import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { generateKey, hashKey, keyPrefix } from '../src/auth/key';
import { SECRET_DIR, connectAsOperator, describeTarget, loadOperatorConfig } from './operator';

/**
 * Operator tool for the API keyring. Runs by hand as the operator login; the
 * service login is denied every write, so it can never mint or revoke a key.
 *
 *   npx tsx backend/tools/manage-keys.ts list
 *   npx tsx backend/tools/manage-keys.ts mint --label "Phone" [--expires 2027-01-01] --confirm
 *   npx tsx backend/tools/manage-keys.ts revoke --prefix woak_AbC123 --confirm
 */

const USAGE = `usage:
  manage-keys.ts list
  manage-keys.ts mint --label <text> [--expires YYYY-MM-DD] --confirm
  manage-keys.ts revoke --prefix <prefix> --confirm`;

function flag(argv: string[], name: string): string | null {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return null;
    return argv[index + 1] ?? null;
}

function slug(label: string): string {
    return (
        label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'key'
    );
}

async function list(pool: sql.ConnectionPool): Promise<void> {
    const result = await pool.request().query<{
        id: number;
        prefix: string;
        label: string;
        created_at: Date;
        expires_at: Date | null;
        is_revoked: boolean;
    }>(
        `SELECT id, prefix, label, created_at, expires_at, is_revoked
         FROM opt.api_key ORDER BY id`
    );

    if (result.recordset.length === 0) {
        console.log('No keys. Mint one with: manage-keys.ts mint --label "..." --confirm');
        return;
    }

    for (const row of result.recordset) {
        const state = row.is_revoked
            ? 'revoked'
            : row.expires_at && row.expires_at <= new Date()
              ? 'expired'
              : 'active';
        const expires = row.expires_at ? row.expires_at.toISOString().slice(0, 10) : 'never';
        console.log(
            `${String(row.id).padStart(3)}  ${row.prefix.padEnd(14)} ${state.padEnd(8)} ` +
                `expires ${expires.padEnd(11)} ${row.label}`
        );
    }
}

async function mint(pool: sql.ConnectionPool, argv: string[], confirmed: boolean): Promise<void> {
    const label = flag(argv, 'label');
    if (!label) throw new Error('mint requires --label');

    const expires = flag(argv, 'expires');
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
        throw new Error('--expires must be YYYY-MM-DD');
    }

    console.log(`label   ${label}`);
    console.log(`expires ${expires ?? 'never'}`);

    if (!confirmed) {
        console.log('\nDry run. This altered nothing. Re-run with --confirm to mint.');
        return;
    }

    const key = generateKey();
    await pool
        .request()
        .input('keyHash', sql.Char(64), hashKey(key))
        .input('prefix', sql.VarChar(16), keyPrefix(key))
        .input('label', sql.NVarChar(100), label)
        .input('expiresAt', sql.VarChar(10), expires)
        .query(
            `INSERT INTO opt.api_key (key_hash, prefix, label, expires_at)
             VALUES (@keyHash, @prefix, @label, CAST(@expiresAt AS DATETIME2(0)))`
        );

    // The key is unrecoverable after this, and printing it would put a live
    // credential into shell history and any transcript.
    fs.mkdirSync(SECRET_DIR, { recursive: true });
    const file = path.join(SECRET_DIR, `${slug(label)}.key`);
    fs.writeFileSync(file, key, { encoding: 'utf-8', mode: 0o600 });

    console.log(`\nMinted ${keyPrefix(key)}...`);
    console.log(`Key written to ${file}`);
    console.log('That path is gitignored. Paste the value into the app, then delete the file.');
}

async function revoke(pool: sql.ConnectionPool, argv: string[], confirmed: boolean): Promise<void> {
    const prefix = flag(argv, 'prefix');
    if (!prefix) throw new Error('revoke requires --prefix (see: manage-keys.ts list)');

    const found = await pool.request().input('prefix', sql.VarChar(16), prefix).query<{
        id: number;
        label: string;
        is_revoked: boolean;
    }>('SELECT id, label, is_revoked FROM opt.api_key WHERE prefix = @prefix');

    if (found.recordset.length === 0) throw new Error(`No key with prefix ${prefix}`);
    for (const row of found.recordset) {
        console.log(`${row.id}  ${row.label}${row.is_revoked ? '  (already revoked)' : ''}`);
    }

    if (!confirmed) {
        console.log('\nDry run. This altered nothing. Re-run with --confirm to revoke.');
        return;
    }

    await pool
        .request()
        .input('prefix', sql.VarChar(16), prefix)
        .query('UPDATE opt.api_key SET is_revoked = 1 WHERE prefix = @prefix');

    console.log('\nRevoked. The next request with that key is rejected.');
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const confirmed = argv.includes('--confirm');

    if (!command || !['list', 'mint', 'revoke'].includes(command)) {
        console.log(USAGE);
        process.exitCode = 1;
        return;
    }

    const config = loadOperatorConfig();
    console.log(`target ${describeTarget(config)}\n`);

    const pool = await connectAsOperator(config);
    try {
        if (command === 'list') await list(pool);
        else if (command === 'mint') await mint(pool, argv, confirmed);
        else await revoke(pool, argv, confirmed);
    } finally {
        await pool.close();
    }
}

main().catch((error: Error) => {
    console.error(`failed: ${error.message}`);
    process.exitCode = 1;
});
