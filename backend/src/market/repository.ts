import sql from 'mssql';
import type { IsoDate, Moneyness, PastSignal, SignalOutcome, SymbolBar } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { sqlDateToIso } from '../signals/shape';
import type { SymbolQuote } from './yahoo';

/**
 * The cache side of the market data, in `optcfg` — the only schema this app may
 * write. `weboptions_ro` holds no UPDATE (see migration 009), so a refresh deletes
 * the symbol's rows and reinserts them inside one transaction.
 *
 * `pastSignalsFor` and `outcomeFor` read `opt`, which is strictly read-only and
 * owned by the webportfolio repo.
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
            // The profile cache keeps a price but no prior close: it is refreshed on a
            // 12h TTL, so a day-over-day move read from it could be a day stale.
            previousClose: null,
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
 * Other VADER puts on the same underlying, newest first.
 *
 * Deliberately NOT filtered by expiration: a signal from last week that has not
 * expired yet is exactly the context a reader wants, and `resolveOutcome` labels it
 * `open` rather than pretending it resolved.
 *
 * The signal being viewed is excluded by strike, expiration and report date rather
 * than by contract key, because `Trade` carries no key — and rebuilding the COALESCE
 * fallback here would only match the rows whose real key is missing. Without the
 * report date the exclusion would take every morning of that contract with it.
 *
 * One row per MORNING, not per contract. The same put is recommended on several
 * mornings at a different yield each time, and each of those is a recommendation the
 * reader made a decision about. Collapsing them hid whole weeks of the list. The
 * dedup that remains is only within a single morning, where one contract can appear
 * under two tiers at once; it keeps the classified row over an unclassified one, the
 * same rule the week grid uses.
 *
 * `@otherLimit` caps only the signals NOT held. A position the reader actually took
 * is never trimmed, however old it is, because dropping one would read as though it
 * was never taken. `recentSignalCountFor` is what says how many were left out.
 */
const PAST_SIGNALS_QUERY = `
SELECT
    report_date, strike, expiration, annualized_yield, tier, is_top_pick,
    owned_live_contracts, owned_paper_contracts
FROM (
    SELECT
        d.*,
        ROW_NUMBER() OVER (
            PARTITION BY d.is_owned
            ORDER BY d.report_date DESC, d.strike DESC
        ) AS rank_in_group
    FROM (
        SELECT
            s.report_date,
            s.strike,
            s.expiration,
            s.annualized_yield,
            COALESCE(s.tier, s.profile) AS tier,
            MAX(CAST(s.is_top_pick AS INT)) OVER (
                PARTITION BY s.report_date, s.strike, s.expiration
            ) AS is_top_pick,
            own.owned_live_contracts,
            own.owned_paper_contracts,
            CASE
                WHEN own.owned_live_contracts > 0 OR own.owned_paper_contracts > 0 THEN 1
                ELSE 0
            END AS is_owned,
            ROW_NUMBER() OVER (
                PARTITION BY s.report_date, s.strike, s.expiration
                ORDER BY CASE WHEN COALESCE(s.tier, s.profile) IS NULL THEN 1 ELSE 0 END,
                         s.annualized_yield DESC
            ) AS rn
        FROM opt.telegram_signal s
        OUTER APPLY (
            SELECT
                COALESCE(SUM(CASE WHEN ot.is_paper = 0 THEN ot.contracts ELSE 0 END), 0) AS owned_live_contracts,
                COALESCE(SUM(CASE WHEN ot.is_paper = 1 THEN ot.contracts ELSE 0 END), 0) AS owned_paper_contracts
            FROM dbo.option_transactions ot
            WHERE ot.symbol = s.symbol
              AND ot.strike_price = s.strike
              AND ot.expiration_date = s.expiration
              AND ot.status = 'open'
              AND ot.action = 'sell_to_open'
              -- The position has to have been opened on the morning the signal was given.
              -- Without this a later signal on the same contract wears an earlier
              -- morning's badge, which reads as though it was the trade that was taken.
              AND CAST(ot.transaction_date AS DATE) = s.report_date
        ) own
        WHERE s.is_current = 1
          AND s.parse_status = 'parsed'
          AND s.option_right = 'P'
          AND s.symbol = @symbol
          AND NOT (
                @excludeStrike IS NOT NULL
            AND @excludeExpiration IS NOT NULL
            AND s.strike = @excludeStrike
            AND s.expiration = CAST(@excludeExpiration AS DATE)
            AND (@excludeReportDate IS NULL OR s.report_date = CAST(@excludeReportDate AS DATE))
          )
    ) d
    WHERE d.rn = 1
) g
WHERE g.is_owned = 1 OR g.rank_in_group <= @otherLimit
ORDER BY g.is_owned DESC, g.report_date DESC, g.strike DESC
`;

