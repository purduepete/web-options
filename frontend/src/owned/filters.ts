import type { Moneyness, OwnedOptionPosition } from '@weboptions/shared';
import { symbolMatcher, type MoneynessFilter } from '../signals/grouping';
import { signalFor, type SignalMap, type SignalMatch } from './types';

/** Where the delta stops being comfortable, and where it stops being tolerable. */
export const DELTA_WARN = 0.4;
export const DELTA_DANGER = 0.6;

/**
 * The band a delta falls in, on its magnitude, so a call reads the same as a put.
 * A contract with no quoted delta gets no tone rather than a flattering one.
 */
export function deltaBand(delta: number | null): 'good' | 'warn' | 'bad' | null {
    if (delta === null || !Number.isFinite(delta)) return null;
    const magnitude = Math.abs(delta);
    if (magnitude < DELTA_WARN) return 'good';
    if (magnitude <= DELTA_DANGER) return 'warn';
    return 'bad';
}

/** The position's own moneyness, falling back to the signal it was opened from. */
export function ownedMoneyness(position: OwnedOptionPosition, signal: SignalMatch | undefined): Moneyness | null {
    return position.moneyness ?? signal?.trade.moneyness ?? null;
}

/** How far the underlying still sits from the strike, on the same fallback. */
export function strikeCushion(position: OwnedOptionPosition, signal: SignalMatch | undefined): number | null {
    return position.percentFromStrike ?? signal?.trade.percentFromStrike ?? null;
}

export const CAPTURED_FILTERS = ['all', 'positive', 'quarter', 'half', 'most'] as const;

export type CapturedFilter = (typeof CAPTURED_FILTERS)[number];

/** The floor each choice keeps, as a percentage of the entry credit. */
const CAPTURED_FLOORS: Record<CapturedFilter, number | null> = {
    all: null,
    positive: 0,
    quarter: 25,
    half: 50,
    most: 75,
};

export function readCapturedFilter(value: string | null): CapturedFilter {
    return CAPTURED_FILTERS.includes(value as CapturedFilter) ? (value as CapturedFilter) : 'all';
}

/** Shared by the menu and by the pill that reports the choice back. */
export const CAPTURED_LABELS: Record<CapturedFilter, string> = {
    all: 'All',
    positive: '0%+',
    quarter: '25%+',
    half: '50%+',
    most: '75%+',
};

export interface OwnedFilterState {
    symbol: string;
    moneyness: MoneynessFilter;
    captured?: CapturedFilter;
}

/**
 * Narrows the rows client-side. Atm and unknown moneyness drop out whenever a
 * moneyness is asked for, mirroring `filterDaysByMoneyness`, and a row with no
 * captured figure drops out of every floor rather than passing the lowest one.
 */
export function filterOwnedPositions(
    positions: readonly OwnedOptionPosition[],
    signals: SignalMap,
    { symbol, moneyness, captured = 'all' }: OwnedFilterState,
): OwnedOptionPosition[] {
    const matchesSymbol = symbolMatcher(symbol);
    const floor = CAPTURED_FLOORS[captured];
    return positions.filter((position) => {
        if (!matchesSymbol(position.symbol)) return false;
        if (floor !== null) {
            const percent = position.unrealizedCreditCapturedPct;
            if (percent === null || percent < floor) return false;
        }
        if (moneyness === 'all') return true;
        return ownedMoneyness(position, signalFor(signals, position)) === moneyness;
    });
}
