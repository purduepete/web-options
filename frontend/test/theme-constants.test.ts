import { describe, expect, it } from 'vitest';
import {
    DEFAULT_HIGHLIGHT_COLOR,
    HIGHLIGHT_OPTIONS,
    hexToRgb,
    isDarkTheme,
    isThemePreference,
    resolveTheme,
} from '@weboptions/shared';

describe('resolveTheme', () => {
    it('passes an explicit preference through', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
        expect(resolveTheme('midnight', false)).toBe('midnight');
    });

    it('resolves system to midnight rather than dark, matching webportfolio', () => {
        expect(resolveTheme('system', true)).toBe('midnight');
        expect(resolveTheme('system', false)).toBe('light');
    });
});

describe('isDarkTheme', () => {
    it('treats midnight as dark', () => {
        expect(isDarkTheme('midnight')).toBe(true);
        expect(isDarkTheme('dark')).toBe(true);
        expect(isDarkTheme('light')).toBe(false);
    });
});

describe('isThemePreference', () => {
    it('rejects anything that is not one of the four', () => {
        expect(isThemePreference('midnight')).toBe(true);
        expect(isThemePreference('neon')).toBe(false);
        expect(isThemePreference(null)).toBe(false);
    });
});

describe('hexToRgb', () => {
    it('splits a six-digit hex colour', () => {
        expect(hexToRgb('#6b8cae')).toBe('107, 140, 174');
        expect(hexToRgb('6b8cae')).toBe('107, 140, 174');
    });

    it('rejects shorthand and garbage, which is what guards the stored value', () => {
        expect(hexToRgb('#fff')).toBeNull();
        expect(hexToRgb('red')).toBeNull();
        expect(hexToRgb('')).toBeNull();
    });
});

describe('highlight presets', () => {
    it('offers nine unique colours and includes the default', () => {
        const values = HIGHLIGHT_OPTIONS.map((option) => option.value);
        expect(values).toHaveLength(9);
        expect(new Set(values).size).toBe(9);
        expect(values).toContain(DEFAULT_HIGHLIGHT_COLOR);
    });

    it('gives every preset a parseable colour', () => {
        for (const option of HIGHLIGHT_OPTIONS) {
            expect(hexToRgb(option.value)).not.toBeNull();
        }
    });
});
