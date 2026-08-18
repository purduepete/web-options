import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { WeeklyReport } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as reportRepository from '../src/reports/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

const report: WeeklyReport = {
    publishDate: '2026-08-17',
    title: null,
    sourceUrl: 'https://themultiplier.substack.com/p/6853-in-weekly-options-income-from',
    macro: [{ label: 'VIX', text: 'lowest close of the period' }],
    metrics: {
        netPnl: 6853,
        closedLegs: 38,
        winningLegs: 35,
        rollLegs: 3,
        hitRate: 92.1,
        winnersAmount: 6911,
        rollCost: 58,
        collateral: 455150,
        returnPct: 1.51,
        newPositions: 38,
        newPremium: 12853,
        netCash: 8748,
        medianDaysHeld: 10,
        openPositionsTotal: 87,
        openCalls: 55,
        openPuts: 32,
        openGreen: 23,
        openYellow: 24,
        openRed: 40,
    },
    callouts: [{ ticker: 'ALB', kind: 'roll', headline: 'Roll chain closed near max profit', body: null }],
};

function stubKeyring(): void {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null,
    );
}

function agent() {
    stubKeyring();
    return request(createApp(config));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /api/reports', () => {
    it('needs a key', async () => {
        const list = vi.spyOn(reportRepository, 'listReports').mockResolvedValue([]);
        const response = await agent().get('/api/reports');
        expect(response.status).toBe(401);
        expect(list).not.toHaveBeenCalled();
    });

    it('returns the index newest first', async () => {
        vi.spyOn(reportRepository, 'listReports').mockResolvedValue([
            { publishDate: '2026-08-17', title: null, netPnl: 6853, hitRate: 92.1, calloutCount: 4 },
        ]);
        const response = await agent().get('/api/reports').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body.reports).toHaveLength(1);
        expect(response.body.reports[0].calloutCount).toBe(4);
    });

    it('returns an empty archive rather than erroring when nothing has been ingested', async () => {
        vi.spyOn(reportRepository, 'listReports').mockResolvedValue([]);
        const response = await agent().get('/api/reports').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body.reports).toEqual([]);
    });
});

describe('GET /api/reports/:publishDate', () => {
    it('returns the whole week, metrics and callouts included', async () => {
        vi.spyOn(reportRepository, 'fetchReport').mockResolvedValue(report);
        const response = await agent().get('/api/reports/2026-08-17').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body.metrics.netPnl).toBe(6853);
        expect(response.body.callouts).toHaveLength(1);
    });

    it('404s for a date with no report', async () => {
        vi.spyOn(reportRepository, 'fetchReport').mockResolvedValue(null);
        const response = await agent().get('/api/reports/2026-01-05').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'no report for that date' });
    });

    it('400s before touching the database when the date is malformed', async () => {
        const fetch = vi.spyOn(reportRepository, 'fetchReport');
        const response = await agent().get('/api/reports/last-week').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
});
