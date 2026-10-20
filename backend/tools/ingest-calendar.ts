import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import type { CalendarWeek } from '@weboptions/shared';
import { normalizePayload, type CalendarPayload } from '../src/calendars/payload';
import { connectAsOperator, describeTarget, loadOperatorConfig } from './operator';

/**
 * Writes a calendar sidecar into opt.calendar_*. Operator tooling: the service
 * login is denied every write, so this can only ever run from the laptop.
 *
 *   npx tsx backend/tools/ingest-calendar.ts <file.json|dir> [--force] --confirm
 *
 * Re-ingest is a cascading delete plus a reinsert inside one transaction. No MERGE,
 * no soft-delete graph: a week is five days and about thirty trades.
 */

function hashOf(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

async function existingHash(pool: sql.ConnectionPool, publishDate: string): Promise<string | null> {
    const result = await pool.request().input('publishDate', sql.VarChar(10), publishDate).query<{
        source_hash: string;
    }>('SELECT source_hash FROM opt.calendar_week WHERE publish_date = CAST(@publishDate AS DATE)');
    return result.recordset[0]?.source_hash ?? null;
}

async function writeWeek(pool: sql.ConnectionPool, week: CalendarWeek, sourceHash: string): Promise<void> {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        // The FK cascade takes the days and their trades with it.
        await new sql.Request(transaction)
            .input('publishDate', sql.VarChar(10), week.publishDate)
            .query('DELETE FROM opt.calendar_week WHERE publish_date = CAST(@publishDate AS DATE)');

        const inserted = await new sql.Request(transaction)
            .input('publishDate', sql.VarChar(10), week.publishDate)
            .input('weekStart', sql.VarChar(10), week.weekStart)
            .input('weekEnd', sql.VarChar(10), week.weekEnd)
            .input('title', sql.NVarChar(200), week.title)
            .input('macro', sql.NVarChar(sql.MAX), week.macro ? JSON.stringify(week.macro) : null)
            .input('sourceHash', sql.Char(64), sourceHash)
            .query<{ id: number }>(
                `INSERT INTO opt.calendar_week (publish_date, week_start, week_end, title, macro, source_hash)
                 OUTPUT INSERTED.id
                 VALUES (CAST(@publishDate AS DATE), CAST(@weekStart AS DATE), CAST(@weekEnd AS DATE),
                         @title, @macro, @sourceHash)`
            );

        const weekId = inserted.recordset[0]!.id;

        for (const [dayIndex, day] of week.days.entries()) {
            const dayRow = await new sql.Request(transaction)
                .input('weekId', sql.Int, weekId)
                .input('dayName', sql.NVarChar(20), day.name)
                .input('dayDate', sql.VarChar(10), day.date)
                .input('rule', sql.NVarChar(sql.MAX), day.rule)
                .input('event', sql.NVarChar(sql.MAX), day.event)
                .input('sortOrder', sql.Int, dayIndex)
                .query<{ id: number }>(
                    `INSERT INTO opt.calendar_day (week_id, day_name, day_date, [rule], [event], sort_order)
                     OUTPUT INSERTED.id
                     VALUES (@weekId, @dayName, CAST(@dayDate AS DATE), @rule, @event, @sortOrder)`
                );

            const dayId = dayRow.recordset[0]!.id;

            for (const [tradeIndex, trade] of day.trades.entries()) {
                await new sql.Request(transaction)
                    .input('dayId', sql.Int, dayId)
                    .input('ticker', sql.VarChar(16), trade.ticker)
                    .input('optionRight', sql.Char(1), trade.optionRight)
                    .input('strike', sql.Decimal(18, 4), trade.strike)
                    .input('expiry', sql.VarChar(10), trade.expiry)
                    .input('dte', sql.Int, trade.dte)
                    .input('delta', sql.Decimal(9, 4), trade.delta)
                    .input('annYield', sql.Decimal(9, 4), trade.annualizedYield)
                    .input('premium', sql.Decimal(18, 2), trade.premium)
                    .input('collateral', sql.Decimal(18, 2), trade.collateral)
                    .input('risk', sql.VarChar(20), trade.risk)
                    .input('note', sql.NVarChar(sql.MAX), trade.note)
                    .input('sortOrder', sql.Int, tradeIndex)
                    .query(
                        `INSERT INTO opt.calendar_trade
                             (day_id, ticker, option_right, strike, expiry, dte, delta, ann_yield,
                              premium, collateral, risk, note, sort_order)
                         VALUES (@dayId, @ticker, @optionRight, @strike, CAST(@expiry AS DATE), @dte,
                                 @delta, @annYield, @premium, @collateral, @risk, @note, @sortOrder)`
                    );
            }
        }

        await transaction.commit();
    } catch (error) {
        // A transaction the server already killed throws again here, which would
        // replace the real failure with a useless one.
        try {
            await transaction.rollback();
        } catch {
            // ignored on purpose
        }
        throw error;
    }
}

function jsonFilesFrom(target: string): string[] {
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    return fs
        .readdirSync(target)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .map((name) => path.join(target, name))
        .sort();
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const target = argv[0];
    if (!target) {
        console.log('usage: ingest-calendar.ts <file.json|dir> [--force] --confirm');
        process.exitCode = 1;
        return;
    }

    const confirmed = argv.includes('--confirm');
    const force = argv.includes('--force');

    const config = loadOperatorConfig();
    console.log(`target ${describeTarget(config)}\n`);

    const pool = await connectAsOperator(config);
    try {
        for (const file of jsonFilesFrom(target)) {
            const source = fs.readFileSync(file, 'utf-8');
            const week = normalizePayload(JSON.parse(source) as CalendarPayload);
            const sourceHash = hashOf(source);
            const trades = week.days.reduce((sum, day) => sum + day.trades.length, 0);

            const current = await existingHash(pool, week.publishDate);
            const unchanged = current === sourceHash;

            console.log(
                `${week.publishDate}  ${week.weekStart}..${week.weekEnd}  ` +
                    `days ${week.days.length}  trades ${trades}  ` +
                    `${current === null ? 'new' : unchanged ? 'unchanged' : 'changed'}`
            );

            if (unchanged && !force) {
                console.log('  skipped (source hash matches; --force to reingest)');
                continue;
            }
            if (!confirmed) {
                console.log('  dry run, nothing written');
                continue;
            }

            await writeWeek(pool, week, sourceHash);
            console.log('  written');
        }

        if (!confirmed) {
            console.log('\nDry run. Re-run with --confirm to write.');
        }
    } finally {
        await pool.close();
    }
}

main().catch((error: Error) => {
    console.error(`failed: ${error.message}`);
    process.exitCode = 1;
});
