import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaySignals, Trade } from '@weboptions/shared';
import {
    EXPIRY_FILTERS,
    MONEYNESS_FILTERS,
    buildGroups,
    cycle,
    filterDaysByExpiry,
    filterDaysByMoneyness,
    filterDaysBySymbol,
    groupTrades,
    shiftWeek,
    weekdayColumn,
} from '../src/signals/grouping';

function trade(symbol: string, extra: Partial<Trade> = {}): Trade {
    return {
        symbol,
        sector: null,
        optionRight: 'P',
        strike: 100,
        expiration: '2025-08-15',
        dte: 4,
        delta: -0.2,
        annualizedYield: 10,
        premium: 100,
        collateral: 10000,
        tier: 'Conservative',
        isTopPick: false,
        actualDelta: -0.25,
        actualPremium: 130,
        actualAnnualizedYield: 12,
        actualIlliquid: false,
        closeDate: null,
        closeUnderlying: null,
        moneyness: null,
        percentFromStrike: null,
        ...extra,
    };
}

function day(date: string, name: string, trades: Trade[]): DaySignals {
    return { name, date, hasData: true, trades };
}

describe('cycle', () => {
    it('walks each filter all the way round and back to where it started', () => {
        expect(EXPIRY_FILTERS.reduce((at) => cycle(EXPIRY_FILTERS, at), 'all')).toBe('all');
        expect(cycle(EXPIRY_FILTERS, 'all')).toBe('expired');
        expect(cycle(EXPIRY_FILTERS, 'active')).toBe('all');
        expect(cycle(MONEYNESS_FILTERS, 'itm')).toBe('otm');
        expect(cycle(MONEYNESS_FILTERS, 'otm')).toBe('all');
    });

    it('starts from the top when handed something not on the list', () => {
        // A hand-edited ?expiry= in the URL should still leave the key working.
        expect(cycle(EXPIRY_FILTERS, 'nonsense' as (typeof EXPIRY_FILTERS)[number])).toBe('all');
    });
});

describe('filterDaysBySymbol', () => {
    const days = [
        day('2025-08-11', 'Monday', [trade('AAPL'), trade('MSFT')]),
        day('2025-08-12', 'Tuesday', [trade('AMD')]),
    ];

    it('keeps every trade when there is no filter', () => {
        expect(filterDaysBySymbol(days, '')).toEqual(days);
    });

    it('matches anywhere in the symbol, case-insensitively', () => {
        const result = filterDaysBySymbol(days, 'm');
        expect(result.map((d) => d.trades.map((t) => t.symbol))).toEqual([['MSFT'], ['AMD']]);
    });

    it('keeps the day even when nothing on it matches, so its card still shows', () => {
        const result = filterDaysBySymbol(days, 'aapl');
        expect(result).toHaveLength(2);
        expect(result[1]?.trades).toEqual([]);
    });
});

describe('filterDaysByExpiry', () => {
    const days = [
        day('2025-08-11', 'Monday', [
            trade('AAPL', { expiration: '2025-08-15' }),
            trade('MSFT', { expiration: '2025-08-20' }),
            trade('AMD', { expiration: '2025-08-29' }),
        ]),
    ];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2025, 7, 20, 9, 30, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('leaves the week alone when showing everything', () => {
        expect(filterDaysByExpiry(days, 'all')).toEqual(days);
    });

    it('drops what has expired and keeps expiry day itself', () => {
        const result = filterDaysByExpiry(days, 'active');
        expect(result[0]?.trades.map((t) => t.symbol)).toEqual(['MSFT', 'AMD']);
    });

    it('keeps only what has expired the other way round', () => {
        const result = filterDaysByExpiry(days, 'expired');
        expect(result[0]?.trades.map((t) => t.symbol)).toEqual(['AAPL']);
    });

    it('keeps a day that empties out, so its card still shows', () => {
        const result = filterDaysByExpiry([day('2025-08-11', 'Monday', [trade('AAPL')])], 'active');
        expect(result).toHaveLength(1);
        expect(result[0]?.trades).toEqual([]);
    });
});

describe('filterDaysByMoneyness', () => {
    const days = [
        day('2025-08-11', 'Monday', [
            trade('AAPL', { moneyness: 'itm' }),
            trade('MSFT', { moneyness: 'otm' }),
            trade('AMD', { moneyness: null }),
        ]),
    ];

    it('leaves the week alone when showing everything', () => {
        expect(filterDaysByMoneyness(days, 'all')).toEqual(days);
    });

    it('keeps only what closed in the money', () => {
        expect(filterDaysByMoneyness(days, 'itm')[0]?.trades.map((t) => t.symbol)).toEqual(['AAPL']);
    });

    it('drops a contract with no close of its own, since it has no moneyness', () => {
        expect(filterDaysByMoneyness(days, 'otm')[0]?.trades.map((t) => t.symbol)).toEqual(['MSFT']);
    });
});

