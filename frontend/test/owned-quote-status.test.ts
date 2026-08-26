import { describe, expect, it } from 'vitest';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { quoteIssue } from '../src/owned/quoteStatus';

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
