import { describe, expect, it } from 'vitest';
import {
    optionRightFrom,
    parseDelta,
    parseInteger,
    parseMoney,
    parsePercent,
    parseStrike,
    resolveDayDate,
} from '../src/calendars/normalize';
import { normalizePayload, type CalendarPayload } from '../src/calendars/payload';

describe('parseMoney', () => {
    it('strips the currency symbol and thousands separators', () => {
        expect(parseMoney('$17,500')).toBe(17500);
        expect(parseMoney('$195')).toBe(195);
        expect(parseMoney('$1,234.56')).toBe(1234.56);
    });

    it('returns null for absent or unparseable values', () => {
        expect(parseMoney(null)).toBeNull();
        expect(parseMoney('')).toBeNull();
        expect(parseMoney('n/a')).toBeNull();
    });
});

describe('parsePercent', () => {
    it('drops the sign', () => {
        expect(parsePercent('9.7%')).toBe(9.7);
        expect(parsePercent('68.4%')).toBe(68.4);
    });
});

describe('parseDelta', () => {
    it('keeps the explicit sign', () => {
        expect(parseDelta('-0.19')).toBe(-0.19);
        expect(parseDelta('+0.38')).toBe(0.38);
    });
});

describe('parseInteger', () => {
    it('accepts both the number and string forms', () => {
        expect(parseInteger(42)).toBe(42);
        expect(parseInteger('14')).toBe(14);
        expect(parseInteger('x')).toBeNull();
    });
});

describe('parseStrike', () => {
    it('splits the price from the right marker', () => {
        expect(parseStrike('$175P')).toEqual({ strike: 175, right: 'P' });
        expect(parseStrike('$130C')).toEqual({ strike: 130, right: 'C' });
        expect(parseStrike('$1,175.50C')).toEqual({ strike: 1175.5, right: 'C' });
    });

    it('tolerates a strike with no right marker', () => {
        expect(parseStrike('$60')).toEqual({ strike: 60, right: null });
    });
});

describe('optionRightFrom', () => {
    it('prefers the explicit type', () => {
        expect(optionRightFrom('put', '$175P')).toBe('P');
        expect(optionRightFrom('call', '$130C')).toBe('C');
    });

    it('falls back to the strike suffix', () => {
        expect(optionRightFrom(null, '$130C')).toBe('C');
    });
});

describe('resolveDayDate', () => {
    it('takes the year from the publish date', () => {
        expect(resolveDayDate('Aug 10', '2026-08-10')).toBe('2026-08-10');
        expect(resolveDayDate('Aug 14', '2026-08-10')).toBe('2026-08-14');
    });

    it('rolls into the next year for a calendar published at the end of December', () => {
        expect(resolveDayDate('Jan 2', '2026-12-28')).toBe('2027-01-02');
    });

    it('rolls back for a calendar published on New Year\u2019s Day', () => {
        expect(resolveDayDate('Dec 30', '2027-01-01')).toBe('2026-12-30');
    });

    it('returns null for an unreadable display date', () => {
        expect(resolveDayDate('sometime', '2026-08-10')).toBeNull();
    });
});

const payload: CalendarPayload = {
    publishDate: '2026-08-10',
    macro: [{ label: 'VIX', text: 'low' }],
    days: [
        {
            name: 'Monday',
            date: 'Aug 10',
            rule: '  sell puts  ',
            event: null,
            trades: [
                {
                    ticker: 'pm',
                    type: 'put',
                    strike: '$175P',
                    expiry: '2026-09-18',
                    dte: 42,
                    delta: '-0.19',
                    ann: '9.7%',
                    premium: '$195',
                    collateral: '$17,500',
                    risk: 'Conservative',
                    note: '7.7% cushion.',
                },
            ],
        },
        { name: 'Thursday', date: 'Aug 13', rule: null, event: 'CPI', trades: [] },
    ],
};

describe('normalizePayload', () => {
    const week = normalizePayload(payload);

    it('derives the week bounds from the first and last day', () => {
        expect(week.weekStart).toBe('2026-08-10');
        expect(week.weekEnd).toBe('2026-08-13');
    });

    it('normalizes every display string into a number', () => {
        expect(week.days[0]!.trades[0]).toEqual({
            ticker: 'PM',
            optionRight: 'P',
            strike: 175,
            expiry: '2026-09-18',
            dte: 42,
            delta: -0.19,
            annualizedYield: 9.7,
            premium: 195,
            collateral: 17500,
            risk: 'conservative',
            note: '7.7% cushion.',
        });
    });

    it('trims prose and keeps a day with no trades', () => {
        expect(week.days[0]!.rule).toBe('sell puts');
        expect(week.days[1]).toMatchObject({ name: 'Thursday', event: 'CPI', trades: [] });
    });

    it('refuses a day whose date cannot be resolved', () => {
        expect(() =>
            normalizePayload({ ...payload, days: [{ name: 'Monday', date: 'whenever', trades: [] }] }),
        ).toThrow(/Could not resolve a date/);
    });

    it('refuses an impossible publish date', () => {
        expect(() => normalizePayload({ ...payload, publishDate: '2026-02-31' })).toThrow();
    });
});
