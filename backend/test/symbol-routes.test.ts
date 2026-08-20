import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { GRADE_DEFAULTS, type SymbolDetail } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as marketService from '../src/market/service';
import * as settingsRepository from '../src/settings/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

function agent() {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null,
    );
    return request(createApp(config));
}

const DETAIL: SymbolDetail = {
    symbol: 'VST',
    longName: 'Vistra Corp.',
    exchange: 'NYSE',
    currency: 'USD',
    price: 182.35,
    priceDate: '2026-08-18',
    stale: false,
    sma50: 170,
    sma200: 150,
    bars: [{ date: '2026-08-18', close: 182.35 }],
    pastSignals: [],
    outcome: null,
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /api/symbols/:symbol', () => {
    it('needs a key', async () => {
        const detail = vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        const response = await agent().get('/api/symbols/VST');

        expect(response.status).toBe(401);
        expect(detail).not.toHaveBeenCalled();
    });

    it('answers with the detail', async () => {
        vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        const response = await agent().get('/api/symbols/VST').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(DETAIL);
    });

    it('passes the viewed contract through so it is excluded from its own history', async () => {
        const detail = vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        await agent()
            .get('/api/symbols/VST')
            .query({ strike: '170.5', expiration: '2026-08-21' })
            .set('x-api-key', VALID_KEY);

        expect(detail.mock.calls[0]?.[2]).toEqual({
            exclude: { strike: 170.5, expiration: '2026-08-21' },
            reportDate: null,
        });
    });

    it('passes the report date through, which is what names the outcome row', async () => {
        const detail = vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        await agent()
            .get('/api/symbols/VST')
            .query({ strike: '170.5', expiration: '2026-08-21', reportDate: '2026-08-18' })
            .set('x-api-key', VALID_KEY);

        expect(detail.mock.calls[0]?.[2]).toEqual({
            exclude: { strike: 170.5, expiration: '2026-08-21' },
            reportDate: '2026-08-18',
        });
    });

    it('asks for no exclusion when no contract was named', async () => {
        const detail = vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        await agent().get('/api/symbols/VST').set('x-api-key', VALID_KEY);

        expect(detail.mock.calls[0]?.[2]).toEqual({
            exclude: { strike: null, expiration: null },
            reportDate: null,
        });
    });

    it.each([
        ['a strike that is not a number', { strike: 'cheap' }],
        ['an expiration that is not a date', { expiration: '21/08/2026' }],
        ['an expiration with no dashes', { expiration: '20260821' }],
        ['a report date that is not a date', { reportDate: 'monday' }],
    ])('refuses %s', async (_label, query) => {
        const detail = vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        const response = await agent().get('/api/symbols/VST').query(query).set('x-api-key', VALID_KEY);

        expect(response.status).toBe(400);
        expect(detail).not.toHaveBeenCalled();
    });

    it('checks the SHAPE of an expiration, not the calendar', async () => {
        // `isIsoDate` is shared with every other route and tests the pattern only.
        // A date that never happened is harmless here: it matches no past signal.
        vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(DETAIL);
        const response = await agent()
            .get('/api/symbols/VST')
            .query({ expiration: '2026-13-45' })
            .set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
    });

    it('refuses a symbol that is not a ticker', async () => {
        // Null from the service means the symbol was rejected, not that Yahoo was down.
        vi.spyOn(marketService, 'getSymbolDetail').mockResolvedValue(null);
        const response = await agent().get('/api/symbols/not%20a%20ticker').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(400);
    });
});

describe('GET /api/grade-settings', () => {
    it('needs a key', async () => {
        const read = vi.spyOn(settingsRepository, 'readGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent().get('/api/grade-settings');

        expect(response.status).toBe(401);
        expect(read).not.toHaveBeenCalled();
    });

    it('answers with the stored thresholds', async () => {
        vi.spyOn(settingsRepository, 'readGradeSettings').mockResolvedValue({
            ...GRADE_DEFAULTS,
            deltaThreshold: -0.4,
        });
        const response = await agent().get('/api/grade-settings').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ settings: { ...GRADE_DEFAULTS, deltaThreshold: -0.4 } });
    });
});

describe('PUT /api/grade-settings', () => {
    it('needs a key', async () => {
        const replace = vi.spyOn(settingsRepository, 'replaceGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent().put('/api/grade-settings').send({ settings: GRADE_DEFAULTS });

        expect(response.status).toBe(401);
        expect(replace).not.toHaveBeenCalled();
    });

    it('stores all four and answers with what was stored', async () => {
        const replace = vi
            .spyOn(settingsRepository, 'replaceGradeSettings')
            .mockImplementation(async (_db, settings) => settings);
        const settings = { ...GRADE_DEFAULTS, otmPercentThreshold: 12 };
        const response = await agent().put('/api/grade-settings').set('x-api-key', VALID_KEY).send({ settings });

        expect(response.status).toBe(200);
        expect(replace.mock.calls[0]?.[1]).toEqual(settings);
        expect(response.body).toEqual({ settings });
    });

    it.each([
        ['no settings at all', {}],
        ['a bare number', { settings: 4 }],
        ['an array', { settings: [] }],
        ['null', { settings: null }],
    ])('refuses %s', async (_label, body) => {
        const replace = vi.spyOn(settingsRepository, 'replaceGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent().put('/api/grade-settings').set('x-api-key', VALID_KEY).send(body);

        expect(response.status).toBe(400);
        expect(replace).not.toHaveBeenCalled();
    });

    it('refuses a key it does not recognise rather than silently dropping it', async () => {
        const replace = vi.spyOn(settingsRepository, 'replaceGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent()
            .put('/api/grade-settings')
            .set('x-api-key', VALID_KEY)
            .send({ settings: { ...GRADE_DEFAULTS, ivRankFloor: 30 } });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('ivRankFloor');
        expect(replace).not.toHaveBeenCalled();
    });

    it('refuses a partial save', async () => {
        const replace = vi.spyOn(settingsRepository, 'replaceGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent()
            .put('/api/grade-settings')
            .set('x-api-key', VALID_KEY)
            .send({ settings: { deltaThreshold: -0.3 } });

        expect(response.status).toBe(400);
        expect(replace).not.toHaveBeenCalled();
    });

    it('refuses a threshold sent as text, so "30" cannot become the string "30"', async () => {
        const response = await agent()
            .put('/api/grade-settings')
            .set('x-api-key', VALID_KEY)
            .send({ settings: { ...GRADE_DEFAULTS, annualizedRedBelow: '20' } });

        expect(response.status).toBe(400);
    });

    it.each([
        ['a positive delta threshold', { deltaThreshold: 0.25 }],
        ['a cushion below zero', { otmPercentThreshold: -5 }],
        ['a yield threshold past the ceiling', { annualizedYellowBelow: 5000 }],
        ['red above yellow, which nothing could grade yellow', { annualizedRedBelow: 40 }],
    ])('refuses %s', async (_label, overrides) => {
        const replace = vi.spyOn(settingsRepository, 'replaceGradeSettings').mockResolvedValue(GRADE_DEFAULTS);
        const response = await agent()
            .put('/api/grade-settings')
            .set('x-api-key', VALID_KEY)
            .send({ settings: { ...GRADE_DEFAULTS, ...overrides } });

        expect(response.status).toBe(400);
        expect(replace).not.toHaveBeenCalled();
    });
});
