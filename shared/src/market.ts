/**
 * Market data for the trade drill-in modal: the underlying's own price history,
 * which no table WebOptions can read holds. `opt.telegram_contract_price` keeps one
 * close per SIGNALLED CONTRACT since 2026-08-05; a 200 day average needs ten months
 * of closes for the UNDERLYING, so the backend fetches them and caches them itself.
 */

import type { IsoDate, Moneyness } from './index';

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
    tier: string | null;
    isTopPick: boolean;
    closeAtExpiration: number | null;
    outcome: SymbolOutcome;
    ownedLiveContracts: number;
    ownedPaperContracts: number;
}

/**
 * How one signal has actually gone since it was published, read from webportfolio's
 * nightly rollup of `opt.telegram_contract_price` into `opt.telegram_signal_outcome`.
 *
 * EVERY FIGURE IS AN END OF DAY MARK. Nothing here is intraday, so a trade opened
 * this morning has one point and its best is its only one. The rollup is per SIGNAL,
 * not per contract: the same put signalled on two mornings is two trades at two entry
 * premiums, which is why the report date identifies the row.
 *
 * `premiumKept` and `bestPremiumKept` are fractions of the entry premium, positive
 * when the seller is ahead. Webportfolio calls the second one "Max Cap", short for
 * maximum profit capture; it is the largest share of the premium that could have been
 * banked by buying the contract back at any close so far.
 */
export interface SignalOutcome {
    reportDate: IsoDate;
    /** What it was actually sold for, which is what every figure below is measured against. */
    entryPremium: number | null;
    /** The latest end of day mark, and the day it closed at that. */
    mark: number | null;
    asOf: IsoDate | null;
    daysHeld: number | null;
    /** Profit in dollars on one contract, and the same thing as a fraction of the premium. */
    profit: number | null;
    premiumKept: number | null;
    /**
     * The high and low water marks of the same two figures. The rollup stores the
     * best as a fraction and both extremes in dollars, so the worst one's fraction
     * is worked out here rather than left as the odd figure out.
     */
    bestPremiumKept: number | null;
    bestProfit: number | null;
    bestOn: IsoDate | null;
    worstPremiumKept: number | null;
    /**
     * The lowest the profit has ever been at a close, in dollars. Not necessarily a
     * loss: a put that ran clean shows its worst day still in the money.
     */
    worstProfit: number | null;
    /** Days until half the premium had decayed away. Null while it never has. */
    daysToHalf: number | null;
    /** True once the contract has expired, after which nothing above moves again. */
    settled: boolean;
    moneynessAtExpiration: Moneyness | null;
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
    /** Null when the window could not be read. */
    recentSignals: RecentSignalStats | null;
    /** Open contracts matching the viewed symbol, strike, and expiration. Null when unavailable. */
    ownedContracts: number | null;
    /**
     * Null unless the caller named a report date, and null too for a signal the
     * nightly job has not rolled up: it started on 2026-07-17, so an older week has
     * signals and no outcome.
     */
    outcome: SignalOutcome | null;
}

/**
 * Trading days behind `RecentSignalStats`. Counted as the days VADER actually
 * reported on, which are trading days by construction, so no market calendar is
 * needed. Shared so the label and the query cannot drift apart.
 */
export const RECENT_SIGNAL_WINDOW_DAYS = 20;

/**
 * How this underlying has been doing lately, over the last `RECENT_SIGNAL_WINDOW_DAYS`
 * trading days. Covers every signal in the window, including the one being viewed and
 * the ones `pastSignals` trims away, which is what the trimmed list cannot tell you.
 *
 * `total` is the denominator for BOTH figures, so a signal that has not expired yet
 * counts against `assigned` rather than being left out of it. That keeps the two
 * percentages comparable and stops a two-contract sample reading as "50% assigned".
 */
export interface RecentSignalStats {
    total: number;
    /** In the money at expiration if it has expired, against today's price if not. */
    inTheMoney: number;
    /** Expired in the money. */
    assigned: number;
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
