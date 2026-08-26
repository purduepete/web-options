import type { OwnedOptionPosition } from '@weboptions/shared';

export type QuoteIssue = 'Price unavailable' | 'Delta unavailable' | 'Live quote unavailable';

export function quoteIssue(position: OwnedOptionPosition): QuoteIssue | null {
    const { quote } = position;
    const hasPrice = quote.midPrice !== null || quote.bid !== null || quote.ask !== null;
    const hasDelta = quote.delta !== null;
    if (hasPrice && hasDelta) return null;
    if (!hasPrice && hasDelta) return 'Price unavailable';
    if (hasPrice) return 'Delta unavailable';
    return 'Live quote unavailable';
}
