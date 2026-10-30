import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        UnauthorizedError: actual.UnauthorizedError,
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
        fetchVix: vi.fn(async () => ({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } })),
    };
});

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
                                    <Route path="calendars/latest" element={<p>latest week page</p>} />
                                    <Route path="calendars/:publishDate" element={<p>one week page</p>} />
                                </Route>
                            </Routes>
                        </RecentlyVisitedProvider>
                    </FavoritesProvider>
                </MemoryRouter>
            </ApiKeyProvider>
        </ThemeProvider>
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

    it('opens on Ctrl+/, navigates on Enter and closes', async () => {
        const user = userEvent.setup();
        renderApp();

        expect(screen.queryByRole('dialog')).toBeNull();

        await user.keyboard('{Control>}/{/Control}');
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('weekly calendars{Enter}');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(await screen.findByText('latest week page')).toBeTruthy();
    });

    it('opens from the navbar search button and closes on Ctrl+/', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.click(screen.getByRole('button', { name: /Search/ }));
        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Control>}/{/Control}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('leaves the individual weeks out, even when some are ingested', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.keyboard('{Control>}/{/Control}');
        await screen.findByRole('dialog');

        expect(screen.queryAllByRole('option', { name: /Week of/ })).toHaveLength(0);
    });

    it('changes the theme from an action', async () => {
        const user = userEvent.setup();
        renderApp();

        await user.keyboard('{Control>}/{/Control}');
        await user.keyboard('light theme{Enter}');

        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
});
