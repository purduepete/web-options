import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { FavoriteShortcuts } from '../src/navigation/FavoriteShortcuts';
import { FavoritesProvider, useFavorites } from '../src/navigation/FavoritesProvider';

function Harness() {
    const { pathname } = useLocation();
    const { toggleFavorite } = useFavorites();
    return (
        <>
            <FavoriteShortcuts />
            <button type="button" onClick={() => toggleFavorite('/summary')}>
                Add summary
            </button>
            <button type="button" onClick={() => toggleFavorite('/owned-contracts')}>
                Add owned
            </button>
            <input aria-label="Typing" />
            <output>{pathname}</output>
        </>
    );
}

function renderHarness(initialPath = '/settings/key') {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <FavoritesProvider>
                <Harness />
            </FavoritesProvider>
        </MemoryRouter>,
    );
}

describe('FavoriteShortcuts', () => {
    beforeEach(() => localStorage.clear());

    it('opens Live Signals from Ctrl+0', () => {
        renderHarness();
        fireEvent.keyDown(window, { key: '0', ctrlKey: true });
        expect(screen.getByText('/', { selector: 'output' })).toBeTruthy();
    });

    it('opens favorites by their current position', async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByRole('button', { name: 'Add summary' }));
        await user.click(screen.getByRole('button', { name: 'Add owned' }));

        fireEvent.keyDown(window, { key: '2', ctrlKey: true });
        expect(screen.getByText('/owned-contracts', { selector: 'output' })).toBeTruthy();
    });

    it('does not fire with another modifier or while typing', async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByRole('button', { name: 'Add summary' }));

        fireEvent.keyDown(window, { key: '1', ctrlKey: true, altKey: true });
        expect(screen.getByText('/settings/key', { selector: 'output' })).toBeTruthy();

        const input = screen.getByRole('textbox', { name: 'Typing' });
        fireEvent.keyDown(input, { key: '1', ctrlKey: true });
        expect(screen.getByText('/settings/key', { selector: 'output' })).toBeTruthy();
    });
});
