import type { DaySignals, Trade } from '@weboptions/shared';

/**
 * The grid's layout algebra, kept away from React so it can be reasoned about
 * on its own.
 *
 * The one idea worth stating: the risk groups are chosen ONCE for the whole
 * week, not per day. Every day card then draws the same groups in the same
 * order, which is what lets the five cards line their headings up on shared
 * grid rows however many tickets sit above them in any one column.
 */

/** Risk tiers, least to most. Anything else falls through to `other`. */
export const TIER_ORDER = ['conservative', 'balanced', 'aggressive'] as const;

export type GroupId = 'top-picks' | (typeof TIER_ORDER)[number] | 'other';

export interface SignalGroup {
    id: GroupId;
    label: string;
    /** Top picks come from every tier, so only that group spells the tier out. */
    showTierBadge: boolean;
    matches: (trade: Trade) => boolean;
}

const LABELS: Record<GroupId, string> = {
    'top-picks': 'Top Picks',
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
    other: 'Other',
};

function tierOf(trade: Trade): string {
    return (trade.tier ?? '').toLowerCase();
}

function isKnownTier(trade: Trade): boolean {
    return (TIER_ORDER as readonly string[]).includes(tierOf(trade));
}

/**
 * Narrows every day's trades to those whose symbol contains `query`. Days are
 * kept even when they empty out, so the card still appears and can say that
 * nothing matched.
 */
export function filterDaysBySymbol(days: DaySignals[], query: string): DaySignals[] {
    const needle = query.trim().toUpperCase();
    if (!needle) return days;
    return days.map((day) => ({
        ...day,
        trades: day.trades.filter((trade) => trade.symbol.toUpperCase().includes(needle)),
    }));
}

/** The groups at least one day this week can fill, in the order they are drawn. */
export function buildGroups(days: DaySignals[]): SignalGroup[] {
    const groups: SignalGroup[] = [];
    const someTradeIs = (predicate: (trade: Trade) => boolean) =>
        days.some((day) => day.trades.some(predicate));

    const isTopPick = (trade: Trade) => trade.isTopPick;
    if (someTradeIs(isTopPick)) {
        groups.push({ id: 'top-picks', label: LABELS['top-picks'], showTierBadge: true, matches: isTopPick });
    }

    for (const tier of TIER_ORDER) {
        const matches = (trade: Trade) => !trade.isTopPick && tierOf(trade) === tier;
        if (someTradeIs(matches)) {
            groups.push({ id: tier, label: LABELS[tier], showTierBadge: false, matches });
        }
    }

    const isOther = (trade: Trade) => !trade.isTopPick && !isKnownTier(trade);
    if (someTradeIs(isOther)) {
        groups.push({ id: 'other', label: LABELS.other, showTierBadge: false, matches: isOther });
    }

    return groups;
}

/** This group's share of one day, richest annualised yield first. */
export function groupTrades(group: SignalGroup, trades: Trade[]): Trade[] {
    return trades
        .filter(group.matches)
        .slice()
        .sort((a, b) => (b.annualizedYield ?? 0) - (a.annualizedYield ?? 0));
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
