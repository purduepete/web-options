import type { IsoDate } from '@weboptions/shared';

/**
 * Week math ported from the retired Flask server's `_monday_of` and
 * `_week_start_for_publish_date`. The behaviour it had to match is recorded in
 * test/fixtures/golden.
 *
 * Deliberately machine-local, matching Python's `date.today()`. That was safe in
 * Flask only because the server and the user were the same machine; on
 * jimbrownhome it is safe only because the service pins TZ=America/Los_Angeles.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Python's `date.weekday()`: Monday=0 … Sunday=6. JS `getDay()` is Sunday=0. */
function pythonWeekday(d: Date): number {
    return (d.getDay() + 6) % 7;
}

/** Formats using LOCAL parts. `toISOString()` here would shift the day in Pacific. */
export function toIsoDate(d: Date): IsoDate {
    const year = String(d.getFullYear()).padStart(4, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD` to a local midnight Date, rejecting non-dates like 2026-02-31. */
export function fromIsoDate(value: string): Date {
    const match = ISO_DATE_RE.exec(value);
    if (!match) {
        throw new RangeError(`date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
    }
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
        throw new RangeError(`not a real calendar date: ${value}`);
    }
    return parsed;
}

export function addDays(d: Date, days: number): Date {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

export function mondayOf(d: Date): Date {
    return addDays(d, -pythonWeekday(d));
}

export function currentWeekMonday(now: Date = new Date()): Date {
    return mondayOf(now);
}

/** Throws RangeError on malformed input; callers turn that into a 400. */
export function parseWeekParam(value: string): Date {
    return mondayOf(fromIsoDate(value));
}

/**
 * Maps a calendar's publish date to the Monday of the week it covers. The
 * newsletter often lands Sat/Sun ahead of its week, so weekends map FORWARD —
 * a plain mondayOf() on a Sunday would point at the week that just ended.
 */
export function weekStartForPublishDate(publishDate: Date): Date {
    const weekday = pythonWeekday(publishDate);
    if (weekday === 5) return addDays(publishDate, 2);
    if (weekday === 6) return addDays(publishDate, 1);
    return addDays(publishDate, -weekday);
}

export function weekEndFor(monday: Date): Date {
    return addDays(monday, 4);
}
