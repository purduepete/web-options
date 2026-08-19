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

/** Where the underlying closed relative to the strike. */
export type Moneyness = 'itm' | 'otm' | 'atm';

/** Which set of numbers a signal card shows. */
export const NUMBER_SOURCES = ['actual', 'quoted'] as const;
export type NumberSource = (typeof NUMBER_SOURCES)[number];

export const DEFAULT_NUMBER_SOURCE: NumberSource = 'actual';

/**
 * `delta`/`premium`/`annualizedYield` are what VADER advertised. The `actual*`
 * fields are the 7:30am Pacific quote captured on the report date, and are null
 * whenever no quote exists — capture began 2026-08-05, and no backfill is
 * possible, so every earlier week is VADER's numbers only.
 *
 * The `close*` fields and the moneyness derived from them come from the separate
 * end-of-day snapshot, and describe the MOST RECENT close on or after the report
 * date rather than the report date's own. They are null until that contract has
 * been captured at least once, which for the current day is always.
 */
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
    actualDelta: number | null;
    actualPremium: number | null;
    actualAnnualizedYield: number | null;
    actualIlliquid: boolean;
    closeDate: IsoDate | null;
    closeUnderlying: number | null;
    moneyness: Moneyness | null;
    percentFromStrike: number | null;
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
