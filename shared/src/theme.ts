/**
 * Theme vocabulary, shared so the FOUC bootstrap, the provider and the settings
 * page cannot drift apart. Ported from webportfolio: same theme names, same
 * storage keys, same highlight presets.
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark', 'midnight'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually lands on <html>. 'system' resolves to one of these. */
export const RESOLVED_THEMES = ['light', 'dark', 'midnight'] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'midnight';

export const STORAGE_KEYS = {
    themePreference: 'config_theme_preference',
    highlightColor: 'config_highlight_color',
    apiKey: 'weboptions_api_key',
} as const;

export interface HighlightOption {
    name: string;
    value: string;
    /** Which theme family the colour was picked to sit against. */
    suits: 'light' | 'dark';
}

export const HIGHLIGHT_OPTIONS: readonly HighlightOption[] = [
    { name: 'Deep Green', value: '#14532d', suits: 'light' },
    { name: 'Midnight Blue', value: '#2f477b', suits: 'light' },
    { name: 'Deep Slate', value: '#334155', suits: 'light' },
    { name: 'Steel Blue', value: '#6b8cae', suits: 'dark' },
    { name: 'Sage Green', value: '#6ba387', suits: 'dark' },
    { name: 'Silver Mist', value: '#c8cccc', suits: 'dark' },
    { name: 'Slate Gray', value: '#64748b', suits: 'dark' },
    { name: 'Fawn', value: '#b08968', suits: 'dark' },
    { name: 'Dusty Purple', value: '#8082c3', suits: 'dark' },
];

export const DEFAULT_HIGHLIGHT_COLOR = '#6b8cae';

export const THEME_DEFAULT_HIGHLIGHT: Record<ResolvedTheme, string> = {
    light: '#2f477b',
    dark: '#6b8cae',
    midnight: '#6b8cae',
};

/**
 * Page background per theme, mirrored from --bg in index.css. Mobile browsers
 * paint their chrome with this via <meta name="theme-color">, so it has to be a
 * literal value rather than a CSS variable reference.
 */
export const THEME_BACKGROUNDS: Record<ResolvedTheme, string> = {
    light: '#ffffff',
    dark: '#111827',
    midnight: '#020617',
};

export function isThemePreference(value: unknown): value is ThemePreference {
    return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
    return typeof value === 'string' && (RESOLVED_THEMES as readonly string[]).includes(value);
}

/** The dark end of 'system' is midnight, matching webportfolio. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
    if (preference === 'system') return prefersDark ? 'midnight' : 'light';
    return preference;
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
    return theme !== 'light';
}

export function hexToRgb(hex: string): string | null {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const value = Number.parseInt(match[1]!, 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
