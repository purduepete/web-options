import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CalendarDay, CalendarTrade, CalendarWeek } from '@weboptions/shared';

const fetchCalendars = vi.fn();
const fetchCalendar = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchCalendars: () => fetchCalendars(),
        fetchCalendar: (publishDate: string) => fetchCalendar(publishDate),
    };
});

vi.mock('../src/auth/ApiKeyProvider', () => ({
    useApiKey: () => ({ status: 'ready', forget: () => {} }),
}));

const { CalendarsIndexPage } = await import('../src/pages/CalendarsIndexPage');
const { CalendarWeekPage } = await import('../src/pages/CalendarWeekPage');
const { NotFoundError } = await import('../src/api');

function trade(ticker: string, extra: Partial<CalendarTrade> = {}): CalendarTrade {
    return {
        ticker,
        optionRight: 'P',
        strike: 175,
        expiry: '2026-09-18',
        dte: 42,
        delta: -0.19,
        annualizedYield: 9.7,
        premium: 195,
        collateral: 17500,
        risk: 'conservative',
        note: null,
        ...extra,
    };
}

function day(name: string, date: string, extra: Partial<CalendarDay> = {}): CalendarDay {
    return { name, date, rule: null, event: null, trades: [], ...extra };
}

function calendar(extra: Partial<CalendarWeek> = {}): CalendarWeek {
    return {
        publishDate: '2026-08-10',
        weekStart: '2026-08-10',
        weekEnd: '2026-08-14',
        title: 'Rally week',
        macro: [{ label: 'S&P 500 at a record close', text: 'Give new calls extra room.' }],
        days: [
            day('Monday', '2026-08-10', {
                rule: 'Sell puts on steady names.',
                trades: [trade('PM'), trade('NEM', { risk: 'balanced', annualizedYield: 24.9, collateral: 10500 })],
            }),
            day('Wednesday', '2026-08-12', { event: 'Key event: July CPI release.' }),
        ],
        ...extra,
    };
}

