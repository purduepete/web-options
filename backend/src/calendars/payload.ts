import type { CalendarDay, CalendarTrade, CalendarWeek } from '@weboptions/shared';
import { addDays, toIsoDate, weekStartForPublishDate, fromIsoDate } from '../weeks';
import {
    optionRightFrom,
    parseDelta,
    parseInteger,
    parseMoney,
    parsePercent,
    parseStrike,
    resolveDayDate,
} from './normalize';

/** The generator's sidecar shape: display strings exactly as the newsletter wrote them. */
export interface RawTrade {
    ticker?: unknown;
    type?: unknown;
    strike?: unknown;
    expiry?: unknown;
    dte?: unknown;
    delta?: unknown;
    ann?: unknown;
    premium?: unknown;
    collateral?: unknown;
    risk?: unknown;
    note?: unknown;
}

export interface RawDay {
    name?: unknown;
    date?: unknown;
    rule?: unknown;
    event?: unknown;
    trades?: RawTrade[];
}

export interface CalendarPayload {
    publishDate: string;
    title?: string | null;
    macro?: { label: string; text: string }[];
    days: RawDay[];
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toTrade(raw: RawTrade): CalendarTrade {
    const parsedStrike = parseStrike(raw.strike);
    return {
        ticker: (text(raw.ticker) ?? '').toUpperCase(),
        optionRight: optionRightFrom(raw.type, raw.strike),
        strike: parsedStrike.strike,
        expiry: text(raw.expiry),
        dte: parseInteger(raw.dte),
        delta: parseDelta(raw.delta),
        annualizedYield: parsePercent(raw.ann),
        premium: parseMoney(raw.premium),
        collateral: parseMoney(raw.collateral),
        risk: text(raw.risk)?.toLowerCase() ?? null,
        note: text(raw.note),
    };
}

export function normalizePayload(payload: CalendarPayload): CalendarWeek {
    const publishDate = payload.publishDate;
    // Throws on a malformed or impossible date rather than silently ingesting it.
    fromIsoDate(publishDate);

    const days: CalendarDay[] = [];
    for (const raw of payload.days ?? []) {
        const display = text(raw.date);
        const date = display ? resolveDayDate(display, publishDate) : null;
        if (!date) {
            throw new Error(`Could not resolve a date for day "${String(raw.name)}" (${String(raw.date)})`);
        }
        days.push({
            name: text(raw.name) ?? '',
            date,
            rule: text(raw.rule),
            event: text(raw.event),
            trades: (raw.trades ?? []).map(toTrade),
        });
    }

    const fallbackStart = weekStartForPublishDate(fromIsoDate(publishDate));
    const weekStart = days[0]?.date ?? toIsoDate(fallbackStart);
    const weekEnd = days[days.length - 1]?.date ?? toIsoDate(addDays(fallbackStart, 4));

    return {
        publishDate,
        weekStart,
        weekEnd,
        title: payload.title ?? null,
        macro: payload.macro ?? [],
        days,
    };
}
