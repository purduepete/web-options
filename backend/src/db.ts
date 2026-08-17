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

export type DbFailure = 'database_unreachable' | 'database_login_failed';

/** Driver codes that mean the database is the problem, not the request. */
const UNREACHABLE = new Set(['ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINSTLOOKUP', 'ENOTFOUND']);

/**
 * Separates "the database is down" from "this code is wrong", so the browser can
 * say which one happened instead of showing the same message for both.
 */
export function classifyDbError(error: unknown): DbFailure | null {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code !== 'string') return null;
    if (code === 'ELOGIN') return 'database_login_failed';
    return UNREACHABLE.has(code) ? 'database_unreachable' : null;
}

/**
 * Readiness, as opposed to liveness. Reading a row from opt.api_key proves in one
 * query that the server is reachable, the login works, the schema is deployed and
 * the grants are still in place.
 */
export async function pingDatabase(db: DbConfig): Promise<void> {
    const ready = await getPool(db);
    await ready.request().query('SELECT TOP 1 1 AS ok FROM opt.api_key');
}
