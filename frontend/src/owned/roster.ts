import type { OwnedOptionPosition } from '@weboptions/shared';

/** The same identity the list keys its rows by: an id is only unique per book. */
function key(position: OwnedOptionPosition): string {
    return `${position.isPaper ? 'paper' : 'live'}-${position.id}`;
}

/**
 * A contract nobody has asked to price. Every figure a quote produces is cleared,
 * so the row reads as an em dash rather than showing a number the reader did not
 * request. The underlying is left alone: it is the stock's price, not the
 * contract's, and the signal feed carries it anyway.
 */
function unpriced(position: OwnedOptionPosition): OwnedOptionPosition {
    return {
        ...position,
        estimatedBuybackCost: null,
        unrealizedCreditCaptured: null,
        unrealizedCreditCapturedPct: null,
        cachedPrice: {
            ...position.cachedPrice,
            mark: null,
            mid: null,
            bid: null,
            ask: null,
            lastPrice: null,
            delta: null,
        },
        quote: {
            ...position.quote,
            quoteStatus: 'unpriced',
            asOf: null,
            delta: null,
            midPrice: null,
            bid: null,
            ask: null,
            lastPrice: null,
        },
    };
}

/**
 * Which contracts are open comes from the roster; what each one is worth is kept
 * from what the reader is already looking at. A contract that has appeared since
 * arrives blank, and one that has closed leaves.
 */
export function mergeRoster(
    priced: readonly OwnedOptionPosition[],
    roster: readonly OwnedOptionPosition[],
): OwnedOptionPosition[] {
    const known = new Map(priced.map((position) => [key(position), position]));
    return roster.map((position) => known.get(key(position)) ?? unpriced(position));
}
