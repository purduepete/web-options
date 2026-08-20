import type { IsoDate, PastSignal, SymbolBar, SymbolOutcome } from '@weboptions/shared';

/** Pure arithmetic over a close-only daily series. Every function tolerates a short one. */

/** Trading days, not calendar days: ~21 a month. */
const SIX_MONTHS_OF_BARS = 126;

/**
 * The simple moving average of the LAST n bars. Returns null when there are fewer
 * than n, rather than averaging what happened to be there and calling it a 200 day
 * average — a 60 bar "200 DMA" would sit far closer to the price than the real one
 * and make every trade look safer than it is.
 */
export function sma(bars: readonly SymbolBar[], n: number): number | null {
    if (n <= 0 || bars.length < n) return null;
    const window = bars.slice(-n);
    const total = window.reduce((sum, bar) => sum + bar.close, 0);
    return total / n;
}

/** How far above (positive) or below (negative) the average the price sits, in percent. */
export function distancePercent(price: number | null, average: number | null): number | null {
    if (price === null || average === null || average === 0) return null;
    return ((price - average) / average) * 100;
}

/** The chart's window. The averages are still computed over the full two years. */
export function sixMonthSlice(bars: readonly SymbolBar[]): SymbolBar[] {
    return bars.slice(-SIX_MONTHS_OF_BARS);
}

/** The close on or after a date, or null when the series does not reach it. */
export function closeOnOrAfter(bars: readonly SymbolBar[], date: IsoDate): SymbolBar | null {
    for (const bar of bars) {
        if (bar.date >= date) return bar;
    }
    return null;
}

/**
 * How a past put resolved, judged against the close at expiration.
 *
 * `unknown` and `open` are different answers. An expiration the series does not
 * reach because it is in the FUTURE is `open` — that trade may still work out. One
 * the series does not reach because it fell off the back of the two year window is
 * `unknown`, and saying anything else about it would be a guess.
 */
export function resolveOutcome(
    bars: readonly SymbolBar[],
    strike: number | null,
    expiration: IsoDate | null,
    today: IsoDate,
): { outcome: SymbolOutcome; closeAtExpiration: number | null } {
    if (strike === null || expiration === null) return { outcome: 'unknown', closeAtExpiration: null };
    if (expiration >= today) return { outcome: 'open', closeAtExpiration: null };

    const bar = closeOnOrAfter(bars, expiration);
    if (!bar) return { outcome: 'unknown', closeAtExpiration: null };

    // A put finishing at or above its strike expires worthless, which is the win.
    return {
        outcome: bar.close >= strike ? 'expired_otm' : 'expired_itm',
        closeAtExpiration: bar.close,
    };
}

/** Fills in each past signal's outcome once the bars are known. */
export function resolvePastSignals(
    signals: readonly Omit<PastSignal, 'outcome' | 'closeAtExpiration'>[],
    bars: readonly SymbolBar[],
    today: IsoDate,
): PastSignal[] {
    return signals.map((signal) => ({
        ...signal,
        ...resolveOutcome(bars, signal.strike, signal.expiration, today),
    }));
}
