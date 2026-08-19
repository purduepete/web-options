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
        closeDate: null,
        closeUnderlying: null,
        moneyness: null,
        percentFromStrike: null,
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

    it('averages the premium drift over the contracts that were quoted', () => {
        const days = [
            day('2025-08-11', [
                trade({ premium: 100, actualPremium: 80 }),
                trade({ premium: 200, actualPremium: 120 }),
                trade({ premium: 100, actualPremium: null }),
            ]),
        ];
        const summary = summarizeWeek(days, 'actual');
        expect(summary.driftSamples).toBe(2);
        expect(summary.premiumDrift).toBeCloseTo(-30);
    });

    it("has no drift to report when the tickets are showing VADER's own numbers", () => {
        const summary = summarizeWeek([day('2025-08-11', [trade({ premium: 100, actualPremium: 80 })])], 'quoted');
        expect(summary.premiumDrift).toBeNull();
        expect(summary.driftSamples).toBe(0);
    });

    it('reports nothing at all for a week the filters emptied', () => {
        expect(summarizeWeek([day('2025-08-11', [])], 'actual')).toEqual({
            signals: 0,
            priced: 0,
            otm: 0,
            premiumDrift: null,
            driftSamples: 0,
        });
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
