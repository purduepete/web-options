import sql from 'mssql';
import type { IsoDate, PastSignal, SymbolBar } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { sqlDateToIso } from '../signals/shape';
import type { SymbolQuote } from './yahoo';

/**
 * The cache side of the market data, in `optcfg` — the only schema this app may
 * write. `weboptions_ro` holds no UPDATE (see migration 009), so a refresh deletes
 * the symbol's rows and reinserts them inside one transaction.
 *
 * `pastSignalsFor` reads `opt`, which is strictly read-only and owned by the
 * webportfolio repo.
 */

export interface CachedSymbol {
    quote: SymbolQuote;
    bars: SymbolBar[];
    refreshedAt: Date | null;
}

const PROFILE_QUERY = `
SELECT symbol, long_name, exchange, currency, price, price_date, refreshed_at
FROM optcfg.symbol_profile
WHERE symbol = @symbol
`;

const BARS_QUERY = `
SELECT bar_date, [close]
FROM optcfg.price_bar
WHERE symbol = @symbol
ORDER BY bar_date
`;

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}

export async function readCached(db: DbConfig, symbol: string): Promise<CachedSymbol | null> {
    const pool = await getPool(db);

    const profile = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .query<Record<string, unknown>>(PROFILE_QUERY);
    const row = profile.recordset[0];
    if (!row) return null;

    const bars = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .query<Record<string, unknown>>(BARS_QUERY);

    return {
        quote: {
            longName: (row.long_name as string | null) ?? null,
            exchange: (row.exchange as string | null) ?? null,
            currency: (row.currency as string | null) ?? null,
            price: toNumber(row.price),
            priceDate: sqlDateToIso(row.price_date),
        },
        bars: bars.recordset
            .map((bar) => ({ date: sqlDateToIso(bar.bar_date) as IsoDate, close: toNumber(bar['close']) ?? 0 }))
            .filter((bar) => Boolean(bar.date)),
        refreshedAt: row.refreshed_at instanceof Date ? row.refreshed_at : null,
    };
}

/** Kept well under the driver's 2100 parameter ceiling: 3 parameters a row. */
const BAR_BATCH = 500;

export async function writeCached(
    db: DbConfig,
    symbol: string,
    quote: SymbolQuote,
    bars: readonly SymbolBar[],
): Promise<void> {
    const pool = await getPool(db);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        for (const table of ['optcfg.symbol_profile', 'optcfg.price_bar']) {
            await new sql.Request(transaction)
                .input('symbol', sql.VarChar(20), symbol)
                .query(`DELETE FROM ${table} WHERE symbol = @symbol`);
        }

        await new sql.Request(transaction)
            .input('symbol', sql.VarChar(20), symbol)
            .input('longName', sql.NVarChar(120), quote.longName)
            .input('exchange', sql.VarChar(40), quote.exchange)
            .input('currency', sql.VarChar(10), quote.currency)
            .input('price', sql.Decimal(18, 4), quote.price)
            .input('priceDate', sql.VarChar(10), quote.priceDate).query(`
                INSERT INTO optcfg.symbol_profile (symbol, long_name, exchange, currency, price, price_date)
                VALUES (@symbol, @longName, @exchange, @currency, @price, CAST(@priceDate AS DATE))
            `);

        for (let start = 0; start < bars.length; start += BAR_BATCH) {
            const batch = bars.slice(start, start + BAR_BATCH);
            const request = new sql.Request(transaction).input('symbol', sql.VarChar(20), symbol);
            batch.forEach((bar, index) => {
                request.input(`d${index}`, sql.VarChar(10), bar.date);
                request.input(`c${index}`, sql.Decimal(18, 4), bar.close);
            });
            const values = batch.map((_, index) => `(@symbol, CAST(@d${index} AS DATE), @c${index})`).join(', ');
            await request.query(`INSERT INTO optcfg.price_bar (symbol, bar_date, [close]) VALUES ${values}`);
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

/**
 * Prior VADER puts on the same underlying, newest first.
 *
 * Deliberately NOT filtered by expiration: a signal from last week that has not
 * expired yet is exactly the context a reader wants, and `resolveOutcome` labels it
 * `open` rather than pretending it resolved.
 *
 * The contract being viewed is excluded by strike and expiration rather than by
 * contract key, because `Trade` carries no key — and rebuilding the COALESCE
 * fallback here would only match the rows whose real key is missing.
 *
 * One row per contract: the same put is signalled on several mornings, and five
 * rows of the same strike would be a list of nothing.
 */
const PAST_SIGNALS_QUERY = `
SELECT TOP (@limit) report_date, strike, expiration, annualized_yield
FROM (
    SELECT
        s.report_date,
        s.strike,
        s.expiration,
        s.annualized_yield,
        ROW_NUMBER() OVER (
            PARTITION BY s.strike, s.expiration
            ORDER BY s.report_date DESC
        ) AS rn
    FROM opt.telegram_signal s
    WHERE s.is_current = 1
      AND s.parse_status = 'parsed'
      AND s.option_right = 'P'
      AND s.symbol = @symbol
      AND NOT (
            @excludeStrike IS NOT NULL
        AND @excludeExpiration IS NOT NULL
        AND s.strike = @excludeStrike
        AND s.expiration = CAST(@excludeExpiration AS DATE)
      )
) d
WHERE rn = 1
ORDER BY report_date DESC
`;

export type PastSignalSeed = Omit<PastSignal, 'outcome' | 'closeAtExpiration'>;

export interface PastSignalExclusion {
    strike: number | null;
    expiration: IsoDate | null;
}

export async function pastSignalsFor(
    db: DbConfig,
    symbol: string,
    exclude: PastSignalExclusion,
    limit: number,
): Promise<PastSignalSeed[]> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .input('excludeStrike', sql.Decimal(18, 4), exclude.strike)
        .input('excludeExpiration', sql.VarChar(10), exclude.expiration)
        .input('limit', sql.Int, limit)
        .query<Record<string, unknown>>(PAST_SIGNALS_QUERY);

    return result.recordset.map((row) => ({
        reportDate: sqlDateToIso(row.report_date) as IsoDate,
        strike: toNumber(row.strike),
        expiration: sqlDateToIso(row.expiration),
        annualizedYield: toNumber(row.annualized_yield),
    }));
}
