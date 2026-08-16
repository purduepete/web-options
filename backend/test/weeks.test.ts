import { describe, expect, it } from 'vitest';
import {
    addDays,
    currentWeekMonday,
    fromIsoDate,
    mondayOf,
    parseWeekParam,
    toIsoDate,
    weekEndFor,
    weekStartForPublishDate,
} from '../src/weeks';

// The suite runs under TZ=America/Los_Angeles (vitest.config.ts) because the
// production service pins the same zone. A green run in UTC proves nothing.
describe('timezone pin', () => {
    it('runs in the zone the service is deployed with', () => {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    });

    it('formats local parts, not UTC — the bug that shifts a day west of Greenwich', () => {
        const lateEvening = new Date(2026, 7, 16, 23, 30, 0);
        expect(toIsoDate(lateEvening)).toBe('2026-08-16');
        expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-08-17');
    });
});

describe('mondayOf', () => {
    it.each([
        ['2026-08-10', '2026-08-10'],
        ['2026-08-11', '2026-08-10'],
        ['2026-08-14', '2026-08-10'],
        ['2026-08-15', '2026-08-10'],
        ['2026-08-16', '2026-08-10'],
    ])('%s belongs to the week starting %s', (input, expected) => {
        expect(toIsoDate(mondayOf(fromIsoDate(input)))).toBe(expected);
    });

    it('crosses a year boundary', () => {
        expect(toIsoDate(mondayOf(fromIsoDate('2027-01-01')))).toBe('2026-12-28');
    });

    it('crosses a month boundary', () => {
        expect(toIsoDate(mondayOf(fromIsoDate('2026-09-02')))).toBe('2026-08-31');
    });

    it('is stable across a DST spring-forward boundary', () => {
        expect(toIsoDate(mondayOf(fromIsoDate('2026-03-08')))).toBe('2026-03-02');
        expect(toIsoDate(mondayOf(fromIsoDate('2026-11-01')))).toBe('2026-10-26');
    });
});

describe('weekStartForPublishDate', () => {
    it('maps a Saturday publish forward to the following Monday', () => {
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2026-08-15')))).toBe('2026-08-17');
    });

    it('maps a Sunday publish forward to the following Monday', () => {
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2026-08-16')))).toBe('2026-08-17');
    });

    it('maps a weekday publish back to its own Monday', () => {
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2026-08-12')))).toBe('2026-08-10');
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2026-08-10')))).toBe('2026-08-10');
    });

    it('rolls a weekend publish into the next year', () => {
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2026-12-27')))).toBe('2026-12-28');
        expect(toIsoDate(weekStartForPublishDate(fromIsoDate('2027-01-02')))).toBe('2027-01-04');
    });
});

describe('fromIsoDate', () => {
    it.each(['', '2026-8-1', '16-08-2026', 'yesterday', '2026-02-31', '2026-13-01'])('rejects %s', (value) => {
        expect(() => fromIsoDate(value)).toThrow(RangeError);
    });

    it('accepts a leap day', () => {
        expect(toIsoDate(fromIsoDate('2028-02-29'))).toBe('2028-02-29');
    });
});

describe('parseWeekParam', () => {
    it('snaps any day in the week to its Monday', () => {
        expect(toIsoDate(parseWeekParam('2026-08-14'))).toBe('2026-08-10');
    });

    it('propagates a RangeError the route turns into a 400', () => {
        expect(() => parseWeekParam('not-a-date')).toThrow(RangeError);
    });
});

describe('week bounds', () => {
    it('ends on the Friday', () => {
        expect(toIsoDate(weekEndFor(fromIsoDate('2026-08-10')))).toBe('2026-08-14');
    });

    it('adds days without drifting through a DST transition', () => {
        expect(toIsoDate(addDays(fromIsoDate('2026-03-07'), 1))).toBe('2026-03-08');
        expect(toIsoDate(addDays(fromIsoDate('2026-03-08'), 1))).toBe('2026-03-09');
    });
});

describe('currentWeekMonday', () => {
    it('uses the supplied clock', () => {
        expect(toIsoDate(currentWeekMonday(new Date(2026, 7, 13, 6, 0, 0)))).toBe('2026-08-10');
    });

    it('does not roll backwards just before midnight', () => {
        expect(toIsoDate(currentWeekMonday(new Date(2026, 7, 16, 23, 59, 59)))).toBe('2026-08-10');
        expect(toIsoDate(currentWeekMonday(new Date(2026, 7, 17, 0, 0, 1)))).toBe('2026-08-17');
    });
});
