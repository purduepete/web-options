import { describe, expect, it } from 'vitest';
import type { CalendarTrade } from '@weboptions/shared';
import { groupCalendarTrades, isLatest, weekRangeLabel } from '../src/calendars/calendarGroups';

function trade(ticker: string, extra: Partial<CalendarTrade> = {}): CalendarTrade {
    return {
        ticker,
        optionRight: 'P',
        strike: 100,
        expiry: '2026-09-18',
        dte: 42,
        delta: -0.2,
        annualizedYield: 10,
        premium: 200,
        collateral: 10000,
        risk: 'balanced',
        note: null,
        ...extra,
    };
}

describe('groupCalendarTrades', () => {
    it('gives nothing back for a day with no trades', () => {
        expect(groupCalendarTrades([])).toEqual([]);
    });

    it('orders the groups by risk, mildest first', () => {
        const trades = [
            trade('A', { risk: 'aggressive' }),
            trade('B', { risk: 'conservative' }),
            trade('C', { risk: 'balanced' }),
        ];
        expect(groupCalendarTrades(trades).map((g) => g.risk)).toEqual(['conservative', 'balanced', 'aggressive']);
    });

    it('reads the risk regardless of how it was capitalised', () => {
        expect(groupCalendarTrades([trade('A', { risk: 'Conservative' })]).map((g) => g.risk)).toEqual([
            'conservative',
        ]);
    });

    it('collects unknown and missing risks into Other, at the end', () => {
        const trades = [trade('A', { risk: null }), trade('B', { risk: 'balanced' }), trade('C', { risk: 'wild' })];
        const groups = groupCalendarTrades(trades);
        expect(groups.map((g) => g.risk)).toEqual(['balanced', 'other']);
        expect(groups[1]?.trades.map((t) => t.ticker)).toEqual(['A', 'C']);
    });

    it('puts every put before every call, then sorts each by yield', () => {
        const trades = [
            trade('CALL-LOW', { optionRight: 'C', annualizedYield: 5 }),
            trade('PUT-LOW', { optionRight: 'P', annualizedYield: 4 }),
            trade('CALL-HIGH', { optionRight: 'C', annualizedYield: 40 }),
            trade('PUT-HIGH', { optionRight: 'P', annualizedYield: 30 }),
        ];
        expect(groupCalendarTrades(trades)[0]?.trades.map((t) => t.ticker)).toEqual([
            'PUT-HIGH',
            'PUT-LOW',
            'CALL-HIGH',
            'CALL-LOW',
        ]);
    });

    it('leaves the array it was handed alone', () => {
        const trades = [trade('A', { annualizedYield: 1 }), trade('B', { annualizedYield: 9 })];
        groupCalendarTrades(trades);
        expect(trades.map((t) => t.ticker)).toEqual(['A', 'B']);
    });
});

describe('weekRangeLabel', () => {
    it('reads as a range of days', () => {
        expect(weekRangeLabel('2026-08-10', '2026-08-14')).toBe('Aug 10 – Aug 14');
    });
});

describe('isLatest', () => {
    it('marks only the newest publish date', () => {
        const calendars = [{ publishDate: '2026-08-10' }, { publishDate: '2026-08-03' }];
        expect(calendars.map((c) => isLatest(c.publishDate, calendars))).toEqual([true, false]);
    });

    it('does not depend on the list already being sorted', () => {
        const calendars = [{ publishDate: '2026-08-03' }, { publishDate: '2026-08-10' }];
        expect(calendars.map((c) => isLatest(c.publishDate, calendars))).toEqual([false, true]);
    });

    it('marks nothing in an empty list', () => {
        expect(isLatest('2026-08-10', [])).toBe(false);
    });
});
