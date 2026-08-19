import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SUMMARY_COLUMNS } from '@weboptions/shared';
import type { SummaryCell, SummaryColumn, WeekSummaryRow } from '@weboptions/shared';

const fetchSignalMonths = vi.fn();
const fetchSignalSummary = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchSignalMonths: () => fetchSignalMonths(),
        fetchSignalSummary: (month: string, symbols?: readonly string[], expiry?: string) =>
            fetchSignalSummary(month, symbols, expiry),
    };
});

const forget = vi.fn();
// Stable like the real provider: a fresh identity would refire the fetch effect.
const apiKey = { status: 'ready', forget };

vi.mock('../src/auth/ApiKeyProvider', () => ({
    useApiKey: () => apiKey,
}));

const { UnauthorizedError } = await import('../src/api');
const { SummaryPage } = await import('../src/pages/SummaryPage');

function cell(extra: Partial<SummaryCell> = {}): SummaryCell {
    return {
        signals: 0,
        priced: 0,
        otm: 0,
        captured: 0,
        premium: null,
        collateral: null,
        annualizedYield: null,
        ...extra,
    };
}

function cells(overrides: Partial<Record<SummaryColumn, SummaryCell>> = {}): Record<SummaryColumn, SummaryCell> {
    const built = {} as Record<SummaryColumn, SummaryCell>;
    for (const column of SUMMARY_COLUMNS) built[column] = cell();
    return { ...built, ...overrides };
}

function row(
    weekStart: string,
    weekEnd: string,
    overrides: Partial<Record<SummaryColumn, SummaryCell>> = {},
): WeekSummaryRow {
    return { weekStart, weekEnd, cells: cells(overrides) };
}

/** Two months, newest first, exactly as the route orders them. */
const MONTHS = {
    months: [
        { month: '2026-08', label: 'August 2026', weekStarts: ['2026-08-10', '2026-08-03'] },
        { month: '2026-07', label: 'July 2026', weekStarts: ['2026-07-06'] },
    ],
};

const AUGUST = {
    month: '2026-08',
    symbols: [],
    weeks: [
        row('2026-08-10', '2026-08-14', {
            all: cell({
                signals: 4,
                priced: 4,
                otm: 3,
                captured: 2,
                premium: 520,
                annualizedYield: 36,
            }),
            balanced: cell({ signals: 4, priced: 4, otm: 3, captured: 4, premium: 520, annualizedYield: 36 }),
        }),
        row('2026-08-03', '2026-08-07'),
    ],
    total: cells({
        all: cell({ signals: 4, priced: 4, otm: 3, captured: 2, premium: 520, annualizedYield: 36 }),
        balanced: cell({ signals: 4, priced: 4, otm: 3, captured: 4, premium: 520, annualizedYield: 36 }),
    }),
};

function renderPage(entry = '/summary') {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <SummaryPage />
        </MemoryRouter>,
    );
}

/** The months showing numbers they have been told are out of date. */
function waiting(): Element[] {
    return Array.from(document.querySelectorAll('[aria-busy="true"]'));
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fetchSignalMonths.mockResolvedValue(MONTHS);
    fetchSignalSummary.mockResolvedValue(AUGUST);
});

