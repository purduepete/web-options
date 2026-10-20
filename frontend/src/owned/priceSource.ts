import type { Moneyness, OwnedOptionPosition, UnderlyingQuote } from '@weboptions/shared';

/**
 * Which of the two prices upstream sends for a contract the page is reading:
 * the daily row stored against it, or the quote pulled live. The choice is a
 * reading preference like the sort, so it lives in local storage rather than
 * the URL.
 */

export const PRICE_SOURCES = ['eod', 'live'] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

/** The stored price is the one that is always there and never moves under you. */
export const DEFAULT_PRICE_SOURCE: PriceSource = 'eod';

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
    eod: 'End of day',
    live: 'Live',
};

export const PRICE_SOURCE_DESCRIPTIONS: Record<PriceSource, string> = {
    eod: 'The daily price stored against the contract',
    live: 'The quote pulled when the page last refreshed',
};

const KEY = 'weboptions.owned-price-source.v1';

function isPriceSource(value: unknown): value is PriceSource {
    return PRICE_SOURCES.includes(value as PriceSource);
}

export function readPriceSource(): PriceSource {
    try {
        const raw = localStorage.getItem(KEY);
        return isPriceSource(raw) ? raw : DEFAULT_PRICE_SOURCE;
    } catch {
        return DEFAULT_PRICE_SOURCE;
    }
}

export function writePriceSource(source: PriceSource): void {
    try {
        localStorage.setItem(KEY, source);
    } catch {
        // A blocked or full store only costs the choice its life beyond the tab.
    }
}

/** Each source runs its own ladder: neither one borrows the other's number. */
function priceOf(position: OwnedOptionPosition, source: PriceSource): number | null {
    const { cachedPrice, quote } = position;
    return source === 'eod'
        ? (cachedPrice.closePrice ?? cachedPrice.mark ?? cachedPrice.mid)
        : (quote.midPrice ?? quote.bid ?? quote.ask);
}

function liveUnderlyingFields(
    position: OwnedOptionPosition,
    quote: UnderlyingQuote | undefined
): Pick<OwnedOptionPosition, 'underlyingPrice' | 'percentFromStrike' | 'moneyness'> | null {
    if (!quote || !Number.isFinite(quote.price) || position.strikePrice <= 0) return null;
    const distance = quote.price - position.strikePrice;
    let moneyness: Moneyness = 'atm';
    if (distance !== 0) {
        const isInTheMoney = position.putCall === 'P' ? distance < 0 : distance > 0;
        moneyness = isInTheMoney ? 'itm' : 'otm';
    }
    return {
        underlyingPrice: quote.price,
        percentFromStrike: (distance / position.strikePrice) * 100,
        moneyness,
    };
}

/**
 * Upstream blends the two sources and derives the cost, the P/L and the captured
 * share from whichever won. Reading one source alone means deriving those three
 * again here, with upstream's arithmetic, so the totals, the sort and the filters
 * all agree with the rows. The stored price answers as a quote so that everything
 * downstream reads the chosen source without being told which one it is.
 */
export function applyPriceSource(
    positions: readonly OwnedOptionPosition[],
    source: PriceSource,
    underlyings: Readonly<Record<string, UnderlyingQuote>> = {}
): OwnedOptionPosition[] {
    return positions.map((position) => {
        const price = priceOf(position, source);
        const cost = price === null ? null : price * position.contracts * 100;
        const captured = cost === null ? null : position.entryCredit - cost;
        const { cachedPrice, quote } = position;
        const underlying = source === 'live' ? liveUnderlyingFields(position, underlyings[position.symbol]) : null;
        return {
            ...position,
            ...underlying,
            estimatedBuybackCost: cost,
            unrealizedCreditCaptured: captured,
            unrealizedCreditCapturedPct:
                captured === null || position.entryCredit === 0 ? null : (captured / position.entryCredit) * 100,
            quote:
                source === 'live'
                    ? quote
                    : {
                          ...quote,
                          quoteStatus: price === null ? 'unpriced' : 'stored',
                          asOf: cachedPrice.priceDate,
                          delta: cachedPrice.delta,
                          midPrice: price,
                          bid: cachedPrice.bid,
                          ask: cachedPrice.ask,
                          lastPrice: cachedPrice.lastPrice,
                      },
        };
    });
}
