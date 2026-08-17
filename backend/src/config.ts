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
    webRoot: string | null;
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
 * Unset in development, where Vite serves the app and proxies here. Set in
 * production, where this process is the only one running. A set-but-wrong path
 * fails at startup rather than quietly serving an API with no app in front of it.
 */
function resolveWebRoot(value: string | undefined): string | null {
    if (!value) return null;
    const root = path.resolve(value);
    if (!fs.existsSync(path.join(root, 'index.html'))) {
        const relative = path.isAbsolute(value) ? '' : ` (${value}, resolved against ${process.cwd()})`;
        throw new Error(
            `WEBOPTIONS_WEB_ROOT is ${root}${relative}, but there is no index.html there. ` +
                'Run npm run build first, or point it at frontend/dist. In development ' +
                'it should not be set at all, since Vite serves the app.',
        );
    }
    return root;
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
        webRoot: resolveWebRoot(env.WEBOPTIONS_WEB_ROOT),
    };
}