describe('SummaryPage', () => {
    it('opens the newest month and fetches only that one', async () => {
        renderPage();

        await screen.findByRole('table');

        expect(fetchSignalSummary).toHaveBeenCalledTimes(1);
        expect(fetchSignalSummary).toHaveBeenCalledWith('2026-08', [], 'all');
        expect(screen.getByRole('button', { name: /August 2026/ }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: /July 2026/ }).getAttribute('aria-expanded')).toBe('false');
    });

    it('gives every risk group a column, but no catch-all one', async () => {
        renderPage();

        const table = await screen.findByRole('table');
        const headers = within(table).getAllByRole('columnheader');

        expect(headers.map((header) => header.textContent)).toEqual([
            'Week',
            'Top Picks',
            'Conservative',
            'Balanced',
            'Aggressive',
            'All',
        ]);
    });

    it('colours each risk group the way the week grid does', async () => {
        renderPage();

        const table = await screen.findByRole('table');
        const headers = within(table).getAllByRole('columnheader');

        expect(headers[1]?.getAttribute('class')).toBe('summary-column-top-picks');
        expect(headers[4]?.getAttribute('class')).toBe('summary-column-aggressive');
    });

    it('keeps a week with nothing in it, and says so', async () => {
        renderPage();

        const table = await screen.findByRole('table');
        const rows = within(table).getAllByRole('row');

        // Header, both weeks with the empty one included, then the month.
        expect(rows).toHaveLength(4);
        expect(within(rows[2]!).getAllByText('No signals').length).toBe(SUMMARY_COLUMNS.length);
    });

    it('closes the month with a total row of its own', async () => {
        renderPage();

        const table = await screen.findByRole('table');
        const rows = within(table).getAllByRole('row');
        const total = rows[3]!;

        expect(total.getAttribute('class')).toBe('summary-total');
        expect(within(total).getByRole('rowheader').textContent).toBe('August 2026');
        // A total is read, not navigated: no link back into the grid.
        expect(within(total).queryByRole('link')).toBeNull();
        expect(within(total).getAllByText('$520').length).toBe(2);
    });

    it('names each table by its month, since every one draws the same headings', async () => {
        renderPage();

        const table = await screen.findByRole('table', { name: 'August 2026' });

        expect(table).toBeTruthy();
    });

    it('links each week straight into the grid', async () => {
        renderPage();

        const link = await screen.findByRole('link', { name: /Week of Aug 10/ });

        expect(link.getAttribute('href')).toBe('/?week=2026-08-10');
    });

    it('shows the captured numbers, falling back to VADER where none were caught', async () => {
        renderPage();

        await screen.findByRole('table');

        expect(screen.getAllByText('$520').length).toBe(4);
        expect(screen.getAllByText('36.0%').length).toBe(4);
    });

    it('marks only the figure that borrowed VADER numbers for part of its group', async () => {
        renderPage();

        await screen.findByRole('table');
        const [balanced, all] = screen.getAllByText('$520');

        // Balanced caught all four quotes; the total leaned on VADER for two.
        expect(balanced?.getAttribute('class')).not.toContain('value-quoted');
        expect(all?.getAttribute('class')).toContain('value-quoted');
    });

    it('rates OTM against the contracts that have a close', async () => {
        renderPage();

        await screen.findByRole('table');

        expect(screen.getAllByText('75.0%').length).toBe(4);
    });

    it('fetches a month when it is opened, and not again when it is reopened', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        const july = screen.getByRole('button', { name: /July 2026/ });

        await user.click(july);
        await waitFor(() => expect(fetchSignalSummary).toHaveBeenCalledTimes(2));
        expect(fetchSignalSummary).toHaveBeenLastCalledWith('2026-07', [], 'all');

        await user.click(july);
        await user.click(july);
        await waitFor(() => expect(july.getAttribute('aria-expanded')).toBe('true'));
        expect(fetchSignalSummary).toHaveBeenCalledTimes(2);
    });

    it('narrows to the symbols typed, once the typing stops', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        await user.type(screen.getByLabelText(/Filter by symbols/), 'amd, nvda');

        await waitFor(() => expect(fetchSignalSummary).toHaveBeenCalledTimes(2));
        expect(fetchSignalSummary).toHaveBeenLastCalledWith('2026-08', ['AMD', 'NVDA'], 'all');
    });

    it('reloads every open month when the filter changes, in whatever order they answer', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        await user.click(screen.getByRole('button', { name: /July 2026/ }));
        await waitFor(() => expect(screen.getAllByRole('table').length).toBe(2));

        const pending = new Map<string, (value: unknown) => void>();
        fetchSignalSummary.mockImplementation((month: string) => new Promise((resolve) => pending.set(month, resolve)));

        // Both months refetch under the new filter. Neither table leaves the
        // page while it waits — a spinner in their place would rebuild what the
        // reader is looking at — and the one still waiting says so.
        await user.type(screen.getByLabelText(/Filter by symbols/), 'AMD');
        await waitFor(() => expect(pending.size).toBe(2));
        expect(screen.getAllByRole('table').length).toBe(2);
        expect(waiting().length).toBe(2);

        pending.get('2026-07')!({ ...AUGUST, month: '2026-07', symbols: ['AMD'] });
        await waitFor(() => expect(waiting().length).toBe(1));
        expect(screen.getAllByRole('table').length).toBe(2);

        pending.get('2026-08')!({ ...AUGUST, symbols: ['AMD'] });
        await waitFor(() => expect(waiting().length).toBe(0));
        expect(screen.getAllByRole('table').length).toBe(2);
    });

    it('reads the filter back out of the address it was given', async () => {
        renderPage('/summary?symbols=AMD');

        await screen.findByRole('table');

        expect(fetchSignalSummary).toHaveBeenCalledWith('2026-08', ['AMD'], 'all');
        expect(screen.getByLabelText(/Filter by symbols/).getAttribute('value')).toBe('AMD');
    });

    it('narrows to the contracts chosen, and reads the choice back out of the address', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        await user.click(screen.getByRole('button', { name: /Contracts/ }));
        await user.click(screen.getByRole('menuitemradio', { name: /Expired/ }));

        await waitFor(() => expect(fetchSignalSummary).toHaveBeenCalledTimes(2));
        expect(fetchSignalSummary).toHaveBeenLastCalledWith('2026-08', [], 'expired');
    });

    it('opens with the contracts filter the address asked for', async () => {
        renderPage('/summary?expiry=active');

        await screen.findByRole('table');

        expect(fetchSignalSummary).toHaveBeenCalledWith('2026-08', [], 'active');
    });

    it('clears only its own box when the symbol filter is crossed out', async () => {
        const user = userEvent.setup();
        renderPage('/summary?expiry=expired&symbols=AMD');

        await screen.findByRole('table');
        await user.click(screen.getByRole('button', { name: /Clear the symbol filter/ }));

        await waitFor(() => expect(fetchSignalSummary).toHaveBeenLastCalledWith('2026-08', [], 'expired'));
    });

    it('serves the unfiltered numbers from memory once the filter is cleared', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        await user.type(screen.getByLabelText(/Filter by symbols/), 'AMD');
        await waitFor(() => expect(fetchSignalSummary).toHaveBeenCalledTimes(2));

        await user.click(screen.getByRole('button', { name: /Clear the symbol filter/ }));

        await waitFor(() => expect(screen.getByLabelText(/Filter by symbols/).getAttribute('value')).toBe(''));
        expect(fetchSignalSummary).toHaveBeenCalledTimes(2);
    });

    it('offers the clear control only once something has been typed', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        expect(screen.queryByRole('button', { name: /Clear the symbol filter/ })).toBeNull();

        await user.type(screen.getByLabelText(/Filter by symbols/), 'AMD');

        const clear = await screen.findByRole('button', { name: /Clear the symbol filter/ });
        await user.click(clear);

        await waitFor(() => expect(screen.queryByRole('button', { name: /Clear the symbol filter/ })).toBeNull());
    });

    it('collapses and expands every month on j', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');

        await user.keyboard('j');
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /August 2026/ }).getAttribute('aria-expanded')).toBe('false'),
        );

        await user.keyboard('j');
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /July 2026/ }).getAttribute('aria-expanded')).toBe('true'),
        );
    });

    it('puts the cursor in the filter on slash, without typing the slash', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByRole('table');
        await user.keyboard('/');

        const input = screen.getByLabelText(/Filter by symbols/);
        expect(document.activeElement).toBe(input);
        expect(input.getAttribute('value')).toBe('');
    });

    it('says so plainly when nothing has ever been recorded', async () => {
        fetchSignalMonths.mockResolvedValue({ months: [] });

        renderPage();

        expect(await screen.findByText('No signals have been recorded yet.')).toBeTruthy();
        expect(fetchSignalSummary).not.toHaveBeenCalled();
    });

    it('reports a month that would not load, and does not keep asking', async () => {
        fetchSignalSummary.mockRejectedValue(new Error('boom'));

        renderPage();

        expect(await screen.findByText('This month could not be loaded.')).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(fetchSignalSummary).toHaveBeenCalledTimes(1);
    });

    it('drops the key rather than reporting an error when it is rejected', async () => {
        fetchSignalMonths.mockRejectedValue(new UnauthorizedError());

        renderPage();

        await waitFor(() => expect(forget).toHaveBeenCalled());
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
