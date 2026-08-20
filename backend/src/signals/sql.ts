/**
 * Ported verbatim from the retired Flask server, with pyodbc positional `?`
 * rebound to named parameters. Semantics must not drift: partition by
 * (report_date, contract_key), prefer the tier-bucketed row over a
 * Top-Picks-only row, OR is_top_pick across duplicates, puts only. The parity
 * gate in test/parity.test.ts is what proves it has not drifted.
 *
 * The week bounds bind as VARCHAR(10) and are CAST to DATE inside T-SQL on purpose.
 * Binding a JS Date lets the driver's UTC conversion decide which calendar day the
 * query means; a string cannot drift.
 *
 * The entry-quote join is additive: opt.telegram_entry_quote is UNIQUE on
 * (contract_key, report_date), so it can never multiply a row or disturb the dedup
 * above. It joins the RAW s.contract_key, never the COALESCE fallback, because quote
 * rows only ever exist for real hashes.
 *
 * The end-of-day APPLY is additive for the same reason: TOP 1 cannot multiply a row.
 * It must stay inside this CTE and correlate on the RAW s.contract_key — correlating
 * on the COALESCE dedup key would change row identity and break the parity gate.
 *
 * The outcome APPLY is additive on the same terms. It correlates on the four columns
 * the nightly rollup denormalizes rather than on a key, because those are the grain
 * of that table for a put — the same identification the drill-in's own lookup uses.
 */

export const SIGNAL_QUERY = `
WITH base AS (
    SELECT
        s.report_date,
        s.symbol,
        s.sector,
        s.option_right,
        s.strike,
        s.expiration,
        s.dte,
        s.delta,
        s.annualized_yield,
        s.premium,
        s.collateral,
        s.collateral_bucket,
        COALESCE(s.tier, s.profile) AS tier,
        q.delta AS actual_delta,
        q.mark AS actual_mark,
        q.is_illiquid_quote AS actual_illiquid,
        q.implied_volatility AS actual_iv,
        q.underlying_price AS actual_underlying,
        c.price_date AS close_date,
        c.underlying_price AS close_underlying,
        o.max_profit_capture_pct AS best_premium_kept,
        own.owned_live_contracts,
        own.owned_paper_contracts,
        COALESCE(s.contract_key,
            CONCAT(s.symbol, '|', s.strike, '|', s.expiration)) AS contract_key,
        MAX(CAST(s.is_top_pick AS INT)) OVER (
            PARTITION BY s.report_date,
                COALESCE(s.contract_key,
                    CONCAT(s.symbol, '|', s.strike, '|', s.expiration))
        ) AS is_top_pick,
        ROW_NUMBER() OVER (
            PARTITION BY s.report_date,
                COALESCE(s.contract_key,
                    CONCAT(s.symbol, '|', s.strike, '|', s.expiration))
            ORDER BY CASE WHEN s.tier IS NULL THEN 1 ELSE 0 END,
                     s.annualized_yield DESC
        ) AS rn
    FROM opt.telegram_signal s
    LEFT JOIN opt.telegram_entry_quote q
           ON q.contract_key = s.contract_key
          AND q.report_date = s.report_date
    OUTER APPLY (
        SELECT TOP 1 p.price_date, p.underlying_price
        FROM opt.telegram_contract_price p
        WHERE p.contract_key = s.contract_key
          AND p.underlying_price IS NOT NULL
          AND p.market_session = 'regular_close'
          AND p.price_date >= s.report_date
          AND (s.expiration IS NULL OR p.price_date <= s.expiration)
        ORDER BY p.price_date DESC, p.captured_at_utc DESC
    ) c
    OUTER APPLY (
        SELECT TOP 1 so.max_profit_capture_pct
        FROM opt.telegram_signal_outcome so
        WHERE so.symbol = s.symbol
          AND so.option_right = s.option_right
          AND so.strike = s.strike
          AND so.expiration = s.expiration
          AND so.report_date = s.report_date
        ORDER BY so.computed_date DESC
    ) o
    -- Only link a transaction entered on the signal's recommendation date.
    OUTER APPLY (
        SELECT
            COALESCE(SUM(CASE WHEN ot.is_paper = 0 THEN ot.contracts ELSE 0 END), 0) AS owned_live_contracts,
            COALESCE(SUM(CASE WHEN ot.is_paper = 1 THEN ot.contracts ELSE 0 END), 0) AS owned_paper_contracts
        FROM dbo.option_transactions ot
        WHERE ot.symbol = s.symbol
          AND ot.strike_price = s.strike
          AND ot.expiration_date = s.expiration
          AND CAST(ot.transaction_date AS DATE) = s.report_date
          AND ot.status = 'open'
          AND ot.action = 'sell_to_open'
    ) own
    WHERE s.is_current = 1 AND s.parse_status = 'parsed' AND s.option_right = 'P'
      AND s.report_date BETWEEN CAST(@weekStart AS DATE) AND CAST(@weekEnd AS DATE)
)
SELECT
    report_date, symbol, sector, option_right, strike, expiration, dte, delta,
    annualized_yield, premium, collateral, collateral_bucket, tier, is_top_pick,
    actual_delta, actual_mark, actual_illiquid, actual_iv, actual_underlying,
    close_date, close_underlying, best_premium_kept,
    owned_live_contracts, owned_paper_contracts
FROM base
WHERE rn = 1
ORDER BY report_date, tier, option_right, annualized_yield DESC
`;

export const EXISTS_QUERY = `
SELECT TOP 1 1 AS found
FROM opt.telegram_signal
WHERE is_current = 1 AND parse_status = 'parsed' AND option_right = 'P'
  AND report_date BETWEEN CAST(@weekStart AS DATE) AND CAST(@weekEnd AS DATE)
`;

export const EARLIEST_DATE_QUERY = `
SELECT MIN(report_date) AS earliest
FROM opt.telegram_signal
WHERE is_current = 1 AND parse_status = 'parsed' AND option_right = 'P'
`;

/**
 * Every date that has signals at all, which is what the summary's month index is
 * built from. Deliberately the DISTINCT dates rather than a rollup: the grouping
 * into weeks and months is week math, and week math lives in weeks.ts.
 */
export const SIGNAL_DATES_QUERY = `
SELECT DISTINCT report_date
FROM opt.telegram_signal
WHERE is_current = 1 AND parse_status = 'parsed' AND option_right = 'P'
ORDER BY report_date
`;
