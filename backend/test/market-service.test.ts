import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SymbolBar } from '@weboptions/shared';
import type { DbConfig } from '../src/config';
import * as repository from '../src/market/repository';
import { getSymbolDetail, resetInFlight } from '../src/market/service';
import * as yahoo from '../src/market/yahoo';

/*
 * The two freshness rules are the whole point of this file: the bars are cached for
 * twelve hours, and the PRICE never is. A cached price would make the drill-in
 * answer "was this worth buying this morning", which is a different question.
 */

const db: DbConfig = { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' };

const TODAY = '2026-08-18';

function series(count: number, close = 100): SymbolBar[] {
    const start = Date.UTC(2025, 0, 1);
    return Array.from({ length: count }, (_, index) => ({
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        close,
    }));
}

const QUOTE: yahoo.SymbolQuote = {
    longName: 'Vistra Corp.',
    exchange: 'NYSE',
    currency: 'USD',
    price: 182.35,
    priceDate: TODAY,
};

function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** A warm cache and a live quote, for the tests that are about neither. */
function cachedMarket(): void {
    vi.spyOn(repository, 'readCached').mockResolvedValue({
        quote: QUOTE,
        bars: series(300),
        refreshedAt: hoursAgo(1),
    });
    vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);
}

beforeEach(() => {
    resetInFlight();
    vi.spyOn(repository, 'pastSignalsFor').mockResolvedValue([]);
    vi.spyOn(repository, 'outcomeFor').mockResolvedValue(null);
    vi.spyOn(repository, 'ownedContractsFor').mockResolvedValue(0);
    vi.spyOn(repository, 'writeCached').mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    resetInFlight();
});

