import {
    SUMMARY_COLUMNS,
    groupIdForTrade,
    hasHalfFigure,
    hasKeptHalf,
    matchesExpiry,
    matchesSymbolFilter,
    splitSymbolFilter,
    type ExpiryFilter,
    type NumberSource,
    type IsoDate,
    type SignalMonth,
    type SummaryFilters,
    type SummaryCell,
    type SummaryColumn,
    type Trade,
    type WeekSummaryRow,
} from '@weboptions/shared';
import { fromIsoDate, mondayOf, toIsoDate, weekEndFor } from '../weeks';
import { sqlDateToIso, toTrade, type SignalRow } from './shape';

/**
 * The summary's rollup, in TypeScript rather than T-SQL.
 *
 * Moneyness, the captured premium and our own annualised yield are all derived in
 * shape.ts, and which risk group a ticket belongs to is decided in shared. A SQL
 * rollup would have to restate all four, and the two definitions would drift.
 *
 * Every date here goes ISO string -> fromIsoDate -> mondayOf. `new Date(iso)`
 * parses as UTC midnight and lands on the previous day in Pacific, which would
 * file a Monday's signals under the week before.
 */

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

function weekStartOf(date: IsoDate): IsoDate {
    return toIsoDate(mondayOf(fromIsoDate(date)));
}

/**
 * The month index: every week that has signals, filed under the month of its
 * MONDAY. A week straddling a month boundary therefore belongs wholly to the
 * month it started in, which is what keeps each week on exactly one row.
 *
 * Newest first, months and weeks alike — this is a history, and the reader is
 * nearly always asking about the recent end of it.
 */
