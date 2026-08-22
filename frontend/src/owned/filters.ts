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

export interface OwnedFilterState {
    symbol: string;
    moneyness: MoneynessFilter;
}

/**
 * Narrows the rows client-side. Atm and unknown moneyness drop out whenever a
 * moneyness is asked for, mirroring `filterDaysByMoneyness`.
 */
export function filterOwnedPositions(
    positions: readonly OwnedOptionPosition[],
    signals: SignalMap,
    { symbol, moneyness }: OwnedFilterState,
): OwnedOptionPosition[] {
    const matchesSymbol = symbolMatcher(symbol);
    return positions.filter((position) => {
        if (!matchesSymbol(position.symbol)) return false;
        if (moneyness === 'all') return true;
        return ownedMoneyness(position, signalFor(signals, position)) === moneyness;
    });
}
