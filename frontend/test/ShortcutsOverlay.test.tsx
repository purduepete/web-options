import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutsOverlay } from '../src/shortcuts/ShortcutsOverlay';
import { SHORTCUT_SECTIONS } from '../src/shortcuts/shortcutList';

const OPEN = '{Control>}{Shift>}?{/Shift}{/Control}';

function dialog(): HTMLElement | null {
    return screen.queryByRole('dialog');
}

describe('ShortcutsOverlay', () => {
    it('stays out of the way until it is asked for', () => {
        render(<ShortcutsOverlay />);
        expect(dialog()).toBeNull();
    });

    it('opens and closes on Ctrl+Shift+?', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);

        await user.keyboard(OPEN);
        expect(dialog()).toBeTruthy();

        await user.keyboard(OPEN);
        expect(dialog()).toBeNull();
    });

    it('answers to the slash the layout actually reports', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);

        await user.keyboard('{Control>}{Shift>}/{/Shift}{/Control}');
        expect(dialog()).toBeTruthy();
    });

    it('lists every documented shortcut under its section', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);
        await user.keyboard(OPEN);

        for (const section of SHORTCUT_SECTIONS) {
            expect(screen.getByRole('heading', { name: section.title })).toBeTruthy();
            for (const shortcut of section.shortcuts) {
                expect(screen.getAllByText(shortcut.description).length).toBeGreaterThan(0);
            }
        }
    });

    it('closes on Escape, on the close button and on the backdrop', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);

        await user.keyboard(OPEN);
        await user.keyboard('{Escape}');
        expect(dialog()).toBeNull();

        await user.keyboard(OPEN);
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(dialog()).toBeNull();

        await user.keyboard(OPEN);
        await user.click(screen.getByTestId('shortcuts-backdrop'));
        expect(dialog()).toBeNull();
    });

    it('is a labelled modal that takes focus when it opens', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);
        await user.keyboard(OPEN);

        const panel = screen.getByRole('dialog');
        expect(panel.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    });
});
