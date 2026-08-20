import type { VixQuote } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';
import { sqlDateToIso } from '../signals/shape';

/**
 * The VIX, read out of webportfolio's daily price table. That app's price-updater
 * Function writes one row per symbol per session just after midnight, so the newest
 * row is the last close.
 *
 * `dbo.stock_price` is the third and last thing this login may read; migration 012
 * grants it by object, and says why.
 */

const VIX_QUERY = `
SELECT TOP 2 current_price, system_date
FROM dbo.stock_price
WHERE symbol = 'VIX' AND current_price IS NOT NULL
ORDER BY system_date DESC
`;

interface VixRow {
    current_price: unknown;
    system_date: unknown;
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export async function readVix(db: DbConfig): Promise<VixQuote | null> {
    const pool = await getPool(db);
    const result = await pool.request().query<VixRow>(VIX_QUERY);
    const row = result.recordset[0];
    if (!row) return null;

    const value = toNumber(row.current_price);
    const asOf = sqlDateToIso(row.system_date);
    // A row without a usable figure or date describes nothing, so it is no row.
    if (value === null || asOf === null) return null;

    // A day change wants the day before, so a second row from the same date is no
    // help — the job ran twice rather than the market having closed twice.
    const prior = result.recordset[1];
    const priorDate = prior ? sqlDateToIso(prior.system_date) : null;
    const previousValue = prior && priorDate !== null && priorDate !== asOf ? toNumber(prior.current_price) : null;

    return { value, asOf, previousValue };
}
