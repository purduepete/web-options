import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from '../config';

let pool: Pool | undefined;

export class HistoryUnavailable extends Error {}

export async function withHistory<T>(config: AppConfig, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!config.history) throw new HistoryUnavailable('History database is not configured.');
    if (process.env.PGPASSWORD || process.env.PGPASSFILE !== config.history.passfile) {
        throw new HistoryUnavailable('History password-file configuration is invalid.');
    }
    if (!pool) {
        pool = new Pool({
            host: '127.0.0.1',
            port: 5432,
            database: 'web_options',
            user: 'sd_web_options_reader',
            max: 3,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c timezone=UTC',
        });
        pool.on('error', reportPoolError);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

function reportPoolError(): void {
    console.error('[history] idle database connection lost');
}

export async function closeHistoryPool(): Promise<void> {
    const current = pool;
    pool = undefined;
    await current?.end();
}
