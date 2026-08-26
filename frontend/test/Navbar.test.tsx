import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FavoritesProvider } from '../src/navigation/FavoritesProvider';
import { RecentlyVisitedProvider } from '../src/navigation/RecentlyVisitedProvider';
import { ThemeProvider } from '../src/theme/ThemeProvider';
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
            <ThemeProvider>
                <FavoritesProvider>
                    <RecentlyVisitedProvider>
                        <Navbar />
                        <Routes>
                            <Route path="/" element={<p>live signals</p>} />
                            <Route path="/calendars" element={<p>calendars</p>} />
                        </Routes>
                    </RecentlyVisitedProvider>
                </FavoritesProvider>
            </ThemeProvider>
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

        // pointerdown rather than mousedown, so a tap dismisses it too.
        fireEvent.pointerDown(document.body);
        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('publishes its height for the headers that pin below it', () => {
        renderNavbar();

        // jsdom measures everything as nothing, so only the wiring is checked.
        expect(document.documentElement.style.getPropertyValue('--navbar-height')).toBe('0px');
    });

    it('opens and closes the menu from Ctrl+backslash', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const menu = screen.getByRole('button', { name: /Menu/ });

        await user.keyboard('{Control>}\\{/Control}');
        expect(menu.getAttribute('aria-expanded')).toBe('true');

        await user.keyboard('{Control>}\\{/Control}');
        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('hides future placeholders and puts Owned Contracts under Tools', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.click(screen.getByRole('button', { name: /Menu/ }));

        expect(screen.queryByText('Week Explorer')).toBeNull();
        expect(screen.queryByText('Symbol Lookup')).toBeNull();
        expect(screen.queryByText('Export')).toBeNull();

        const tools = screen.getByRole('heading', { name: 'Tools' }).parentElement;
        expect(tools?.textContent).toContain('Owned Contracts');
        const signals = screen.getByRole('heading', { name: 'Signals' }).parentElement;
        expect(signals?.textContent).not.toContain('Owned Contracts');
    });

    it('cycles the theme from the bar and comes back around', async () => {
        const user = userEvent.setup();
        renderNavbar();

        expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
        for (const expected of ['light', 'dark', 'midnight']) {
            // Re-queried each time: the label names the theme it is showing.
            await user.click(screen.getByRole('button', { name: /^Theme:/ }));
            expect(document.documentElement.getAttribute('data-theme')).toBe(expected);
        }
    });

    it('puts page reload in the top bar', () => {
        renderNavbar();

        const reload = screen.getByRole('button', { name: 'Reload page' });
        expect(reload.getAttribute('title')).toBe('Reload page');
    });

    it('closes the panel once a destination is chosen', async () => {
        const user = userEvent.setup();
        renderNavbar();

        const menu = screen.getByRole('button', { name: /Menu/ });
        await user.click(menu);
        // fireEvent, not user-event: user-event would send a mousedown that the
        // outside-click handler sees first, so this would pass for the wrong
        // reason (and jsdom would try a real document navigation).
        fireEvent.click(screen.getByRole('link', { name: /Weekly Calendars/ }));

        expect(menu.getAttribute('aria-expanded')).toBe('false');
    });

    it('pins a starred page above the sections and keeps it after a reload', async () => {
        const user = userEvent.setup();
        const view = renderNavbar();

        await user.click(screen.getByRole('button', { name: /Menu/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Favorite Live Signals' }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favorites' })).toBeTruthy();

        const favorites = screen.getByRole('heading', { name: /Favorites/ }).parentElement;
        expect(favorites?.textContent).toContain('Live Signals');
        expect(favorites?.textContent).not.toMatch(/\d/);

        view.unmount();
        renderNavbar();
        await user.click(screen.getByRole('button', { name: /Menu/ }));
        expect(screen.getByRole('button', { name: 'Remove Live Signals from favorites' })).toBeTruthy();
    });

    it('records the current page as recently visited', async () => {
        const user = userEvent.setup();
        renderNavbar('/calendars/latest');

        await user.click(screen.getByRole('button', { name: /Menu/ }));

        const recent = screen.getByRole('heading', { name: /Recently visited/ }).parentElement;
        expect(recent?.textContent).toContain('Weekly Calendars');
    });
});

describe('Navbar on mobile', () => {
    beforeEach(() => setViewport('mobile'));

    it('hides the section buttons behind a drawer', () => {
        renderNavbar();
        expect(screen.queryByRole('button', { name: /Signals/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
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

    it('opens the drawer from Ctrl+backslash, since there is no panel here', async () => {
        const user = userEvent.setup();
        renderNavbar();

        await user.keyboard('{Control>}\\{/Control}');
        expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    });
});
