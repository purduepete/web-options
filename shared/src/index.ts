/**
 * Wire contracts shared by the backend and frontend.
 *
 * DATE RULE: every date crossing this boundary is an `IsoDate` string, never a JS
 * `Date`. A serialized Date arrives as "2026-08-16T00:00:00.000Z"; reading it back
 * with local getters shifts it a day earlier in any negative-offset zone (Pacific).
 */

export * from './theme';
export * from './storage';
export * from './caution';
export * from './grade';
export * from './market';

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
    /** Implied volatility as captured, a fraction rather than a percent. */
    actualIv: number | null;
    /** What the underlying was worth when the quote was captured, not today. */
    actualUnderlying: number | null;
    closeDate: IsoDate | null;
    closeUnderlying: number | null;
    moneyness: Moneyness | null;
    percentFromStrike: number | null;
}

/** Risk tiers, least to most. Anything else falls through to `other`. */
export const TIER_ORDER = ['conservative', 'balanced', 'aggressive'] as const;

export type GroupId = 'top-picks' | (typeof TIER_ORDER)[number] | 'other';

export const GROUP_IDS: readonly GroupId[] = ['top-picks', ...TIER_ORDER, 'other'];

export const GROUP_LABELS: Record<GroupId, string> = {
    'top-picks': 'Top Picks',
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
    other: 'Other',
};

/**
 * The one place a trade's risk group is decided. Both the week grid and the
 * server-side summary rollup go through here, so the two can never disagree
 * about which column a ticket belongs in.
 *
 * A top pick is ONLY ever a top pick: it is drawn from every tier, so counting
 * it under its tier as well would double it.
 */
export function groupIdForTrade(trade: Trade): GroupId {
    if (trade.isTopPick) return 'top-picks';
    const tier = (trade.tier ?? '').toLowerCase();
    return (TIER_ORDER as readonly string[]).includes(tier) ? (tier as GroupId) : 'other';
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

/**
 * The summary's columns: the named risk groups, then the week's total. `other`
 * is deliberately absent — it only ever catches a tier we do not recognise, and
 * a column that is empty every month is noise. Those trades still reach `all`.
 */
export type SummaryColumn = Exclude<GroupId, 'other'> | 'all';

export const SUMMARY_COLUMNS: readonly SummaryColumn[] = ['top-picks', ...TIER_ORDER, 'all'];

export const SUMMARY_COLUMN_LABELS: Record<SummaryColumn, string> = {
    'top-picks': GROUP_LABELS['top-picks'],
    conservative: GROUP_LABELS.conservative,
    balanced: GROUP_LABELS.balanced,
    aggressive: GROUP_LABELS.aggressive,
    all: 'All',
};

/**
 * `priced` is the denominator for `otm`: a contract with no close yet has no
 * moneyness and belongs to neither side. `captured` counts contracts that had a
 * real captured quote, so a cell leaning on VADER's fallback can say so.
 *
 * The figures are the captured numbers, falling back per contract to the ones
 * VADER advertised. The summary offers no choice between the two: a month-wide
 * total mixing captured and advertised numbers is the only honest one there is.
 *
 * `premium` and `collateral` are sums, so on their own they measure how many
 * signals a group got. `annualizedYield` is the comparable figure: it is
 * weighted by collateral, so a $20k put outweighs a $200 one instead of each
 * counting once.
 */
export interface SummaryCell {
    signals: number;
    priced: number;
    otm: number;
    captured: number;
    premium: number | null;
    collateral: number | null;
    annualizedYield: number | null;
}

export interface WeekSummaryRow {
    weekStart: IsoDate;
    weekEnd: IsoDate;
    cells: Record<SummaryColumn, SummaryCell>;
}

/** A month of the summary, keyed `YYYY-MM` and filed by the month of each week's MONDAY. */
export interface SignalMonth {
    month: string;
    label: string;
    weekStarts: IsoDate[];
}

export interface SignalMonthsResponse {
    months: SignalMonth[];
}

/** `symbols` echoes back what the server actually applied, not what was typed. */
export interface SignalSummaryResponse {
    month: string;
    symbols: string[];
    expiry: ExpiryFilter;
    weeks: WeekSummaryRow[];
    /* Computed over every trade in the month, not by adding the weeks up, so the
       yields stay means rather than means of means. */
    total: Record<SummaryColumn, SummaryCell>;
}

export const MAX_FILTER_SYMBOLS = 25;

/** Whether a page shows every contract, only the settled ones, or only the live ones. */
export const EXPIRY_FILTERS = ['all', 'expired', 'active'] as const;

export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number];

