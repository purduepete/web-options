import { DAY_NAMES, type DaySignals, type IsoDate, type OptionRight, type Trade } from '@weboptions/shared';
import { addDays, toIsoDate } from '../weeks';

/** One row as the driver hands it back. Dates arrive as Date, decimals as string or number. */
export interface SignalRow {
    report_date: unknown;
    symbol: string;
    sector: string | null;
    option_right: string;
    strike: unknown;
    expiration: unknown;
    dte: unknown;
    delta: unknown;
    annualized_yield: unknown;
    premium: unknown;
    collateral: unknown;
    collateral_bucket: string | null;
    tier: string | null;
    is_top_pick: unknown;
}

/**
 * Normalizes whatever the driver returns for a DATE column into `YYYY-MM-DD`.
 *
 * tedious materializes DATE as a JS Date at MIDNIGHT UTC. Reading it with local
 * getters west of Greenwich yields the previous day, which would file Monday's
 * signals under Sunday and drop them from the grid entirely. Read UTC parts.
 */
export function sqlDateToIso(value: unknown): IsoDate | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        const year = String(value.getUTCFullYear()).padStart(4, '0');
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function toInteger(value: unknown): number | null {
    const parsed = toNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
}

export function toTrade(row: SignalRow): Trade {
    return {
        symbol: row.symbol,
        sector: row.sector,
        optionRight: row.option_right as OptionRight,
        strike: toNumber(row.strike),
        expiration: sqlDateToIso(row.expiration),
        dte: toInteger(row.dte),
        delta: toNumber(row.delta),
        annualizedYield: toNumber(row.annualized_yield),
        premium: toNumber(row.premium),
        collateral: toNumber(row.collateral),
        tier: row.tier,
        isTopPick: Boolean(toNumber(row.is_top_pick)),
    };
}

/**
 * Groups rows into Monday–Friday. Days with no rows are OMITTED rather than
 * emitted empty — the Flask response did the same and the frontend relies on it.
 */
export function groupIntoDays(rows: SignalRow[], monday: Date): DaySignals[] {
    const days: DaySignals[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
        const dayIso = toIsoDate(addDays(monday, offset));
        const dayRows = rows.filter((row) => sqlDateToIso(row.report_date) === dayIso);
        if (dayRows.length === 0) continue;
        days.push({
            name: DAY_NAMES[offset]!,
            date: dayIso,
            hasData: true,
            trades: dayRows.map(toTrade),
        });
    }
    return days;
}
