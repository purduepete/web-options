import sql from 'mssql';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../src/config';

/**
 * Connection helper for the operator tools.
 *
 * These tools are the ONLY write path in the project and they run by hand from the
 * laptop. They are never compiled into dist/, so the artifact deployed to
 * jimbrownhome contains no code capable of writing at all.
 */

export const READ_ONLY_LOGIN = 'weboptions_ro';

// A password echoed to stdout ends up in shell history, terminal scrollback and any
// transcript of the session, so it goes to a gitignored file instead.
export const SECRET_DIR = path.resolve(__dirname, '../../.secrets');
export const SECRET_FILE = path.join(SECRET_DIR, 'weboptions_ro.password');

export function loadOperatorConfig(): AppConfig {
    const config = loadConfig();
    if (config.db.user.toLowerCase() === READ_ONLY_LOGIN) {
        throw new Error(
            `Refusing to run: DB_USER is ${READ_ONLY_LOGIN}, which is the service login and ` +
                'cannot write by design. Operator tools must run as the operator login from ' +
                'the laptop, never on the server.'
        );
    }
    return config;
}

export async function connectAsOperator(config: AppConfig): Promise<sql.ConnectionPool> {
    return new sql.ConnectionPool({
        server: config.db.server,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30_000,
        requestTimeout: 60_000,
    }).connect();
}

export function describeTarget(config: AppConfig): string {
    return `${config.db.user}@${config.db.server}/${config.db.database}`;
}
