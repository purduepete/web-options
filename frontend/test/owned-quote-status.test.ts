import { describe, expect, it } from 'vitest';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { quoteIssue, quoteSourceLabel } from '../src/owned/quoteStatus';

function position(midPrice: number | null, delta: number | null): OwnedOptionPosition {
    return {
        quote: {
            midPrice,
            bid: null,
            ask: null,
            delta,
        },
    } as OwnedOptionPosition;
}

describe('quoteIssue', () => {
    it.each([
        [1.25, -0.2, null],
        [null, -0.2, 'Price unavailable'],
        [1.25, null, 'Delta unavailable'],
        [null, null, 'Live quote unavailable'],
    ] as const)('classifies price %s and delta %s', (price, delta, expected) => {
        expect(quoteIssue(position(price, delta))).toBe(expected);
    });

    it('accepts a bid when the provider omits the mid', () => {
        const row = position(null, -0.2);
        row.quote.bid = 1.2;

        expect(quoteIssue(row)).toBeNull();
    });
});

describe('quoteSourceLabel', () => {
    it('labels a partial provider response as live when provenance says it is live', () => {
        const row = position(1.25, null);
        row.quote.quoteStatus = 'partial';
        row.quote.quoteSource = 'live';

        expect(quoteSourceLabel(row, false)).toBe('Live');
    });

    it('labels memory and stored quotes as cached', () => {
        const row = position(1.25, -0.2);
        row.quote.quoteStatus = 'ok';

        row.quote.quoteSource = 'memory_cache';
        expect(quoteSourceLabel(row, false)).toBe('Cached');

        row.quote.quoteSource = 'stored_daily';
        expect(quoteSourceLabel(row, false)).toBe('Cached');

        row.quote.quoteSource = 'unavailable';
        expect(quoteSourceLabel(row, false)).toBe('Cached');
    });

    it('treats a persisted payload as cached and supports older responses', () => {
        const row = position(1.25, -0.2);
        row.quote.quoteStatus = 'ok';

        expect(quoteSourceLabel(row, true)).toBe('Cached');
        expect(quoteSourceLabel(row, false)).toBe('Live');
    });
});
