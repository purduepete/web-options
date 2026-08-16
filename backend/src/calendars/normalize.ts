import type { IsoDate, OptionRight } from '@weboptions/shared';
import { fromIsoDate, toIsoDate } from '../weeks';

/**
 * Turns the newsletter's display strings into numbers, once, at ingest time.
 * Nothing downstream should ever have to parse '$17,500' again.
 */

export function parseMoney(value: unknown): number | null {
    if (typeof value !== 'string') return typeof value === 'number' ? value : null;
    const cleaned = value.replace(/[$,\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parsePercent(value: unknown): number | null {
    if (typeof value !== 'string') return typeof value === 'number' ? value : null;
    const cleaned = value.replace(/[%\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Deltas carry an explicit sign, including a leading '+' that Number() accepts. */
export function parseDelta(value: unknown): number | null {
    if (typeof value !== 'string') return typeof value === 'number' ? value : null;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseInteger(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
    if (typeof value !== 'string') return null;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export interface ParsedStrike {
    strike: number | null;
    right: OptionRight | null;
}

/** '$175P' -> 175 + 'P'. The trailing letter is the only right marker on some rows. */
export function parseStrike(value: unknown): ParsedStrike {
    if (typeof value !== 'string') return { strike: null, right: null };
    const match = /^\s*\$?\s*([\d,]+(?:\.\d+)?)\s*([PC])?\s*$/i.exec(value);
    if (!match) return { strike: null, right: null };
    const strike = Number(match[1]!.replace(/,/g, ''));
    const letter = match[2]?.toUpperCase();
    return {
        strike: Number.isFinite(strike) ? strike : null,
        right: letter === 'P' || letter === 'C' ? letter : null,
    };
}

export function optionRightFrom(type: unknown, strike: unknown): OptionRight {
    if (typeof type === 'string') {
        const normalized = type.trim().toLowerCase();
        if (normalized.startsWith('put')) return 'P';
        if (normalized.startsWith('call')) return 'C';
    }
    return parseStrike(strike).right ?? 'P';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * 'Aug 10' has no year. Picks the candidate year nearest the publish date, which
 * keeps a calendar published in late December pointing at the right January.
 */
export function resolveDayDate(display: string, publishDate: IsoDate): IsoDate | null {
    const match = /^\s*([A-Za-z]{3,})\.?\s+(\d{1,2})\s*$/.exec(display);
    if (!match) return null;

    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
    const day = Number(match[2]);
    if (month === -1 || !Number.isFinite(day)) return null;

    const published = fromIsoDate(publishDate);
    let best: Date | null = null;
    for (const year of [published.getFullYear() - 1, published.getFullYear(), published.getFullYear() + 1]) {
        const candidate = new Date(year, month, day);
        if (candidate.getMonth() !== month) continue; // e.g. Feb 30 in a non-leap year
        if (!best || Math.abs(+candidate - +published) < Math.abs(+best - +published)) {
            best = candidate;
        }
    }
    return best ? toIsoDate(best) : null;
}
