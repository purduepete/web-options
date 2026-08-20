/**
 * Market data for the trade drill-in modal: the underlying's own price history,
 * which no table WebOptions can read holds. `opt.telegram_contract_price` keeps one
 * close per SIGNALLED CONTRACT since 2026-08-05; a 200 day average needs ten months
 * of closes for the UNDERLYING, so the backend fetches them and caches them itself.
 */

import type { IsoDate } from './index';

/** One trading day's close. The series omits weekends, holidays and unquoted days. */
export interface SymbolBar {
    date: IsoDate;
    close: number;
}

/** How a past signal on this symbol turned out. */
export type SymbolOutcome = 'expired_otm' | 'expired_itm' | 'open' | 'unknown';

export const OUTCOME_LABELS: Record<SymbolOutcome, string> = {
    expired_otm: 'Expired worthless',
    expired_itm: 'Assigned',
    open: 'Still open',
    unknown: 'Unknown',
};

/** A prior VADER put on the same underlying, with how it resolved. */
export interface PastSignal {
    reportDate: IsoDate;
    strike: number | null;
    expiration: IsoDate | null;
    annualizedYield: number | null;
    closeAtExpiration: number | null;
    outcome: SymbolOutcome;
}

/**
 * `price` is refetched on every modal open; `bars` come from a 12 hour cache. When
 * the quote call fails the cached price is served with `stale` set, and when there
 * are no bars at all `bars` is empty rather than the whole response failing — the
 * modal still has the trade itself to show.
 */
export interface SymbolDetail {
    symbol: string;
    longName: string | null;
    exchange: string | null;
    currency: string | null;
    price: number | null;
    priceDate: IsoDate | null;
    stale: boolean;
    sma50: number | null;
    sma200: number | null;
    bars: SymbolBar[];
    pastSignals: PastSignal[];
}

/**
 * The volatility index, as webportfolio's nightly price job last recorded it. A
 * close, not a live quote, so during the session it describes yesterday.
 */
export interface VixQuote {
    value: number;
    asOf: IsoDate;
    /** The session before it, so the chip can show a day change. Null on the first row ever recorded. */
    previousValue: number | null;
}

/** Null when the price job has never recorded a VIX close, which is not an error. */
export interface VixResponse {
    vix: VixQuote | null;
}
