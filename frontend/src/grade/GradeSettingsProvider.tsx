import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GRADE_DEFAULTS, type GradeSettings } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchGradeSettings, saveGradeSettings } from '../api';

/**
 * The four grading thresholds, loaded once and shared, for the same reason the
 * caution list is: they are a setting about the reader, not about this browser.
 *
 * A failed load is not fatal. Grading is a badge on a card, so a page that cannot
 * fetch the thresholds falls back to the defaults and grades anyway.
 */

interface GradeSettingsState {
    settings: GradeSettings;
    loaded: boolean;
    error: string | null;
    save(settings: GradeSettings): Promise<void>;
}

const GradeSettingsContext = createContext<GradeSettingsState | null>(null);

export function GradeSettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<GradeSettings>(GRADE_DEFAULTS);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchGradeSettings()
            .then((result) => {
                if (cancelled) return;
                setSettings(result.settings);
                setLoaded(true);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                // A revoked key is the whole app's problem, and ApiKeyProvider
                // is already watching for it.
                if (!(cause instanceof UnauthorizedError)) setError(describeFailure(cause));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const save = useCallback(async (next: GradeSettings) => {
        // Seeded from the server's answer rather than what was sent.
        const result = await saveGradeSettings(next);
        setSettings(result.settings);
        setLoaded(true);
        setError(null);
    }, []);

    const value = useMemo<GradeSettingsState>(
        () => ({ settings, loaded, error, save }),
        [settings, loaded, error, save],
    );

    return <GradeSettingsContext.Provider value={value}>{children}</GradeSettingsContext.Provider>;
}

export function useGradeSettingsState(): GradeSettingsState {
    const value = useContext(GradeSettingsContext);
    if (!value) throw new Error('useGradeSettingsState must be used inside GradeSettingsProvider');
    return value;
}

/**
 * Just the thresholds. Returns the defaults outside the provider so a badge can
 * be rendered in isolation by a test without one.
 */
export function useGradeSettings(): GradeSettings {
    return useContext(GradeSettingsContext)?.settings ?? GRADE_DEFAULTS;
}