export function monthsFrom(dates: IsoDate[]): SignalMonth[] {
    const byMonth = new Map<string, Set<IsoDate>>();
    for (const date of dates) {
        const weekStart = weekStartOf(date);
        const month = weekStart.slice(0, 7);
        let weeks = byMonth.get(month);
        if (!weeks) {
            weeks = new Set();
            byMonth.set(month, weeks);
        }
        weeks.add(weekStart);
    }

    return [...byMonth.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, weeks]) => ({
            month,
            label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`)),
            weekStarts: [...weeks].sort((a, b) => b.localeCompare(a)),
        }));
}

/** The one date range covering a month's weeks, Monday of the first to Friday of the last. */
export function spanOf(month: SignalMonth): { from: IsoDate; to: IsoDate } {
    const sorted = [...month.weekStarts].sort();
    const first = sorted[0] ?? `${month.month}-01`;
    const last = sorted[sorted.length - 1] ?? first;
    return { from: first, to: toIsoDate(weekEndFor(fromIsoDate(last))) };
}

function mean(values: number[]): number | null {
    if (values.length === 0) return null;
    return round(values.reduce((total, value) => total + value, 0) / values.length, 1);
}

function total(values: number[]): number | null {
    if (values.length === 0) return null;
    return round(
        values.reduce((sum, value) => sum + value, 0),
        2
    );
}

/**
 * Weighted by collateral, so a tier is not flattered by a handful of tiny
 * contracts at a huge yield. A trade whose collateral is unknown cannot be
 * weighted, so it only counts if nothing in the cell has collateral at all.
 */
function weightedYield(trades: Trade[], numberSource: NumberSource): number | null {
    const plain: number[] = [];
    let weighted = 0;
    let weight = 0;

    for (const trade of trades) {
        const yieldValue =
            numberSource === 'actual' ? (trade.actualAnnualizedYield ?? trade.annualizedYield) : trade.annualizedYield;
        if (yieldValue === null) continue;
        plain.push(yieldValue);
        if (trade.collateral === null || trade.collateral <= 0) continue;
        weighted += yieldValue * trade.collateral;
        weight += trade.collateral;
    }

    return weight > 0 ? round(weighted / weight, 1) : mean(plain);
}

/**
 * Each figure is the captured number, falling back to VADER's per contract the
 * way the grid's tickets do. Capture only began 2026-08-05, so an older week
 * would otherwise report nothing at all rather than the numbers it does have.
 */
function summarizeCell(trades: Trade[], numberSource: NumberSource): SummaryCell {
    const nonNull = (values: (number | null)[]) => values.filter((value): value is number => value !== null);
    return {
        signals: trades.length,
        priced: trades.filter((trade) => trade.moneyness !== null).length,
        otm: trades.filter((trade) => trade.moneyness === 'otm').length,
        captured: trades.filter((trade) => trade.actualPremium !== null).length,
        halfRollup: trades.filter(hasHalfFigure).length,
        halfKept: trades.filter(hasKeptHalf).length,
        premium: total(
            nonNull(
                trades.map((trade) =>
                    numberSource === 'actual' ? (trade.actualPremium ?? trade.premium) : trade.premium
                )
            )
        ),
        collateral: total(nonNull(trades.map((trade) => trade.collateral))),
        annualizedYield: weightedYield(trades, numberSource),
    };
}

function cellsFor(trades: Trade[], numberSource: NumberSource): Record<SummaryColumn, SummaryCell> {
    const cells = {} as Record<SummaryColumn, SummaryCell>;
    for (const column of SUMMARY_COLUMNS) {
        // `all` is computed over every surviving trade rather than by adding the
        // group cells up, so its yield stays weighted across the whole set.
        cells[column] = summarizeCell(
            column === 'all' ? trades : trades.filter((trade) => groupIdForTrade(trade) === column),
            numberSource
        );
    }
    return cells;
}

/**
 * One row per week in `weekStarts`, always — a symbol filter that empties a week
 * leaves an empty row behind rather than removing it, so the reader can see that
 * the week existed and the symbol was simply absent from it. The contracts filter
 * leaves the same hole for the same reason. A symbol written with a leading bang
 * is one to drop rather than one to keep.
 *
 * The month total comes from the same trades in one pass, never from adding the
 * weekly cells up: a sum of weekly yields is not the month's yield.
 */
export function summarizeRange(
    rows: SignalRow[],
    weekStarts: IsoDate[],
    requested: SummaryFilters | string[],
    legacyExpiry: ExpiryFilter = 'all'
): { weeks: WeekSummaryRow[]; total: Record<SummaryColumn, SummaryCell> } {
    const filters: SummaryFilters = Array.isArray(requested)
        ? {
              symbols: requested,
              expiry: legacyExpiry,
              moneyness: 'all',
              half: 'all',
              owned: 'all',
              numberSource: 'actual',
          }
        : requested;
    const wanted = splitSymbolFilter(filters.symbols);
    const byWeek = new Map<IsoDate, Trade[]>();
    for (const weekStart of weekStarts) byWeek.set(weekStart, []);
    const kept: Trade[] = [];

    for (const row of rows) {
        const reportDate = sqlDateToIso(row.report_date);
        if (!reportDate) continue;
        const trade = toTrade(row);
        if (!matchesSymbolFilter(trade.symbol, wanted)) continue;
        if (!matchesExpiry(trade, filters.expiry)) continue;
        if (filters.moneyness !== 'all' && trade.moneyness !== filters.moneyness) continue;
        if (filters.half === 'yes' && !hasKeptHalf(trade)) continue;
        if (filters.half === 'no' && (!hasHalfFigure(trade) || hasKeptHalf(trade))) continue;
        if (filters.owned === 'owned' && trade.ownedLiveContracts === 0 && trade.ownedPaperContracts === 0) continue;
        const week = byWeek.get(weekStartOf(reportDate));
        if (!week) continue;
        week.push(trade);
        kept.push(trade);
    }

    return {
        weeks: weekStarts.map((weekStart) => ({
            weekStart,
            weekEnd: toIsoDate(weekEndFor(fromIsoDate(weekStart))),
            cells: cellsFor(byWeek.get(weekStart) ?? [], filters.numberSource),
        })),
        total: cellsFor(kept, filters.numberSource),
    };
}
