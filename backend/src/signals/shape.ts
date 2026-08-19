import {
    DAY_NAMES,
    type DaySignals,
    type IsoDate,
    type Moneyness,
    type OptionRight,
    type Trade,
} from '@weboptions/shared';
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
    actual_delta: unknown;
    actual_mark: unknown;
    actual_illiquid: unknown;
    close_date: unknown;
    close_underlying: unknown;
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

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

/**
 * VADER quotes a premium per CONTRACT (752 against a 17500 collateral); the captured
 * `mark` is per SHARE. webportfolio settles the convention: it computes
 * `breakeven = strike - mark` and `premium_dollars = mark * 100`.
 */
function toActualPremium(mark: unknown): number | null {
    const parsed = toNumber(mark);
    return parsed === null ? null : round(parsed * 100, 2);
}

/**
 * Ours, not VADER's: the same formula run against the captured premium, so the yield
 * on the card can never describe a premium the card is not showing.
 */
function toActualYield(premium: number | null, collateral: number | null, dte: number | null): number | null {
    if (premium === null || collateral === null || collateral <= 0) return null;
    if (dte === null || dte <= 0) return null;
    return round((premium / collateral) * (365 / dte) * 100, 1);
}

/** Right-aware so a call would read correctly; today the query is puts only. */
function toMoneyness(right: OptionRight, strike: number | null, underlying: number | null): Moneyness | null {
    if (strike === null || strike <= 0 || underlying === null) return null;
    if (underlying === strike) return 'atm';
    const below = underlying < strike;
    return (right === 'P' ? below : !below) ? 'itm' : 'otm';
}

/**
 * Signed against the STRIKE, so it reads negative for an in-the-money put and
 * positive for one out of the money regardless of right. A strike at or below
 * zero is nonsense and would flip the sign, so it yields nothing.
 */
function toPercentFromStrike(strike: number | null, underlying: number | null): number | null {
    if (strike === null || strike <= 0 || underlying === null) return null;
    return round(((underlying - strike) / strike) * 100, 1);
}

export function toTrade(row: SignalRow): Trade {
    const collateral = toNumber(row.collateral);
    const dte = toInteger(row.dte);
    const actualPremium = toActualPremium(row.actual_mark);
    const optionRight = row.option_right as OptionRight;
    const strike = toNumber(row.strike);
    const closeUnderlying = toNumber(row.close_underlying);
    return {
        symbol: row.symbol,
        sector: row.sector,
        optionRight,
        strike,
        expiration: sqlDateToIso(row.expiration),
        dte,
        delta: toNumber(row.delta),
        annualizedYield: toNumber(row.annualized_yield),
        premium: toNumber(row.premium),
        collateral,
        tier: row.tier,
        isTopPick: Boolean(toNumber(row.is_top_pick)),
        actualDelta: toNumber(row.actual_delta),
        actualPremium,
        actualAnnualizedYield: toActualYield(actualPremium, collateral, dte),
        actualIlliquid: Boolean(toNumber(row.actual_illiquid)),
        closeDate: sqlDateToIso(row.close_date),
        closeUnderlying,
        moneyness: toMoneyness(optionRight, strike, closeUnderlying),
        percentFromStrike: toPercentFromStrike(strike, closeUnderlying),
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
