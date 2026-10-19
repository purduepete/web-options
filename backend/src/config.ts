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
    auth?: { mode: 'api-key' | 'access'; allowedOrigins: string[] };
    db: DbConfig;
    webportfolio: {
        apiUrl: string | null;
        serviceKey: string | null;
    };
    port: number;
    host: string;
    nodeEnv: string;
    webRoot: string | null;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SECRETS_DIR = path.join(REPO_ROOT, '.secrets');

function clean(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function readSecretFile(fileName: string, secretsDir = DEFAULT_SECRETS_DIR): string | null {
    const filePath = path.join(secretsDir, fileName);
    if (!fs.existsSync(filePath)) return null;
    return clean(fs.readFileSync(filePath, 'utf-8'));
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
    const mode = env.WEBOPTIONS_AUTH_MODE ?? 'api-key';
    if (mode !== 'api-key' && mode !== 'access') {
        throw new Error('WEBOPTIONS_AUTH_MODE must be api-key or access');
    }
    const auth: NonNullable<AppConfig['auth']> = {
        mode,
        allowedOrigins: (env.WEBOPTIONS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    };
    const iniPath = env.WEBPORTFOLIO_CONFIG_PATH;
    const fallback = iniPath ? readIniFallback(path.resolve(iniPath)) : {};
    const secretsDir = env.WEBOPTIONS_SECRETS_DIR ? path.resolve(env.WEBOPTIONS_SECRETS_DIR) : DEFAULT_SECRETS_DIR;

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

    const config: AppConfig = {
        auth,
        db: db as DbConfig,
        webportfolio: {
            apiUrl: clean(env.WEBPORTFOLIO_API_URL) ?? readSecretFile('webportfolio_api_url', secretsDir),
            serviceKey: clean(env.WEBPORTFOLIO_SERVICE_KEY) ?? readSecretFile('webportfolio_service.key', secretsDir),
        },
        port: Number(env.PORT ?? 5057),
        host: env.HOST ?? (mode === 'access' ? '127.0.0.1' : '0.0.0.0'),
        nodeEnv: env.NODE_ENV ?? 'development',
        webRoot: resolveWebRoot(env.WEBOPTIONS_WEB_ROOT),
    };
    validateAccessConfig(config);
    return config;
}

export function validateAccessConfig(config: AppConfig): void {
    if (config.auth?.mode !== 'access') return;
    // Literal addresses avoid DNS resolving a loopback-looking name elsewhere.
    if (!['127.0.0.1', '::1'].includes(config.host)) {
        throw new Error('Access mode requires a literal loopback HOST (127.0.0.1 or ::1)');
    }
    if (!config.auth.allowedOrigins.length || config.auth.allowedOrigins.some((origin) => {
        try {
            const url = new URL(origin);
            return url.protocol !== 'https:' || url.origin !== origin;
        } catch {
            return true;
        }
    })) {
        throw new Error('Access mode requires exact HTTPS WEBOPTIONS_ALLOWED_ORIGINS without paths or trailing slashes');
    }
}
