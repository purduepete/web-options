import { describe, expect, it } from 'vitest';
import type { DaySignals, Trade } from '@weboptions/shared';
import { buildGroups, filterDaysBySymbol, groupTrades, shiftWeek, weekdayColumn } from '../src/signals/grouping';

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
        ...extra,
    };
}

function day(date: string, name: string, trades: Trade[]): DaySignals {
    return { name, date, hasData: true, trades };
}

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
        expect(groupTrades(groups[1]!, days[0]!.trades).map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('claims a top pick for Top Picks and nowhere else', () => {
        const trades = [trade('NVDA', { isTopPick: true, tier: 'Balanced' }), trade('MSFT', { tier: 'Balanced' })];
        const groups = buildGroups([day('2025-08-11', 'Monday', trades)]);

        expect(groupTrades(groups[0]!, trades).map((t) => t.symbol)).toEqual(['NVDA']);
        expect(groupTrades(groups[1]!, trades).map((t) => t.symbol)).toEqual(['MSFT']);
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
        expect(groupTrades(group, trades).map((t) => t.symbol)).toEqual(['MSFT', 'AMD', 'AAPL']);
    });

    it('sinks a missing yield to the bottom instead of dropping the trade', () => {
        const trades = [trade('AAPL', { annualizedYield: null }), trade('MSFT', { annualizedYield: 3 })];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        expect(groupTrades(group, trades).map((t) => t.symbol)).toEqual(['MSFT', 'AAPL']);
    });

    it('leaves the array it was handed alone', () => {
        const trades = [trade('AAPL', { annualizedYield: 1 }), trade('MSFT', { annualizedYield: 9 })];
        const group = buildGroups([day('2025-08-11', 'Monday', trades)])[0]!;
        groupTrades(group, trades);
        expect(trades.map((t) => t.symbol)).toEqual(['AAPL', 'MSFT']);
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
