import sql from 'mssql';
import { GRADE_SETTING_KEYS, type GradeSettings, parseGradeSettings } from '@weboptions/shared';
import type { DbConfig } from '../config';
import { getPool } from '../db';

/**
 * `optcfg.app_setting` is a GENERIC key/value table, so every statement here names
 * the keys it touches. An unqualified `DELETE FROM optcfg.app_setting` would wipe
 * whatever the next feature stores there, and the delete-then-insert save pattern
 * makes that mistake easy to reach for. There is no UPDATE grant, so the pattern
 * itself is not optional.
 */

const NAME_PARAMS = GRADE_SETTING_KEYS.map((_, index) => `@n${index}`).join(', ');

function bindNames(request: sql.Request): sql.Request {
    GRADE_SETTING_KEYS.forEach((key, index) => request.input(`n${index}`, sql.VarChar(64), key));
    return request;
}

export async function readGradeSettings(db: DbConfig): Promise<GradeSettings> {
    const pool = await getPool(db);
    const result = await bindNames(pool.request()).query<{ name: string; value: string }>(
        `SELECT name, value FROM optcfg.app_setting WHERE name IN (${NAME_PARAMS})`,
    );

    const stored: Record<string, string> = {};
    for (const row of result.recordset) stored[row.name] = row.value;
    // Missing rows fall through to the defaults, so a fresh database grades sensibly.
    return parseGradeSettings(stored);
}

export async function replaceGradeSettings(db: DbConfig, settings: GradeSettings): Promise<GradeSettings> {
    const pool = await getPool(db);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        await bindNames(new sql.Request(transaction)).query(
            `DELETE FROM optcfg.app_setting WHERE name IN (${NAME_PARAMS})`,
        );

        const request = new sql.Request(transaction);
        GRADE_SETTING_KEYS.forEach((key, index) => {
            request.input(`k${index}`, sql.VarChar(64), key);
            request.input(`v${index}`, sql.VarChar(64), String(settings[key]));
        });
        const values = GRADE_SETTING_KEYS.map((_, index) => `(@k${index}, @v${index})`).join(', ');
        await request.query(`INSERT INTO optcfg.app_setting (name, value) VALUES ${values}`);

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
    return settings;
}
