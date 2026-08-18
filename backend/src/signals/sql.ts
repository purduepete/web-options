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
    WHERE s.is_current = 1 AND s.parse_status = 'parsed' AND s.option_right = 'P'
      AND s.report_date BETWEEN CAST(@weekStart AS DATE) AND CAST(@weekEnd AS DATE)
)
SELECT
    report_date, symbol, sector, option_right, strike, expiration, dte, delta,
    annualized_yield, premium, collateral, collateral_bucket, tier, is_top_pick
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
