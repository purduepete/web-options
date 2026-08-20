import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { VixQuote } from '@weboptions/shared';
import { fetchVix } from '../api';

/**
 * The last VIX close, fetched once and shared, because two very different things
 * need the same figure: the chip on the bar, and every grade on the board.
 *
 * A failed fetch leaves it null, and a null VIX simply drops that one criterion.
 * Grading a whole week yellow because a lookup failed would be worse than silence.
 */

const VixContext = createContext<VixQuote | null>(null);

export function VixProvider({ children }: { children: ReactNode }) {
    const [vix, setVix] = useState<VixQuote | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchVix()
            .then((response) => {
                if (!cancelled) setVix(response.vix);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    return <VixContext.Provider value={vix}>{children}</VixContext.Provider>;
}

/** Null outside the provider too, so a card can be rendered by a test without one. */
export function useVix(): VixQuote | null {
    return useContext(VixContext);
}

/** Just the number, which is all `gradeTrade` wants. */
export function useVixValue(): number | null {
    return useVix()?.value ?? null;
}
