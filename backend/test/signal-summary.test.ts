/**
 * The summary rollup and its two routes.
 *
 * The rollup is worth its own suite because it is the only place the risk-group
 * rule, the moneyness derivation and the week math all meet — and because a week
 * that straddles a month boundary is the one case that quietly duplicates or
 * loses a row if the bucketing is wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as signalsRepository from '../src/signals/repository';
import type { SignalRow } from '../src/signals/shape';
import { monthsFrom, spanOf, summarizeRange } from '../src/signals/summary';
import { MAX_FILTER_SYMBOLS, parseSymbolList } from '@weboptions/shared';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

/** A plausible put. Dates go in as strings, which is what the shaper's slice(0,10) reads. */
function row(overrides: Partial<SignalRow> = {}): SignalRow {
    return {
        report_date: '2026-08-10',
        symbol: 'AMD',
        sector: 'Technology',
        option_right: 'P',
        strike: 100,
        expiration: '2026-08-14',
        dte: 4,
        delta: -0.2,
        annualized_yield: 40,
        premium: 100,
        collateral: 10000,
        collateral_bucket: null,
        tier: 'balanced',
        is_top_pick: 0,
        actual_delta: null,
        actual_mark: null,
        actual_illiquid: 0,
        close_date: null,
        close_underlying: null,
        ...overrides,
    };
}

function get(path: string) {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null,
    );
    return request(createApp(config)).get(path).set('X-API-Key', VALID_KEY);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseSymbolList', () => {
    it('shrugs off stray commas and whitespace', () => {
        expect(parseSymbolList(' amd , , nvda,,')).toEqual(['AMD', 'NVDA']);
    });

    it('reads anything that is not a string as no filter', () => {
        expect(parseSymbolList(['AMD'])).toEqual([]);
        expect(parseSymbolList(undefined)).toEqual([]);
    });

    it('stops at the cap rather than trusting the query string', () => {
        const many = Array.from({ length: MAX_FILTER_SYMBOLS + 10 }, (_, index) => `S${index}`);

        expect(parseSymbolList(many.join(','))).toHaveLength(MAX_FILTER_SYMBOLS);
    });
});

describe('monthsFrom', () => {
    it('files a week under the month of its Monday, however it straddles', () => {
        // Monday 2026-08-31 through Tuesday 2026-09-01: one week, filed in August.
        const months = monthsFrom(['2026-08-31', '2026-09-01']);

        expect(months).toHaveLength(1);
        expect(months[0]?.month).toBe('2026-08');
        expect(months[0]?.weekStarts).toEqual(['2026-08-31']);
    });

    it('collapses every date of a week onto one week start', () => {
        const months = monthsFrom(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);

        expect(months[0]?.weekStarts).toEqual(['2026-08-10']);
    });

    it('orders months and weeks newest first', () => {
        const months = monthsFrom(['2026-07-06', '2026-08-03', '2026-08-10']);

        expect(months.map((month) => month.month)).toEqual(['2026-08', '2026-07']);
        expect(months[0]?.weekStarts).toEqual(['2026-08-10', '2026-08-03']);
        expect(months[0]?.label).toBe('August 2026');
    });
});

describe('spanOf', () => {
    it('runs from the first Monday to the last Friday', () => {
        const months = monthsFrom(['2026-08-03', '2026-08-10', '2026-08-31']);

        expect(spanOf(months[0]!)).toEqual({ from: '2026-08-03', to: '2026-09-04' });
    });
});

