import { RECENT_SIGNAL_WINDOW_DAYS, type IsoDate, type SymbolDetail } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { recentSignalStats, resolvePastSignals, sixMonthSlice, sma } from './metrics';
import {
    ownedContractsFor,
    outcomeFor,
    type PastSignalExclusion,
    pastSignalsFor,
    readCached,
    recentSignalsFor,
    writeCached,
} from './repository';
import { fetchDailyBars, fetchQuote, normalizeSymbol, type SymbolQuote } from './yahoo';

/**
 * What the modal asks for. Two different freshness rules, on purpose:
 *
 * The BARS are cached for 12 hours. Yesterday's closes do not change, and the one
 * bar that matters today is the one the day has not produced yet.
 *
 * The PRICE is refetched on EVERY open, with no TTL at all. A drill-in exists to
 * answer "is this worth buying right now", and a price from an hour ago answers a
 * different question. The only thing stopping a double fetch is the in-flight map
 * below, which collapses concurrent calls for the same symbol rather than caching
 * the answer.
 */

const BARS_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Caps the signals NOT held. Owned ones are all kept on top of this, so the list is
 * "everything I took, plus the five most recent of the rest".
 */
const OTHER_SIGNAL_LIMIT = 5;

/**
 * No market-calendar modelling. A weekend refresh re-fetches an unchanged series and
 * costs one request; knowing which days are holidays would cost a calendar to
 * maintain, and getting it wrong would serve stale bars on a day that did trade.
 */
function isFresh(refreshedAt: Date | null, now: number): boolean {
    return refreshedAt !== null && now - refreshedAt.getTime() < BARS_TTL_MS;
}

/** Concurrent opens of the same symbol share one round trip. Not a cache: cleared on settle. */
const inFlight = new Map<string, Promise<SymbolDetail | null>>();

export interface SymbolDetailOptions {
    /**
     * The contract the modal is showing. With `reportDate` it names one signal, which
     * is the one row kept out of its own "other signals" list — the other mornings of
     * the same contract are exactly the comparison the list is for.
     */
    exclude?: Omit<PastSignalExclusion, 'reportDate'>;
    /**
     * The morning this contract was signalled. Together with the contract it names
     * one row of the end-of-day rollup; without it there is no outcome to look up,
     * since the same put on two mornings is two trades.
     */
    reportDate?: IsoDate | null;
    /** Injectable so tests do not depend on the day they run. */
    today?: IsoDate;
}

export async function getSymbolDetail(
    db: DbConfig,
    rawSymbol: string,
    options: SymbolDetailOptions = {},
): Promise<SymbolDetail | null> {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return null;

    const key = `${symbol}|${options.exclude?.strike ?? ''}|${options.exclude?.expiration ?? ''}|${options.reportDate ?? ''}`;
    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = build(db, symbol, options).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
}

async function build(db: DbConfig, symbol: string, options: SymbolDetailOptions): Promise<SymbolDetail> {
    const today = options.today ?? new Date().toISOString().slice(0, 10);

    const cached = await readCached(db, symbol).catch(() => null);

    let bars = cached?.bars ?? [];
    let profile: SymbolQuote | null = cached?.quote ?? null;

    if (!isFresh(cached?.refreshedAt ?? null, Date.now())) {
        const fetched = await fetchDailyBars(symbol);
        if (fetched) {
            bars = fetched.bars;
            profile = fetched.quote;
            // A cache write that fails must not fail the modal: the data is in hand.
            await writeCached(db, symbol, fetched.quote, fetched.bars).catch(() => undefined);
        }
    }

    // Always live, never from the cache. Only a failed call falls back, and says so.
    const live = await fetchQuote(symbol);
    const livePrice = live?.price ?? null;
    const price = livePrice ?? profile?.price ?? null;
    const priceDate = livePrice !== null ? (live?.priceDate ?? null) : (profile?.priceDate ?? null);
    // Stale means "this figure is older than it looks", so an absent price is not stale.
    const stale = livePrice === null && price !== null;
    // The live close runs ahead of the cached bars, so it settles an expiration that
    // landed after the series was last written.
    const latest = price !== null && priceDate !== null ? { date: priceDate, close: price } : null;

    const seeds = await pastSignalsFor(
        db,
        symbol,
        {
            strike: options.exclude?.strike ?? null,
            expiration: options.exclude?.expiration ?? null,
            reportDate: options.reportDate ?? null,
        },
        OTHER_SIGNAL_LIMIT,
    ).catch(() => []);

    const recentRows = await recentSignalsFor(db, symbol, RECENT_SIGNAL_WINDOW_DAYS).catch(() => null);
    const recentSignals = recentRows ? recentSignalStats(recentRows, bars, today, latest, price) : null;

    // Soft-failed like everything else here: an unrolled-up signal and an unreachable
    // rollup both leave the rest of the modal worth showing.
    const strike = options.exclude?.strike ?? null;
    const expiration = options.exclude?.expiration ?? null;
    const reportDate = options.reportDate ?? null;
    const outcome =
        strike !== null && expiration !== null && reportDate !== null
            ? await outcomeFor(db, symbol, { strike, expiration, reportDate }).catch(() => null)
            : null;
    const ownedContracts =
        strike !== null && expiration !== null
            ? await ownedContractsFor(db, symbol, { strike, expiration, reportDate }).catch(() => null)
            : null;

    return {
        symbol,
        longName: live?.longName ?? profile?.longName ?? null,
        exchange: live?.exchange ?? profile?.exchange ?? null,
        currency: live?.currency ?? profile?.currency ?? null,
        price,
        priceDate,
        stale,
        // Averages use the FULL two years; only the chart is trimmed to six months.
        sma50: sma(bars, 50),
        sma200: sma(bars, 200),
        bars: sixMonthSlice(bars),
        pastSignals: resolvePastSignals(seeds, bars, today, latest),
        recentSignals,
        ownedContracts,        outcome,
    };
}

/** Tests only: the in-flight map is process-wide. */
export function resetInFlight(): void {
    inFlight.clear();
}
