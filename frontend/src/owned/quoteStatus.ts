import type { OwnedOptionPosition } from '@weboptions/shared';

export type QuoteIssue = 'Price unavailable' | 'Delta unavailable' | 'Live quote unavailable';
export type QuoteSourceLabel = 'Live' | 'Cached';

export function quoteSourceLabel(position: OwnedOptionPosition, fromCache: boolean): QuoteSourceLabel {
    if (fromCache) return 'Cached';
    if (position.quote.quoteSource !== undefined) {
        return position.quote.quoteSource === 'live' ? 'Live' : 'Cached';
    }
    return position.quote.quoteStatus === 'ok' ? 'Live' : 'Cached';
}

export function quoteIssue(position: OwnedOptionPosition): QuoteIssue | null {
    const { quote } = position;
    const hasPrice = quote.midPrice !== null || quote.bid !== null || quote.ask !== null;
    const hasDelta = quote.delta !== null;
    if (hasPrice && hasDelta) return null;
    if (!hasPrice && hasDelta) return 'Price unavailable';
    if (hasPrice) return 'Delta unavailable';
    return 'Live quote unavailable';
}
