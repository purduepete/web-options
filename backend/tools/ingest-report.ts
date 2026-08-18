import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import type { WeeklyReport } from '@weboptions/shared';
import { normalizePayload, type ReportPayload } from '../src/reports/payload';
import { connectAsOperator, describeTarget, loadOperatorConfig } from './operator';

/**
 * Writes a weekly-report sidecar into opt.report_*. Operator tooling: the
 * service login is denied every write, so this can only ever run from the
 * laptop.
 *
 *   npx tsx backend/tools/ingest-report.ts <file.json|dir> [--force] --confirm
 *
 * Re-ingest is a cascading delete plus a reinsert inside one transaction, same
 * shape as ingest-calendar.ts: a week here is one row plus a handful of
 * callouts, not the calendar's five days of trades.
 */

function hashOf(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

async function existingHash(pool: sql.ConnectionPool, publishDate: string): Promise<string | null> {
    const result = await pool
        .request()
        .input('publishDate', sql.VarChar(10), publishDate)
        .query<{ source_hash: string }>('SELECT source_hash FROM opt.report_week WHERE publish_date = CAST(@publishDate AS DATE)');
    return result.recordset[0]?.source_hash ?? null;
}

async function writeWeek(pool: sql.ConnectionPool, week: WeeklyReport, sourceHash: string): Promise<void> {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        // The FK cascade takes the callouts with it.
        await new sql.Request(transaction)
            .input('publishDate', sql.VarChar(10), week.publishDate)
            .query('DELETE FROM opt.report_week WHERE publish_date = CAST(@publishDate AS DATE)');

        const m = week.metrics;
        const inserted = await new sql.Request(transaction)
            .input('publishDate', sql.VarChar(10), week.publishDate)
            .input('title', sql.NVarChar(200), week.title)
            .input('sourceUrl', sql.NVarChar(500), week.sourceUrl)
            .input('macro', sql.NVarChar(sql.MAX), week.macro.length > 0 ? JSON.stringify(week.macro) : null)
            .input('netPnl', sql.Decimal(18, 2), m.netPnl)
            .input('closedLegs', sql.Int, m.closedLegs)
            .input('winningLegs', sql.Int, m.winningLegs)
            .input('rollLegs', sql.Int, m.rollLegs)
            .input('hitRate', sql.Decimal(9, 4), m.hitRate)
            .input('winnersAmount', sql.Decimal(18, 2), m.winnersAmount)
            .input('rollCost', sql.Decimal(18, 2), m.rollCost)
            .input('collateral', sql.Decimal(18, 2), m.collateral)
            .input('returnPct', sql.Decimal(9, 4), m.returnPct)
            .input('newPositions', sql.Int, m.newPositions)
            .input('newPremium', sql.Decimal(18, 2), m.newPremium)
            .input('netCash', sql.Decimal(18, 2), m.netCash)
            .input('medianDaysHeld', sql.Int, m.medianDaysHeld)
            .input('openPositionsTotal', sql.Int, m.openPositionsTotal)
            .input('openCalls', sql.Int, m.openCalls)
            .input('openPuts', sql.Int, m.openPuts)
            .input('openGreen', sql.Int, m.openGreen)
            .input('openYellow', sql.Int, m.openYellow)
            .input('openRed', sql.Int, m.openRed)
            .input('sourceHash', sql.Char(64), sourceHash)
            .query<{ id: number }>(
                `INSERT INTO opt.report_week
                     (publish_date, title, source_url, macro, net_pnl, closed_legs, winning_legs, roll_legs,
                      hit_rate, winners_amount, roll_cost, collateral, return_pct, new_positions, new_premium,
                      net_cash, median_days_held, open_positions_total, open_calls, open_puts,
                      open_green, open_yellow, open_red, source_hash)
                 OUTPUT INSERTED.id
                 VALUES (CAST(@publishDate AS DATE), @title, @sourceUrl, @macro, @netPnl, @closedLegs, @winningLegs,
                         @rollLegs, @hitRate, @winnersAmount, @rollCost, @collateral, @returnPct, @newPositions,
                         @newPremium, @netCash, @medianDaysHeld, @openPositionsTotal, @openCalls, @openPuts,
                         @openGreen, @openYellow, @openRed, @sourceHash)`,
            );

        const weekId = inserted.recordset[0]!.id;

        for (const [index, callout] of week.callouts.entries()) {
            await new sql.Request(transaction)
                .input('weekId', sql.Int, weekId)
                .input('ticker', sql.VarChar(16), callout.ticker)
                .input('kind', sql.VarChar(20), callout.kind)
                .input('headline', sql.NVarChar(300), callout.headline)
                .input('body', sql.NVarChar(sql.MAX), callout.body)
                .input('sortOrder', sql.Int, index)
                .query(
                    `INSERT INTO opt.report_callout (report_week_id, ticker, kind, headline, body, sort_order)
                     VALUES (@weekId, @ticker, @kind, @headline, @body, @sortOrder)`,
                );
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
        console.log('usage: ingest-report.ts <file.json|dir> [--force] --confirm');
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
            const week = normalizePayload(JSON.parse(source) as ReportPayload);
            const sourceHash = hashOf(source);

            const current = await existingHash(pool, week.publishDate);
            const unchanged = current === sourceHash;

            console.log(
                `${week.publishDate}  net ${week.metrics.netPnl ?? 'n/a'}  callouts ${week.callouts.length}  ` +
                    `${current === null ? 'new' : unchanged ? 'unchanged' : 'changed'}`,
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
