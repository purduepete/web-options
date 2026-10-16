import { describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';

const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weboptions-web-'));
fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Web Options</title>');
fs.mkdirSync(path.join(webRoot, 'assets'));
fs.writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'console.log(1);');

afterAll(() => {
    fs.rmSync(webRoot, { recursive: true, force: true });
});

const base: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    webportfolio: { apiUrl: null, serviceKey: null },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

const env = {
    DB_SERVER: 'unused',
    DB_NAME: 'unused',
    DB_USER: 'weboptions_ro',
    DB_PASSWORD: 'unused',
};

describe('serving the built front end', () => {
    const app = createApp({ ...base, webRoot });

    it('serves the app shell at the root', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.text).toContain('Web Options');
    });

    it.each(['/', '/calendars/2026-08-10', '/assets/app.js', '/api/nope', '/healthz'])(
        'allows only itself and the HTTPS SiteDock origins to frame %s',
        async (url) => {
            const response = await request(app).get(url);
            expect(response.headers['x-frame-options']).toBeUndefined();
            expect(response.headers['content-security-policy']).toBe(
                "frame-ancestors 'self' https://jimbrownhome.tail8ad282.ts.net:9443 https://jimbrownlaptop.tail8ad282.ts.net",
            );
            expect(response.headers['x-content-type-options']).toBe('nosniff');
        },
    );

    it('serves a built asset', async () => {
        const response = await request(app).get('/assets/app.js');
        expect(response.status).toBe(200);
        expect(response.text).toContain('console.log');
    });

    it('answers a client-side deep link with the app shell', async () => {
        const response = await request(app).get('/calendars/2026-08-10');
        expect(response.status).toBe(200);
        expect(response.text).toContain('Web Options');
    });

    it('answers an unknown api route with json, never the app shell', async () => {
        // The key gate runs first, so this is a 401 rather than a 404. Either way
        // it must not fall through to the static handler and return HTML.
        const response = await request(app).get('/api/nope');
        expect(response.status).toBe(401);
        expect(response.headers['content-type']).toContain('application/json');
    });

    it('leaves the probes alone', async () => {
        const response = await request(app).get('/healthz');
        expect(response.body).toEqual({ status: 'ok' });
    });
});

describe('without a web root', () => {
    const app = createApp(base);

    it('404s a page request instead of pretending to be an app', async () => {
        const response = await request(app).get('/calendars/2026-08-10');
        expect(response.status).toBe(404);
    });
});

describe('resolving the web root', () => {
    it('is null when the variable is unset', () => {
        expect(loadConfig(env).webRoot).toBeNull();
    });

    it('resolves to an absolute path', () => {
        expect(loadConfig({ ...env, WEBOPTIONS_WEB_ROOT: webRoot }).webRoot).toBe(path.resolve(webRoot));
    });

    it('refuses a directory with no index.html, rather than serving nothing', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'weboptions-empty-'));
        try {
            expect(() => loadConfig({ ...env, WEBOPTIONS_WEB_ROOT: empty })).toThrow(/no index\.html/);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    // A relative value resolves against the working directory, not the repo root,
    // so the reported path looks invented unless the message says what it used.
    it('names the working directory when the path was relative', () => {
        expect(() => loadConfig({ ...env, WEBOPTIONS_WEB_ROOT: 'no-such-web-root' })).toThrow(/resolved against/);
    });
});

describe('resolving WebPortfolio integration settings', () => {
    it('reads the URL and service key from .secrets files', () => {
        const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'weboptions-secrets-'));
        try {
            fs.writeFileSync(path.join(secrets, 'webportfolio_api_url'), 'https://portfolio.example.test\n');
            fs.writeFileSync(path.join(secrets, 'webportfolio_service.key'), 'service-key\n');

            expect(loadConfig({ ...env, WEBOPTIONS_SECRETS_DIR: secrets }).webportfolio).toEqual({
                apiUrl: 'https://portfolio.example.test',
                serviceKey: 'service-key',
            });
        } finally {
            fs.rmSync(secrets, { recursive: true, force: true });
        }
    });

    it('lets env vars override .secrets files for one-off runs', () => {
        const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'weboptions-secrets-'));
        try {
            fs.writeFileSync(path.join(secrets, 'webportfolio_api_url'), 'https://from-file.example.test\n');
            fs.writeFileSync(path.join(secrets, 'webportfolio_service.key'), 'file-key\n');

            expect(
                loadConfig({
                    ...env,
                    WEBOPTIONS_SECRETS_DIR: secrets,
                    WEBPORTFOLIO_API_URL: 'https://from-env.example.test',
                    WEBPORTFOLIO_SERVICE_KEY: 'env-key',
                }).webportfolio,
            ).toEqual({ apiUrl: 'https://from-env.example.test', serviceKey: 'env-key' });
        } finally {
            fs.rmSync(secrets, { recursive: true, force: true });
        }
    });
});
