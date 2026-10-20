import { STORAGE_KEYS } from '@weboptions/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FavoritesProvider } from '../src/navigation/FavoritesProvider';
import { findNavItem } from '../src/navigation/navModel';
import { favoriteMoveIndices, FavoritesPage } from '../src/pages/FavoritesPage';

function renderPage() {
    return render(
        <FavoritesProvider>
            <FavoritesPage />
        </FavoritesProvider>
    );
}

describe('FavoritesPage', () => {
    beforeEach(() => localStorage.clear());

    it('explains how to add a favorite when the list is empty', () => {
        renderPage();
        expect(screen.getByText('Star pages in the menu to add favorites here.')).toBeTruthy();
    });

    it('shows shortcut positions from the persisted favorite order', () => {
        localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(['/summary', '/']));
        renderPage();

        const rows = screen.getAllByRole('listitem');
        expect(rows[0]?.textContent).toContain('Summary');
        expect(rows[0]?.textContent).toContain('Ctrl+1');
        expect(rows[1]?.textContent).toContain('Live Signals');
        expect(rows[1]?.textContent).toContain('Ctrl+2');
    });

    it('translates a completed drag into persisted-order positions', () => {
        const favorites = [findNavItem('/'), findNavItem('/summary')].filter((item) => item !== undefined);
        expect(favoriteMoveIndices(favorites, '/summary', '/')).toEqual([1, 0]);
        expect(favoriteMoveIndices(favorites, '/', '/')).toBeNull();
        expect(favoriteMoveIndices(favorites, '/missing', '/')).toBeNull();
    });

    it('removes a shortcut and saves the remaining favorites', async () => {
        const user = userEvent.setup();
        localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(['/', '/summary']));
        renderPage();

        await user.click(screen.getByRole('button', { name: 'Remove Summary from favorites' }));

        expect(screen.queryByText('Summary')).toBeNull();
        await waitFor(() => {
            expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) ?? '[]')).toEqual(['/']);
        });
    });
});
