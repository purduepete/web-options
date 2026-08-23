import type { ExpiryFilter, NumberSource } from './index';

export const MONEYNESS_FILTERS = ['all', 'itm', 'otm'] as const;
export type MoneynessFilter = (typeof MONEYNESS_FILTERS)[number];

export const HALF_FILTERS = ['all', 'yes', 'no'] as const;
export type HalfFilter = (typeof HALF_FILTERS)[number];

export const OWNED_FILTERS = ['all', 'owned'] as const;
export type OwnedFilter = (typeof OWNED_FILTERS)[number];

export interface SummaryFilters {
    symbols: string[];
    expiry: ExpiryFilter;
    moneyness: MoneynessFilter;
    half: HalfFilter;
    owned: OwnedFilter;
    numberSource: NumberSource;
}

export function parseMoneynessFilter(raw: unknown): MoneynessFilter {
    return (MONEYNESS_FILTERS as readonly unknown[]).includes(raw) ? (raw as MoneynessFilter) : 'all';
}

export function parseHalfFilter(raw: unknown): HalfFilter {
    return (HALF_FILTERS as readonly unknown[]).includes(raw) ? (raw as HalfFilter) : 'all';
}

export function parseOwnedFilter(raw: unknown): OwnedFilter {
    return (OWNED_FILTERS as readonly unknown[]).includes(raw) ? (raw as OwnedFilter) : 'all';
}

export function parseNumberSource(raw: unknown): NumberSource {
    return raw === 'quoted' ? 'quoted' : 'actual';
}