describe('buildGroups', () => {
    it('offers no groups at all for a week with no trades', () => {
        expect(buildGroups([day('2025-08-11', 'Monday', [])])).toEqual([]);
    });

    it('puts top picks first, then the tiers in risk order', () => {
        const days = [
            day('2025-08-11', 'Monday', [
                trade('AAPL', { tier: 'Aggressive' }),
                trade('MSFT', { tier: 'Balanced' }),
                trade('NVDA', { isTopPick: true, tier: 'Balanced' }),
            ]),
            day('2025-08-12', 'Tuesday', [trade('AMD', { tier: 'Conservative' })]),
        ];

        expect(buildGroups(days).map((g) => g.id)).toEqual(['top-picks', 'conservative', 'balanced', 'aggressive']);
    });

    it('only offers a group some day this week actually fills', () => {
        const days = [day('2025-08-11', 'Monday', [trade('AAPL', { tier: 'Balanced' })])];
        expect(buildGroups(days).map((g) => g.id)).toEqual(['balanced']);
    });

    it('sweeps unrecognised and missing tiers into Other, last', () => {
        const days = [
            day('2025-08-11', 'Monday', [
                trade('AAPL', { tier: null }),
                trade('MSFT', { tier: 'Speculative' }),
                trade('AMD', { tier: 'Conservative' }),
            ]),
        ];

        const groups = buildGroups(days);
        expect(groups.map((g) => g.id)).toEqual(['conservative', 'other']);
        expect(groupTrades(groups[1]!, days[0]!.trades, 'quoted').map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('claims a top pick for Top Picks and nowhere else', () => {
        const trades = [trade('NVDA', { isTopPick: true, tier: 'Balanced' }), trade('MSFT', { tier: 'Balanced' })];
        const groups = buildGroups([day('2025-08-11', 'Monday', trades)]);

        expect(groupTrades(groups[0]!, trades, 'quoted').map((t) => t.symbol)).toEqual(['NVDA']);
        expect(groupTrades(groups[1]!, trades, 'quoted').map((t) => t.symbol)).toEqual(['MSFT']);
    });

    it('shows the tier badge only where the group name does not already say it', () => {
        const trades = [trade('NVDA', { isTopPick: true })];
        const groups = buildGroups([day('2025-08-11', 'Monday', [...trades, trade('MSFT')])]);
        expect(groups.map((g) => [g.id, g.showTierBadge])).toEqual([
            ['top-picks', true],
            ['conservative', false],
        ]);
    });
});

describe('groupTrades', () => {
    it('sorts by annualised yield, richest first', () => {
        const trades = [
            trade('AAPL', { annualizedYield: 8 }),
            trade('MSFT', { annualizedYield: 22 }),
            trade('AMD', { annualizedYield: 15 }),
        ];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        expect(groupTrades(group, trades, 'quoted').map((t) => t.symbol)).toEqual(['MSFT', 'AMD', 'AAPL']);
    });

    it('sinks a missing yield to the bottom instead of dropping the trade', () => {
        const trades = [trade('AAPL', { annualizedYield: null }), trade('MSFT', { annualizedYield: 3 })];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        expect(groupTrades(group, trades, 'quoted').map((t) => t.symbol)).toEqual(['MSFT', 'AAPL']);
    });

    it('leaves the array it was handed alone', () => {
        const trades = [trade('AAPL', { annualizedYield: 1 }), trade('MSFT', { annualizedYield: 9 })];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        groupTrades(group, trades, 'quoted');
        expect(trades.map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('ranks on the captured yield in actual mode, not the advertised one', () => {
        // Reversed against each other, so only the source being read can decide.
        const trades = [
            trade('AAPL', { annualizedYield: 30, actualAnnualizedYield: 4 }),
            trade('MSFT', { annualizedYield: 5, actualAnnualizedYield: 26 }),
        ];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        expect(groupTrades(group, trades, 'actual').map((t) => t.symbol)).toEqual(['MSFT', 'AAPL']);
        expect(groupTrades(group, trades, 'quoted').map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('ranks an unquoted trade on the yield it falls back to displaying', () => {
        const trades = [
            trade('AAPL', { annualizedYield: 30, actualAnnualizedYield: null }),
            trade('MSFT', { annualizedYield: 5, actualAnnualizedYield: 12 }),
        ];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        expect(groupTrades(group, trades, 'actual').map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
    });
});

describe('weekdayColumn', () => {
    it('places each weekday in its own column, Monday first', () => {
        expect(weekdayColumn('2025-08-11')).toBe(1);
        expect(weekdayColumn('2025-08-15')).toBe(5);
    });

    it('parks a weekend date in the last column rather than off the grid', () => {
        expect(weekdayColumn('2025-08-16')).toBe(5);
        expect(weekdayColumn('2025-08-17')).toBe(5);
    });
});

describe('shiftWeek', () => {
    it('moves a whole week either way', () => {
        expect(shiftWeek('2025-08-11', 7)).toBe('2025-08-18');
        expect(shiftWeek('2025-08-11', -7)).toBe('2025-08-04');
    });

    it('crosses month and year boundaries', () => {
        expect(shiftWeek('2025-12-29', 7)).toBe('2026-01-05');
        expect(shiftWeek('2025-01-01', -7)).toBe('2024-12-25');
    });
});
