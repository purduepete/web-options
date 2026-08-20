import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { STORAGE_KEYS } from '@weboptions/shared';
import type { DaySignals, Trade, WeekSignalsResponse } from '@weboptions/shared';

const fetchWeekSignals = vi.fn();
const fetchEarliestWeek = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchWeekSignals: (week?: string) => fetchWeekSignals(week),
        fetchEarliestWeek: () => fetchEarliestWeek(),
    };
});

// Stable like the real provider, whose forget() is a useCallback: a fresh
// identity here would refire the fetch effect on every render.
const apiKey = { status: 'ready', forget: () => {} };

vi.mock('../src/auth/ApiKeyProvider', () => ({
    useApiKey: () => apiKey,
}));

const { LiveSignalsPage } = await import('../src/pages/LiveSignalsPage');

function trade(symbol: string, extra: Partial<Trade> = {}): Trade {
    return {
        symbol,
        sector: null,
        optionRight: 'P',
        strike: 100,
        expiration: '2025-08-15',
        dte: 4,
        delta: -0.2,
        annualizedYield: 10,
        premium: 120,
        collateral: 10000,
        tier: 'Conservative',
        isTopPick: false,
        actualDelta: null,
        actualPremium: null,
        actualAnnualizedYield: null,
        actualIlliquid: false,
        actualIv: null,
        actualUnderlying: null,
        closeDate: null,
        closeUnderlying: null,
        moneyness: null,
        percentFromStrike: null,
        ...extra,
    };
}

function day(date: string, name: string, trades: Trade[]): DaySignals {
    return { name, date, hasData: true, trades };
}

function week(extra: Partial<WeekSignalsResponse> = {}): WeekSignalsResponse {
    return {
        weekStart: '2025-08-11',
        weekEnd: '2025-08-15',
        generatedAt: '2025-08-11T12:00:00Z',
        isCurrentWeek: true,
        hasPriorWeekData: true,
        hasNextWeekData: false,
        days: [
            day('2025-08-11', 'Monday', [
                trade('AAPL', { annualizedYield: 12.34, isTopPick: true, tier: 'Balanced' }),
                trade('MSFT', { annualizedYield: 8, tier: 'Aggressive' }),
            ]),
            day('2025-08-12', 'Tuesday', [trade('AMD', { annualizedYield: 20 })]),
        ],
        ...extra,
    };
}

function renderPage(initialEntry = '/') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <LiveSignalsPage />
        </MemoryRouter>,
    );
}

/** The heading text of every risk group currently drawn, in document order. */
function groupHeadings(): string[] {
    // Scoped to the grid: the filter menus in the head are expandable too.
    const grid = within(screen.getByTestId('week-grid'));
    return grid
        .queryAllByRole('button', { expanded: true })
        .concat(grid.queryAllByRole('button', { expanded: false }))
        .map((button) => button.textContent ?? '');
}

/** Every day card's label, in document order. */
function dayHeadings(): string[] {
    return screen.getAllByRole('region').map((card) => card.getAttribute('aria-label') ?? '');
}

/** Every number inside `scope` that fell back to VADER, in document order. */
function quotedValues(scope: HTMLElement): string[] {
    return Array.from(scope.querySelectorAll('.value-quoted')).map((node) => node.textContent ?? '');
}