describe('summarizeRange', () => {
    it('counts a top pick only under top picks, and once in all', () => {
        const { weeks } = summarizeRange([row({ is_top_pick: 1, tier: 'aggressive' })], ['2026-08-10'], []);
        const cells = weeks[0]!.cells;

        expect(cells['top-picks'].signals).toBe(1);
        expect(cells.aggressive.signals).toBe(0);
        expect(cells.all.signals).toBe(1);
    });

    it('leaves an unrecognised tier out of every group but the total', () => {
        const { weeks } = summarizeRange([row({ tier: 'speculative' })], ['2026-08-10'], []);
        const cells = weeks[0]!.cells;

        expect(cells.all.signals).toBe(1);
        expect(cells.balanced.signals).toBe(0);
        expect(Object.keys(cells)).not.toContain('other');
    });

    it('rates moneyness against priced contracts only', () => {
        const { weeks } = summarizeRange(
            [
                row({ close_underlying: 120, close_date: '2026-08-14' }),
                row({ symbol: 'NVDA', close_underlying: 80, close_date: '2026-08-14' }),
                row({ symbol: 'INTC' }),
            ],
            ['2026-08-10'],
            [],
        );
        const all = weeks[0]!.cells.all;

        expect(all.signals).toBe(3);
        expect(all.priced).toBe(2);
        expect(all.otm).toBe(1);
    });

    it('counts the trades that beat half their premium, and only those over it', () => {
        const { weeks } = summarizeRange(
            [
                row({ best_premium_kept: 0.62 }),
                row({ symbol: 'NVDA', best_premium_kept: 0.5 }),
                row({ symbol: 'INTC', best_premium_kept: null }),
            ],
            ['2026-08-10'],
            [],
        );
        const all = weeks[0]!.cells.all;

        expect(all.signals).toBe(3);
        // Exactly half is not over it, and a signal the rollup has not reached is
        // not counted against the two it has.
        expect(all.halfRollup).toBe(2);
        expect(all.halfKept).toBe(1);
    });

    it('falls back to VADER numbers where no quote was captured', () => {
        const { weeks } = summarizeRange([row({ actual_mark: 2 }), row({ symbol: 'NVDA' })], ['2026-08-10'], []);
        const all = weeks[0]!.cells.all;

        // 200 captured for the first, 100 borrowed for the second.
        expect(all.premium).toBe(300);
        expect(all.captured).toBe(1);
    });

    it('yields null rather than zero when nothing contributes', () => {
        const { weeks } = summarizeRange([row({ annualized_yield: null, premium: null })], ['2026-08-10'], []);
        const all = weeks[0]!.cells.all;

        expect(all.signals).toBe(1);
        expect(all.premium).toBeNull();
        expect(all.annualizedYield).toBeNull();
    });

    it('averages the yield rather than summing it', () => {
        const { weeks } = summarizeRange(
            [row({ annualized_yield: 30 }), row({ symbol: 'NVDA', annualized_yield: 50 })],
            ['2026-08-10'],
            [],
        );

        expect(weeks[0]!.cells.all.annualizedYield).toBe(40);
    });

    it('weights the yield by collateral rather than by contract', () => {
        const { weeks } = summarizeRange(
            [
                row({ annualized_yield: 100, collateral: 1000 }),
                row({ symbol: 'NVDA', annualized_yield: 20, collateral: 9000 }),
            ],
            ['2026-08-10'],
            [],
        );
        const all = weeks[0]!.cells.all;

        // 28 by capital committed, not the 60 an unweighted mean would report.
        expect(all.annualizedYield).toBe(28);
        expect(all.collateral).toBe(10000);
    });

    it('falls back to a plain mean when no collateral is known at all', () => {
        const { weeks } = summarizeRange(
            [
                row({ annualized_yield: 30, collateral: null }),
                row({ symbol: 'NVDA', annualized_yield: 50, collateral: null }),
            ],
            ['2026-08-10'],
            [],
        );
        const all = weeks[0]!.cells.all;

        expect(all.annualizedYield).toBe(40);
        expect(all.collateral).toBeNull();
    });

    it('keeps a week the filter emptied, rather than dropping it', () => {
        const { weeks } = summarizeRange(
            [row({ report_date: '2026-08-10' }), row({ report_date: '2026-08-03', symbol: 'NVDA' })],
            ['2026-08-10', '2026-08-03'],
            ['AMD'],
        );

        expect(weeks.map((week) => week.weekStart)).toEqual(['2026-08-10', '2026-08-03']);
        expect(weeks[0]!.cells.all.signals).toBe(1);
        expect(weeks[1]!.cells.all.signals).toBe(0);
    });

    it('files each row under the week its own report date belongs to', () => {
        const { weeks } = summarizeRange(
            [row({ report_date: '2026-08-31' }), row({ report_date: '2026-09-01', symbol: 'NVDA' })],
            ['2026-08-31'],
            [],
        );

        expect(weeks[0]!.weekEnd).toBe('2026-09-04');
        expect(weeks[0]!.cells.all.signals).toBe(2);
    });

    it('totals the month over every trade, so the yield stays a mean', () => {
        const { weeks, total } = summarizeRange(
            [
                row({ report_date: '2026-08-10', annualized_yield: 30 }),
                row({ report_date: '2026-08-03', symbol: 'NVDA', annualized_yield: 50 }),
                row({ report_date: '2026-08-03', symbol: 'INTC', annualized_yield: 70 }),
            ],
            ['2026-08-10', '2026-08-03'],
            [],
        );

        expect(total.all.signals).toBe(3);
        expect(total.all.premium).toBe(300);
        // 50 across the three, not the 45 a mean of the two week means would give.
        expect(total.all.annualizedYield).toBe(50);
        expect(weeks[1]!.cells.all.annualizedYield).toBe(60);
    });

    it('leaves the month total empty when the filter matched nothing', () => {
        const { total } = summarizeRange([row({ report_date: '2026-08-10' })], ['2026-08-10'], ['NVDA']);

        expect(total.all.signals).toBe(0);
        expect(total.all.premium).toBeNull();
    });

    // Expirations either side of any clock this ever runs on, so the suite does
    // not need today to be a particular day.
    it('keeps only the contracts the expiry filter asks for', () => {
        const rows = [row({ expiration: '2000-08-14' }), row({ symbol: 'NVDA', expiration: '2999-08-14' })];

        expect(summarizeRange(rows, ['2026-08-10'], [], 'all').total.all.signals).toBe(2);
        expect(summarizeRange(rows, ['2026-08-10'], [], 'active').total.all.signals).toBe(1);
        expect(summarizeRange(rows, ['2026-08-10'], [], 'expired').total.all.signals).toBe(1);
    });

    it('leaves the week behind as an empty row when the expiry filter clears it', () => {
        const { weeks } = summarizeRange([row({ expiration: '2000-08-14' })], ['2026-08-10'], [], 'active');

        expect(weeks).toHaveLength(1);
        expect(weeks[0]!.cells.all.signals).toBe(0);
    });
});

