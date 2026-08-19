import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UnauthorizedError, describeFailure, fetchCautionSymbols, saveCautionSymbols } from '../api';

/**
 * The global caution list, loaded once and shared.
 *
 * It is a global setting, so it lives on the server rather than in this browser:
 * a ticker flagged on the laptop is flagged on the phone. Both the live grid and
 * the calendar grid read it, so it is fetched here rather than by either page.
 *
 * A failed load is not fatal. The list decorates tickets; it does not gate them,
 * so a page that cannot get it simply shows no caution icons.
 */

interface CautionState {
    symbols: ReadonlySet<string>;
    /** Distinguishes "nothing is flagged" from "not fetched yet". */
    loaded: boolean;
    error: string | null;
    save(symbols: readonly string[]): Promise<void>;
}

const CautionContext = createContext<CautionState | null>(null);

const EMPTY: ReadonlySet<string> = new Set();

export function CautionProvider({ children }: { children: ReactNode }) {
    const [symbols, setSymbols] = useState<ReadonlySet<string>>(EMPTY);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCautionSymbols()
            .then((result) => {
                if (cancelled) return;
                setSymbols(new Set(result.symbols));
                setLoaded(true);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                // A revoked key is the whole app's problem, not this list's, and
                // ApiKeyProvider is already watching for it.
                if (!(cause instanceof UnauthorizedError)) setError(describeFailure(cause));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const save = useCallback(async (next: readonly string[]) => {
        // Seeded from the server's answer rather than what was sent, so the page
        // shows what was actually stored.
        const result = await saveCautionSymbols(next);
        setSymbols(new Set(result.symbols));
        setLoaded(true);
        setError(null);
    }, []);

    const value = useMemo<CautionState>(() => ({ symbols, loaded, error, save }), [symbols, loaded, error, save]);

    return <CautionContext.Provider value={value}>{children}</CautionContext.Provider>;
}

export function useCaution(): CautionState {
    const value = useContext(CautionContext);
    if (!value) throw new Error('useCaution must be used inside CautionProvider');
    return value;
}

/**
 * Just the set, for the grids. Returns an empty set outside the provider so a
 * ticket can be rendered in isolation by a test without one.
 */
export function useCautionSymbols(): ReadonlySet<string> {
    return useContext(CautionContext)?.symbols ?? EMPTY;
}