/** Opens one of the head's menus and picks one of its choices. */
async function choose(user: ReturnType<typeof userEvent.setup>, menu: RegExp, option: string) {
    await user.click(screen.getByRole('button', { name: menu }));
    await user.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${option}`) }));
}

beforeEach(() => {
    fetchWeekSignals.mockReset();
    fetchEarliestWeek.mockReset();
    fetchWeekSignals.mockResolvedValue(week());
    localStorage.clear();
});

describe('LiveSignalsPage', () => {
    it('titles the page with the week it actually loaded', async () => {
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' })).toBeTruthy();
    });

    it('says nothing until it knows the week, rather than naming itself twice', () => {
        // The row still holds its shape, so the week arrives without a jump.
        const { container } = renderPage();
        const heading = container.querySelector('.page-head h1');
        expect(heading?.querySelector('.week-title-spacer')?.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('heading', { name: /Week of/ })).toBeNull();
    });

    it('draws a card per day with the trade count in its header', async () => {
        renderPage();
        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(within(monday).getByText('Aug 11 (2)')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Tuesday Aug 12' })).toBeTruthy();
    });

    it('splits a day into top picks and risk tiers', async () => {
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        const headings = groupHeadings();
        expect(headings.some((text) => text.startsWith('Top Picks (1)'))).toBe(true);
        expect(headings.some((text) => text.startsWith('Aggressive (1)'))).toBe(true);
        // AAPL is a top pick, so it does not also appear under Balanced.
        expect(headings.some((text) => text.startsWith('Balanced'))).toBe(false);
    });

    it('shows the numbers on a ticket the way a trader reads them', async () => {
        renderPage();
        const tuesday = await screen.findByRole('region', { name: 'Tuesday Aug 12' });

        expect(within(tuesday).getByText('AMD $100P')).toBeTruthy();
        expect(within(tuesday).getByText('08/15/2025')).toBeTruthy();
        expect(within(tuesday).getByText('$10,000')).toBeTruthy();
        // Nothing was quoted for these fixtures, so the advertised numbers stand
        // in — each one marked, and named for a screen reader.
        expect(quotedValues(tuesday)).toEqual([
            '-0.20 (VADER estimate)',
            '20.0% (VADER estimate)',
            '$120 (VADER estimate)',
        ]);
    });

    it('asks the server for the week named in the URL', async () => {
        renderPage('/?week=2025-07-07');
        await waitFor(() => expect(fetchWeekSignals).toHaveBeenCalledWith('2025-07-07'));
    });

    it('grades the newest day and leaves the rest of the week ungraded', async () => {
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
        ].join('-');
        fetchWeekSignals.mockResolvedValue(
            week({
                days: [
                    day('2025-08-11', 'Monday', [trade('OLD', { annualizedYield: 5 })]),
                    day(today, 'Today', [
                        trade('POOR', { annualizedYield: 5 }),
                        trade('GOOD', { annualizedYield: 50, delta: -0.1, closeUnderlying: 120 }),
                    ]),
                ],
            }),
        );
        renderPage();

        const poor = await screen.findByRole('button', { name: /^POOR/ });
        expect(poor.querySelector('.grade-corner.red')).toBeTruthy();
        expect(screen.getByRole('button', { name: /^GOOD/ }).querySelector('.grade-corner.green')).toBeTruthy();
        // A week-old signal is graded against a price the market left behind.
        expect(screen.getByRole('button', { name: /^OLD/ }).querySelector('.grade-corner')).toBeNull();
    });

    it('steps back a week and records it in the URL', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        await user.click(screen.getByRole('button', { name: 'Previous week' }));

        await waitFor(() => expect(fetchWeekSignals).toHaveBeenLastCalledWith('2025-08-04'));
    });

    it('clears the old week while the next one is on the way', async () => {
        let arrive: (value: WeekSignalsResponse) => void = () => {};
        fetchWeekSignals.mockResolvedValueOnce(week()).mockReturnValueOnce(
            new Promise<WeekSignalsResponse>((resolve) => {
                arrive = resolve;
            }),
        );

        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await user.click(screen.getByRole('button', { name: 'Previous week' }));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Monday Aug 11' })).toBeNull());

        arrive(week({ weekStart: '2025-08-04', weekEnd: '2025-08-08' }));
        expect(await screen.findByRole('region', { name: 'Monday Aug 11' })).toBeTruthy();
    });

    it('will not step forward when the server says there is nothing there', async () => {
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });
        expect(screen.getByRole('button', { name: 'Next week' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'This week' }).hasAttribute('disabled')).toBe(true);
    });

    it('keeps the two step buttons next to each other', async () => {
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        const nav = document.querySelector('.week-nav');
        const labels = [...(nav?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label'));

        expect(labels).toEqual(['First week', 'Previous week', 'Next week', null]);
    });

    it('jumps to the earliest week the server knows about', async () => {
        const user = userEvent.setup();
        fetchEarliestWeek.mockResolvedValue({ weekStart: '2025-01-06' });
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        await user.click(screen.getByRole('button', { name: 'First week' }));

        await waitFor(() => expect(fetchWeekSignals).toHaveBeenLastCalledWith('2025-01-06'));
    });

    it('narrows every day to the filtered symbol and says so where nothing matched', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await user.type(screen.getByLabelText('Filter by symbol'), 'amd');

        const monday = screen.getByRole('region', { name: 'Monday Aug 11' });
        expect(within(monday).getByText('No matches for "AMD".')).toBeTruthy();
        expect(screen.getByText('AMD $100P')).toBeTruthy();
        expect(screen.queryByText('AAPL $100P')).toBeNull();
    });

    it('starts with the filter from the URL already applied', async () => {
        renderPage('/?symbol=MSFT');
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        expect((screen.getByLabelText('Filter by symbol') as HTMLInputElement).value).toBe('MSFT');
        expect(screen.getByText('MSFT $100P')).toBeTruthy();
        expect(screen.queryByText('AAPL $100P')).toBeNull();
    });

    it('clears the filter from the button', async () => {
        const user = userEvent.setup();
        renderPage('/?symbol=MSFT');
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await user.click(screen.getByRole('button', { name: 'Clear symbol filter' }));

        expect((screen.getByLabelText('Filter by symbol') as HTMLInputElement).value).toBe('');
        expect(screen.getByText('AAPL $100P')).toBeTruthy();
    });

    // Both dates are far enough either side of today that the outcome does not
    // depend on when the suite runs.
    const settled = () =>
        week({
            days: [
                day('2025-08-11', 'Monday', [
                    trade('AAPL', { expiration: '2020-01-17' }),
                    trade('MSFT', { expiration: '2099-12-18' }),
                ]),
                day('2025-08-12', 'Tuesday', [trade('AMD', { expiration: '2020-01-17' })]),
            ],
        });

    it('hides expired contracts across the whole week and says why a day emptied', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(settled());
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await choose(user, /^Contracts:/, 'Active');

        expect(screen.queryByText('AAPL $100P')).toBeNull();
        expect(screen.getByText('MSFT $100P')).toBeTruthy();
        const tuesday = screen.getByRole('region', { name: 'Tuesday Aug 12' });
        expect(within(tuesday).getByText('Every signal this day has expired.')).toBeTruthy();
    });

    it('turns the filter around to show only what has expired', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(settled());
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await choose(user, /^Contracts:/, 'Expired');

        expect(screen.getByText('AAPL $100P')).toBeTruthy();
        expect(screen.queryByText('MSFT $100P')).toBeNull();
    });

    it('starts with the expiry filter from the URL already applied', async () => {
        fetchWeekSignals.mockResolvedValue(settled());
        renderPage('/?expiry=active');
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        // The trigger carries the choice, so a shared link says what it narrowed.
        expect(screen.getByRole('button', { name: 'Contracts: Active' })).toBeTruthy();
        expect(screen.queryByText('AAPL $100P')).toBeNull();
    });

    it('narrows the week to where the contracts closed', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(
            week({
                days: [
                    day('2025-08-11', 'Monday', [
                        trade('AAPL', { moneyness: 'itm' }),
                        trade('MSFT', { moneyness: 'otm' }),
                    ]),
                    day('2025-08-12', 'Tuesday', [trade('AMD', { moneyness: 'otm' })]),
                ],
            }),
        );
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await choose(user, /^Moneyness:/, 'ITM');

        expect(screen.getByText('AAPL $100P')).toBeTruthy();
        expect(screen.queryByText('MSFT $100P')).toBeNull();
        const tuesday = screen.getByRole('region', { name: 'Tuesday Aug 12' });
        expect(within(tuesday).getByText('Nothing this day closed ITM.')).toBeTruthy();
    });

    it('collapses a group across every day at once', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(
            week({
                days: [day('2025-08-11', 'Monday', [trade('AAPL')]), day('2025-08-12', 'Tuesday', [trade('AMD')])],
            }),
        );
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        const headings = screen.getAllByRole('button', { name: /Conservative/ });
        expect(headings).toHaveLength(2);
        await user.click(headings[0]!);

        for (const heading of screen.getAllByRole('button', { name: /Conservative/ })) {
            expect(heading.getAttribute('aria-expanded')).toBe('false');
        }
        expect(screen.queryByText('AAPL $100P')).toBeNull();
        expect(screen.queryByText('AMD $100P')).toBeNull();
    });

    it('isolates one group from the keyboard and reopens everything with j', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await user.keyboard('t');

        expect(screen.getByRole('button', { name: /Top Picks/ }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: /Aggressive/ }).getAttribute('aria-expanded')).toBe('false');

        await user.keyboard('j');

        for (const heading of screen.getAllByRole('button', { name: /Top Picks|Aggressive|Conservative/ })) {
            expect(heading.getAttribute('aria-expanded')).toBe('true');
        }
    });

    it('leaves the shortcuts alone while the filter box has focus', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });

        await user.click(screen.getByLabelText('Filter by symbol'));
        await user.keyboard('t');

        expect((screen.getByLabelText('Filter by symbol') as HTMLInputElement).value).toBe('T');
        expect(screen.getByRole('button', { name: /Aggressive/ }).getAttribute('aria-expanded')).toBe('true');
    });

    it('leaves nothing behind on a day that has no trades in a group', async () => {
        // The five cards share grid rows, so a group a day cannot fill has to
        // render no element at all rather than an empty or hidden one — an
        // occupied row would push every card below it out of alignment.
        fetchWeekSignals.mockResolvedValue(
            week({
                days: [
                    day('2025-08-11', 'Monday', [trade('AAPL', { tier: 'Conservative' })]),
                    day('2025-08-12', 'Tuesday', [trade('AMD', { tier: 'Aggressive' })]),
                ],
            }),
        );
        renderPage();

        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(within(monday).queryByRole('button', { name: /Aggressive/, hidden: true })).toBeNull();
        expect(within(monday).getByRole('button', { name: /Conservative/ })).toBeTruthy();
    });

    it('lists each risk group as a heading under its day', async () => {
        renderPage();
        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(
            within(monday)
                .getAllByRole('heading', { level: 3 })
                .map((h) => h.textContent),
        ).toEqual(['Top Picks (1)', 'Aggressive (1)']);
    });

    it('says so when the week is empty rather than showing a bare grid', async () => {
        fetchWeekSignals.mockResolvedValue(week({ days: [] }));
        renderPage();
        expect(await screen.findByText('No signals landed for this week yet.')).toBeTruthy();
    });

    it('reports a failure instead of pretending the week is empty', async () => {
        fetchWeekSignals.mockRejectedValue(new Error('boom'));
        renderPage();
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.queryByTestId('week-grid')).toBeNull();
    });
});

describe('LiveSignalsPage menu reset', () => {
    it('is out of reach while every menu is already at its default', async () => {
        renderPage();
        await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();

        // It stays in the bar all the same, holding the width it will want, so
        // that narrowing a menu later does not reflow the row around it.
        const idle = document.querySelector('.menus-reset');
        expect(idle?.className).toContain('is-idle');
        expect(idle?.getAttribute('disabled')).not.toBeNull();
    });

    it('puts all three menus back in one press', async () => {
        const user = userEvent.setup();
        renderPage('/?expiry=active&moneyness=itm');
        await screen.findByTestId('week-grid');
        await choose(user, /^Numbers:/, 'VADER');

        await user.click(screen.getByRole('button', { name: 'Reset' }));

        expect(screen.getByRole('button', { name: 'Numbers: Actual' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Contracts: All' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Moneyness: All' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    });

    it('leaves the reader with the default numbers on the next visit', async () => {
        const user = userEvent.setup();
        const first = renderPage();
        await screen.findByTestId('week-grid');
        await choose(user, /^Numbers:/, 'VADER');

        await user.click(screen.getByRole('button', { name: 'Reset' }));
        expect(localStorage.getItem(STORAGE_KEYS.signalNumberSource)).toBe('actual');

        first.unmount();
        renderPage();
        expect(await screen.findByRole('button', { name: 'Numbers: Actual' })).toBeTruthy();
    });
});

/**
 * Reports the widths a viewport of `width` would match, and nothing else: the
 * hooks under test ask in `max-width` and jsdom answers no to everything.
 */
function pretendViewport(width: number) {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => {
        const limit = /max-width:\s*(\d+)px/.exec(query)?.[1];
        return {
            matches: limit !== undefined && width <= Number(limit),
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        };
    }) as typeof window.matchMedia;
    return () => {
        window.matchMedia = original;
    };
}

describe('LiveSignalsPage on a phone', () => {
    let restore = () => {};

    beforeEach(() => {
        restore = pretendViewport(390);
    });

    afterEach(() => {
        restore();
    });

    it('folds every filter away behind one button, and opens them all at once', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        expect(screen.queryByRole('button', { name: /^Contracts:/ })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Filter by symbol' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Filters' }));

        expect(screen.getByRole('button', { name: 'Contracts: All' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Moneyness: All' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Filter by symbol' })).toBeTruthy();
    });

    it('leaves the week navigation out of the fold, so the weeks stay one press away', async () => {
        renderPage();
        await screen.findByTestId('week-grid');

        expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
    });

    it('says so on the button when something is already narrowed', async () => {
        renderPage('/?expiry=active');
        await screen.findByTestId('week-grid');

        expect(screen.getByRole('button', { name: 'Filters' }).className).toContain('narrowed');
    });

    it('opens the fold rather than aiming the caret at a box nobody can see', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        await user.keyboard('/');

        expect(screen.getByRole('textbox', { name: 'Filter by symbol' })).toBe(document.activeElement);
    });

    it('folds a day away by its own heading, and leaves the others alone', async () => {
        const user = userEvent.setup();
        renderPage();
        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(within(monday).getByText('AAPL $100P')).toBeTruthy();

        await user.click(monday.querySelector('.day-fold') as HTMLElement);

        expect(within(monday).queryByText('AAPL $100P')).toBeNull();
        const tuesday = screen.getByRole('region', { name: 'Tuesday Aug 12' });
        expect(within(tuesday).getByText('AMD $100P')).toBeTruthy();
    });

    it('puts the newest day of the week in progress at the top', async () => {
        renderPage();
        await screen.findByTestId('week-grid');

        expect(dayHeadings()).toEqual(['Tuesday Aug 12', 'Monday Aug 11']);
    });

    it('leaves a week already over reading forwards', async () => {
        fetchWeekSignals.mockResolvedValue(week({ isCurrentWeek: false }));
        renderPage();
        await screen.findByTestId('week-grid');

        expect(dayHeadings()).toEqual(['Monday Aug 11', 'Tuesday Aug 12']);
    });
});

describe('LiveSignalsPage filter shortcuts', () => {
    it('hands the symbol box the caret, and its whole contents, on slash', async () => {
        const user = userEvent.setup();
        renderPage('/?symbol=AMD');
        await screen.findByTestId('week-grid');

        await user.keyboard('/');

        const box = screen.getByLabelText('Filter by symbol') as HTMLInputElement;
        expect(document.activeElement).toBe(box);
        // Selected rather than merely focused: the next symbol replaces the last.
        expect(box.selectionStart).toBe(0);
        expect(box.selectionEnd).toBe(3);
        expect(box.value).toBe('AMD');
    });

    it('walks the contracts filter round with e', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        await user.keyboard('e');
        expect(screen.getByRole('button', { name: 'Contracts: Expired' })).toBeTruthy();

        await user.keyboard('e');
        expect(screen.getByRole('button', { name: 'Contracts: Active' })).toBeTruthy();

        await user.keyboard('e');
        expect(screen.getByRole('button', { name: 'Contracts: All' })).toBeTruthy();
    });

    it('walks the moneyness filter round with m', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        await user.keyboard('m');
        expect(screen.getByRole('button', { name: 'Moneyness: ITM' })).toBeTruthy();

        await user.keyboard('m');
        expect(screen.getByRole('button', { name: 'Moneyness: OTM' })).toBeTruthy();

        await user.keyboard('m');
        expect(screen.getByRole('button', { name: 'Moneyness: All' })).toBeTruthy();
    });

    it('puts all three menus back with r', async () => {
        const user = userEvent.setup();
        renderPage('/?expiry=active&moneyness=itm');
        await screen.findByTestId('week-grid');
        await choose(user, /^Numbers:/, 'VADER');

        await user.keyboard('r');

        expect(screen.getByRole('button', { name: 'Numbers: Actual' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Contracts: All' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Moneyness: All' })).toBeTruthy();
    });

    it('types the filter keys into the symbol box rather than acting on them', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        await user.click(screen.getByLabelText('Filter by symbol'));
        await user.keyboard('emr');

        expect((screen.getByLabelText('Filter by symbol') as HTMLInputElement).value).toBe('EMR');
        expect(screen.getByRole('button', { name: 'Contracts: All' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Moneyness: All' })).toBeTruthy();
    });

    it('leaves the symbol box on escape without discarding what was typed', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByTestId('week-grid');

        const box = screen.getByLabelText('Filter by symbol') as HTMLInputElement;
        await user.click(box);
        await user.keyboard('amd{Escape}');

        expect(document.activeElement).not.toBe(box);
        expect(box.value).toBe('AMD');
    });
});

describe('LiveSignalsPage week score', () => {
    /** The one line above the grid, read as the reader reads it. */
    function scoreLine(): string {
        return document.querySelector('.week-score')?.textContent ?? '';
    }

    it('counts the whole week above the grid', async () => {
        renderPage();
        await screen.findByTestId('week-grid');
        expect(scoreLine()).toContain('3 signals');
    });

    it('scores only what the filters left on screen', async () => {
        renderPage('/?symbol=AAPL');
        await screen.findByTestId('week-grid');
        expect(scoreLine()).toContain('1 signal');
    });

    it('counts the OTM closes against the contracts that have one', async () => {
        fetchWeekSignals.mockResolvedValue(
            week({
                days: [
                    day('2025-08-11', 'Monday', [
                        trade('AAPL', { moneyness: 'otm' }),
                        trade('MSFT', { moneyness: 'itm' }),
                        trade('AMD'),
                    ]),
                    day('2025-08-12', 'Tuesday', [trade('NVDA', { moneyness: 'otm' })]),
                ],
            }),
        );
        renderPage();
        await screen.findByTestId('week-grid');
        expect(scoreLine()).toContain('2 of 3 closed OTM (66.7%)');
    });

    it('averages how far the captured premium landed from VADER', async () => {
        const drifted = week({
            days: [
                day('2025-08-11', 'Monday', [
                    trade('AAPL', { premium: 100, actualPremium: 80 }),
                    trade('MSFT', { premium: 200, actualPremium: 120 }),
                ]),
            ],
        });
        fetchWeekSignals.mockResolvedValue(drifted);
        renderPage();
        await screen.findByTestId('week-grid');
        expect(scoreLine()).toContain('Premium 30.0% under VADER');

        await choose(userEvent.setup(), /^Numbers:/, 'VADER');
        expect(scoreLine()).not.toContain('Premium');
    });

    it('says nothing at all for a week the filters emptied', async () => {
        renderPage('/?symbol=NOTHING');
        await screen.findByTestId('week-grid');
        expect(document.querySelector('.week-score')).toBeNull();
    });

    it('totals the collateral each day would take to secure', async () => {
        renderPage();
        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(within(monday).getByTitle('$20,000 to secure every contract on this day.').textContent).toContain(
            '$20K',
        );

        const tuesday = screen.getByRole('region', { name: 'Tuesday Aug 12' });
        expect(within(tuesday).getByTitle('$10,000 to secure every contract on this day.')).toBeTruthy();
    });

    it('leaves the total off a day with no collateral to report', async () => {
        fetchWeekSignals.mockResolvedValue(
            week({ days: [day('2025-08-11', 'Monday', [trade('AAPL', { collateral: null })])] }),
        );
        renderPage();
        const monday = await screen.findByRole('region', { name: 'Monday Aug 11' });
        expect(monday.querySelector('.day-collateral')).toBeNull();
    });
});

describe('LiveSignalsPage number source', () => {
    /** One Tuesday trade whose captured quote disagrees with VADER on every number. */
    function quotedWeek(extra: Partial<Trade> = {}) {
        return week({
            days: [
                day('2025-08-12', 'Tuesday', [
                    trade('AMD', {
                        delta: -0.2,
                        annualizedYield: 20,
                        premium: 120,
                        actualDelta: -0.31,
                        actualAnnualizedYield: 26.5,
                        actualPremium: 175,
                        ...extra,
                    }),
                ]),
            ],
        });
    }

    async function tuesday(): Promise<HTMLElement> {
        return screen.findByRole('region', { name: 'Tuesday Aug 12' });
    }

    it('opens on the captured numbers, not the advertised ones', async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        const card = await tuesday();

        expect(within(card).getByText('-0.31')).toBeTruthy();
        expect(within(card).getByText('26.5%')).toBeTruthy();
        expect(within(card).getByText('$175')).toBeTruthy();
        // A real quote is never marked as borrowed.
        expect(quotedValues(card)).toEqual([]);
    });

    it('swaps every number back to VADER when asked', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        await tuesday();

        await choose(user, /^Numbers:/, 'VADER');

        expect(screen.getByRole('button', { name: 'Numbers: VADER' })).toBeTruthy();
        const card = await tuesday();
        expect(within(card).getByText('-0.20')).toBeTruthy();
        expect(within(card).getByText('20.0%')).toBeTruthy();
        expect(within(card).getByText('$120')).toBeTruthy();
        // In VADER's own mode there is nothing to mark: these are the source.
        expect(quotedValues(card)).toEqual([]);
    });

    it('remembers the choice for the next visit', async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        const first = renderPage();
        await tuesday();

        await choose(user, /^Numbers:/, 'VADER');
        expect(localStorage.getItem(STORAGE_KEYS.signalNumberSource)).toBe('quoted');

        first.unmount();
        renderPage();
        expect(within(await tuesday()).getByText('$120')).toBeTruthy();
    });

    it('ignores a stored value it does not recognise', async () => {
        localStorage.setItem(STORAGE_KEYS.signalNumberSource, 'nonsense');
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        expect(within(await tuesday()).getByText('$175')).toBeTruthy();
    });

    it('falls back per value, so a half-captured quote keeps what it has', async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek({ actualPremium: null, actualAnnualizedYield: null }));
        renderPage();
        const card = await tuesday();

        expect(within(card).getByText('-0.31')).toBeTruthy();
        expect(quotedValues(card)).toEqual(['20.0% (VADER estimate)', '$120 (VADER estimate)']);
    });

    it('flags a premium taken across a wide spread', async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek({ actualIlliquid: true }));
        renderPage();
        expect(within(await tuesday()).getByText(/wide spread/)).toBeTruthy();
    });

    it('drops the spread flag when the premium is not the captured one', async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek({ actualIlliquid: true, actualPremium: null }));
        renderPage();
        expect(within(await tuesday()).queryByText(/wide spread/)).toBeNull();
    });

    it('shows how far each captured number moved from VADER', async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        const card = await tuesday();

        // Delta absolute: -0.31 against -0.20. Premium percent: 175 against 120.
        expect(within(card).getByText('(0.11)')).toBeTruthy();
        expect(within(card).getByText('(45.8%)')).toBeTruthy();

        expect(within(card).getByText('(0.11)').className).toContain('diff-down');
        expect(within(card).getByText('(45.8%)').className).toContain('diff-up');

        // Delta runs negative, so its arrow reads magnitude and points the other way.
        const arrowOf = (text: string) =>
            within(card).getByText(text).querySelector('.diff-arrow path')?.getAttribute('d') ?? '';
        expect(arrowOf('(45.8%)')).toBeTruthy();
        expect(arrowOf('(0.11)')).toBe(arrowOf('(45.8%)'));
    });

    it("hides the differences in VADER's own mode, where there is nothing to compare", async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        await tuesday();

        await choose(user, /^Numbers:/, 'VADER');

        const card = await tuesday();
        expect(within(card).queryByText('(0.11)')).toBeNull();
        expect(within(card).queryByText('(45.8%)')).toBeNull();
    });

    it("leaves a fallen-back number undifferenced, since it is VADER's already", async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek({ actualPremium: null }));
        renderPage();
        const card = await tuesday();

        expect(within(card).getByText('(0.11)')).toBeTruthy();
        expect(within(card).queryByText('(45.8%)')).toBeNull();
    });
});

describe('LiveSignalsPage moneyness', () => {
    function closedWeek(extra: Partial<Trade> = {}) {
        return week({
            days: [
                day('2025-08-12', 'Tuesday', [
                    trade('AMD', {
                        strike: 100,
                        closeDate: '2025-08-14',
                        closeUnderlying: 103.2,
                        moneyness: 'otm',
                        percentFromStrike: 3.2,
                        ...extra,
                    }),
                ]),
            ],
        });
    }

    async function tuesday(): Promise<HTMLElement> {
        return screen.findByRole('region', { name: 'Tuesday Aug 12' });
    }

    function badge(card: HTMLElement): HTMLElement | null {
        return card.querySelector('.moneyness');
    }

    it('reads a close above the strike as out of the money', async () => {
        fetchWeekSignals.mockResolvedValue(closedWeek());
        renderPage();
        const found = badge(await tuesday());

        expect(found?.className).toContain('otm');
        expect(found?.textContent).toContain('OTM');
        expect(found?.textContent).toContain('+3.2%');
        expect(found?.getAttribute('title')).toContain('8/14/2025');
    });

    it('reads a close below the strike as in the money, signed negative', async () => {
        fetchWeekSignals.mockResolvedValue(
            closedWeek({ closeUnderlying: 94.5, moneyness: 'itm', percentFromStrike: -5.5 }),
        );
        renderPage();
        const found = badge(await tuesday());

        expect(found?.className).toContain('itm');
        expect(found?.textContent).toContain('ITM');
        expect(found?.textContent).toContain('-5.5%');
    });

    it('renders nothing at all for a contract with no close', async () => {
        fetchWeekSignals.mockResolvedValue(
            closedWeek({ closeDate: null, closeUnderlying: null, moneyness: null, percentFromStrike: null }),
        );
        renderPage();
        expect(badge(await tuesday())).toBeNull();
    });

    it("stays put in VADER's mode, being an outcome rather than a competing quote", async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(closedWeek());
        renderPage();
        await tuesday();

        await choose(user, /^Numbers:/, 'VADER');

        expect(badge(await tuesday())?.textContent).toContain('OTM');
    });
});
