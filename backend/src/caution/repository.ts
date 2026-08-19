import sql from 'mssql';
import type { DbConfig } from '../config';
import { getPool } from '../db';

/**
 * The only writable table in the database, and the only place this project writes.
 * See database/migrations/009 for the permissions that make that true rather than
 * merely intended.
 */

const LIST_QUERY = 'SELECT symbol FROM optcfg.caution_symbol ORDER BY symbol';

export async function listCautionSymbols(db: DbConfig): Promise<string[]> {
    const pool = await getPool(db);
    const result = await pool.request().query<{ symbol: string }>(LIST_QUERY);
    return result.recordset.map((row) => row.symbol);
}

/**
 * Replaces the whole set. A save is the reader handing over the list they can see,
 * so reconciling it row by row would only invent a way for the two to disagree.
 * The delete and the insert share a transaction, so a failure halfway through
 * cannot leave the list empty.
 */
export async function replaceCautionSymbols(db: DbConfig, symbols: readonly string[]): Promise<string[]> {
    const pool = await getPool(db);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        await new sql.Request(transaction).query('DELETE FROM optcfg.caution_symbol');
        if (symbols.length > 0) {
            const request = new sql.Request(transaction);
            symbols.forEach((symbol, index) => request.input(`s${index}`, sql.VarChar(20), symbol));
            const values = symbols.map((_, index) => `(@s${index})`).join(', ');
            await request.query(`INSERT INTO optcfg.caution_symbol (symbol) VALUES ${values}`);
        }
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
    return [...symbols].sort();
}
