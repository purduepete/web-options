/**
 * The two response flags that depend on today's date rather than on the data.
 *
 * A recorded fixture cannot pin them, since the recorded value is only right during
 * the week of the capture, so this suite covers them with the clock held still.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    webRoot: null,
};

/** Wednesday of the week starting Monday 2026-08-10, in local time. */
const WEDNESDAY = new Date(2026, 7, 12, 9, 30, 0);
const THIS_WEEK = '2026-08-10';
const LAST_WEEK = '2026-08-03';
const NEXT_WEEK = '2026-08-17';

function getWeek(week: string) {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null
    );
    return request(createApp(config)).get(`/api/week-signals?week=${week}`).set('X-API-Key', VALID_KEY);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(WEDNESDAY);
    vi.spyOn(signalsRepository, 'fetchWeek').mockResolvedValue([]);
    // Every neighbouring week has rows, so any `false` below comes from the date.
    vi.spyOn(signalsRepository, 'weekHasData').mockResolvedValue(true);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('GET /api/week-signals week flags', () => {
    it('marks the week containing today as current', async () => {
        const response = await getWeek(THIS_WEEK);

        expect(response.status).toBe(200);
        expect(response.body.isCurrentWeek).toBe(true);
    });

    it('marks any other week as not current', async () => {
        const response = await getWeek(LAST_WEEK);

        expect(response.body.isCurrentWeek).toBe(false);
    });

    it('offers a next week only when one has already happened', async () => {
        const past = await getWeek(LAST_WEEK);

        expect(past.body.hasNextWeekData).toBe(true);
    });

    it('refuses to advance past the current week, rows or no rows', async () => {
        const current = await getWeek(THIS_WEEK);
        const future = await getWeek(NEXT_WEEK);

        expect(current.body.hasNextWeekData).toBe(false);
        expect(future.body.hasNextWeekData).toBe(false);
    });

    it('answers for the current week when no week is given', async () => {
        vi.spyOn(authRepository, 'findActiveKey').mockResolvedValue({
            label: 'Test key',
            prefix: 'woak_aaaaaaa',
            expiresAt: null,
        });
        const response = await request(createApp(config)).get('/api/week-signals').set('X-API-Key', VALID_KEY);

        expect(response.body.weekStart).toBe(THIS_WEEK);
        expect(response.body.isCurrentWeek).toBe(true);
    });
});

describe('GET /api/earliest-week', () => {
    it('returns the earliest Telegram signal week', async () => {
        vi.spyOn(authRepository, 'findActiveKey').mockResolvedValue({
            label: 'Test key',
            prefix: 'woak_aaaaaaa',
            expiresAt: null,
        });
        vi.spyOn(signalsRepository, 'earliestWeekMonday').mockResolvedValue('2026-08-03');

        const response = await request(createApp(config)).get('/api/earliest-week').set('X-API-Key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ weekStart: '2026-08-03' });
    });
});
