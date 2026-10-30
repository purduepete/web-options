import { HIGHLIGHT_OPTIONS, THEME_PREFERENCES, type ThemePreference } from '@weboptions/shared';
import { CheckIcon, MonitorIcon, MoonIcon, MoonStarIcon, SunIcon } from '../components/icons';
import { useTheme } from './ThemeProvider';
import './ThemeControls.css';

const ICONS: Record<ThemePreference, typeof SunIcon> = {
    system: MonitorIcon,
    light: SunIcon,
    dark: MoonIcon,
    midnight: MoonStarIcon,
};

const LABELS: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    midnight: 'Midnight',
};

export function ThemeControls() {
    const { preference, theme, highlightColor, setPreference, setHighlightColor } = useTheme();

    return (
        <div className="theme-controls">
            <fieldset className="theme-group">
                <legend>Theme</legend>
                <div className="theme-options" role="radiogroup" aria-label="Theme">
                    {THEME_PREFERENCES.map((option) => {
                        const Icon = ICONS[option];
                        const selected = preference === option;
                        return (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={selected ? 'theme-option selected' : 'theme-option'}
                                onClick={() => setPreference(option)}
                            >
                                <Icon />
                                <span>{LABELS[option]}</span>
                            </button>
                        );
                    })}
                </div>
                {preference === 'system' && <p className="muted note">Following the system, currently {theme}.</p>}
            </fieldset>

            <fieldset className="theme-group">
                <legend>Highlight color</legend>
                <div className="swatches" role="radiogroup" aria-label="Highlight color">
                    {HIGHLIGHT_OPTIONS.map((option) => {
                        const selected = highlightColor.toLowerCase() === option.value.toLowerCase();
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={option.name}
                                data-tip={`${option.name} (suits ${option.suits} themes)`}
                                className={selected ? 'swatch selected' : 'swatch'}
                                style={{ background: option.value }}
                                onClick={() => setHighlightColor(option.value)}
                            >
                                {selected && <CheckIcon width={14} height={14} />}
                            </button>
                        );
                    })}
                </div>
            </fieldset>
        </div>
    );
}
