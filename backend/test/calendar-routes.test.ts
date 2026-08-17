import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { CalendarWeek } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as calendarRepository from '../src/calendars/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

const week: CalendarWeek = {
    publishDate: '2026-08-10',
    weekStart: '2026-08-10',
    weekEnd: '2026-08-14',
    title: null,
    macro: [{ label: 'VIX', text: 'low' }],
    days: [
        {
            name: 'Monday',
            date: '2026-08-10',
            rule: 'sell puts',
            event: null,
            trades: [
                {
                    ticker: 'PM',
                    optionRight: 'P',
                    strike: 175,
                    expiry: '2026-09-18',
                    dte: 42,
                    delta: -0.19,
                    annualizedYield: 9.7,
                    premium: 195,
                    collateral: 17500,
                    risk: 'conservative',
                    note: null,
                },
            ],
        },
        { name: 'Thursday', date: '2026-08-13', rule: null, event: 'CPI', trades: [] },
    ],
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

describe('GET /api/calendars', () => {
    it('needs a key', async () => {
        const list = vi.spyOn(calendarRepository, 'listCalendars').mockResolvedValue([]);
        const response = await agent().get('/api/calendars');
        expect(response.status).toBe(401);
        expect(list).not.toHaveBeenCalled();
    });

    it('returns the index newest first', async () => {
        vi.spyOn(calendarRepository, 'listCalendars').mockResolvedValue([
            { publishDate: '2026-08-10', weekStart: '2026-08-10', weekEnd: '2026-08-14', title: null, tradeCount: 19 },
        ]);
        const response = await agent().get('/api/calendars').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body.calendars).toHaveLength(1);
        expect(response.body.calendars[0].tradeCount).toBe(19);
    });
});

describe('GET /api/calendars/:publishDate', () => {
    it('returns the whole week, empty days included', async () => {
        vi.spyOn(calendarRepository, 'fetchCalendar').mockResolvedValue(week);
        const response = await agent().get('/api/calendars/2026-08-10').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body.macro).toEqual([{ label: 'VIX', text: 'low' }]);
        expect(response.body.days).toHaveLength(2);
        expect(response.body.days[1].trades).toEqual([]);
    });

    it('404s for a date with no calendar', async () => {
        vi.spyOn(calendarRepository, 'fetchCalendar').mockResolvedValue(null);
        const response = await agent().get('/api/calendars/2026-01-05').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'no calendar for that date' });
    });

    it('400s before touching the database when the date is malformed', async () => {
        const fetch = vi.spyOn(calendarRepository, 'fetchCalendar');
        const response = await agent().get('/api/calendars/last-week').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
});
