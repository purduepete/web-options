import type { ResolvedTheme } from '@weboptions/shared';
import { MoonIcon, MoonStarIcon, SunIcon } from '../components/icons';
import { useTheme } from '../theme/ThemeProvider';

const CYCLE: Record<ResolvedTheme, { icon: typeof SunIcon; label: string; next: ResolvedTheme }> = {
    light: { icon: SunIcon, label: 'Light', next: 'midnight' },
    dark: { icon: MoonIcon, label: 'Dark', next: 'light' },
    midnight: { icon: MoonStarIcon, label: 'Midnight', next: 'dark' },
};

/**
 * Cycles the theme from the bar, so the common change costs one click.
 *
 * `system` is deliberately not in the cycle: three clicks bring you back to
 * where you started, and nothing here depends on what the operating system is
 * doing. It stays on the appearance page, along with the highlight color.
 */
export function ThemeToggle() {
    const { theme, setPreference } = useTheme();
    const { icon: Icon, label, next } = CYCLE[theme];
    const description = `Theme: ${label}. Switch to ${CYCLE[next].label}.`;

    return (
        <button
            type="button"
            className="theme-toggle"
            aria-label={description}
            title={description}
            onClick={() => setPreference(next)}
        >
            <Icon />
        </button>
    );
}
