import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    webportfolio: { apiUrl: 'https://portfolio.example.test', serviceKey: 'service-key' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

function agent(overrides: Partial<AppConfig> = {}) {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null,
    );
    return request(createApp({ ...config, ...overrides }));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /api/owned-contracts', () => {
    it('needs a WebOptions key before it can proxy anywhere', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const response = await agent().get('/api/owned-contracts');

        expect(response.status).toBe(401);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reports missing WebPortfolio configuration as unavailable', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const response = await agent({ webportfolio: { apiUrl: null, serviceKey: null } })
            .get('/api/owned-contracts')
            .set('x-api-key', VALID_KEY);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            error: 'webportfolio API is not configured',
            code: 'webportfolio_not_configured',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('proxies to WebPortfolio with the service key and returns positions', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: [
                        {
                            id: 42,
                            symbol: 'RDDT',
                            isPaper: false,
                            quote: { quoteStatus: 'ok' },
                        },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        );

        const response = await agent().get('/api/owned-contracts').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body.positions).toEqual([
            { id: 42, symbol: 'RDDT', isPaper: false, quote: { quoteStatus: 'ok' } },
        ]);
        expect(response.body.generatedAt).toEqual(expect.any(String));
        expect(fetchSpy).toHaveBeenCalledWith(
            new URL('/api/option-transactions/open-positions/realtime', config.webportfolio.apiUrl!),
            {
                headers: { Accept: 'application/json', 'X-API-Key': 'service-key' },
                signal: expect.any(AbortSignal),
            },
        );
    });

    it('forwards an explicit forced refresh to WebPortfolio', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        const response = await agent().get('/api/owned-contracts?refresh=true').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledWith(
            new URL('/api/option-transactions/open-positions/realtime?refresh=true', config.webportfolio.apiUrl!),
            {
                headers: { Accept: 'application/json', 'X-API-Key': 'service-key' },
                signal: expect.any(AbortSignal),
            },
        );
    });

    it('rejects unsupported refresh values before calling WebPortfolio', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const response = await agent().get('/api/owned-contracts?refresh=false').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'refresh must be true when provided' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('maps WebPortfolio auth failures without leaking credentials', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ success: false, error: 'forbidden' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
            }),
        );

        const response = await agent().get('/api/owned-contracts').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'forbidden', code: 'webportfolio_unauthorized' });
        expect(JSON.stringify(response.body)).not.toContain('service-key');
    });

    it('maps an unreachable WebPortfolio API to a service outage', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

        const response = await agent().get('/api/owned-contracts').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: 'webportfolio API did not answer', code: 'webportfolio_unreachable' });
    });
});
