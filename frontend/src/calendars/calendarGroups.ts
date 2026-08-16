import type { CalendarTrade } from '@weboptions/shared';
import { formatDayLabel } from '../signals/format';

/**
 * How a weekly calendar's trades are arranged inside one day.
 *
 * Unlike the live grid, a calendar day has no top picks and no shared row
 * layout across the week: the groups simply stack in risk order inside that
 * day's ticket column. Puts lead calls because the newsletter reads that way —
 * cash first, then the covered calls against what is already held.
 */

export const RISK_ORDER = ['conservative', 'balanced', 'aggressive'] as const;

export type RiskId = (typeof RISK_ORDER)[number] | 'other';

export interface CalendarGroup {
    risk: RiskId;
    label: string;
    trades: CalendarTrade[];
}

const LABELS: Record<RiskId, string> = {
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
    other: 'Other',
};

function riskOf(trade: CalendarTrade): RiskId {
    const risk = (trade.risk ?? '').toLowerCase();
    return (RISK_ORDER as readonly string[]).includes(risk) ? (risk as RiskId) : 'other';
}

function byRightThenYield(a: CalendarTrade, b: CalendarTrade): number {
    if (a.optionRight !== b.optionRight) return a.optionRight === 'P' ? -1 : 1;
    return (b.annualizedYield ?? 0) - (a.annualizedYield ?? 0);
}

export function groupCalendarTrades(trades: CalendarTrade[]): CalendarGroup[] {
    const groups: CalendarGroup[] = [];
    for (const risk of [...RISK_ORDER, 'other'] as RiskId[]) {
        const inGroup = trades.filter((trade) => riskOf(trade) === risk);
        if (inGroup.length === 0) continue;
        groups.push({ risk, label: LABELS[risk], trades: inGroup.slice().sort(byRightThenYield) });
    }
    return groups;
}

export function weekRangeLabel(weekStart: string, weekEnd: string): string {
    return `${formatDayLabel(weekStart)} – ${formatDayLabel(weekEnd)}`;
}

/** True for the newest publish date in the list, whatever order it arrived in. */
export function isLatest(publishDate: string, calendars: readonly { publishDate: string }[]): boolean {
    if (calendars.length === 0) return false;
    return calendars.every((other) => other.publishDate <= publishDate);
}
