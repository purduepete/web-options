/**
 * Wire contracts shared by the backend and frontend.
 *
 * DATE RULE: every date crossing this boundary is an `IsoDate` string, never a JS
 * `Date`. A serialized Date arrives as "2026-08-16T00:00:00.000Z"; reading it back
 * with local getters shifts it a day earlier in any negative-offset zone (Pacific).
 */

export * from './theme';
export * from './storage';

/** A calendar date with no time and no zone, formatted `YYYY-MM-DD`. */
export type IsoDate = string;

export type OptionRight = 'P' | 'C';

export interface Trade {
    symbol: string;
    sector: string | null;
    optionRight: OptionRight;
    strike: number | null;
    expiration: IsoDate | null;
    dte: number | null;
    delta: number | null;
    annualizedYield: number | null;
    premium: number | null;
    collateral: number | null;
    tier: string | null;
    isTopPick: boolean;
}

export interface DaySignals {
    name: string;
    date: IsoDate;
    hasData: true;
    trades: Trade[];
}

export interface WeekSignalsResponse {
    weekStart: IsoDate;
    weekEnd: IsoDate;
    generatedAt: string;
    isCurrentWeek: boolean;
    hasPriorWeekData: boolean;
    hasNextWeekData: boolean;
    days: DaySignals[];
}

export interface EarliestWeekResponse {
    weekStart: IsoDate | null;
}

/** One headline from a calendar's macro banner. */
export interface MacroNote {
    label: string;
    text: string;
}

export interface CalendarTrade {
    ticker: string;
    optionRight: OptionRight;
    strike: number | null;
    expiry: IsoDate | null;
    dte: number | null;
    delta: number | null;
    annualizedYield: number | null;
    premium: number | null;
    collateral: number | null;
    risk: string | null;
    note: string | null;
}

export interface CalendarDay {
    name: string;
    date: IsoDate;
    rule: string | null;
    event: string | null;
    trades: CalendarTrade[];
}

export interface CalendarWeek {
    publishDate: IsoDate;
    weekStart: IsoDate;
    weekEnd: IsoDate;
    title: string | null;
    macro: MacroNote[];
    days: CalendarDay[];
}

export interface CalendarSummary {
    publishDate: IsoDate;
    weekStart: IsoDate;
    weekEnd: IsoDate;
    title: string | null;
    tradeCount: number;
}

export interface CalendarsIndexResponse {
    calendars: CalendarSummary[];
}

/** Kind of notable-trade write-up on a weekly results report. Extensible: new
 * values are an app-level allowlist change, not a schema migration. */
export type ReportCalloutKind = 'roll' | 'assignment' | 'close' | 'note';

export interface ReportCallout {
    ticker: string;
    kind: ReportCalloutKind;
    headline: string;
    body: string | null;
}

/** Headline metrics for one week's realized performance and open-position book.
 * Percentages (hitRate, returnPct) are percentage points, e.g. 92.1 not 0.921,
 * matching CalendarTrade.annualizedYield's convention. */
export interface ReportMetrics {
    netPnl: number | null;
    closedLegs: number | null;
    winningLegs: number | null;
    rollLegs: number | null;
    hitRate: number | null;
    winnersAmount: number | null;
    rollCost: number | null;
    collateral: number | null;
    returnPct: number | null;
    newPositions: number | null;
    newPremium: number | null;
    netCash: number | null;
    medianDaysHeld: number | null;
    openPositionsTotal: number | null;
    openCalls: number | null;
    openPuts: number | null;
    openGreen: number | null;
    openYellow: number | null;
    openRed: number | null;
}

export interface WeeklyReport {
    publishDate: IsoDate;
    title: string | null;
    sourceUrl: string | null;
    macro: MacroNote[];
    metrics: ReportMetrics;
    callouts: ReportCallout[];
}

export interface WeeklyReportSummary {
    publishDate: IsoDate;
    title: string | null;
    netPnl: number | null;
    hitRate: number | null;
    calloutCount: number;
}

export interface ReportsIndexResponse {
    reports: WeeklyReportSummary[];
}

export interface HealthResponse {
    status: 'ok';
}

/** Identifies the key the caller presented. Never includes the key or its hash. */
export interface MeResponse {
    label: string;
    prefix: string;
    expiresAt: IsoDate | null;
}

export interface ApiError {
    error: string;
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
    return typeof value === 'string' && ISO_DATE_RE.test(value);
}
