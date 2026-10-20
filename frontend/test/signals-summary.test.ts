import { describe, expect, it } from 'vitest';
import type { DaySignals, Trade } from '@weboptions/shared';
import { premiumDriftPercent, summarizeWeek, totalCollateral } from '../src/signals/summary';

function trade(extra: Partial<Trade> = {}): Trade {
    return {
        symbol: 'AAPL',
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
        actualPremium: 100,
        actualAnnualizedYield: 12,
        actualIlliquid: false,
        actualIv: null,
        actualUnderlying: null,
        closeDate: null,
        closeUnderlying: null,
        moneyness: null,
        percentFromStrike: null,
        bestPremiumKept: null,
        ownedLiveContracts: 0,
        ownedPaperContracts: 0,
        ...extra,
    };
}

function day(date: string, trades: Trade[]): DaySignals {
    return { name: 'Monday', date, hasData: true, trades };
}

describe('summarizeWeek', () => {
    it('counts every trade on every day it is given', () => {
        const summary = summarizeWeek([day('2025-08-11', [trade(), trade()]), day('2025-08-12', [trade()])], 'actual');
        expect(summary.signals).toBe(3);
    });

    it('scores the OTM count against the contracts that have a close, not the whole week', () => {
        const days = [
            day('2025-08-11', [trade({ moneyness: 'otm' }), trade({ moneyness: 'itm' }), trade()]),
            day('2025-08-12', [trade({ moneyness: 'otm' })]),
        ];
        const summary = summarizeWeek(days, 'actual');
        expect(summary.signals).toBe(4);
        expect(summary.priced).toBe(3);
        expect(summary.otm).toBe(2);
    });

    it('averages actual premium drift while the tickets show VADER', () => {
        const days = [
            day('2025-08-11', [
                trade({ premium: 100, actualPremium: 80 }),
                trade({ premium: 200, actualPremium: 120 }),
                trade({ premium: 100, actualPremium: null }),
            ]),
        ];
        const summary = summarizeWeek(days, 'quoted');
        expect(summary.driftSamples).toBe(2);
        expect(summary.premiumDrift).toBeCloseTo(-30);
    });

    it('has no drift to report when the tickets are showing actual numbers', () => {
        const summary = summarizeWeek([day('2025-08-11', [trade({ premium: 100, actualPremium: 80 })])], 'actual');
        expect(summary.premiumDrift).toBeNull();
        expect(summary.driftSamples).toBe(0);
    });

    it('totals the selected premium source and records actual-mode fallback', () => {
        const days = [
            day('2025-08-11', [
                trade({ premium: 100, actualPremium: 80 }),
                trade({ premium: 200, actualPremium: null }),
            ]),
        ];

        expect(summarizeWeek(days, 'actual')).toMatchObject({ totalPremium: 280, premiumUsesFallback: true });
        expect(summarizeWeek(days, 'quoted')).toMatchObject({ totalPremium: 300, premiumUsesFallback: false });
    });

    it('omits the premium total when no displayed trade has one', () => {
        const summary = summarizeWeek([day('2025-08-11', [trade({ premium: null, actualPremium: null })])], 'actual');

        expect(summary.totalPremium).toBeNull();
        expect(summary.premiumUsesFallback).toBe(false);
    });

    it('reports nothing at all for a week the filters emptied', () => {
        expect(summarizeWeek([day('2025-08-11', [])], 'actual')).toEqual({
            signals: 0,
            priced: 0,
            otm: 0,
            premiumDrift: null,
            driftSamples: 0,
            totalPremium: null,
            premiumUsesFallback: false,
            totalCollateral: null,
        });
    });

    it('totals the collateral required across the displayed week', () => {
        const summary = summarizeWeek(
            [day('2025-08-11', [trade({ collateral: 10000 })]), day('2025-08-12', [trade({ collateral: 2500 })])],
            'actual'
        );

        expect(summary.totalCollateral).toBe(12500);
    });
});

describe('premiumDriftPercent', () => {
    it('signs against VADER, so a worse market reads negative', () => {
        expect(premiumDriftPercent(90, 100)).toBeCloseTo(-10);
        expect(premiumDriftPercent(110, 100)).toBeCloseTo(10);
    });

    it('refuses to divide by an advertised premium of zero', () => {
        expect(premiumDriftPercent(50, 0)).toBeNull();
        expect(premiumDriftPercent(null, 100)).toBeNull();
        expect(premiumDriftPercent(50, null)).toBeNull();
    });
});

describe('totalCollateral', () => {
    it('adds up what the day would take to secure', () => {
        expect(totalCollateral([trade({ collateral: 10000 }), trade({ collateral: 2500 })])).toBe(12500);
    });

    it('skips the contracts with no figure rather than counting them as nothing', () => {
        expect(totalCollateral([trade({ collateral: 10000 }), trade({ collateral: null })])).toBe(10000);
    });

    it('has nothing to say when no contract carries a figure', () => {
        expect(totalCollateral([trade({ collateral: null })])).toBeNull();
        expect(totalCollateral([])).toBeNull();
    });
});
