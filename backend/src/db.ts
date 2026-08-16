import sql from 'mssql';
import type { DbConfig } from './config';

let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

function buildPoolConfig(db: DbConfig): sql.config {
    return {
        server: db.server,
        database: db.database,
        user: db.user,
        password: db.password,
        options: {
            encrypt: true,
            trustServerCertificate: false,
            // Ask the driver for plain dates; the read path still normalizes defensively.
            useUTC: true,
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
        connectionTimeout: 30_000,
        requestTimeout: 30_000,
    };
}

/**
 * Single lazily-created pool. A pool that has dropped (laptop sleep, Azure SQL
 * idle eviction) is discarded and rebuilt rather than handed out dead.
 */
export async function getPool(db: DbConfig): Promise<sql.ConnectionPool> {
    if (pool?.connected) return pool;
    if (connecting) return connecting;

    connecting = (async () => {
        if (pool) {
            try {
                await pool.close();
            } catch {
                // Already broken; nothing to salvage.
            }
            pool = null;
        }
        const created = new sql.ConnectionPool(buildPoolConfig(db));
        created.on('error', () => {
            pool = null;
        });
        pool = await created.connect();
        return pool;
    })();

    try {
        return await connecting;
    } finally {
        connecting = null;
    }
}

export async function closePool(): Promise<void> {
    const current = pool;
    pool = null;
    if (current) await current.close();
}