function renderWeek(publishDate = '2026-08-10') {
    return render(
        <MemoryRouter initialEntries={[`/calendars/${publishDate}`]}>
            <Routes>
                <Route path="/calendars/:publishDate" element={<CalendarWeekPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    fetchCalendars.mockReset();
    fetchCalendar.mockReset();
});

describe('CalendarsIndexPage', () => {
    function renderIndex() {
        return render(
            <MemoryRouter>
                <CalendarsIndexPage />
            </MemoryRouter>,
        );
    }

    it('badges only the newest week', async () => {
        fetchCalendars.mockResolvedValue({
            calendars: [
                {
                    publishDate: '2026-08-10',
                    weekStart: '2026-08-10',
                    weekEnd: '2026-08-14',
                    title: null,
                    tradeCount: 9,
                },
                {
                    publishDate: '2026-08-03',
                    weekStart: '2026-08-03',
                    weekEnd: '2026-08-07',
                    title: null,
                    tradeCount: 4,
                },
            ],
        });
        renderIndex();

        const cards = await screen.findAllByRole('listitem');
        expect(screen.getAllByText('Latest')).toHaveLength(1);
        expect(within(cards[0]!).getByText('Latest')).toBeTruthy();
        expect(within(cards[0]!).getByRole('heading', { name: 'Aug 10 – Aug 14' })).toBeTruthy();
    });

    it('counts the trades and links to the week', async () => {
        fetchCalendars.mockResolvedValue({
            calendars: [
                {
                    publishDate: '2026-08-10',
                    weekStart: '2026-08-10',
                    weekEnd: '2026-08-14',
                    title: null,
                    tradeCount: 1,
                },
            ],
        });
        renderIndex();

        expect(await screen.findByText('1 trade')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Open calendar' }).getAttribute('href')).toBe('/calendars/2026-08-10');
    });

    it('mentions the publish date only when it is not the Monday', async () => {
        fetchCalendars.mockResolvedValue({
            calendars: [
                {
                    publishDate: '2026-08-09',
                    weekStart: '2026-08-10',
                    weekEnd: '2026-08-14',
                    title: null,
                    tradeCount: 3,
                },
            ],
        });
        renderIndex();

        expect(await screen.findByText('3 trades · published 08/09/2026')).toBeTruthy();
    });

    it('says the archive is empty rather than showing a bare list', async () => {
        fetchCalendars.mockResolvedValue({ calendars: [] });
        renderIndex();
        expect(await screen.findByText('No weekly calendars have been ingested yet.')).toBeTruthy();
    });

    it('reports a failure', async () => {
        fetchCalendars.mockRejectedValue(new Error('nope'));
        renderIndex();
        expect((await screen.findByRole('alert')).textContent).toContain('nope');
    });
});

describe('CalendarWeekPage', () => {
    it('leads with the title and the macro notes', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        renderWeek();

        expect(await screen.findByRole('heading', { name: 'Rally week' })).toBeTruthy();
        expect(screen.getByText('Aug 10 – Aug 14 · published 08/10/2026')).toBeTruthy();
        expect(screen.getByText('S&P 500 at a record close')).toBeTruthy();
        expect(screen.getByText('Give new calls extra room.')).toBeTruthy();
    });

    it('falls back to the week range when the newsletter had no title', async () => {
        fetchCalendar.mockResolvedValue(calendar({ title: null }));
        renderWeek();
        expect(await screen.findByRole('heading', { name: 'Week of Aug 10 – Aug 14' })).toBeTruthy();
    });

    it('draws a card per day carrying its rule and its event', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        renderWeek();

        const monday = await screen.findByRole('region', { name: 'Monday Aug 10' });
        expect(within(monday).getByText('Sell puts on steady names.')).toBeTruthy();

        const wednesday = screen.getByRole('region', { name: 'Wednesday Aug 12' });
        expect(within(wednesday).getByText('Key event: July CPI release.')).toBeTruthy();
    });

    it('groups a day by risk and shows the ticket numbers', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        renderWeek();

        const monday = await screen.findByRole('region', { name: 'Monday Aug 10' });
        expect(
            within(monday)
                .getAllByRole('heading', { level: 3 })
                .map((h) => h.textContent),
        ).toEqual(['Conservative', 'Balanced']);
        expect(within(monday).getByText('PM $175P')).toBeTruthy();
        expect(within(monday).getByText('9.7%')).toBeTruthy();
        expect(within(monday).getByText('$17,500')).toBeTruthy();
        expect(within(monday).getByText('$10,500')).toBeTruthy();
    });

    it('tells a quiet day to follow the rule instead of leaving it blank', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        renderWeek();

        const wednesday = await screen.findByRole('region', { name: 'Wednesday Aug 12' });
        expect(within(wednesday).getByText('No new positions scheduled. Follow the rule above.')).toBeTruthy();
    });

    it('shows a trade note when the newsletter gave one', async () => {
        fetchCalendar.mockResolvedValue(
            calendar({
                days: [day('Monday', '2026-08-10', { trades: [trade('PM', { note: '7.7% cushion.' })] })],
            }),
        );
        renderWeek();
        expect(await screen.findByText('7.7% cushion.')).toBeTruthy();
    });

    it('says plainly when nothing was ingested for that date', async () => {
        fetchCalendar.mockRejectedValue(new NotFoundError());
        renderWeek('2026-01-01');
        expect((await screen.findByRole('alert')).textContent).toBe('No calendar was ingested for that date.');
        expect(screen.queryByTestId('calendar-grid')).toBeNull();
    });

    it('always offers the way back to the archive', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        renderWeek();
        await screen.findByRole('heading', { name: 'Rally week' });
        expect(screen.getByRole('link', { name: '← All weekly calendars' }).getAttribute('href')).toBe('/calendars');
    });

    it('gathers the back link and the macro read into one pinned block', async () => {
        fetchCalendar.mockResolvedValue(calendar());
        const { container } = renderWeek();
        await screen.findByRole('heading', { name: 'Rally week' });

        const head = container.querySelector('.calendar-head');
        expect(head).toBeTruthy();
        expect(head?.querySelector('.calendar-back')).toBeTruthy();
        expect(head?.querySelector('.macro-banner')).toBeTruthy();
        // The day names stop underneath it, so its height has to be measured.
        expect(document.documentElement.style.getPropertyValue('--calendar-head-height')).not.toBe('');
    });
});