describe('the summary routes without a key', () => {
    it('refuses both of them, and reads nothing on the way', async () => {
        const dates = vi.spyOn(signalsRepository, 'signalDates').mockResolvedValue(['2026-08-10']);
        const range = vi.spyOn(signalsRepository, 'fetchRange').mockResolvedValue([row()]);
        const app = request(createApp(config));

        expect((await app.get('/api/signal-months')).status).toBe(401);
        expect((await app.get('/api/signal-summary?month=2026-08')).status).toBe(401);
        expect(dates).not.toHaveBeenCalled();
        expect(range).not.toHaveBeenCalled();
    });
});

describe('GET /api/signal-months', () => {
    it('answers with the month index', async () => {
        vi.spyOn(signalsRepository, 'signalDates').mockResolvedValue(['2026-08-10', '2026-08-11']);

        const response = await get('/api/signal-months');

        expect(response.status).toBe(200);
        expect(response.body.months).toEqual([{ month: '2026-08', label: 'August 2026', weekStarts: ['2026-08-10'] }]);
    });
});

describe('GET /api/signal-summary', () => {
    beforeEach(() => {
        vi.spyOn(signalsRepository, 'signalDates').mockResolvedValue(['2026-08-10']);
        vi.spyOn(signalsRepository, 'fetchRange').mockResolvedValue([row()]);
    });

    it('rejects a month that is not YYYY-MM', async () => {
        expect((await get('/api/signal-summary?month=2026-8')).status).toBe(400);
        expect((await get('/api/signal-summary')).status).toBe(400);
    });

    it('rejects a month number that is not a real month', async () => {
        expect((await get('/api/signal-summary?month=2026-13')).status).toBe(400);
        expect((await get('/api/signal-summary?month=2026-00')).status).toBe(400);
    });

    it('answers 404 for a month with no signals at all', async () => {
        const response = await get('/api/signal-summary?month=2020-01');

        expect(response.status).toBe(404);
    });

    it('narrows to the symbols asked for and echoes them back', async () => {
        const response = await get('/api/signal-summary?month=2026-08&symbols=amd,%20nvda,amd');

        expect(response.status).toBe(200);
        expect(response.body.symbols).toEqual(['AMD', 'NVDA']);
        expect(response.body.weeks[0].cells.all.signals).toBe(1);
        expect(response.body.total.all.signals).toBe(1);
    });

    it('treats a repeated symbols param as no filter rather than an error', async () => {
        // Express hands back an array here, which must not be read as a string.
        const response = await get('/api/signal-summary?month=2026-08&symbols=AMD&symbols=NVDA');

        expect(response.status).toBe(200);
        expect(response.body.symbols).toEqual([]);
    });

    it('queries the whole span of the month it was asked for', async () => {
        await get('/api/signal-summary?month=2026-08');

        expect(signalsRepository.fetchRange).toHaveBeenCalledWith(config.db, '2026-08-10', '2026-08-14');
    });

    it('narrows to the contracts asked for and echoes the choice back', async () => {
        vi.spyOn(signalsRepository, 'fetchRange').mockResolvedValue([
            row({ expiration: '2000-08-14' }),
            row({ symbol: 'NVDA', expiration: '2999-08-14' }),
        ]);

        const response = await get('/api/signal-summary?month=2026-08&expiry=expired');

        expect(response.status).toBe(200);
        expect(response.body.expiry).toBe('expired');
        expect(response.body.total.all.signals).toBe(1);
    });

    it('reads an expiry it does not know as no filter at all', async () => {
        const response = await get('/api/signal-summary?month=2026-08&expiry=lapsed');

        expect(response.status).toBe(200);
        expect(response.body.expiry).toBe('all');
        expect(response.body.total.all.signals).toBe(1);
    });
});
