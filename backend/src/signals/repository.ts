import sql from 'mssql';
import type { DaySignals, IsoDate } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { addDays, mondayOf, toIsoDate } from '../weeks';
import { groupIntoDays, sqlDateToIso, type SignalRow } from './shape';
import { EARLIEST_DATE_QUERY, EXISTS_QUERY, SIGNAL_DATES_QUERY, SIGNAL_QUERY } from './sql';

async function requestFor(db: DbConfig): Promise<sql.Request> {
    const pool = await getPool(db);
    return pool.request();
}

function bindWeek(request: sql.Request, monday: Date): sql.Request {
    return request
        .input('weekStart', sql.VarChar(10), toIsoDate(monday))
        .input('weekEnd', sql.VarChar(10), toIsoDate(addDays(monday, 4)));
}

/**
 * The same two parameters over an arbitrary span. Separate from bindWeek because
 * that one derives its end from its start (monday + 4) and would silently clip a
 * multi-week range down to five days. Strings, for the reason sql.ts explains.
 */
function bindRange(request: sql.Request, from: IsoDate, to: IsoDate): sql.Request {
    return request.input('weekStart', sql.VarChar(10), from).input('weekEnd', sql.VarChar(10), to);
}

export async function fetchWeek(db: DbConfig, monday: Date): Promise<DaySignals[]> {
    const request = bindWeek(await requestFor(db), monday);
    const result = await request.query<SignalRow>(SIGNAL_QUERY);
    return groupIntoDays(result.recordset, monday);
}

/**
 * Rows across a span, ungrouped. The summary needs each row's own report_date to
 * file it under a week, and a Trade carries no date.
 */
export async function fetchRange(db: DbConfig, from: IsoDate, to: IsoDate): Promise<SignalRow[]> {
    const request = bindRange(await requestFor(db), from, to);
    const result = await request.query<SignalRow>(SIGNAL_QUERY);
    return result.recordset;
}

/** Every date with signals, ascending. Small: one row per trading day, ever. */
export async function signalDates(db: DbConfig): Promise<IsoDate[]> {
    const request = await requestFor(db);
    const result = await request.query<{ report_date: unknown }>(SIGNAL_DATES_QUERY);
    const dates: IsoDate[] = [];
    for (const row of result.recordset) {
        const iso = sqlDateToIso(row.report_date);
        if (iso) dates.push(iso);
    }
    return dates;
}

export async function weekHasData(db: DbConfig, monday: Date): Promise<boolean> {
    const request = bindWeek(await requestFor(db), monday);
    const result = await request.query(EXISTS_QUERY);
    return result.recordset.length > 0;
}

export async function earliestWeekMonday(db: DbConfig): Promise<IsoDate | null> {
    const request = await requestFor(db);
    const result = await request.query<{ earliest: unknown }>(EARLIEST_DATE_QUERY);
    const earliest = result.recordset[0]?.earliest;
    if (earliest === null || earliest === undefined) return null;
    // MIN(report_date) comes back as a UTC-midnight Date; go through the same
    // normalizer the row shaper uses rather than trusting local getters.
    const iso = earliest instanceof Date ? earliest : new Date(String(earliest));
    const utcMidnight = new Date(Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate()));
    const asLocal = new Date(utcMidnight.getUTCFullYear(), utcMidnight.getUTCMonth(), utcMidnight.getUTCDate());
    return toIsoDate(mondayOf(asLocal));
}
