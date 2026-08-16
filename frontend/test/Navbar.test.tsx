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

    it('opens a panel on hover and closes it on Escape', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const signals = screen.getByRole('button', { name: /Signals/ });
        expect(signals.getAttribute('aria-expanded')).toBe('false');

        await user.hover(signals);
        expect(signals.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('link', { name: /Live Signals/ })).toBeTruthy();

        await user.keyboard('{Escape}');
        expect(signals.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows placeholders without making them links', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.hover(screen.getByRole('button', { name: /Signals/ }));

        expect(screen.getByText('Week Explorer')).toBeTruthy();
        expect(screen.queryByRole('link', { name: /Week Explorer/ })).toBeNull();
        // A placeholder cannot be favourited either.
        expect(screen.queryByRole('button', { name: /Favourite Week Explorer/ })).toBeNull();
    });

    it('closes the panel once a destination is chosen', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const calendars = screen.getByRole('button', { name: /^Calendars/ });
        await user.hover(calendars);
        // fireEvent for the same reason as the favourites test: user-event's
        // pointer move into the panel tears it down before the click lands, so
        // this would pass for the wrong reason (and jsdom would try a real
        // document navigation).
        fireEvent.click(screen.getByRole('link', { name: /All Calendars/ }));

        expect(calendars.getAttribute('aria-expanded')).toBe('false');
    });

    it('pins a starred page under Quick access and keeps it after a reload', async () => {
        const user = userEvent.setup();
        const view = renderNavbar();

        await user.hover(screen.getByRole('button', { name: /Signals/ }));
        // fireEvent, not user-event: user-event's pointer emulation dispatches a
        // mouseout with no relatedTarget when moving into the freshly rendered
        // panel, which React turns into a header mouseleave and closes the menu.
        fireEvent.click(screen.getByRole('button', { name: 'Favourite Live Signals' }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favourites' })).toBeTruthy();

        await user.hover(screen.getByRole('button', { name: /Quick access/ }));
        expect(screen.getByRole('heading', { name: /Favourites/ })).toBeTruthy();
        expect(screen.getAllByRole('link', { name: /Live Signals/ }).length).toBeGreaterThan(0);

        view.unmount();
        renderNavbar();
        await user.hover(screen.getByRole('button', { name: /Quick access/ }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favourites' })).toBeTruthy();
    });

    it('records the current page as recently visited', async () => {
        const user = userEvent.setup();
        renderNavbar('/calendars');

        await user.hover(screen.getByRole('button', { name: /Quick access/ }));

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
