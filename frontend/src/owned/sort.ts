import type { OwnedOptionPosition } from '@weboptions/shared';
import { annualizedReturn, strikeCushion } from './filters';
import { signalFor, type SignalMap, type SignalMatch } from './types';

/**
 * The order the rows come back in. The upstream API promises none, so the page
 * picks one and keeps it: the choice outlives the tab, in local storage, while
 * the filters stay in the URL where they can be shared.
 */

export const OWNED_SORTS = [
    'expiration',
    'symbol',
    'opened',
    'captured',
    'pl',
    'cushion',
    'delta',
    'annualized',
    'credit',
] as const;

export type OwnedSort = (typeof OWNED_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface OwnedSortState {
    key: OwnedSort;
    direction: SortDirection;
}

/** Soonest to expire first: the contracts with the least time left read first. */
export const DEFAULT_OWNED_SORT: OwnedSortState = { key: 'expiration', direction: 'asc' };

export const OWNED_SORT_LABELS: Record<OwnedSort, string> = {
    expiration: 'Expiration',
    symbol: 'Symbol',
    opened: 'Opened',
    captured: 'Captured',
    pl: 'Open P/L',
    cushion: 'Cushion',
    delta: 'Delta',
    annualized: 'Annualized',
    credit: 'Entry credit',
};

export const OWNED_SORT_DESCRIPTIONS: Record<OwnedSort, string> = {
    expiration: 'When the contract runs out',
    symbol: 'The underlying, alphabetically',
    opened: 'The day the position was taken',
    captured: 'Share of the entry credit earned',
    pl: 'The open gain or loss, in dollars',
    cushion: 'How far the underlying sits from the strike',
    delta: 'Assignment risk, on magnitude',
    annualized: 'The entry credit as a yearly rate',
    credit: 'What the contract was sold for',
};

type SortValue = string | number | null;

const VALUES: Record<OwnedSort, (position: OwnedOptionPosition, signal: SignalMatch | undefined) => SortValue> = {
    expiration: (position) => position.expirationDate,
    symbol: (position) => position.symbol,
    opened: (position) => position.transactionDate,
    captured: (position) => position.unrealizedCreditCapturedPct,
    pl: (position) => position.unrealizedCreditCaptured,
    cushion: (position, signal) => strikeCushion(position, signal),
    // On magnitude, so a call sorts alongside the put that carries the same risk.
    delta: (position) => {
        const delta = position.quote.delta ?? position.delta;
        return delta === null || !Number.isFinite(delta) ? null : Math.abs(delta);
    },
    annualized: (position) => annualizedReturn(position),
    credit: (position) => position.entryCredit,
};

export function readSortDirection(value: unknown): SortDirection {
    return value === 'asc' || value === 'desc' ? value : DEFAULT_OWNED_SORT.direction;
}

export function readOwnedSortKey(value: unknown): OwnedSort {
    return OWNED_SORTS.includes(value as OwnedSort) ? (value as OwnedSort) : DEFAULT_OWNED_SORT.key;
}

/**
 * Orders the rows client-side. A row with nothing to compare sits at the bottom
 * whichever way round it is, rather than leading the list on a missing figure.
 */
export function sortOwnedPositions(
    positions: readonly OwnedOptionPosition[],
    signals: SignalMap,
    { key, direction }: OwnedSortState
): OwnedOptionPosition[] {
    const read = VALUES[key];
    const sign = direction === 'asc' ? 1 : -1;
    return [...positions].sort((left, right) => {
        const a = read(left, signalFor(signals, left));
        const b = read(right, signalFor(signals, right));
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
        if (typeof a === 'string' || typeof b === 'string') return sign * String(a).localeCompare(String(b));
        return sign * (a - b);
    });
}

/** Bumping the v1 suffix drops every stored choice when the shape changes. */
const KEY = 'weboptions.owned-sort.v1';

export function readOwnedSort(): OwnedSortState {
    let raw: string | null;
    try {
        raw = localStorage.getItem(KEY);
    } catch {
        return DEFAULT_OWNED_SORT;
    }
    if (raw === null) return DEFAULT_OWNED_SORT;

    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return DEFAULT_OWNED_SORT;
        const { key, direction } = parsed as Partial<OwnedSortState>;
        return { key: readOwnedSortKey(key), direction: readSortDirection(direction) };
    } catch {
        return DEFAULT_OWNED_SORT;
    }
}

export function writeOwnedSort(state: OwnedSortState): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
        // A blocked or full store only costs the choice its life beyond the tab.
    }
}
