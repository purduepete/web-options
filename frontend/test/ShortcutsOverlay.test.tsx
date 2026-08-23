import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutsOverlay } from '../src/shortcuts/ShortcutsOverlay';
import { SHORTCUT_GROUPS } from '../src/shortcuts/shortcutList';

const OPEN = '{Control>}{Shift>}?{/Shift}{/Control}';

function dialog(): HTMLElement | null {
    return screen.queryByRole('dialog');
}

describe('ShortcutsOverlay', () => {
    it('shows examples for the cycling contract filters', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);
        await user.keyboard(OPEN);

        expect(screen.getByText('Next contracts filter (All → Expired → Active)')).toBeTruthy();
        expect(screen.getByText('Next moneyness filter (All → ITM → OTM)')).toBeTruthy();
    });

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

        for (const group of SHORTCUT_GROUPS) {
            expect(screen.getByRole('heading', { name: group.title })).toBeTruthy();
            for (const entry of group.entries) {
                expect(screen.getAllByText(entry.description).length).toBeGreaterThan(0);
            }
        }
    });

    it('lists shared commands once and keeps the two meanings of c separate', async () => {
        const user = userEvent.setup();
        render(<ShortcutsOverlay />);
        await user.keyboard(OPEN);

        expect(screen.getAllByText('Focus the symbol filter')).toHaveLength(1);
        expect(screen.getByText('Toggle Conservative tier')).toBeTruthy();
        expect(screen.getByText('Next captured filter')).toBeTruthy();
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