describe('getSymbolDetail', () => {
    it('refuses a symbol that is not a ticker without touching the database or the network', async () => {
        const cached = vi.spyOn(repository, 'readCached');
        const bars = vi.spyOn(yahoo, 'fetchDailyBars');

        expect(await getSymbolDetail(db, 'DROP TABLE')).toBeNull();
        expect(cached).not.toHaveBeenCalled();
        expect(bars).not.toHaveBeenCalled();
    });

    it('serves fresh bars from the cache without asking Yahoo for the series', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300),
            refreshedAt: hoursAgo(3),
        });
        const daily = vi.spyOn(yahoo, 'fetchDailyBars');
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(daily).not.toHaveBeenCalled();
        expect(detail?.sma200).toBe(100);
    });

    it('refetches the series once the cache is over twelve hours old', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300, 50),
            refreshedAt: hoursAgo(13),
        });
        const daily = vi.spyOn(yahoo, 'fetchDailyBars').mockResolvedValue({ quote: QUOTE, bars: series(300, 100) });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(daily).toHaveBeenCalledTimes(1);
        expect(detail?.sma50).toBe(100);
        expect(repository.writeCached).toHaveBeenCalledTimes(1);
    });

    it('asks for a live price even when the bars came from the cache', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: { ...QUOTE, price: 100, priceDate: '2026-08-01' },
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        const quote = vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue({ ...QUOTE, price: 182.35 });

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(quote).toHaveBeenCalledTimes(1);
        expect(detail?.price).toBe(182.35);
        expect(detail?.priceDate).toBe(TODAY);
        expect(detail?.stale).toBe(false);
    });

    it('falls back to the cached price when the live call fails, and says it did', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: { ...QUOTE, price: 100, priceDate: '2026-08-01' },
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(null);

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(detail?.price).toBe(100);
        expect(detail?.priceDate).toBe('2026-08-01');
        expect(detail?.stale).toBe(true);
    });

    it('is not stale when there is simply no price to be had', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue(null);
        vi.spyOn(yahoo, 'fetchDailyBars').mockResolvedValue(null);
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(null);

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(detail?.price).toBeNull();
        expect(detail?.stale).toBe(false);
    });

    it('still answers when the cache read throws', async () => {
        vi.spyOn(repository, 'readCached').mockRejectedValue(new Error('login failed'));
        vi.spyOn(yahoo, 'fetchDailyBars').mockResolvedValue({ quote: QUOTE, bars: series(300) });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        expect((await getSymbolDetail(db, 'VST', { today: TODAY }))?.sma50).toBe(100);
    });

    it('still answers when the cache WRITE throws, because the data is already in hand', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue(null);
        vi.mocked(repository.writeCached).mockRejectedValue(new Error('DENY'));
        vi.spyOn(yahoo, 'fetchDailyBars').mockResolvedValue({ quote: QUOTE, bars: series(300) });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        expect((await getSymbolDetail(db, 'VST', { today: TODAY }))?.price).toBe(182.35);
    });

    it('trims the chart to six months while averaging the full two years', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(400),
            refreshedAt: hoursAgo(1),
        });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        const detail = await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(detail?.bars).toHaveLength(126);
        expect(detail?.sma200).toBe(100);
    });

    it('collapses two concurrent opens of the same contract into one round trip', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        const quote = vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        const [first, second] = await Promise.all([
            getSymbolDetail(db, 'VST', { today: TODAY }),
            getSymbolDetail(db, 'VST', { today: TODAY }),
        ]);

        expect(quote).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
    });

    it('does not hold the answer once it has settled, so the next open is live again', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        const quote = vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        await getSymbolDetail(db, 'VST', { today: TODAY });
        await getSymbolDetail(db, 'VST', { today: TODAY });

        expect(quote).toHaveBeenCalledTimes(2);
    });

    it('keeps the viewed contract out of its own earlier signals', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);

        await getSymbolDetail(db, 'VST', {
            today: TODAY,
            exclude: { strike: 170, expiration: '2026-08-21' },
        });

        expect(vi.mocked(repository.pastSignalsFor).mock.calls[0]?.[2]).toEqual({
            strike: 170,
            expiration: '2026-08-21',
        });
    });

    it('still answers when the past-signal query throws', async () => {
        vi.spyOn(repository, 'readCached').mockResolvedValue({
            quote: QUOTE,
            bars: series(300),
            refreshedAt: hoursAgo(1),
        });
        vi.spyOn(yahoo, 'fetchQuote').mockResolvedValue(QUOTE);
        vi.mocked(repository.pastSignalsFor).mockRejectedValue(new Error('timeout'));

        expect((await getSymbolDetail(db, 'VST', { today: TODAY }))?.pastSignals).toEqual([]);
    });

    it('looks the outcome up by the contract AND the morning it was signalled', async () => {
        cachedMarket();

        await getSymbolDetail(db, 'VST', {
            today: TODAY,
            exclude: { strike: 170, expiration: '2026-08-21' },
            reportDate: '2026-08-18',
        });

        expect(vi.mocked(repository.outcomeFor).mock.calls[0]?.[2]).toEqual({
            strike: 170,
            expiration: '2026-08-21',
            reportDate: '2026-08-18',
        });
    });

    it('does not go looking for an outcome it could not identify', async () => {
        cachedMarket();

        // A symbol opened without a contract, or without the morning: either way the
        // rollup's grain is not satisfied, and a partial match is the wrong trade.
        expect((await getSymbolDetail(db, 'VST', { today: TODAY }))?.outcome).toBeNull();
        expect(repository.outcomeFor).not.toHaveBeenCalled();
    });

    it('still answers when the outcome query throws', async () => {
        cachedMarket();
        vi.mocked(repository.outcomeFor).mockRejectedValue(new Error('timeout'));

        const detail = await getSymbolDetail(db, 'VST', {
            today: TODAY,
            exclude: { strike: 170, expiration: '2026-08-21' },
            reportDate: '2026-08-18',
        });

        expect(detail?.outcome).toBeNull();
        expect(detail?.price).toBe(182.35);
    });

    it('does not serve one morning outcome to another, though the contract is the same', async () => {
        cachedMarket();

        await getSymbolDetail(db, 'VST', {
            today: TODAY,
            exclude: { strike: 170, expiration: '2026-08-21' },
            reportDate: '2026-08-18',
        });
        await getSymbolDetail(db, 'VST', {
            today: TODAY,
            exclude: { strike: 170, expiration: '2026-08-21' },
            reportDate: '2026-08-19',
        });

        expect(repository.outcomeFor).toHaveBeenCalledTimes(2);
    });
});
