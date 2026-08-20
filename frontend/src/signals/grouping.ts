import type {
    DaySignals,
    ExpiryFilter,
    GradeBand,
    GradeSettings,
    GroupId,
    NumberSource,
    Trade,
} from '@weboptions/shared';
import {
    EXPIRY_FILTERS,
    GROUP_IDS,
    GROUP_LABELS,
    groupIdForTrade,
    hasExpired,
    hasHalfFigure,
    hasKeptHalf,
    gradeTrade,
    isRecentSignalDay,
    TIER_ORDER,
} from '@weboptions/shared';

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

export type GradeFilter = Exclude<GradeBand, 'ungraded'>;
export const GRADE_FILTERS: readonly GradeFilter[] = ['red', 'yellow', 'green'];

/** Where the contract closed against its strike. Atm is a rounding edge, not a choice. */
export const MONEYNESS_FILTERS = ['all', 'itm', 'otm'] as const;

export type MoneynessFilter = (typeof MONEYNESS_FILTERS)[number];

/** Whether the trade has been up over half its premium at some close. */
export const HALF_FILTERS = ['all', 'yes', 'no'] as const;

export type HalfFilter = (typeof HALF_FILTERS)[number];

/** Whether the reader wants every signal or only contracts already owned. */
export const OWNED_FILTERS = ['all', 'owned'] as const;

export type OwnedFilter = (typeof OWNED_FILTERS)[number];

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
 * Narrows every day's trades by a comma-separated list of symbol fragments. Each term
 * carries its own bang, so a trade has to match one of the plain terms, where there are
 * any, and none of the banged ones. Days are kept even when they empty out, so the card
 * still appears and can say that nothing matched.
 */
export function filterDaysBySymbol(days: DaySignals[], query: string): DaySignals[] {
    const terms = query
        .toUpperCase()
        .split(',')
        .map((term) => term.trim())
        .filter((term) => term !== '');
    const wanted = terms.filter((term) => !term.startsWith('!'));
    const unwanted = terms
        .filter((term) => term.startsWith('!'))
        .map((term) => term.slice(1).trim())
        .filter((term) => term !== '');
    if (wanted.length === 0 && unwanted.length === 0) return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => {
            const symbol = trade.symbol.toUpperCase();
            if (unwanted.some((term) => symbol.includes(term))) return false;
            return wanted.length === 0 || wanted.some((term) => symbol.includes(term));
        }),
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

/**
 * Drops the trades on the wrong side of half their premium. A trade the nightly
 * rollup has not reached is left out of `no` as well as `yes`: it has not failed
 * to get there so much as never been asked.
 */
export function filterDaysByHalf(days: DaySignals[], filter: HalfFilter): DaySignals[] {
    if (filter === 'all') return days;
    const keep = filter === 'yes' ? hasKeptHalf : (trade: Trade) => hasHalfFigure(trade) && !hasKeptHalf(trade);
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter(keep),
    }));
}

export function filterDaysByOwned(days: DaySignals[], filter: OwnedFilter): DaySignals[] {
    if (filter === 'all') return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => trade.ownedLiveContracts > 0 || trade.ownedPaperContracts > 0),
    }));
}

/** The same band shown by a ticket, including its recency and number-source rules. */
export function ticketGradeBand(
    trade: Trade,
    dayDate: string,
    numberSource: NumberSource,
    settings: GradeSettings,
    cautionSymbols: readonly string[],
    vix: number | null,
): GradeBand | null {
    if (!isRecentSignalDay(dayDate)) return null;

    const annualizedYield =
        numberSource === 'actual' ? (trade.actualAnnualizedYield ?? trade.annualizedYield) : trade.annualizedYield;
    const delta = numberSource === 'actual' ? (trade.actualDelta ?? trade.delta) : trade.delta;
    const result = gradeTrade(
        {
            symbol: trade.symbol,
            annualizedYield,
            delta,
            strike: trade.strike,
            price: trade.closeUnderlying ?? trade.actualUnderlying,
            cautionSymbols,
            vix,
        },
        settings,
    );
    return result.band === 'ungraded' ? null : result.band;
}

/** Keeps only explicitly selected grade bands; null bands belong to All. */
export function filterDaysByGrade(
    days: DaySignals[],
    selected: readonly GradeFilter[],
    numberSource: NumberSource,
    settings: GradeSettings,
    cautionSymbols: readonly string[],
    vix: number | null,
): DaySignals[] {
    if (selected.length === 0 || selected.length === GRADE_FILTERS.length) return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => {
            const band = ticketGradeBand(trade, day.date, numberSource, settings, cautionSymbols, vix);
            return band !== null && selected.includes(band as GradeFilter);
        }),
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
