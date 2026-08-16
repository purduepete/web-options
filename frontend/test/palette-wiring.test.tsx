import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../src/api', () => ({
    fetchCalendars: vi.fn(async () => ({
        calendars: [
            {
                publishDate: '2026-01-05',
                weekStart: '2026-01-05',
                weekEnd: '2026-01-09',
                title: 'New year kick-off',
                tradeCount: 19,
            },
        ],
    })),
    fetchMe: vi.fn(async () => ({ label: 'test', scopes: [] })),
}));

import { ApiKeyProvider } from '../src/auth/ApiKeyProvider';
import { Layout } from '../src/components/Layout';
import { FavoritesProvider } from '../src/navigation/FavoritesProvider';
import { RecentlyVisitedProvider } from '../src/navigation/RecentlyVisitedProvider';
import { ThemeProvider } from '../src/theme/ThemeProvider';

function renderApp() {
    return render(
        <ThemeProvider>
            <ApiKeyProvider>
                <MemoryRouter initialEntries={['/']}>
                    <FavoritesProvider>
                        <RecentlyVisitedProvider>
                            <Routes>
                                <Route element={<Layout />}>
                                    <Route index element={<p>live signals page</p>} />
                                    <Route path="calendars" element={<p>calendars page</p>} />
                                    <Route path="calendars/:publishDate" element={<p>one week page</p>} />
                                </Route>
                            </Routes>
                        </RecentlyVisitedProvider>
                    </FavoritesProvider>
                </MemoryRouter>
            </ApiKeyProvider>
        </ThemeProvider>,
    );
}

describe('command palette wiring', () => {
    beforeEach(() => {
        window.matchMedia = ((query: string) => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
    });

    it('opens on Ctrl+K, navigates on Enter and closes', async () => {
        const user = userEvent.setup();
        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();

        await user.keyboard('{Control>}k{/Control}');
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('all calendars{Enter}');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText('calendars page')).toBeTruthy();
    });

    it('opens from the navbar search button and closes on the second Ctrl+K', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.click(screen.getByRole('button', { name: /Search/ }));
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Control>}k{/Control}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('lists the ingested weeks it fetched on first open', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.keyboard('{Control>}k{/Control}');
        await screen.findByRole('option', { name: /Week of 2026-01-05/ });

        await user.keyboard('kick');
        expect(screen.getAllByRole('option')).toHaveLength(1);

        await user.keyboard('{Enter}');
        expect(screen.getByText('one week page')).toBeTruthy();
    });

    it('changes the theme from an action', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.keyboard('{Control>}k{/Control}');
        await user.keyboard('light theme{Enter}');

        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
});
