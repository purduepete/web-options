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
         ROLLBACK;`,
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
        label: 'SELECT dbo.user_api_keys (must NOT be readable)',
        expect: 'deny',
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
                    (!allowed && detail ? `\n            ${detail}` : ''),
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
