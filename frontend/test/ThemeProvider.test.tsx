import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEYS } from '@weboptions/shared';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ThemeControls } from '../src/theme/ThemeControls';

function renderControls() {
    return render(
        <ThemeProvider>
            <ThemeControls />
        </ThemeProvider>,
    );
}

const root = () => document.documentElement;

describe('ThemeProvider', () => {
    it('starts on midnight when nothing is stored', () => {
        renderControls();
        expect(root().getAttribute('data-theme')).toBe('midnight');
    });

    it('restores a stored preference', () => {
        localStorage.setItem(STORAGE_KEYS.themePreference, 'light');
        renderControls();
        expect(root().getAttribute('data-theme')).toBe('light');
    });

    it('ignores a stored preference that is not a real theme', () => {
        localStorage.setItem(STORAGE_KEYS.themePreference, 'neon');
        renderControls();
        expect(root().getAttribute('data-theme')).toBe('midnight');
    });

    it('applies and persists a theme choice', async () => {
        const user = userEvent.setup();
        renderControls();

        await user.click(screen.getByRole('radio', { name: 'Light' }));

        expect(root().getAttribute('data-theme')).toBe('light');
        expect(localStorage.getItem(STORAGE_KEYS.themePreference)).toBe('light');
        // Light text on a light highlight would be unreadable.
        expect(root().style.getPropertyValue('--highlight-contrast')).toBe('#f8fafc');
    });

    it('applies and persists a highlight colour with its rgb triple', async () => {
        const user = userEvent.setup();
        renderControls();

        await user.click(screen.getByRole('radio', { name: 'Sage Green' }));

        expect(root().style.getPropertyValue('--highlight')).toBe('#6ba387');
        expect(root().style.getPropertyValue('--highlight-rgb')).toBe('107, 163, 135');
        expect(localStorage.getItem(STORAGE_KEYS.highlightColor)).toBe('#6ba387');
    });

    it('falls back to the default when the stored colour is malformed', () => {
        localStorage.setItem(STORAGE_KEYS.highlightColor, 'chartreuse');
        renderControls();
        expect(root().style.getPropertyValue('--highlight')).toBe('#6b8cae');
    });

    it('marks exactly one theme and one colour as selected', () => {
        renderControls();
        const checked = screen.getAllByRole('radio').filter((el) => el.getAttribute('aria-checked') === 'true');
        expect(checked).toHaveLength(2);
    });

    it('repaints the mobile browser chrome through the theme-color meta tag', async () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        meta.setAttribute('content', '#020617');
        document.head.append(meta);

        const user = userEvent.setup();
        renderControls();
        expect(meta.getAttribute('content')).toBe('#020617');

        await user.click(screen.getByRole('radio', { name: 'Light' }));
        expect(meta.getAttribute('content')).toBe('#ffffff');

        meta.remove();
    });
});
