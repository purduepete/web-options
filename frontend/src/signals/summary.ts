import type { DaySignals, NumberSource, Trade } from '@weboptions/shared';

/**
 * The week read as a whole rather than a card at a time.
 *
 * Everything here counts the days the page is SHOWING. A summary that answered
 * for signals the reader has filtered away would contradict the grid beneath it.
 */

export interface WeekSummary {
    /** Contracts on screen. */
    signals: number;
    /** Those with a close of their own, which is all the OTM count can speak for. */
    priced: number;
    otm: number;
    /** Mean gap between the captured premium and the advertised one, as a percentage. */
    premiumDrift: number | null;
    /** How many contracts that mean was taken over. */
    driftSamples: number;
}

/**
 * How far a captured premium landed from the one VADER advertised, signed
 * against VADER: a minus sign means the market paid less than the signal promised.
 */
export function premiumDriftPercent(actual: number | null, quoted: number | null): number | null {
    if (actual === null || quoted === null || quoted === 0) return null;
    return ((actual - quoted) / quoted) * 100;
}

export function summarizeWeek(days: DaySignals[], source: NumberSource): WeekSummary {
    const trades = days.flatMap((day) => day.trades);
    const priced = trades.filter((trade) => trade.moneyness !== null);

    // In VADER's own mode there is nothing to drift from.
    const drifts =
        source === 'actual'
            ? trades
                  .map((trade) => premiumDriftPercent(trade.actualPremium, trade.premium))
                  .filter((value): value is number => value !== null)
            : [];

    return {
        signals: trades.length,
        priced: priced.length,
        otm: priced.filter((trade) => trade.moneyness === 'otm').length,
        premiumDrift: drifts.length === 0 ? null : drifts.reduce((sum, value) => sum + value, 0) / drifts.length,
        driftSamples: drifts.length,
    };
}

/** What a day would take to secure, or null when not one contract carries a figure. */
export function totalCollateral(trades: Trade[]): number | null {
    const known = trades.filter((trade) => trade.collateral !== null);
    if (known.length === 0) return null;
    return known.reduce((sum, trade) => sum + (trade.collateral ?? 0), 0);
}
