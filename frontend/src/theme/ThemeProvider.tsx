import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    DEFAULT_HIGHLIGHT_COLOR,
    DEFAULT_THEME_PREFERENCE,
    STORAGE_KEYS,
    THEME_BACKGROUNDS,
    THEME_DEFAULT_HIGHLIGHT,
    hexToRgb,
    isDarkTheme,
    isThemePreference,
    resolveTheme,
    type ResolvedTheme,
    type ThemePreference,
} from '@weboptions/shared';

interface ThemeValue {
    preference: ThemePreference;
    /** What is actually on <html> right now; 'system' has already been resolved. */
    theme: ResolvedTheme;
    highlightColor: string;
    setPreference: (preference: ThemePreference) => void;
    setHighlightColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.themePreference)?.replace(/^"|"$/g, '');
        return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

function readHighlight(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.highlightColor)?.replace(/^"|"$/g, '');
        return stored && hexToRgb(stored) ? stored : THEME_DEFAULT_HIGHLIGHT[resolveTheme(readPreference(), prefersDark())];
    } catch {
        return DEFAULT_HIGHLIGHT_COLOR;
    }
}

function prefersDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
    const [highlightColor, setHighlightState] = useState<string>(readHighlight);
    const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

    // Only matters while the preference is 'system', but the listener is cheap
    // and unsubscribing on every preference change is not.
    useEffect(() => {
        const query = window.matchMedia(DARK_QUERY);
        const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    const theme = resolveTheme(preference, systemDark);
    const previousTheme = useRef(theme);

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);
        root.classList.remove('light', 'dark', 'theme-midnight');
        root.classList.add(...(theme === 'light' ? ['light'] : theme === 'midnight' ? ['dark', 'theme-midnight'] : ['dark']));
        root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
        root.style.backgroundColor = THEME_BACKGROUNDS[theme];
        root.style.setProperty('--highlight', highlightColor);
        root.style.setProperty('--highlight-rgb', hexToRgb(highlightColor) ?? '107, 140, 174');
        root.style.setProperty('--highlight-contrast', isDarkTheme(theme) ? '#0f172a' : '#f8fafc');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BACKGROUNDS[theme]);
    }, [theme, highlightColor]);

    useEffect(() => {
        if (previousTheme.current === theme) return;
        previousTheme.current = theme;
        const color = THEME_DEFAULT_HIGHLIGHT[theme];
        setHighlightState(color);
        try { localStorage.setItem(STORAGE_KEYS.highlightColor, color); } catch { /* This tab still updates. */ }
    }, [theme]);

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        try {
            localStorage.setItem(STORAGE_KEYS.themePreference, next);
        } catch {
            // Storage blocked: the choice still applies for this session.
        }
    }, []);

    const setHighlightColor = useCallback((color: string) => {
        if (!hexToRgb(color)) return;
        setHighlightState(color);
        try {
            localStorage.setItem(STORAGE_KEYS.highlightColor, color);
        } catch {
            // As above.
        }
    }, []);

    const value = useMemo<ThemeValue>(
        () => ({ preference, theme, highlightColor, setPreference, setHighlightColor }),
        [preference, theme, highlightColor, setPreference, setHighlightColor],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
    const value = useContext(ThemeContext);
    if (!value) throw new Error('useTheme must be used inside a ThemeProvider');
    return value;
}
