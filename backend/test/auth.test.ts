import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as signalsRepository from '../src/signals/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
};

function stubKeyring(): void {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null,
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('api key gate', () => {
    it('leaves /healthz open so a service manager can probe without a key', async () => {
        const response = await request(createApp(config)).get('/healthz');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
    });

    it('rejects an unauthenticated /api request', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get('/api/health');
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'api key required' });
    });

    it('rejects an unknown key', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get('/api/health').set('x-api-key', 'woak_nope');
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'invalid api key' });
    });

    it('accepts the key in the x-api-key header', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get('/api/health').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
    });

    it('accepts the key in an Authorization: ApiKey header', async () => {
        stubKeyring();
        const response = await request(createApp(config))
            .get('/api/health')
            .set('authorization', `ApiKey ${VALID_KEY}`);
        expect(response.status).toBe(200);
    });

    it('ignores a Bearer token, which is not a scheme this app issues', async () => {
        stubKeyring();
        const response = await request(createApp(config))
            .get('/api/health')
            .set('authorization', `Bearer ${VALID_KEY}`);
        expect(response.status).toBe(401);
    });

    it('never accepts a key from the query string, which morgan would log', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get(`/api/health?api_key=${VALID_KEY}`);
        expect(response.status).toBe(401);
    });

    it('gates the data route, not just health', async () => {
        stubKeyring();
        const fetchWeek = vi.spyOn(signalsRepository, 'fetchWeek');
        const response = await request(createApp(config)).get('/api/week-signals');
        expect(response.status).toBe(401);
        expect(fetchWeek).not.toHaveBeenCalled();
    });

    it('gates unknown /api paths too, so the 404 reveals no routing map', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get('/api/does-not-exist');
        expect(response.status).toBe(401);
    });

    it('reports the calling key from /api/me without echoing it', async () => {
        stubKeyring();
        const response = await request(createApp(config)).get('/api/me').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null });
        expect(JSON.stringify(response.body)).not.toContain(VALID_KEY);
    });

    it('surfaces a keyring lookup failure as 500 without leaking the reason', async () => {
        vi.spyOn(authRepository, 'findActiveKey').mockRejectedValue(new Error('login failed for weboptions_ro'));
        const response = await request(createApp(config)).get('/api/health').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'internal error', code: 'internal' });
    });
});
