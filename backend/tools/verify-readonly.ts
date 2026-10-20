import fs from 'node:fs';
import sql from 'mssql';
import { READ_ONLY_LOGIN, SECRET_FILE, loadOperatorConfig } from './operator';

/**
 * Proves the write/read split is enforced by the database rather than by convention.
 *
 * Connects AS the service login and asserts what it can and cannot do. The write
 * probes run inside a rolled-back transaction so a permission regression is caught
 * without leaving a row behind.
 */

type Probe = { label: string; expect: 'allow' | 'deny'; run: (pool: sql.ConnectionPool) => Promise<unknown> };

const PROBES: Probe[] = [
    {
        label: 'SELECT opt.api_key',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 id FROM opt.api_key'),
    },
    {
        label: 'SELECT opt.telegram_signal',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM opt.telegram_signal'),
    },
    {
        label: 'INSERT opt.api_key',
        expect: 'deny',
        run: (pool) =>
            pool.request().batch(
                `BEGIN TRAN;
         INSERT INTO opt.api_key (key_hash, prefix, label)
         VALUES (REPLICATE('0', 64), 'probe', 'permission probe');
         ROLLBACK;`
            ),
    },
    {
        label: 'UPDATE opt.telegram_signal',
        expect: 'deny',
        run: (pool) => pool.request().batch(`BEGIN TRAN; UPDATE opt.telegram_signal SET symbol = symbol; ROLLBACK;`),
    },
    {
        label: 'CREATE TABLE opt.probe',
        expect: 'deny',
        run: (pool) => pool.request().batch('CREATE TABLE opt.probe (id INT)'),
    },
    {
        label: 'SELECT dbo.option_transactions',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM dbo.option_transactions'),
    },
    {
        label: 'SELECT dbo.user_api_keys (database-wide read access)',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 * FROM dbo.user_api_keys'),
    },
    {
        // Proves the schema-scope GRANT reaches tables created after it was issued.
        label: 'SELECT opt.calendar_week',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 publish_date FROM opt.calendar_week'),
    },
    {
        label: 'DELETE opt.calendar_week',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; DELETE FROM opt.calendar_week; ROLLBACK;'),
    },
    // The optcfg carve-out. These four probes are the whole of the write surface:
    // rows in one table may be replaced, and nothing else about it may change.
    {
        label: 'SELECT optcfg.caution_symbol',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM optcfg.caution_symbol'),
    },
    {
        label: 'INSERT optcfg.caution_symbol',
        expect: 'allow',
        run: (pool) =>
            pool.request().batch(`BEGIN TRAN; INSERT INTO optcfg.caution_symbol (symbol) VALUES ('PROBE'); ROLLBACK;`),
    },
    {
        label: 'DELETE optcfg.caution_symbol',
        expect: 'allow',
        run: (pool) => pool.request().batch('BEGIN TRAN; DELETE FROM optcfg.caution_symbol; ROLLBACK;'),
    },
    {
        label: 'UPDATE optcfg.caution_symbol (rows are replaced, never edited)',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; UPDATE optcfg.caution_symbol SET symbol = symbol; ROLLBACK;'),
    },
    {
        label: 'CREATE TABLE optcfg.probe',
        expect: 'deny',
        run: (pool) => pool.request().batch('CREATE TABLE optcfg.probe (id INT)'),
    },
    // The symbol cache and the app settings, added with the trade drill-in. They
    // are proof that the GRANT at schema scope reaches a table created after it
    // was issued: migration 009 was never re-run for any of these three.
    {
        label: 'SELECT optcfg.symbol_profile',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM optcfg.symbol_profile'),
    },
    {
        label: 'INSERT optcfg.symbol_profile',
        expect: 'allow',
        run: (pool) =>
            pool
                .request()
                .batch(
                    `BEGIN TRAN; INSERT INTO optcfg.symbol_profile (symbol, long_name) VALUES ('PROBE', 'probe'); ROLLBACK;`
                ),
    },
    {
        label: 'DELETE optcfg.symbol_profile',
        expect: 'allow',
        run: (pool) =>
            pool.request().batch(`BEGIN TRAN; DELETE FROM optcfg.symbol_profile WHERE symbol = 'PROBE'; ROLLBACK;`),
    },
    {
        label: 'UPDATE optcfg.symbol_profile (a refresh replaces the row)',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; UPDATE optcfg.symbol_profile SET symbol = symbol; ROLLBACK;'),
    },
    {
        label: 'SELECT optcfg.price_bar',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM optcfg.price_bar'),
    },
    {
        label: 'INSERT optcfg.price_bar',
        expect: 'allow',
        run: (pool) =>
            pool
                .request()
                .batch(
                    `BEGIN TRAN; INSERT INTO optcfg.price_bar (symbol, bar_date, [close]) VALUES ('PROBE', '2000-01-03', 1); ROLLBACK;`
                ),
    },
    {
        label: 'DELETE optcfg.price_bar',
        expect: 'allow',
        run: (pool) =>
            pool.request().batch(`BEGIN TRAN; DELETE FROM optcfg.price_bar WHERE symbol = 'PROBE'; ROLLBACK;`),
    },
    {
        label: 'UPDATE optcfg.price_bar (a refresh replaces the row)',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; UPDATE optcfg.price_bar SET symbol = symbol; ROLLBACK;'),
    },
    {
        label: 'SELECT optcfg.app_setting',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 name FROM optcfg.app_setting'),
    },
    {
        label: 'INSERT optcfg.app_setting',
        expect: 'allow',
        run: (pool) =>
            pool
                .request()
                .batch(`BEGIN TRAN; INSERT INTO optcfg.app_setting (name, value) VALUES ('probe', '1'); ROLLBACK;`),
    },
    {
        label: 'DELETE optcfg.app_setting',
        expect: 'allow',
        run: (pool) =>
            pool.request().batch(`BEGIN TRAN; DELETE FROM optcfg.app_setting WHERE name = 'probe'; ROLLBACK;`),
    },
    {
        label: 'UPDATE optcfg.app_setting (a save replaces the row)',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; UPDATE optcfg.app_setting SET value = value; ROLLBACK;'),
    },
    // The one object outside opt and optcfg this login may touch, granted by name
    // in migration 012 so the navbar can show the VIX. Read, and only read.
    {
        label: 'SELECT dbo.stock_price',
        expect: 'allow',
        run: (pool) => pool.request().query('SELECT TOP 1 symbol FROM dbo.stock_price'),
    },
    {
        label: 'UPDATE dbo.stock_price',
        expect: 'deny',
        run: (pool) => pool.request().batch('BEGIN TRAN; UPDATE dbo.stock_price SET symbol = symbol; ROLLBACK;'),
    },
];

