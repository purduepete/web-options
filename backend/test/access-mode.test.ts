import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import * as authRepository from '../src/auth/repository';
import * as cautionRepository from '../src/caution/repository';

const publicOrigin = 'https://web-options.jimlertech.com';
const privateOrigin = 'https://jimbrownhome1.tail8ad282.ts.net:8797';
const config: AppConfig = {
    auth: { mode: 'access', allowedOrigins: [publicOrigin, privateOrigin] },
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    webportfolio: { apiUrl: null, serviceKey: null },
    port: 18797,
    host: '127.0.0.1',
    nodeEnv: 'test',
    webRoot: null,
};
const env = { DB_SERVER: 'unused', DB_NAME: 'unused', DB_USER: 'weboptions_ro', DB_PASSWORD: 'unused' };

afterEach(() => vi.restoreAllMocks());

describe('explicit platform access mode', () => {
    it('defaults to API keys and rejects unknown modes', () => {
        expect(loadConfig(env).auth?.mode).toBe('api-key');
        expect(loadConfig(env).host).toBe('0.0.0.0');
        expect(() => loadConfig({ ...env, WEBOPTIONS_AUTH_MODE: 'aces' })).toThrow(/AUTH_MODE/);
    });

    it('defaults access to loopback without changing SQL or outbound credentials', () => {
        const result = loadConfig({
            ...env, WEBOPTIONS_AUTH_MODE: 'access', WEBOPTIONS_ALLOWED_ORIGINS: publicOrigin,
            WEBPORTFOLIO_API_URL: 'https://portfolio.example.test', WEBPORTFOLIO_SERVICE_KEY: 'outbound-key',
        });
        expect(result.host).toBe('127.0.0.1');
        expect(result.db).toEqual(config.db);
        expect(result.webportfolio.serviceKey).toBe('outbound-key');
    });

    it.each(['0.0.0.0', '::', 'localhost', '192.168.1.10'])('rejects nonliteral-loopback host %s', (host) => {
        expect(() => createApp({ ...config, host })).toThrow(/loopback/);
        expect(() => loadConfig({ ...env, HOST: host, WEBOPTIONS_AUTH_MODE: 'access', WEBOPTIONS_ALLOWED_ORIGINS: publicOrigin }))
            .toThrow(/loopback/);
    });

    it.each(['', '*', 'null', 'http://example.test', `${publicOrigin}/`, `${publicOrigin}/path`])('rejects unsafe origins %s', (origins) => {
        expect(() => loadConfig({ ...env, WEBOPTIONS_AUTH_MODE: 'access', WEBOPTIONS_ALLOWED_ORIGINS: origins }))
            .toThrow(/exact HTTPS/);
    });

    it('returns platform identity without a key lookup or forged user identity', async () => {
        const lookup = vi.spyOn(authRepository, 'findActiveKey');
        const result = await request(createApp(config)).get('/api/me').set('cf-access-authenticated-user-email', 'spoof@example.test');
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ authMode: 'access', label: 'Deployment platform access' });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('keeps the outbound Portfolio service key in access mode', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })));
        const response = await request(createApp({
            ...config, webportfolio: { apiUrl: 'https://portfolio.example.test', serviceKey: 'outbound-key' },
        })).get('/api/owned-contracts');
        expect(response.status).toBe(200);
        expect(fetch).toHaveBeenCalledWith(
            new URL('https://portfolio.example.test/api/option-transactions/open-positions/realtime'),
            expect.objectContaining({ headers: { Accept: 'application/json', 'X-API-Key': 'outbound-key' } }),
        );
        expect(JSON.stringify(response.body)).not.toContain('outbound-key');
    });

    it.each([undefined, 'null', 'https://evil.example', `${publicOrigin}.evil.test`, `${privateOrigin}0`])(
        'blocks mutation before repository access from %s', async (origin) => {
            const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols');
            const call = request(createApp(config)).put('/api/caution-symbols').send({ symbols: ['AAPL'] });
            if (origin) call.set('Origin', origin);
            const response = await call;
            expect(response.status).toBe(403);
            expect(replace).not.toHaveBeenCalled();
        },
    );

    it.each([publicOrigin, privateOrigin])('accepts mutation from exact allowed origin %s', async (origin) => {
        // Repository is mocked: this test never opens a database connection.
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols').mockResolvedValue(['AAPL']);
        const response = await request(createApp(config)).put('/api/caution-symbols').set('Origin', origin).send({ symbols: ['AAPL'] });
        expect(response.status).toBe(200);
        expect(replace).toHaveBeenCalledOnce();
        expect(response.headers['access-control-allow-origin']).toBe(origin);
    });

    it('does not reflect unapproved CORS origins', async () => {
        const response = await request(createApp(config)).options('/api/caution-symbols')
            .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'PUT');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
});
