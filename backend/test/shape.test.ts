import { describe, expect, it } from 'vitest';
import { groupIntoDays, sqlDateToIso, toTrade, type SignalRow } from '../src/signals/shape';
import { fromIsoDate } from '../src/weeks';

function row(overrides: Partial<SignalRow> = {}): SignalRow {
    return {
        report_date: new Date(Date.UTC(2026, 7, 10)),
        symbol: 'AAPL',
        sector: 'Technology',
        option_right: 'P',
        strike: '175.00',
        expiration: new Date(Date.UTC(2026, 7, 21)),
        dte: 11,
        delta: '-0.190',
        annualized_yield: '9.70',
        premium: '195.00',
        collateral: '17500.00',
        collateral_bucket: 'mid',
        tier: 'conservative',
        is_top_pick: 1,
        actual_delta: '-0.224000',
        actual_mark: '2.010000',
        actual_illiquid: 0,
        ...overrides,
    };
}

describe('sqlDateToIso', () => {
    it('reads UTC parts, so a UTC-midnight DATE does not slip to the previous day', () => {
        const utcMidnight = new Date(Date.UTC(2026, 7, 10));
        expect(sqlDateToIso(utcMidnight)).toBe('2026-08-10');
        // Local getters would have produced the 9th in Pacific — the regression guard.
        expect(utcMidnight.getDate()).toBe(9);
    });

    it('passes strings through and trims any time component', () => {
        expect(sqlDateToIso('2026-08-10')).toBe('2026-08-10');
        expect(sqlDateToIso('2026-08-10T00:00:00.000Z')).toBe('2026-08-10');
    });

    it('maps null and undefined to null', () => {
        expect(sqlDateToIso(null)).toBeNull();
        expect(sqlDateToIso(undefined)).toBeNull();
    });
});

describe('toTrade', () => {
    it('coerces the decimal columns the driver returns as strings', () => {
        expect(toTrade(row())).toEqual({
            symbol: 'AAPL',
            sector: 'Technology',
            optionRight: 'P',
            strike: 175,
            expiration: '2026-08-21',
            dte: 11,
            delta: -0.19,
            annualizedYield: 9.7,
            premium: 195,
            collateral: 17500,
            tier: 'conservative',
            isTopPick: true,
            actualDelta: -0.224,
            actualPremium: 201,
            actualAnnualizedYield: 38.1,
            actualIlliquid: false,
        });
    });

    it('keeps nullable numerics null rather than coercing to zero', () => {
        const trade = toTrade(row({ strike: null, delta: null, annualized_yield: null, dte: null, sector: null }));
        expect(trade.strike).toBeNull();
        expect(trade.delta).toBeNull();
        expect(trade.annualizedYield).toBeNull();
        expect(trade.dte).toBeNull();
        expect(trade.sector).toBeNull();
    });

    it('treats is_top_pick 0 as false and 1 as true', () => {
        expect(toTrade(row({ is_top_pick: 0 })).isTopPick).toBe(false);
        expect(toTrade(row({ is_top_pick: 1 })).isTopPick).toBe(true);
    });

    it('scales the per-share mark up to the per-contract premium VADER quotes', () => {
        expect(toTrade(row({ actual_mark: '7.520000' })).actualPremium).toBe(752);
    });

    it('leaves every actual null when no quote was captured', () => {
        const trade = toTrade(row({ actual_delta: null, actual_mark: null, actual_illiquid: null }));
        expect(trade.actualDelta).toBeNull();
        expect(trade.actualPremium).toBeNull();
        expect(trade.actualAnnualizedYield).toBeNull();
        expect(trade.actualIlliquid).toBe(false);
    });

    it('reports a zero premium as a zero yield rather than an unknown one', () => {
        expect(toTrade(row({ actual_mark: '0.000000' })).actualAnnualizedYield).toBe(0);
    });

    it('refuses to annualize without a positive dte or collateral', () => {
        expect(toTrade(row({ dte: 0 })).actualAnnualizedYield).toBeNull();
        expect(toTrade(row({ dte: null })).actualAnnualizedYield).toBeNull();
        expect(toTrade(row({ collateral: '0.00' })).actualAnnualizedYield).toBeNull();
        expect(toTrade(row({ collateral: null })).actualAnnualizedYield).toBeNull();
    });

    it('surfaces the wide-spread flag as a boolean', () => {
        expect(toTrade(row({ actual_illiquid: 1 })).actualIlliquid).toBe(true);
        expect(toTrade(row({ actual_illiquid: 0 })).actualIlliquid).toBe(false);
    });
});

describe('groupIntoDays', () => {
    const monday = fromIsoDate('2026-08-10');

    it('names the weekdays in order', () => {
        const days = groupIntoDays(
            [
                row({ report_date: new Date(Date.UTC(2026, 7, 10)) }),
                row({ report_date: new Date(Date.UTC(2026, 7, 14)) }),
            ],
            monday,
        );
        expect(days.map((d) => [d.name, d.date])).toEqual([
            ['Monday', '2026-08-10'],
            ['Friday', '2026-08-14'],
        ]);
    });

    it('omits days with no rows instead of emitting them empty', () => {
        const days = groupIntoDays([row({ report_date: new Date(Date.UTC(2026, 7, 12)) })], monday);
        expect(days).toHaveLength(1);
        expect(days[0]?.name).toBe('Wednesday');
    });

    it('ignores weekend rows that fall outside Monday to Friday', () => {
        expect(groupIntoDays([row({ report_date: new Date(Date.UTC(2026, 7, 15)) })], monday)).toEqual([]);
    });

    it('preserves the order the query returned within a day', () => {
        const days = groupIntoDays([row({ symbol: 'MSFT' }), row({ symbol: 'AAPL' }), row({ symbol: 'NVDA' })], monday);
        expect(days[0]?.trades.map((t) => t.symbol)).toEqual(['MSFT', 'AAPL', 'NVDA']);
    });
});
