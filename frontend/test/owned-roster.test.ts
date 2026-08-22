import { describe, expect, it } from 'vitest';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { mergeRoster } from '../src/owned/roster';

function position(overrides: Partial<OwnedOptionPosition> = {}): OwnedOptionPosition {
    return {
        id: 1,
        symbol: 'PLTR',
        isPaper: false,
        estimatedBuybackCost: 90,
        unrealizedCreditCaptured: 160,
        unrealizedCreditCapturedPct: 64,
        underlyingPrice: 172.5,
        percentFromStrike: 13,
        moneyness: 'otm',
        cachedPrice: { mark: 0.9, mid: 0.9, bid: 0.85, ask: 0.95, lastPrice: 0.9, delta: -0.22 },
        quote: { quoteStatus: 'ok', asOf: '2026-08-21T14:00:00', delta: -0.21, midPrice: 0.9, bid: 0.85, ask: 0.95 },
        ...overrides,
    } as OwnedOptionPosition;
}

describe('mergeRoster', () => {
    it('keeps the numbers already on screen for a contract the roster repeats', () => {
        const priced = position({ id: 7, unrealizedCreditCaptured: 160 });
        const merged = mergeRoster([priced], [position({ id: 7, unrealizedCreditCaptured: 999 })]);

        expect(merged).toHaveLength(1);
        expect(merged[0]?.unrealizedCreditCaptured).toBe(160);
        expect(merged[0]?.quote.delta).toBe(-0.21);
    });

    it('brings a new contract in unpriced', () => {
        const merged = mergeRoster([position({ id: 7 })], [position({ id: 7 }), position({ id: 8, symbol: 'SOFI' })]);
        const arrival = merged.find((row) => row.symbol === 'SOFI');

        expect(arrival?.quote.midPrice).toBeNull();
        expect(arrival?.quote.delta).toBeNull();
        expect(arrival?.cachedPrice.mark).toBeNull();
        expect(arrival?.unrealizedCreditCaptured).toBeNull();
        expect(arrival?.unrealizedCreditCapturedPct).toBeNull();
        expect(arrival?.estimatedBuybackCost).toBeNull();
    });

    it('leaves the underlying on a new contract, since the quote is not where it came from', () => {
        const merged = mergeRoster([], [position({ id: 8 })]);

        expect(merged[0]?.underlyingPrice).toBe(172.5);
        expect(merged[0]?.percentFromStrike).toBe(13);
        expect(merged[0]?.moneyness).toBe('otm');
    });

    it('drops a contract the roster no longer lists', () => {
        const merged = mergeRoster([position({ id: 7 }), position({ id: 8 })], [position({ id: 8 })]);

        expect(merged.map((row) => row.id)).toEqual([8]);
    });

    it('tells the paper book from the live one, since an id is only unique within each', () => {
        const merged = mergeRoster(
            [position({ id: 7, isPaper: false, unrealizedCreditCaptured: 160 })],
            [position({ id: 7, isPaper: true, unrealizedCreditCaptured: 999 })],
        );

        expect(merged[0]?.unrealizedCreditCaptured).toBeNull();
    });
});
