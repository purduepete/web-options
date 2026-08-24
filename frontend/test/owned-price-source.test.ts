import { beforeEach, describe, expect, it } from 'vitest';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { DEFAULT_PRICE_SOURCE, applyPriceSource, readPriceSource, writePriceSource } from '../src/owned/priceSource';

function position(overrides: Partial<OwnedOptionPosition> = {}): OwnedOptionPosition {
    return {
        id: 1,
        symbol: 'PLTR',
        isPaper: false,
        contracts: 2,
        entryCredit: 400,
        optionPrice: 2,
        estimatedBuybackCost: 287,
        unrealizedCreditCaptured: 113,
        unrealizedCreditCapturedPct: 28.25,
        cachedPrice: {
            mark: 1,
            mid: 1,
            bid: 0.9,
            ask: 1.1,
            lastPrice: 1.05,
            closePrice: null,
            prevClose: 1.2,
            delta: -0.3,
            priceDate: '2026-08-21',
        },
        quote: {
            quoteStatus: 'ok',
            asOf: '2026-08-21T14:00:00',
            delta: -0.21,
            midPrice: 1.5,
            bid: 1.4,
            ask: 1.6,
            lastPrice: 1.45,
        },
        ...overrides,
    } as OwnedOptionPosition;
}

describe('applyPriceSource', () => {
    it('reads the stored daily price, and derives the figures from it', () => {
        const [row] = applyPriceSource([position()], 'eod');

        expect(row?.quote.midPrice).toBe(1);
        expect(row?.quote.delta).toBe(-0.3);
        expect(row?.quote.asOf).toBe('2026-08-21');
        expect(row?.estimatedBuybackCost).toBe(200);
        expect(row?.unrealizedCreditCaptured).toBe(200);
        expect(row?.unrealizedCreditCapturedPct).toBe(50);
    });

    it('reads the live quote, and derives the figures from it', () => {
        const [row] = applyPriceSource([position()], 'live');

        expect(row?.quote.midPrice).toBe(1.5);
        expect(row?.quote.delta).toBe(-0.21);
        expect(row?.estimatedBuybackCost).toBe(300);
        expect(row?.unrealizedCreditCaptured).toBe(100);
        expect(row?.unrealizedCreditCapturedPct).toBe(25);
    });

    it('derives cushion and moneyness from the current underlying in live mode', () => {
        const [row] = applyPriceSource(
            [
                position({
                    symbol: 'UAL',
                    putCall: 'P',
                    strikePrice: 120,
                    underlyingPrice: null,
                    percentFromStrike: null,
                    moneyness: null,
                }),
            ],
            'live',
            { UAL: { price: 114.18, changePct: 0.9 } },
        );

        expect(row?.underlyingPrice).toBe(114.18);
        expect(row?.percentFromStrike).toBeCloseTo(-4.85);
        expect(row?.moneyness).toBe('itm');
    });

    it('keeps stored underlying fields when a live underlying quote is unavailable', () => {
        const [row] = applyPriceSource(
            [position({ underlyingPrice: 172.5, percentFromStrike: 15, moneyness: 'otm' })],
            'live',
        );

        expect(row?.underlyingPrice).toBe(172.5);
        expect(row?.percentFromStrike).toBe(15);
        expect(row?.moneyness).toBe('otm');
    });

    it('prefers a real close over the stored mark', () => {
        const [row] = applyPriceSource(
            [position({ cachedPrice: { ...position().cachedPrice, closePrice: 0.8 } })],
            'eod',
        );

        expect(row?.quote.midPrice).toBe(0.8);
        expect(row?.estimatedBuybackCost).toBe(160);
    });

    it('leaves a contract with no stored price blank rather than borrowing the live quote', () => {
        const bare = position({
            cachedPrice: { ...position().cachedPrice, mark: null, mid: null, bid: null, ask: null, delta: null },
        });
        const [row] = applyPriceSource([bare], 'eod');

        expect(row?.quote.midPrice).toBeNull();
        expect(row?.quote.delta).toBeNull();
        expect(row?.quote.quoteStatus).toBe('unpriced');
        expect(row?.estimatedBuybackCost).toBeNull();
        expect(row?.unrealizedCreditCaptured).toBeNull();
        expect(row?.unrealizedCreditCapturedPct).toBeNull();
    });

    it('leaves a contract with no live quote blank rather than borrowing the stored price', () => {
        const bare = position({
            quote: { ...position().quote, midPrice: null, bid: null, ask: null, delta: null },
        });
        const [row] = applyPriceSource([bare], 'live');

        expect(row?.quote.midPrice).toBeNull();
        expect(row?.estimatedBuybackCost).toBeNull();
        expect(row?.unrealizedCreditCapturedPct).toBeNull();
    });

    it('falls down the stored ladder to the mid when there is no mark', () => {
        const [row] = applyPriceSource([position({ cachedPrice: { ...position().cachedPrice, mark: null } })], 'eod');

        expect(row?.quote.midPrice).toBe(1);
    });

    it('leaves the underlying alone, since neither source is where it comes from', () => {
        const rows = applyPriceSource([position({ underlyingPrice: 172.5, moneyness: 'otm' })], 'eod');

        expect(rows[0]?.underlyingPrice).toBe(172.5);
        expect(rows[0]?.moneyness).toBe('otm');
    });
});

describe('the stored choice', () => {
    beforeEach(() => localStorage.clear());

    it('opens on the stored price', () => {
        expect(readPriceSource()).toBe('eod');
        expect(DEFAULT_PRICE_SOURCE).toBe('eod');
    });

    it('outlives the tab once it has been made', () => {
        writePriceSource('live');
        expect(readPriceSource()).toBe('live');
    });

    it('ignores a value it does not recognise', () => {
        localStorage.setItem('weboptions.owned-price-source.v1', 'intraday');
        expect(readPriceSource()).toBe('eod');
    });
});
