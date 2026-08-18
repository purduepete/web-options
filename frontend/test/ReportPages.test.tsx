import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReportCallout, WeeklyReport, WeeklyReportSummary } from '@weboptions/shared';

const fetchReports = vi.fn();
const fetchReport = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchReports: () => fetchReports(),
        fetchReport: (publishDate: string) => fetchReport(publishDate),
    };
});

vi.mock('../src/auth/ApiKeyProvider', () => ({
    useApiKey: () => ({ status: 'ready', forget: () => {} }),
}));

const { ReportWeekPage } = await import('../src/pages/ReportWeekPage');
const { LatestReportPage } = await import('../src/pages/LatestReportPage');
const { NotFoundError } = await import('../src/api');

function callout(ticker: string, extra: Partial<ReportCallout> = {}): ReportCallout {
    return { ticker, kind: 'roll', headline: `${ticker} headline`, body: null, ...extra };
}

function report(extra: Partial<WeeklyReport> = {}): WeeklyReport {
    return {
        publishDate: '2026-08-17',
        title: null,
        sourceUrl: 'https://themultiplier.substack.com/p/6853-in-weekly-options-income-from',
        macro: [{ label: 'VIX', text: 'lowest close of the period' }],
        metrics: {
            netPnl: 6853,
            closedLegs: 38,
            winningLegs: 35,
            rollLegs: 3,
            hitRate: 92.1,
            winnersAmount: 6911,
            rollCost: 58,
            collateral: 455150,
            returnPct: 1.51,
            newPositions: 38,
            newPremium: 12853,
            netCash: 8748,
            medianDaysHeld: 10,
            openPositionsTotal: 87,
            openCalls: 55,
            openPuts: 32,
            openGreen: 23,
            openYellow: 24,
            openRed: 40,
        },
        callouts: [callout('ALB', { headline: 'Roll chain closed near max profit' })],
        ...extra,
    };
}

function renderWeek(publishDate = '2026-08-17') {
    return render(
        <MemoryRouter initialEntries={[`/reports/${publishDate}`]}>
            <Routes>
                <Route path="/reports/:publishDate" element={<ReportWeekPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

/** Newest first, the order the index endpoint returns. */
function archive(): WeeklyReportSummary[] {
    return [
        { publishDate: '2026-08-17', title: null, netPnl: 6853, hitRate: 92.1, calloutCount: 1 },
        { publishDate: '2026-08-03', title: null, netPnl: 4200, hitRate: 88.4, calloutCount: 2 },
    ];
}

function button(name: string): HTMLElement {
    return screen.getByRole('button', { name });
}

beforeEach(() => {
    fetchReports.mockReset();
    fetchReport.mockReset();
    fetchReports.mockResolvedValue({ reports: [] });
});

describe('ReportWeekPage', () => {
    it('leads with a fallback title built from the publish date when the newsletter had none', async () => {
        fetchReport.mockResolvedValue(report());
        renderWeek();
        expect(await screen.findByRole('heading', { name: 'Report for 08/17/2026' })).toBeTruthy();
    });

    it('uses the given title when present', async () => {
        fetchReport.mockResolvedValue(report({ title: 'A quiet week' }));
        renderWeek();
        expect(await screen.findByRole('heading', { name: 'A quiet week' })).toBeTruthy();
    });

    it('shows the macro notes', async () => {
        fetchReport.mockResolvedValue(report());
        renderWeek();
        await screen.findByRole('heading', { name: 'Report for 08/17/2026' });
        expect(screen.getByText('VIX')).toBeTruthy();
        expect(screen.getByText('lowest close of the period')).toBeTruthy();
    });

    it('renders the headline metric cards', async () => {
        fetchReport.mockResolvedValue(report());
        renderWeek();
        const summary = await screen.findByTestId('report-summary');
        expect(within(summary).getByText('$6,853')).toBeTruthy();
        expect(within(summary).getByText('92.1%')).toBeTruthy();
        expect(within(summary).getByText('23 / 24 / 40')).toBeTruthy();
    });

    it('renders a notable-trade callout', async () => {
        fetchReport.mockResolvedValue(report());
        renderWeek();
        const callouts = await screen.findByTestId('report-callouts');
        expect(within(callouts).getByText('ALB')).toBeTruthy();
        expect(within(callouts).getByText('Roll chain closed near max profit')).toBeTruthy();
    });

    it('says so plainly when a week has no callouts, instead of leaving a blank space', async () => {
        fetchReport.mockResolvedValue(report({ callouts: [] }));
        renderWeek();
        expect(await screen.findByText('No notable trade write-ups for this week.')).toBeTruthy();
    });

    it('says plainly when nothing was ingested for that date', async () => {
        fetchReport.mockRejectedValue(new NotFoundError());
        renderWeek('2026-01-01');
        expect((await screen.findByRole('alert')).textContent).toBe('No report was ingested for that date.');
        expect(screen.queryByTestId('report-summary')).toBeNull();
    });

    it('steps through the archive to the nearest existing report, not a fixed weekly offset', async () => {
        fetchReport.mockResolvedValue(report());
        fetchReports.mockResolvedValue({ reports: archive() });
        renderWeek('2026-08-17');
        await screen.findByRole('heading', { name: 'Report for 08/17/2026' });

        await waitFor(() => expect(button('Previous').hasAttribute('disabled')).toBe(false));
        fireEvent.click(button('Previous'));
        // Nearest existing report is 2026-08-03, not 2026-08-10 (one week back).
        await waitFor(() => expect(fetchReport).toHaveBeenCalledWith('2026-08-03'));
    });

    it('stops at the ends of a sparse archive', async () => {
        fetchReport.mockResolvedValue(report());
        fetchReports.mockResolvedValue({ reports: archive() });
        renderWeek('2026-08-03');
        await screen.findByRole('heading', { name: 'Report for 08/17/2026' });

        expect(button('First').hasAttribute('disabled')).toBe(true);
        expect(button('Previous').hasAttribute('disabled')).toBe(true);
        await waitFor(() => expect(button('Next').hasAttribute('disabled')).toBe(false));
    });
});

describe('LatestReportPage', () => {
    function renderLatest() {
        return render(
            <MemoryRouter initialEntries={['/reports/latest']}>
                <Routes>
                    <Route path="/reports/latest" element={<LatestReportPage />} />
                    <Route path="/reports/:publishDate" element={<p>the report itself</p>} />
                </Routes>
            </MemoryRouter>,
        );
    }

    it('hands the reader to the newest report', async () => {
        fetchReports.mockResolvedValue({ reports: archive() });
        renderLatest();
        expect(await screen.findByText('the report itself')).toBeTruthy();
    });

    it('says so plainly when nothing has been ingested yet, rather than hanging on a spinner', async () => {
        fetchReports.mockResolvedValue({ reports: [] });
        renderLatest();
        expect(await screen.findByText('Nothing ingested yet.')).toBeTruthy();
    });
});
