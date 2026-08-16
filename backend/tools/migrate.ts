import fs from 'node:fs';
import path from 'node:path';
import { connectAsOperator, describeTarget, loadOperatorConfig } from './operator';

/**
 * Applies database/migrations/*.sql in filename order, as the operator login.
 *
 * Never wired into server startup. A process that migrates on boot is a process
 * that can alter the schema, which is exactly what the service login must not be
 * able to do. Every migration carries its own existence guard, so re-running the
 * whole set is a no-op rather than an error — that is the idempotency contract
 * this runner relies on instead of a ledger table.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

/** Splits on batch separators, which SQL Server itself never sees. */
export function splitBatches(script: string): string[] {
    return script
        .split(/^\s*GO\s*(?:--.*)?$/gim)
        .map((batch) => batch.trim())
        .filter((batch) => batch.length > 0);
}

async function main(): Promise<void> {
    const confirmed = process.argv.includes('--confirm');
    const config = loadOperatorConfig();

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    console.log(`target   ${describeTarget(config)}`);
    console.log(`migrations ${files.length}`);
    for (const file of files) console.log(`  ${file}`);

    if (!confirmed) {
        console.log('\nDry run. This altered nothing. To apply:');
        console.log('  npx tsx backend/tools/migrate.ts --confirm');
        console.log('(npm run swallows --confirm, so call the tool directly.)');
        return;
    }

    const pool = await connectAsOperator(config);
    try {
        for (const file of files) {
            const script = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
            const batches = splitBatches(script);
            process.stdout.write(`applying ${file} (${batches.length} batches) ... `);
            for (const batch of batches) {
                await pool.request().batch(batch);
            }
            console.log('ok');
        }
        console.log('\nAll migrations applied.');
    } finally {
        await pool.close();
    }
}

main().catch((error: Error) => {
    console.error(`migration failed: ${error.message}`);
    process.exitCode = 1;
});
