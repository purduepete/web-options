import sql from 'mssql';
import type { MacroNote, ReportCallout, ReportCalloutKind, ReportMetrics, WeeklyReport, WeeklyReportSummary } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { sqlDateToIso } from '../signals/shape';

const INDEX_QUERY = `
SELECT w.publish_date, w.title, w.net_pnl, w.hit_rate,
       (SELECT COUNT(*) FROM opt.report_callout c WHERE c.report_week_id = w.id) AS callout_count
FROM opt.report_week w
ORDER BY w.publish_date DESC
`;

const WEEK_QUERY = `
SELECT TOP 1 id, publish_date, title, source_url, macro,
       net_pnl, closed_legs, winning_legs, roll_legs, hit_rate, winners_amount, roll_cost,
       collateral, return_pct, new_positions, new_premium, net_cash, median_days_held,
       open_positions_total, open_calls, open_puts, open_green, open_yellow, open_red
FROM opt.report_week
WHERE publish_date = CAST(@publishDate AS DATE)
`;

const CALLOUTS_QUERY = `
SELECT ticker, kind, headline, body, sort_order
FROM opt.report_callout
WHERE report_week_id = @weekId
ORDER BY sort_order
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

function rowToMetrics(row: Record<string, unknown>): ReportMetrics {
    return {
        netPnl: toNumber(row.net_pnl),
        closedLegs: toNumber(row.closed_legs),
        winningLegs: toNumber(row.winning_legs),
        rollLegs: toNumber(row.roll_legs),
        hitRate: toNumber(row.hit_rate),
        winnersAmount: toNumber(row.winners_amount),
        rollCost: toNumber(row.roll_cost),
        collateral: toNumber(row.collateral),
        returnPct: toNumber(row.return_pct),
        newPositions: toNumber(row.new_positions),
        newPremium: toNumber(row.new_premium),
        netCash: toNumber(row.net_cash),
        medianDaysHeld: toNumber(row.median_days_held),
        openPositionsTotal: toNumber(row.open_positions_total),
        openCalls: toNumber(row.open_calls),
        openPuts: toNumber(row.open_puts),
        openGreen: toNumber(row.open_green),
        openYellow: toNumber(row.open_yellow),
        openRed: toNumber(row.open_red),
    };
}

export async function listReports(db: DbConfig): Promise<WeeklyReportSummary[]> {
    const pool = await getPool(db);
    const result = await pool.request().query(INDEX_QUERY);
    return result.recordset.map((row) => ({
        publishDate: sqlDateToIso(row.publish_date)!,
        title: row.title ?? null,
        netPnl: toNumber(row.net_pnl),
        hitRate: toNumber(row.hit_rate),
        calloutCount: toNumber(row.callout_count) ?? 0,
    }));
}

export async function fetchReport(db: DbConfig, publishDate: string): Promise<WeeklyReport | null> {
    const pool = await getPool(db);

    const weekResult = await pool.request().input('publishDate', sql.VarChar(10), publishDate).query(WEEK_QUERY);
    const weekRow = weekResult.recordset[0];
    if (!weekRow) return null;

    const weekId = weekRow.id as number;
    const calloutResult = await pool.request().input('weekId', sql.Int, weekId).query(CALLOUTS_QUERY);

    const callouts: ReportCallout[] = calloutResult.recordset.map((row) => ({
        ticker: row.ticker,
        kind: row.kind as ReportCalloutKind,
        headline: row.headline,
        body: row.body ?? null,
    }));

    return {
        publishDate: sqlDateToIso(weekRow.publish_date)!,
        title: weekRow.title ?? null,
        sourceUrl: weekRow.source_url ?? null,
        macro: parseMacro(weekRow.macro),
        metrics: rowToMetrics(weekRow),
        callouts,
    };
}
