import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    return screen
        .queryAllByRole('button', { expanded: true })
        .concat(screen.queryAllByRole('button', { expanded: false }))
        .map((button) => button.textContent ?? '');
}

/** Every number inside `scope` that fell back to VADER, in document order. */
function quotedValues(scope: HTMLElement): string[] {
    return Array.from(scope.querySelectorAll('.value-quoted')).map((node) => node.textContent ?? '');
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
        expect(container.querySelector('.page-head h1')?.textContent).toBe('');
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

    it('steps back a week and records it in the URL', async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        await user.click(screen.getByRole('button', { name: 'Previous' }));

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

        await user.click(screen.getByRole('button', { name: 'Previous' }));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Monday Aug 11' })).toBeNull());

        arrive(week({ weekStart: '2025-08-04', weekEnd: '2025-08-08' }));
        expect(await screen.findByRole('region', { name: 'Monday Aug 11' })).toBeTruthy();
    });

    it('will not step forward when the server says there is nothing there', async () => {
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });
        expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Current' }).hasAttribute('disabled')).toBe(true);
    });

    it('keeps the two step buttons next to each other', async () => {
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        const nav = document.querySelector('.week-nav');
        const labels = [...(nav?.querySelectorAll('button') ?? [])].map((button) => button.textContent);

        expect(labels).toEqual(['First', 'Previous', 'Next', 'Current']);
    });

    it('jumps to the earliest week the server knows about', async () => {
        const user = userEvent.setup();
        fetchEarliestWeek.mockResolvedValue({ weekStart: '2025-01-06' });
        renderPage();
        await screen.findByRole('heading', { name: 'Week of Aug 11 – Aug 15' });

        await user.click(screen.getByRole('button', { name: 'First' }));

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

        await user.click(screen.getByRole('radio', { name: 'VADER' }));

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

        await user.click(screen.getByRole('radio', { name: 'VADER' }));
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
        expect(within(card).getByText('-0.11')).toBeTruthy();
        expect(within(card).getByText('+45.8%')).toBeTruthy();
    });

    it("hides the differences in VADER's own mode, where there is nothing to compare", async () => {
        const user = userEvent.setup();
        fetchWeekSignals.mockResolvedValue(quotedWeek());
        renderPage();
        await tuesday();

        await user.click(screen.getByRole('radio', { name: 'VADER' }));

        const card = await tuesday();
        expect(within(card).queryByText('-0.11')).toBeNull();
        expect(within(card).queryByText('+45.8%')).toBeNull();
    });

    it("leaves a fallen-back number undifferenced, since it is VADER's already", async () => {
        fetchWeekSignals.mockResolvedValue(quotedWeek({ actualPremium: null }));
        renderPage();
        const card = await tuesday();

        expect(within(card).getByText('-0.11')).toBeTruthy();
        expect(within(card).queryByText('+45.8%')).toBeNull();
    });
});