export type PastSignalSeed = Omit<PastSignal, 'outcome' | 'closeAtExpiration'>;

export interface PastSignalExclusion {
    strike: number | null;
    expiration: IsoDate | null;
    /** Null drops every morning of the contract, which is the pre-report-date behaviour. */
    reportDate: IsoDate | null;
}

export async function pastSignalsFor(
    db: DbConfig,
    symbol: string,
    exclude: PastSignalExclusion,
    otherLimit: number,
): Promise<PastSignalSeed[]> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .input('excludeStrike', sql.Decimal(18, 4), exclude.strike)
        .input('excludeExpiration', sql.VarChar(10), exclude.expiration)
        .input('excludeReportDate', sql.VarChar(10), exclude.reportDate)
        .input('otherLimit', sql.Int, otherLimit)
        .query<Record<string, unknown>>(PAST_SIGNALS_QUERY);

    return result.recordset.map((row) => ({
        reportDate: sqlDateToIso(row.report_date) as IsoDate,
        strike: toNumber(row.strike),
        expiration: sqlDateToIso(row.expiration),
        annualizedYield: toNumber(row.annualized_yield),
        tier: (row.tier as string | null) ?? null,
        isTopPick: Boolean(toNumber(row.is_top_pick)),
        ownedLiveContracts: Math.trunc(toNumber(row.owned_live_contracts) ?? 0),
        ownedPaperContracts: Math.trunc(toNumber(row.owned_paper_contracts) ?? 0),
    }));
}

/**
 * The signals this underlying had recently, at the same one-per-morning grain as the
 * list so the two agree. Rows rather than a count, because whether each one is in the
 * money needs prices, and `resolveOutcome` already knows how to decide that.
 *
 * A trading day here is a day VADER reported on, taken from the signals themselves.
 * That needs no market calendar to maintain and cannot be wrong about a holiday. It
 * does mean a day the job failed does not count, which is the honest answer: there
 * is no data for it either way.
 *
 * Includes the signal being viewed. This is the total the trimmed list is a window onto.
 */
const RECENT_SIGNALS_QUERY = `
DECLARE @cutoff DATE = (
    SELECT MIN(report_date)
    FROM (
        SELECT DISTINCT TOP (@tradingDays) report_date
        FROM opt.telegram_signal
        WHERE is_current = 1 AND parse_status = 'parsed'
        ORDER BY report_date DESC
    ) recent
);

SELECT DISTINCT s.report_date, s.strike, s.expiration
FROM opt.telegram_signal s
WHERE s.is_current = 1
  AND s.parse_status = 'parsed'
  AND s.option_right = 'P'
  AND s.symbol = @symbol
  AND s.report_date >= @cutoff
`;

export interface RecentSignalRow {
    strike: number | null;
    expiration: IsoDate | null;
}

export async function recentSignalsFor(
    db: DbConfig,
    symbol: string,
    tradingDays: number,
): Promise<RecentSignalRow[]> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .input('tradingDays', sql.Int, tradingDays)
        .query<Record<string, unknown>>(RECENT_SIGNALS_QUERY);

    return result.recordset.map((row) => ({
        strike: toNumber(row.strike),
        expiration: sqlDateToIso(row.expiration),
    }));
}

