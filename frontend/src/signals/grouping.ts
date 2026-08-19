import type { DaySignals, ExpiryFilter, GroupId, NumberSource, Trade } from '@weboptions/shared';
import { EXPIRY_FILTERS, GROUP_IDS, GROUP_LABELS, groupIdForTrade, hasExpired, TIER_ORDER } from '@weboptions/shared';

/**
 * The grid's layout algebra, kept away from React so it can be reasoned about
 * on its own.
 *
 * The one idea worth stating: the risk groups are chosen ONCE for the whole
 * week, not per day. Every day card then draws the same groups in the same
 * order, which is what lets the five cards line their headings up on shared
 * grid rows however many tickets sit above them in any one column.
 */

// Classification itself lives in shared, so the summary page's server-side
// rollup and this grid can never drift apart on what counts as a top pick. The
// contracts filter is there for the same reason: the summary applies it before
// the numbers are rolled up, where the browser never sees the trades at all.
export { EXPIRY_FILTERS, TIER_ORDER };
export type { ExpiryFilter, GroupId };

/** Where the contract closed against its strike. Atm is a rounding edge, not a choice. */
export const MONEYNESS_FILTERS = ['all', 'itm', 'otm'] as const;

export type MoneynessFilter = (typeof MONEYNESS_FILTERS)[number];

/** The next choice along, wrapping. What a filter's shortcut key steps through. */
export function cycle<T extends string>(choices: readonly T[], current: T): T {
    const here = choices.indexOf(current);
    return choices[(here + 1) % choices.length] ?? current;
}

export interface SignalGroup {
    id: GroupId;
    label: string;
    /** Top picks come from every tier, so only that group spells the tier out. */
    showTierBadge: boolean;
    matches: (trade: Trade) => boolean;
}

/**
 * Narrows every day's trades to those whose symbol contains `query`, or, when the
 * query opens with a bang, to those whose symbol does not. Days are kept even when
 * they empty out, so the card still appears and can say that nothing matched.
 */
export function filterDaysBySymbol(days: DaySignals[], query: string): DaySignals[] {
    const typed = query.trim().toUpperCase();
    const drop = typed.startsWith('!');
    const needle = drop ? typed.slice(1).trim() : typed;
    if (!needle) return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => trade.symbol.toUpperCase().includes(needle) !== drop),
    }));
}

/**
 * Drops contracts that have already expired. Days are kept when they empty out,
 * for the same reason the symbol filter keeps them.
 */
export function filterDaysByExpiry(days: DaySignals[], filter: ExpiryFilter): DaySignals[] {
    if (filter === 'all') return days;
    const keep = filter === 'expired';
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => hasExpired(trade.expiration) === keep),
    }));
}

/**
 * Drops contracts that did not close where the reader asked. A contract with no
 * close of its own has no moneyness, so it goes too.
 */
export function filterDaysByMoneyness(days: DaySignals[], filter: MoneynessFilter): DaySignals[] {
    if (filter === 'all') return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => trade.moneyness === filter),
    }));
}

/** The groups at least one day this week can fill, in the order they are drawn. */
export function buildGroups(days: DaySignals[]): SignalGroup[] {
    const someTradeIs = (predicate: (trade: Trade) => boolean) => days.some((day) => day.trades.some(predicate));

    return GROUP_IDS.filter((id) => someTradeIs((trade) => groupIdForTrade(trade) === id)).map((id) => ({
        id,
        label: GROUP_LABELS[id],
        showTierBadge: id === 'top-picks',
        matches: (trade: Trade) => groupIdForTrade(trade) === id,
    }));
}

/**
 * This group's share of one day, richest annualised yield first.
 *
 * The sort follows whichever yield the tickets are showing. Ranking on a number
 * the reader cannot see would put the cards in an order the page appears to
 * contradict.
 */
export function groupTrades(group: SignalGroup, trades: Trade[], numberSource: NumberSource): Trade[] {
    const yieldOf = (trade: Trade) =>
        (numberSource === 'actual' ? (trade.actualAnnualizedYield ?? trade.annualizedYield) : trade.annualizedYield) ??
        0;
    return trades
        .filter(group.matches)
        .slice()
        .sort((a, b) => yieldOf(b) - yieldOf(a));
}

/**
 * Which of the five columns a day belongs in. A Friday-only week still lands in
 * the fifth column rather than the first. A weekend date should never arrive,
 * but if one does it parks at the end instead of falling off the grid.
 */
export function weekdayColumn(iso: string): number {
    const [year, month, day] = iso.split('-').map(Number);
    const weekday = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getDay();
    if (weekday === 0 || weekday === 6) return 5;
    return weekday;
}

/** Moves an ISO calendar date by whole days, crossing months and years. */
export function shiftWeek(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const moved = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days);
    const mm = String(moved.getMonth() + 1).padStart(2, '0');
    const dd = String(moved.getDate()).padStart(2, '0');
    return `${moved.getFullYear()}-${mm}-${dd}`;
}
