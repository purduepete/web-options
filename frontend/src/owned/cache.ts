import type { OwnedOptionPosition, OwnedOptionsResponse, UnderlyingQuote } from '@weboptions/shared';
import { isRemembered } from '../auth/keyStore';
import type { SignalMap, SignalMatch } from './types';

/**
 * The owned-contracts payload, kept so returning to the page paints on the first
 * frame instead of waiting on a live repricing of every contract.
 *
 * The payload is plaintext on disk, so it follows the API key's own remember-me
 * choice: it can never outlive the credential that fetched it. Bumping the v1
 * suffix invalidates every reader when the shape changes.
 */
const KEY = 'weboptions.owned-contracts.v1';

export interface CachedOwnedContracts {
    response: OwnedOptionsResponse;
    signals: Map<string, SignalMatch>;
}

function read(): string | null {
    try {
        return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    } catch {
        return null;
    }
}

export function readOwnedCache(): CachedOwnedContracts | null {
    const raw = read();
    if (raw === null) return null;

    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;

        const { positions, underlyings, generatedAt, signals } = parsed as Partial<{
            positions: OwnedOptionPosition[];
            underlyings: Record<string, UnderlyingQuote>;
            generatedAt: string;
            signals: [string, SignalMatch][];
        }>;
        if (!Array.isArray(positions)) return null;

        return {
            response: {
                positions,
                // An older entry can predate a field, so every one but positions has a floor.
                underlyings: typeof underlyings === 'object' && underlyings !== null ? underlyings : {},
                generatedAt: typeof generatedAt === 'string' ? generatedAt : '',
            },
            signals: new Map(Array.isArray(signals) ? signals : []),
        };
    } catch {
        return null;
    }
}

export function writeOwnedCache(response: OwnedOptionsResponse, signals: SignalMap): void {
    try {
        const store = isRemembered() ? localStorage : sessionStorage;
        store.setItem(KEY, JSON.stringify({ ...response, signals: Array.from(signals.entries()) }));
    } catch {
        // A blocked or full store only costs the next visit its head start.
    }
}

export function clearOwnedCache(): void {
    try {
        sessionStorage.removeItem(KEY);
        localStorage.removeItem(KEY);
    } catch {
        // Nothing to clear if the store cannot be reached.
    }
}