const OWNED_CONTRACTS_QUERY = `
SELECT COALESCE(SUM(contracts), 0) AS owned_contracts
FROM dbo.option_transactions
WHERE symbol = @symbol
  AND strike_price = @strike
  AND expiration_date = CAST(@expiration AS DATE)
  AND status = 'open'
    AND action = 'sell_to_open'
    AND (@reportDate IS NULL OR CAST(transaction_date AS DATE) = CAST(@reportDate AS DATE))
`;

/** Returns the open quantity for one contract, or zero when it is not owned. */
export async function ownedContractsFor(
    db: DbConfig,
    symbol: string,
    lookup: { strike: number; expiration: IsoDate; reportDate?: IsoDate | null },
): Promise<number> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .input('strike', sql.Decimal(18, 4), lookup.strike)
        .input('expiration', sql.VarChar(10), lookup.expiration)
        .input('reportDate', sql.VarChar(10), lookup.reportDate ?? null)
        .query<Record<string, unknown>>(OWNED_CONTRACTS_QUERY);

    return toNumber(result.recordset[0]?.owned_contracts) ?? 0;
}

/**
 * The nightly end-of-day rollup for ONE signal.
 *
 * Identified by the four columns the rollup denormalizes rather than by its
 * `signal_key`, because a `Trade` carries no key. Those four are the grain of the
 * table for a put, so TOP 1 is a formality — and if the same put were ever rolled up
 * twice, the newest computation is the one to believe.
 */
const OUTCOME_QUERY = `
SELECT TOP 1
    report_date, executed_premium, current_mark, as_of_date, days_held,
    pnl_dollar, pnl_pct_of_premium, max_profit_capture_pct, max_profit_date,
    eod_mfe, eod_mae, days_to_50pct, is_final, moneyness_at_expiration
FROM opt.telegram_signal_outcome
WHERE symbol = @symbol
  AND option_right = 'P'
  AND strike = @strike
  AND expiration = CAST(@expiration AS DATE)
  AND report_date = CAST(@reportDate AS DATE)
ORDER BY computed_date DESC
`;

export interface OutcomeLookup {
    strike: number;
    expiration: IsoDate;
    reportDate: IsoDate;
}

const MONEYNESS: Record<string, Moneyness> = { ITM: 'itm', OTM: 'otm', ATM: 'atm' };

export async function outcomeFor(db: DbConfig, symbol: string, lookup: OutcomeLookup): Promise<SignalOutcome | null> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('symbol', sql.VarChar(20), symbol)
        .input('strike', sql.Decimal(18, 4), lookup.strike)
        .input('expiration', sql.VarChar(10), lookup.expiration)
        .input('reportDate', sql.VarChar(10), lookup.reportDate)
        .query<Record<string, unknown>>(OUTCOME_QUERY);

    const row = result.recordset[0];
    if (!row) return null;

    const entryPremium = toNumber(row.executed_premium);
    const worstProfit = toNumber(row.eod_mae);

    return {
        reportDate: sqlDateToIso(row.report_date) as IsoDate,
        entryPremium,
        mark: toNumber(row.current_mark),
        asOf: sqlDateToIso(row.as_of_date),
        daysHeld: toNumber(row.days_held),
        profit: toNumber(row.pnl_dollar),
        premiumKept: toNumber(row.pnl_pct_of_premium),
        bestPremiumKept: toNumber(row.max_profit_capture_pct),
        bestProfit: toNumber(row.eod_mfe),
        bestOn: sqlDateToIso(row.max_profit_date),
        // The rollup's own recipe for the fractions it does store: dollars over the
        // premium in the same dollars, which is 100 shares' worth of a per-share mark.
        worstPremiumKept: worstProfit === null || !entryPremium ? null : worstProfit / (entryPremium * 100),
        worstProfit,
        daysToHalf: toNumber(row.days_to_50pct),
        settled: row.is_final === true || row.is_final === 1,
        moneynessAtExpiration: MONEYNESS[String(row.moneyness_at_expiration ?? '')] ?? null,
    };
}
