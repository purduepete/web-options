import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import JSON5 from 'json5';
import type { CalendarPayload } from '../src/calendars/payload';

/**
 * Backfill only. Recovers the structured data from the three calendars that were
 * generated before the sidecar JSON existed. The server never imports this, and
 * there is no runtime HTML fallback anywhere.
 *
 *   npx tsx backend/tools/extract-calendar.ts <file.html|dir> [--out <dir>]
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Scans for the matching bracket instead of searching for `];`, because a `]`
 * inside one of the note strings would truncate the array.
 */
export function extractDaysLiteral(html: string): string {
    const marker = /var\s+days\s*=\s*\[/.exec(html);
    if (!marker) throw new Error('No `var days = [` literal found');

    const start = marker.index + marker[0].length - 1;
    let depth = 0;
    let quote: string | null = null;

    for (let i = start; i < html.length; i += 1) {
        const char = html[i]!;
        if (quote) {
            if (char === '\\') i += 1;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
        } else if (char === '[') {
            depth += 1;
        } else if (char === ']') {
            depth -= 1;
            if (depth === 0) return html.slice(start, i + 1);
        }
    }
    throw new Error('Unterminated `var days` array');
}

export function parsePublishedHeading(heading: string): string {
    const match = /published\s+([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(heading);
    if (!match) throw new Error(`Could not read a publish date from "${heading}"`);
    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
    if (month === -1) throw new Error(`Unknown month in "${heading}"`);
    return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
}

export function extractPayload(html: string): CalendarPayload {
    const $ = cheerio.load(html);

    const heading = $('.macro-banner h1').first().text().trim();
    const publishDate = parsePublishedHeading(heading);

    const macro = $('.macro-banner .macro-item')
        .map((_, element) => ({
            label: $(element).find('b').first().text().trim(),
            text: $(element).find('span').first().text().trim(),
        }))
        .get()
        .filter((item) => item.label || item.text);

    const days = JSON5.parse(extractDaysLiteral(html)) as CalendarPayload['days'];

    return { publishDate, title: null, macro, days };
}

function htmlFilesFrom(target: string): string[] {
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    return fs
        .readdirSync(target)
        .filter((name) => name.toLowerCase().endsWith('.html'))
        .map((name) => path.join(target, name));
}

function main(): void {
    const argv = process.argv.slice(2);
    const target = argv[0];
    if (!target) {
        console.log('usage: extract-calendar.ts <file.html|dir> [--out <dir>]');
        process.exitCode = 1;
        return;
    }

    const outIndex = argv.indexOf('--out');
    const outDir = outIndex === -1 ? null : argv[outIndex + 1];

    for (const file of htmlFilesFrom(target)) {
        const payload = extractPayload(fs.readFileSync(file, 'utf-8'));
        const trades = payload.days.reduce((sum, day) => sum + (day.trades?.length ?? 0), 0);

        const destination = path.join(
            outDir ?? path.dirname(file),
            `weekly-options-calendar-${payload.publishDate}.json`
        );
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, JSON.stringify(payload, null, 2), 'utf-8');

        console.log(
            `${path.basename(file)} -> ${payload.publishDate}  ` +
                `days ${payload.days.length}  trades ${trades}  macro ${payload.macro?.length ?? 0}`
        );
        console.log(`  wrote ${destination}`);
    }
}

if (require.main === module) main();