async function main(): Promise<void> {
    const config = loadOperatorConfig();
    if (!fs.existsSync(SECRET_FILE)) {
        throw new Error(`No password file at ${SECRET_FILE}. Run create-readonly-user first.`);
    }
    const password = fs.readFileSync(SECRET_FILE, 'utf-8').trim();

    const pool = await new sql.ConnectionPool({
        server: config.db.server,
        database: config.db.database,
        user: READ_ONLY_LOGIN,
        password,
        options: { encrypt: true, trustServerCertificate: false },
    }).connect();

    console.log(`connected as ${READ_ONLY_LOGIN}@${config.db.server}/${config.db.database}\n`);

    let failures = 0;
    try {
        for (const probe of PROBES) {
            let allowed: boolean;
            let detail = '';
            try {
                await probe.run(pool);
                allowed = true;
            } catch (error) {
                allowed = false;
                detail = (error as Error).message.split('\n')[0] ?? '';
            }
            const pass = allowed === (probe.expect === 'allow');
            if (!pass) failures += 1;
            console.log(
                `${pass ? 'PASS' : 'FAIL'}  ${probe.expect.padEnd(5)}  ${probe.label}` +
                    (!allowed && detail ? `\n            ${detail}` : '')
            );
        }
    } finally {
        await pool.close();
    }

    console.log(`\n${PROBES.length - failures}/${PROBES.length} probes as expected.`);
    if (failures > 0) process.exitCode = 1;
}

main().catch((error: Error) => {
    console.error(`verification failed: ${error.message}`);
    process.exitCode = 1;
});
