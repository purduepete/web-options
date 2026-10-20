import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as calendarRepository from '../src/calendars/repository';
import * as db from '../src/db';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

function driverError(code: string): Error {
    return Object.assign(new Error('connection failed'), { code });
}

function agent() {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null
    );
    return request(createApp(config));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /healthz', () => {
    it('answers without a key, because a service manager has none', async () => {
        const response = await request(createApp(config)).get('/healthz');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
    });

    it('says nothing about the database, which is the whole reason /readyz exists', async () => {
        const ping = vi.spyOn(db, 'pingDatabase').mockRejectedValue(driverError('ESOCKET'));
        const response = await request(createApp(config)).get('/healthz');

        expect(response.status).toBe(200);
        expect(ping).not.toHaveBeenCalled();
    });
});

describe('GET /readyz', () => {
    it('is green only once a query has actually come back', async () => {
        vi.spyOn(db, 'pingDatabase').mockResolvedValue();
        const response = await request(createApp(config)).get('/readyz');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    });

    it('reports a rotated password as such, not as a generic outage', async () => {
        vi.spyOn(db, 'pingDatabase').mockRejectedValue(driverError('ELOGIN'));
        const response = await request(createApp(config)).get('/readyz');

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ status: 'degraded', database: 'database_login_failed' });
    });

    it('reports an unreachable server', async () => {
        vi.spyOn(db, 'pingDatabase').mockRejectedValue(driverError('ETIMEOUT'));
        const response = await request(createApp(config)).get('/readyz');

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ status: 'degraded', database: 'database_unreachable' });
    });

    it('assumes an outage when the failure carries no driver code', async () => {
        vi.spyOn(db, 'pingDatabase').mockRejectedValue(new Error('who knows'));
        const response = await request(createApp(config)).get('/readyz');

        expect(response.status).toBe(503);
        expect(response.body.database).toBe('database_unreachable');
    });
});

describe('failures on a data route', () => {
    it('answers 503 with a code when the database is the problem', async () => {
        vi.spyOn(calendarRepository, 'listCalendars').mockRejectedValue(driverError('ESOCKET'));
        const response = await agent().get('/api/calendars').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: 'database unavailable', code: 'database_unreachable' });
    });

    it('still answers 500 for a bug, so an outage and a mistake stay distinguishable', async () => {
        vi.spyOn(calendarRepository, 'listCalendars').mockRejectedValue(new TypeError('undefined is not a function'));
        const response = await agent().get('/api/calendars').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'internal error', code: 'internal' });
    });

    it('keeps the driver message to itself', async () => {
        vi.spyOn(calendarRepository, 'listCalendars').mockRejectedValue(
            driverError('ELOGIN') as Error & { code: string }
        );
        const response = await agent().get('/api/calendars').set('x-api-key', VALID_KEY);

        expect(JSON.stringify(response.body)).not.toContain('connection failed');
    });
});