/** Reads the contracts filter. Anything unrecognised narrows nothing. */
export function parseExpiryFilter(raw: unknown): ExpiryFilter {
    return (EXPIRY_FILTERS as readonly unknown[]).includes(raw) ? (raw as ExpiryFilter) : 'all';
}

function toIsoDate(at: Date): IsoDate {
    const month = String(at.getMonth() + 1).padStart(2, '0');
    const day = String(at.getDate()).padStart(2, '0');
    return `${at.getFullYear()}-${month}-${day}`;
}

/** Today as a calendar date, in the zone the process runs in. Both ends pin that to Pacific. */
function todayIso(): IsoDate {
    return toIsoDate(new Date());
}

function previousWeekday(iso: IsoDate): IsoDate {
    const [year, month, day] = iso.split('-').map(Number);
    const at = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
    do {
        at.setDate(at.getDate() - 1);
    } while (at.getDay() === 0 || at.getDay() === 6);
    return toIsoDate(at);
}

/**
 * Today, or the trading day before it. A signal graded against the underlying's
 * latest close stops describing itself once the week has moved on, so only these
 * two days carry a grade. Monday looks back to Friday: a weekend has no signals.
 */
export function isRecentSignalDay(date: IsoDate | null): boolean {
    if (date === null) return false;
    const today = todayIso();
    return date === today || date === previousWeekday(today);
}

/**
 * Compared as text rather than as dates: both are calendar days, and YYYY-MM-DD
 * sorts the way it reads. Expiry day itself is not past, since the contract lives
 * until that afternoon's close.
 */
export function hasExpired(expiration: IsoDate | null): boolean {
    return expiration !== null && expiration < todayIso();
}

/** Lives here rather than on either side: the grid filters in the browser, the summary in SQL's stead. */
export function matchesExpiry(trade: Trade, filter: ExpiryFilter): boolean {
    return filter === 'all' || hasExpired(trade.expiration) === (filter === 'expired');
}

/**
 * Reads the summary's comma-separated symbol filter. A leading `!` survives the
 * read, since it is what marks the symbol as one to drop rather than one to keep;
 * a bang on its own asks nothing of anybody and is dropped.
 *
 * Takes `unknown` because Express hands back an ARRAY for `?symbols=A&symbols=B`
 * and `undefined` for an absent param. Junk yields an empty filter rather than an
 * error: a stray comma should narrow nothing, not break the page.
 */
export function parseSymbolList(raw: unknown): string[] {
    if (typeof raw !== 'string') return [];
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const token = part.trim().toUpperCase();
        const symbol = token.startsWith('!') ? `!${token.slice(1).trim()}` : token;
        if (symbol && symbol !== '!') seen.add(symbol);
        if (seen.size >= MAX_FILTER_SYMBOLS) break;
    }
    return [...seen];
}

/** The typed tokens sorted into the two questions they ask. */
export interface SymbolFilter {
    include: ReadonlySet<string>;
    exclude: ReadonlySet<string>;
}

/** Sorted once rather than per contract, since a month is a great many contracts. */
export function splitSymbolFilter(tokens: readonly string[]): SymbolFilter {
    const include = new Set<string>();
    const exclude = new Set<string>();
    for (const token of tokens) {
        if (token.startsWith('!')) exclude.add(token.slice(1));
        else include.add(token);
    }
    return { include, exclude };
}

/** A bang always wins, and a filter of nothing but bangs keeps everything else. */
export function matchesSymbolFilter(symbol: string, filter: SymbolFilter): boolean {
    const upper = symbol.toUpperCase();
    if (filter.exclude.has(upper)) return false;
    return filter.include.size === 0 || filter.include.has(upper);
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
