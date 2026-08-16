import sql from 'mssql';
import type { CalendarSummary, CalendarWeek, MacroNote } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { sqlDateToIso } from '../signals/shape';

const INDEX_QUERY = `
SELECT w.publish_date, w.week_start, w.week_end, w.title,
       (SELECT COUNT(*)
        FROM opt.calendar_day d
        JOIN opt.calendar_trade t ON t.day_id = d.id
        WHERE d.week_id = w.id) AS trade_count
FROM opt.calendar_week w
ORDER BY w.publish_date DESC
`;

const WEEK_QUERY = `
SELECT TOP 1 id, publish_date, week_start, week_end, title, macro
FROM opt.calendar_week
WHERE publish_date = CAST(@publishDate AS DATE)
`;

const DAYS_QUERY = `
SELECT d.id, d.day_name, d.day_date, d.[rule], d.[event], d.sort_order
FROM opt.calendar_day d
WHERE d.week_id = @weekId
ORDER BY d.sort_order
`;

const TRADES_QUERY = `
SELECT t.day_id, t.ticker, t.option_right, t.strike, t.expiry, t.dte, t.delta,
       t.ann_yield, t.premium, t.collateral, t.risk, t.note, t.sort_order
FROM opt.calendar_trade t
JOIN opt.calendar_day d ON d.id = t.day_id
WHERE d.week_id = @weekId
ORDER BY t.day_id, t.sort_order
`;

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** A macro column that is somehow not an array must not take the page down. */
function parseMacro(value: unknown): MacroNote[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as MacroNote[]) : [];
    } catch {
        return [];
    }
}

export async function listCalendars(db: DbConfig): Promise<CalendarSummary[]> {
    const pool = await getPool(db);
    const result = await pool.request().query(INDEX_QUERY);
    return result.recordset.map((row) => ({
        publishDate: sqlDateToIso(row.publish_date)!,
        weekStart: sqlDateToIso(row.week_start)!,
        weekEnd: sqlDateToIso(row.week_end)!,
        title: row.title ?? null,
        tradeCount: toNumber(row.trade_count) ?? 0,
    }));
}

export async function fetchCalendar(db: DbConfig, publishDate: string): Promise<CalendarWeek | null> {
    const pool = await getPool(db);

    const weekResult = await pool.request().input('publishDate', sql.VarChar(10), publishDate).query(WEEK_QUERY);

    const weekRow = weekResult.recordset[0];
    if (!weekRow) return null;

    const weekId = weekRow.id as number;
    const [dayResult, tradeResult] = await Promise.all([
        pool.request().input('weekId', sql.Int, weekId).query(DAYS_QUERY),
        pool.request().input('weekId', sql.Int, weekId).query(TRADES_QUERY),
    ]);

    const tradesByDay = new Map<number, CalendarWeek['days'][number]['trades']>();
    for (const row of tradeResult.recordset) {
        const dayId = row.day_id as number;
        const bucket = tradesByDay.get(dayId) ?? [];
        bucket.push({
            ticker: row.ticker,
            optionRight: row.option_right === 'C' ? 'C' : 'P',
            strike: toNumber(row.strike),
            expiry: sqlDateToIso(row.expiry),
            dte: toNumber(row.dte),
            delta: toNumber(row.delta),
            annualizedYield: toNumber(row.ann_yield),
            premium: toNumber(row.premium),
            collateral: toNumber(row.collateral),
            risk: row.risk ?? null,
            note: row.note ?? null,
        });
        tradesByDay.set(dayId, bucket);
    }

    return {
        publishDate: sqlDateToIso(weekRow.publish_date)!,
        weekStart: sqlDateToIso(weekRow.week_start)!,
        weekEnd: sqlDateToIso(weekRow.week_end)!,
        title: weekRow.title ?? null,
        macro: parseMacro(weekRow.macro),
        // Empty days still render: the rule and event are the point of an empty day.
        days: dayResult.recordset.map((row) => ({
            name: row.day_name,
            date: sqlDateToIso(row.day_date)!,
            rule: row.rule ?? null,
            event: row.event ?? null,
            trades: tradesByDay.get(row.id as number) ?? [],
        })),
    };
}
