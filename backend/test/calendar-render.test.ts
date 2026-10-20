import { describe, expect, it } from 'vitest';
import type { CalendarPayload } from '../src/calendars/payload';
import { parseCalendarArgs, renderCalendar, validateCalendarPayload } from '../tools/render-calendar';

const payload: CalendarPayload = {
    publishDate: '2026-08-31',
    title: null,
    macro: [{ label: 'Jobs report: Friday, 5:30 AM Pacific', text: 'Wait for the release.' }],
    days: [
        { name: 'Monday', date: 'Aug 31', rule: 'Wait.', event: 'Month end.', trades: [] },
        {
            name: 'Tuesday',
            date: 'Sep 1',
            rule: 'Sell after 7:30 AM Pacific.',
            event: 'ISM at 7:00 AM Pacific.',
            trades: [
                {
                    ticker: 'AAPL',
                    type: 'call',
                    strike: '$330C',
                    expiry: '2026-09-18',
                    dte: 18,
                    delta: '+0.31',
                    ann: '22.2%',
                    premium: '$350',
                    collateral: '$31,970',
                    risk: 'conservative',
                    note: 'Deep contract liquidity.',
                },
            ],
        },
        { name: 'Wednesday', date: 'Sep 2', rule: 'Wait.', event: null, trades: [] },
        { name: 'Thursday', date: 'Sep 3', rule: 'Wait.', event: null, trades: [] },
        { name: 'Friday', date: 'Sep 4', rule: 'Wait.', event: null, trades: [] },
    ],
};

describe('validateCalendarPayload', () => {
    it('accepts five weekdays and the expected trade count', () => {
        expect(validateCalendarPayload(payload, 1)).toMatchObject({
            publishDate: '2026-08-31',
            weekStart: '2026-08-31',
            weekEnd: '2026-09-04',
        });
    });

    it('rejects a missing weekday', () => {
        expect(() => validateCalendarPayload({ ...payload, days: payload.days.slice(0, 4) }, 1)).toThrow(
            /Monday through Friday/
        );
    });

    it('rejects the wrong advertised trade count', () => {
        expect(() => validateCalendarPayload(payload, 14)).toThrow(/expected 14 trades, found 1/);
    });

    it('rejects em dashes and Eastern time labels', () => {
        expect(() =>
            validateCalendarPayload(
                { ...payload, days: [{ ...payload.days[0]!, rule: 'Wait — then trade.' }, ...payload.days.slice(1)] },
                1
            )
        ).toThrow(/em dash/);
        expect(() =>
            validateCalendarPayload(
                {
                    ...payload,
                    days: [{ ...payload.days[0]!, event: 'Report at 8:30 AM Eastern.' }, ...payload.days.slice(1)],
                },
                1
            )
        ).toThrow(/Eastern time/);
    });
});

describe('renderCalendar', () => {
    it('renders the payload once as safe embedded data', () => {
        const html = renderCalendar(payload, {
            expectedTrades: 1,
            generatedAt: new Date('2026-08-31T15:08:00Z'),
            publishedAt: new Date('2026-08-31T14:57:48Z'),
        });

        expect(html).toContain('<title>Weekly Options Calendar - Aug 31, 2026</title>');
        expect(html).toContain('Published Monday, August 31, 2026, 7:57 AM Pacific');
        expect(html).toContain('Calendar generated Monday, August 31, 2026, 8:08 AM local time');
        expect(html).toContain('grid-template-rows: subgrid');
        expect(html).toContain('var DATA = {');
        expect(html.match(/"ticker": "AAPL"/g)).toHaveLength(1);
    });

    it('cannot close the data script from article text', () => {
        const unsafe = {
            ...payload,
            macro: [{ label: '</script><script>alert(1)</script>', text: 'test' }],
        };
        const html = renderCalendar(unsafe, { expectedTrades: 1, generatedAt: new Date('2026-08-31T15:08:00Z') });
        expect(html).not.toContain('</script><script>alert(1)</script>');
        expect(html).toContain('\\u003c/script\\u003e');
    });
});

describe('parseCalendarArgs', () => {
    it('accepts the positional values npm forwards on this machine', () => {
        expect(parseCalendarArgs(['--check', 'week.json', '14', '2026-08-31T14:57:48Z', 'C:\\temp'])).toEqual({
            sourcePath: 'week.json',
            expectedValue: '14',
            publishedValue: '2026-08-31T14:57:48Z',
            outputValue: 'C:\\temp',
        });
    });

    it('keeps named options for direct tsx calls', () => {
        expect(
            parseCalendarArgs([
                'week.json',
                '--expected-trades',
                '14',
                '--published-at',
                '2026-08-31T14:57:48Z',
                '--out',
                'C:\\temp',
            ])
        ).toEqual({
            sourcePath: 'week.json',
            expectedValue: '14',
            publishedValue: '2026-08-31T14:57:48Z',
            outputValue: 'C:\\temp',
        });
    });
});
