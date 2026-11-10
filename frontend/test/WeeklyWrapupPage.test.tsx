import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { WRAPUP_HEADERS, type WeeklyWrapup } from '@weboptions/shared';
import { WeeklyWrapupPage } from '../src/pages/WeeklyWrapupPage';

const mocks = vi.hoisted(() => ({ index: vi.fn(), report: vi.fn(), forget: vi.fn() }));
vi.mock('../src/api', async () => ({
    ...(await vi.importActual('../src/api')),
    fetchWrapups: () => mocks.index(),
    fetchWrapup: (id: string) => mocks.report(id),
}));
vi.mock('../src/auth/ApiKeyProvider', () => ({ useApiKey: () => ({ forget: mocks.forget }) }));

function fixture(): WeeklyWrapup {
    const contract = { symbol: 'TEST', strike: 100, optionRight: 'P' as const, expiration: '2027-01-15' };
    return {
        version: 1,
        id: '2026-11-06',
        sourceUrl: 'https://example.com/report',
        sourceHash: 'a'.repeat(64),
        importedAt: '2026-11-09T17:00:00-08:00',
        sections: {
            management: {
                name: 'Management Plan',
                start: '2026-11-09',
                end: '2026-11-13',
                quoteDate: '2026-11-06',
                tables: [
                    {
                        kind: 'management',
                        headers: [...WRAPUP_HEADERS.management],
                        rows: [
                            {
                                sourceRow: 4,
                                contract,
                                newContract: null,
                                cells: [
                                    'RED',
                                    'HOLD',
                                    'Review',
                                    'TEST',
                                    '1',
                                    '$100P',
                                    '2027-01-15',
                                    '$95',
                                    '-25%',
                                    '-0.5',
                                    '<img src=x onerror=alert(1)>',
                                ],
                            },
                            {
                                sourceRow: 5,
                                contract,
                                newContract: null,
                                cells: [
                                    'RED',
                                    'HOLD',
                                    'Review',
                                    'TEST',
                                    '1',
                                    '$100P',
                                    '2027-01-15',
                                    '$95',
                                    '-26%',
                                    '-0.5',
                                    'Distinct entry guidance',
                                ],
                            },
                        ],
                    },
                ],
                audit: { calls: [6], notes: [1, 2] },
                headerRows: [3],
                sourceRows: 6,
            },
            closed: {
                name: 'Closed Trades',
                start: '2026-11-02',
                end: '2026-11-06',
                quoteDate: null,
                tables: [
                    { kind: 'closed', headers: [...WRAPUP_HEADERS.closed], rows: [] },
                    { kind: 'controlled', headers: [...WRAPUP_HEADERS.controlled], rows: [] },
                ],
                audit: { calls: [], notes: [] },
                headerRows: [1, 2],
                sourceRows: 2,
            },
            rolls: {
                name: 'Rolls',
                start: '2026-11-02',
                end: '2026-11-06',
                quoteDate: null,
                tables: [{ kind: 'rolls', headers: [...WRAPUP_HEADERS.rolls], rows: [] }],
                audit: { calls: [], notes: [] },
                headerRows: [1],
                sourceRows: 1,
            },
        },
    };
}
function open(entry = '/weekly-wrapups') {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Link to="/weekly-wrapups?report=2026-11-06&view=management&row=5#management-row-5">Linked guidance</Link>
            <WeeklyWrapupPage />
        </MemoryRouter>
    );
}
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.index.mockResolvedValue({ reports: [{ id: '2026-11-06', start: '2026-11-02', end: '2026-11-06' }] });
    mocks.report.mockResolvedValue(fixture());
});
describe('WeeklyWrapupPage', () => {
    it('selects and focuses a linked row when the wrap-up page is already mounted on Rolls', async () => {
        open('/weekly-wrapups?report=2026-11-06&view=rolls');
        await screen.findByRole('heading', { name: 'Rolls' });
        fireEvent.click(screen.getByRole('link', { name: 'Linked guidance' }));
        await waitFor(() => expect(document.activeElement?.id).toBe('management-row-5'));
        expect(screen.getByRole('button', { name: 'Management Plan' }).getAttribute('aria-pressed')).toBe('true');
    });
    it('opens and focuses the linked Management Plan row despite a different saved view', async () => {
        localStorage.setItem('weekly_wrapup_view', 'rolls');
        const { container } = open('/weekly-wrapups?report=2026-11-06&view=management&row=5#management-row-5');
        await screen.findByText('Distinct entry guidance');
        await waitFor(() => expect(document.activeElement).toBe(container.querySelector('#management-row-5')));
        expect(screen.getByRole('button', { name: 'Management Plan' }).getAttribute('aria-pressed')).toBe('true');
    });
    it('renders only the 3 selected views, formatted dates, and duplicate contract rows', async () => {
        const { container } = open();
        expect(await screen.findByText('Distinct entry guidance')).toBeTruthy();
        expect(screen.getAllByRole('article')).toHaveLength(2);
        expect(screen.getAllByText('01/15/2027')).toHaveLength(2);
        expect(screen.getByText(/Guidance: 11\/09\/2026 - 11\/13\/2026/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Weekly Overview' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Disclaimer' })).toBeNull();
        expect(container.querySelector('select, datalist, [title], img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    });
    it('switches views, preserves preference, and keeps independent reporting dates', async () => {
        open();
        await screen.findByText('Distinct entry guidance');
        fireEvent.click(screen.getByRole('button', { name: 'Closed Trades' }));
        await screen.findByRole('heading', { name: 'Controlled exits (roll close-legs)' });
        expect(screen.getByText('Reporting period: 11/02/2026 - 11/06/2026')).toBeTruthy();
        expect(localStorage.getItem('weekly_wrapup_view')).toBe('closed');
        fireEvent.click(screen.getByRole('button', { name: 'Rolls' }));
        expect(await screen.findByText(/Roll transaction net is a separate cash flow/)).toBeTruthy();
    });
    it('waits for index and detail before revealing an empty state', async () => {
        let complete: ((value: WeeklyWrapup) => void) | undefined;
        mocks.report.mockImplementation(
            () =>
                new Promise<WeeklyWrapup>((resolve) => {
                    complete = resolve;
                })
        );
        open();
        await waitFor(() => expect(mocks.report).toHaveBeenCalled());
        expect(screen.queryByText('No weekly reports imported')).toBeNull();
        expect(screen.queryByText('Puts only')).toBeNull();
        complete!(fixture());
        expect(await screen.findByText('Puts only')).toBeTruthy();
    });
    it('shows a real empty index without requesting a report', async () => {
        mocks.index.mockResolvedValue({ reports: [] });
        open();
        expect(await screen.findByText('No weekly reports imported')).toBeTruthy();
        expect(mocks.report).not.toHaveBeenCalled();
    });
    it('surfaces failure and retries', async () => {
        mocks.index.mockRejectedValueOnce(new Error('Report storage unavailable'));
        open();
        expect(await screen.findByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('Distinct entry guidance')).toBeTruthy();
    });
});
