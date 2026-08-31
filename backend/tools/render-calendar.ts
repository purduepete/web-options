import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CalendarWeek } from '@weboptions/shared';
import { fromIsoDate, toIsoDate } from '../src/weeks';
import { normalizePayload, type CalendarPayload } from '../src/calendars/payload';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const RISK_TIERS = new Set(['conservative', 'balanced', 'aggressive']);
const TEMPLATE_PATH = path.resolve(__dirname, 'templates/weekly-calendar.html');

export interface RenderCalendarOptions {
    expectedTrades: number;
    generatedAt?: Date;
    publishedAt?: Date;
}

function proseFrom(payload: CalendarPayload): string[] {
    return [
        payload.title ?? '',
        ...(payload.macro ?? []).flatMap((note) => [note.label, note.text]),
        ...payload.days.flatMap((day) => [
            typeof day.rule === 'string' ? day.rule : '',
            typeof day.event === 'string' ? day.event : '',
            ...(day.trades ?? []).map((trade) => (typeof trade.note === 'string' ? trade.note : '')),
        ]),
    ];
}

export function validateCalendarPayload(payload: CalendarPayload, expectedTrades: number): CalendarWeek {
    if (!Number.isInteger(expectedTrades) || expectedTrades < 0) {
        throw new Error('expected trade count must be a non-negative integer');
    }
    if (payload.days.length !== WEEKDAYS.length || payload.days.some((day, index) => day.name !== WEEKDAYS[index])) {
        throw new Error('calendar must contain Monday through Friday in order');
    }

    const tradeCount = payload.days.reduce((total, day) => total + (day.trades?.length ?? 0), 0);
    if (tradeCount !== expectedTrades) {
        throw new Error(`expected ${expectedTrades} trades, found ${tradeCount}`);
    }

    const prose = proseFrom(payload).join('\n');
    if (prose.includes('\u2014') || /&mdash;/i.test(prose)) {
        throw new Error('calendar prose contains an em dash');
    }
    if (/\b(?:ET|Eastern)\b/i.test(prose)) {
        throw new Error('calendar prose contains an Eastern time label');
    }

    const week = normalizePayload(payload);
    week.days.forEach((day, dayIndex) => {
        if (fromIsoDate(day.date).getDay() !== dayIndex + 1) {
            throw new Error(`${day.name} date ${day.date} is on the wrong weekday`);
        }
    });

    payload.days.forEach((day) => {
        (day.trades ?? []).forEach((trade) => {
            const label = typeof trade.ticker === 'string' ? trade.ticker : 'unnamed trade';
            if (typeof trade.expiry !== 'string') throw new Error(`${label} has no expiry`);
            fromIsoDate(trade.expiry);
            if (typeof trade.risk !== 'string' || !RISK_TIERS.has(trade.risk.toLowerCase())) {
                throw new Error(`${label} has an unknown risk tier`);
            }
        });
    });

    return week;
}

function formatLocalDate(value: Date): string {
    return value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatLocalTimestamp(value: Date): string {
    return `${formatLocalDate(value)}, ${value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatShortDate(value: Date): string {
    return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function serializeForScript(payload: CalendarPayload): string {
    return JSON.stringify(payload, null, 2)
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function replaceToken(template: string, token: string, value: string): string {
    const occurrences = template.split(token).length - 1;
    if (occurrences !== 1) throw new Error(`template token ${token} occurs ${occurrences} times`);
    return template.replace(token, value);
}

export function renderCalendar(payload: CalendarPayload, options: RenderCalendarOptions): string {
    const week = validateCalendarPayload(payload, options.expectedTrades);
    const publishDate = fromIsoDate(payload.publishDate);
    const generatedAt = options.generatedAt ?? new Date();
    if (options.publishedAt && toIsoDate(options.publishedAt) !== payload.publishDate) {
        throw new Error('published timestamp does not resolve to the payload publish date in local time');
    }

    const pageDate = formatShortDate(publishDate);
    const rangeStart = fromIsoDate(week.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const rangeEnd = fromIsoDate(week.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const published = options.publishedAt
        ? `${formatLocalTimestamp(options.publishedAt)} Pacific`
        : formatLocalDate(publishDate);

    let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    template = replaceToken(template, '__PAGE_DATE__', pageDate);
    template = replaceToken(template, '__WEEK_RANGE__', `${rangeStart}-${rangeEnd}, ${publishDate.getFullYear()}`);
    template = replaceToken(template, '__PUBLISHED__', published);
    template = replaceToken(template, '__GENERATED__', formatLocalTimestamp(generatedAt));
    return replaceToken(template, '__CALENDAR_DATA__', serializeForScript(payload));
}

function optionValue(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
}

function parseDate(value: string | undefined, name: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (!Number.isFinite(+parsed)) throw new Error(`${name} must be an ISO timestamp`);
    return parsed;
}

function outputPath(target: string | undefined, publishDate: string): string {
    const filename = `weekly-options-calendar-${publishDate}.html`;
    if (!target) return path.join(os.homedir(), 'OneDrive', 'Trading', 'Vader', filename);
    return path.extname(target).toLowerCase() === '.html' ? path.resolve(target) : path.resolve(target, filename);
}

export interface CalendarCliArgs {
    sourcePath: string | undefined;
    expectedValue: string | undefined;
    publishedValue: string | undefined;
    outputValue: string | undefined;
}

export function parseCalendarArgs(argv: string[]): CalendarCliArgs {
    const valueOptions = new Set(['--expected-trades', '--published-at', '--out']);
    const sourceIndex = argv.findIndex(
        (argument, index) => !argument.startsWith('--') && (index === 0 || !valueOptions.has(argv[index - 1]!)),
    );
    const sourcePath = sourceIndex === -1 ? undefined : argv[sourceIndex];
    const positional = sourceIndex === -1 ? [] : argv.slice(sourceIndex + 1).filter((argument) => !argument.startsWith('--'));
    return {
        sourcePath,
        expectedValue: optionValue(argv, '--expected-trades') ?? positional[0],
        publishedValue: optionValue(argv, '--published-at') ?? positional[1],
        outputValue: optionValue(argv, '--out') ?? positional[2],
    };
}

function main(): void {
    const argv = process.argv.slice(2);
    const { sourcePath, expectedValue, publishedValue, outputValue } = parseCalendarArgs(argv);
    if (!sourcePath || !expectedValue) {
        console.log(
            'usage: render-calendar.ts <file.json> <expected-trades> [published-at] [output] [--check]',
        );
        process.exitCode = 1;
        return;
    }

    const expectedTrades = Number(expectedValue);
    const payload = JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8')) as CalendarPayload;
    const publishedAt = parseDate(publishedValue, 'published-at');
    const html = renderCalendar(payload, { expectedTrades, publishedAt });
    const week = validateCalendarPayload(payload, expectedTrades);
    const summary = `${week.publishDate}  ${week.weekStart}..${week.weekEnd}  days ${week.days.length}  trades ${expectedTrades}`;

    if (argv.includes('--check')) {
        console.log(`${summary}  valid`);
        return;
    }

    const destination = outputPath(outputValue, payload.publishDate);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, 'utf8');
    console.log(`${summary}  wrote ${destination}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}