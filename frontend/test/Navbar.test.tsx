import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FavoritesProvider } from '../src/navigation/FavoritesProvider';
import { RecentlyVisitedProvider } from '../src/navigation/RecentlyVisitedProvider';
import { Navbar } from '../src/navigation/Navbar';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** The navbar picks its layout from matchMedia, so the tests drive that directly. */
function setViewport(kind: 'desktop' | 'mobile') {
    window.matchMedia = ((query: string) => ({
        matches: kind === 'desktop' && query === DESKTOP_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

function renderNavbar(initialPath = '/') {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <FavoritesProvider>
                <RecentlyVisitedProvider>
                    <Navbar />
                    <Routes>
                        <Route path="/" element={<p>live signals</p>} />
                        <Route path="/calendars" element={<p>calendars</p>} />
                    </Routes>
                </RecentlyVisitedProvider>
            </FavoritesProvider>
        </MemoryRouter>,
    );
}

describe('Navbar on desktop', () => {
    beforeEach(() => setViewport('desktop'));

    it('opens every section from one button and closes on Escape', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const menu = screen.getByRole('button', { name: /Menu/ });
        expect(menu.getAttribute('aria-expanded')).toBe('false');

        await user.click(menu);
        expect(menu.getAttribute('aria-expanded')).toBe('true');
        // One panel, every section in it, rather than a panel per section.
        for (const section of ['Signals', 'Calendars', 'Tools', 'Settings']) {
            expect(screen.getByRole('heading', { name: section })).toBeTruthy();
        }
        expect(screen.getAllByRole('link', { name: /Live Signals/ }).length).toBeGreaterThan(0);

        await user.keyboard('{Escape}');
        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes when the pointer lands outside the menu', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const menu = screen.getByRole('button', { name: /Menu/ });
        await user.click(menu);
        expect(menu.getAttribute('aria-expanded')).toBe('true');

        fireEvent.mouseDown(document.body);
        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows placeholders without making them links', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.click(screen.getByRole('button', { name: /Menu/ }));

        expect(screen.getByText('Week Explorer')).toBeTruthy();
        expect(screen.queryByRole('link', { name: /Week Explorer/ })).toBeNull();
        // A placeholder cannot be favourited either.
        expect(screen.queryByRole('button', { name: /Favourite Week Explorer/ })).toBeNull();
    });

    it('closes the panel once a destination is chosen', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const menu = screen.getByRole('button', { name: /Menu/ });
        await user.click(menu);
        // fireEvent, not user-event: user-event would send a mousedown that the
        // outside-click handler sees first, so this would pass for the wrong
        // reason (and jsdom would try a real document navigation).
        fireEvent.click(screen.getByRole('link', { name: /All Calendars/ }));

        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('pins a starred page above the sections and keeps it after a reload', async () => {
        const user = userEvent.setup();
        const view = renderNavbar();

        await user.click(screen.getByRole('button', { name: /Menu/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Favourite Live Signals' }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favourites' })).toBeTruthy();

        const favourites = screen.getByRole('heading', { name: /Favourites/ }).parentElement;
        expect(favourites?.textContent).toContain('Live Signals');

        view.unmount();
        renderNavbar();
        await user.click(screen.getByRole('button', { name: /Menu/ }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favourites' })).toBeTruthy();
    });

    it('records the current page as recently visited', async () => {
        const user = userEvent.setup();
        renderNavbar('/calendars');

        await user.click(screen.getByRole('button', { name: /Menu/ }));

        const recent = screen.getByRole('heading', { name: /Recently visited/ }).parentElement;
        expect(recent?.textContent).toContain('All Calendars');
    });
});

describe('Navbar on mobile', () => {
    beforeEach(() => setViewport('mobile'));

    it('hides the section buttons behind a drawer', () => {
        renderNavbar();
        expect(screen.queryByRole('button', { name: /Signals/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    });

    it('opens the drawer and expands one section at a time', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.click(screen.getByRole('button', { name: 'Open menu' }));

        const signals = screen.getByRole('button', { name: 'Signals' });
        const calendars = screen.getByRole('button', { name: 'Calendars' });
        expect(signals.getAttribute('aria-expanded')).toBe('false');

        await user.click(signals);
        expect(signals.getAttribute('aria-expanded')).toBe('true');

        await user.click(calendars);
        expect(signals.getAttribute('aria-expanded')).toBe('false');
        expect(calendars.getAttribute('aria-expanded')).toBe('true');
    });

    it('closes the drawer on Escape', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.click(screen.getByRole('button', { name: 'Open menu' }));
        expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();

        await user.keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    });
});
