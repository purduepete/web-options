import fs from 'node:fs';
import path from 'node:path';
import ini from 'ini';

export interface DbConfig {
    server: string;
    database: string;
    user: string;
    password: string;
}

export interface AppConfig {
    db: DbConfig;
    port: number;
    host: string;
    nodeEnv: string;
}

function readIniFallback(configPath: string): Partial<DbConfig> {
    if (!fs.existsSync(configPath)) return {};
    const parsed = ini.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
        string,
        Record<string, string> | undefined
    >;
    const section = parsed.Database ?? parsed.database ?? {};
    return {
        server: section.server,
        database: section.database,
        user: section.username ?? section.user,
        password: section.password,
    };
}

/**
 * Env vars are primary because jimbrownhome has no config.ini. The ini path is a
 * dev-laptop convenience only, and is never how the deployed service is configured.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const iniPath = env.WEBPORTFOLIO_CONFIG_PATH;
    const fallback = iniPath ? readIniFallback(path.resolve(iniPath)) : {};

    const db: Partial<DbConfig> = {
        server: env.DB_SERVER ?? fallback.server,
        database: env.DB_NAME ?? fallback.database,
        user: env.DB_USER ?? fallback.user,
        password: env.DB_PASSWORD ?? fallback.password,
    };

    const missing = (['server', 'database', 'user', 'password'] as const).filter((key) => !db[key]);
    if (missing.length > 0) {
        throw new Error(
            `Database configuration incomplete — missing ${missing.join(', ')}. ` +
                'Set DB_SERVER / DB_NAME / DB_USER / DB_PASSWORD, or point ' +
                'WEBPORTFOLIO_CONFIG_PATH at a config.ini with a [Database] section.',
        );
    }

    return {
        db: db as DbConfig,
        port: Number(env.PORT ?? 5057),
        host: env.HOST ?? '0.0.0.0',
        nodeEnv: env.NODE_ENV ?? 'development',
    };
}
