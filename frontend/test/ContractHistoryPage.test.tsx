import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HistoryResponse } from '@weboptions/shared';
import { ContractHistoryPage } from '../src/pages/ContractHistoryPage';
import { historyCaptureDotRadius } from '../src/history/format';

const api = vi.hoisted(() => ({ search: vi.fn(), dates: vi.fn(), history: vi.fn(), lock: vi.fn() }));
vi.mock('../src/auth/ApiKeyProvider', () => ({ useApiKey: () => ({ lock: api.lock }) }));
vi.mock('../src/history/api', () => ({
    searchHistoryContracts: api.search,
    getHistoryDates: api.dates,
    getContractHistory: api.history,
}));
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
    LineChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
        <div data-testid="history-chart-data" data-points={JSON.stringify(data)}>
            {children}
        </div>
    ),
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: ({ ticks }: { ticks?: number[] }) => <span data-testid="time-axis" data-ticks={JSON.stringify(ticks)} />,
    YAxis: ({ yAxisId, domain, orientation }: { yAxisId: string; domain?: number[]; orientation?: string }) => (
        <span data-testid={`axis-${yAxisId}`} data-domain={JSON.stringify(domain)} data-orientation={orientation}>
            Axis {yAxisId}
        </span>
    ),
    Line: ({ name }: { name: string }) => <span>{name}</span>,
    ReferenceLine: ({ x, y, label }: { x?: number; y?: number; label?: { value: string } }) => (
        <span data-testid="reference-line" data-x={x} data-y={y}>
            {label?.value}
        </span>
    ),
    ReferenceArea: ({ y1, y2 }: { y1: number; y2: number }) => (
        <span data-testid="itm-area" data-low={y1} data-high={y2} />
    ),
    ReferenceDot: () => <span data-testid="best-marker" />,
}));

const contract = {
    key: 'AAPL  261030P00150000',
    symbol: 'AAPL',
    strike: 150,
    expiration: '2026-10-30',
    added: '2026-10-21',
    tier: 'balanced',
    tiers: ['balanced', 'aggressive'],
    topPick: false,
    underlyingPrice: 160,
    underlyingAt: '2026-10-23T20:10:00Z',
};
const result: HistoryResponse = {
    contract,
    from: '2026-10-23',
    to: '2026-10-23',
    signalDate: '2026-10-21',
    entry: { signalDate: '2026-10-21', mark: 2, delta: -0.28, capturedAt: '2026-10-21T13:35:00Z' },
    analysis: {
        validMarks: 3,
        recordedGaps: 1,
        firstObservedAt: Date.parse('2026-10-21T14:00:00Z'),
        through: Date.parse('2026-10-23T13:45:00Z'),
        best: { time: Date.parse('2026-10-22T14:00:00Z'), mark: 0.8, capturedPercent: 60, dollars: 120 },
        worst: { time: Date.parse('2026-10-21T14:00:00Z'), mark: 2.6, capturedPercent: -30, dollars: -60 },
        latest: { time: Date.parse('2026-10-23T13:45:00Z'), mark: 1.5, capturedPercent: 25, dollars: 50 },
        giveback: { percentagePoints: 35, dollars: 70 },
        targets: [
            {
                percent: 25,
                closingMark: 1.5,
                firstCrossing: {
                    time: Date.parse('2026-10-22T14:00:00Z'),
                    mark: 0.8,
                    capturedPercent: 60,
                    dollars: 120,
                },
            },
            {
                percent: 50,
                closingMark: 1,
                firstCrossing: {
                    time: Date.parse('2026-10-22T14:00:00Z'),
                    mark: 0.8,
                    capturedPercent: 60,
                    dollars: 120,
                },
            },
            { percent: 75, closingMark: 0.5, firstCrossing: null },
        ],
    },
    points: [
        {
            time: Date.parse('2026-10-23T13:45:00Z'),
            sessionDate: '2026-10-23',
            kind: 'open_session',
            mark: 1.5,
            delta: -0.2,
            underlyingPrice: 160,
            priceTime: null,
            deltaTime: null,
            priceReceivedAt: null,
            deltaReceivedAt: null,
            flags: ['wide'],
            reason: null,
        },
    ],
    coverage: {
        observations: 1,
        validPrices: 1,
        validDeltas: 1,
        knownExpected: 1,
        knownPriceGaps: 0,
        knownDeltaGaps: 0,
        unknownSlots: 2,
    },
    warnings: ['Unknown coverage remains visible.'],
};
function mount(query = `?contract=${encodeURIComponent(contract.key)}`) {
    return render(
        <MemoryRouter initialEntries={[`/contract-history${query}`]}>
            <ContractHistoryPage />
        </MemoryRouter>
    );
}
/** A chart stays mounted, hidden, once built, so look only in the one on show. */
function shownChart() {
    return within(document.querySelector<HTMLElement>('.history-chart-pane[data-active="true"]')!);
}
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.search.mockResolvedValue({ items: [contract], hasMore: false, unmappedContracts: 0 });
    api.dates.mockResolvedValue({ dates: ['2026-10-23'] });
    api.history.mockResolvedValue(result);
});
describe('contract history page', () => {
    it('makes the settle capture dot larger than regular capture dots', () => {
        expect(historyCaptureDotRadius('settle')).toBe(5);
        expect(historyCaptureDotRadius('open_session')).toBe(2);
    });

    it('filters the picker to the selected tiers and remembers the choice', async () => {
        const pick = { ...contract, key: 'MSFT  261030P00400000', symbol: 'MSFT', strike: 400, topPick: true };
        const safe = { ...contract, key: 'KO  261030P00060000', symbol: 'KO', strike: 60, tier: 'conservative' };
        api.search.mockResolvedValue({ items: [contract, pick, safe], hasMore: false, unmappedContracts: 0 });
        const { container, unmount } = mount();
        const headings = () =>
            [...container.querySelectorAll('h4')].map((node) => node.firstChild?.textContent?.trim());
        await waitFor(() => expect(headings()).toEqual(['Top Picks', 'Conservative', 'Balanced']));
        fireEvent.click(screen.getByRole('button', { name: 'Tier: Tier' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Top Picks/ }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Conservative/ }));
        expect(headings()).toEqual(['Top Picks', 'Conservative']);
        expect(JSON.parse(localStorage.getItem('history_tier_filter')!)).toEqual(['top-picks', 'conservative']);
        unmount();
        const again = mount();
        await waitFor(() =>
            expect(
                [...again.container.querySelectorAll('h4')].map((node) => node.firstChild?.textContent?.trim())
            ).toEqual(['Top Picks', 'Conservative'])
        );
    });

    it('says when no contract on the date is in the selected tiers', async () => {
        localStorage.setItem('history_tier_filter', JSON.stringify(['aggressive']));
        mount();
        await screen.findByText('No contracts in the selected tiers on this date.');
        expect(screen.getByRole('button', { name: 'Tier: Aggressive' })).toBeTruthy();
    });

    it('reopens the contract picker when the user continues typing after dismissing it', async () => {
        const { container } = mount();
        const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Find VADER contracts' });
        const picker = container.querySelector<HTMLDetailsElement>('.history-contracts')!;
        container.querySelector<HTMLElement>('.history-contracts-body')!.style.position = 'absolute';

        fireEvent.change(input, { target: { value: 'L' } });
        await waitFor(() => expect(picker.open).toBe(true));
        fireEvent.pointerDown(screen.getByRole('heading', { name: 'Contract History' }));
        await waitFor(() => expect(picker.open).toBe(false));

        fireEvent.change(input, { target: { value: 'LR' } });
        await waitFor(() => expect(picker.open).toBe(true));
    });

    it('gives Escape to the nested tier menu before the contract picker', async () => {
        const { container } = mount();
        const picker = container.querySelector<HTMLDetailsElement>('.history-contracts')!;
        container.querySelector<HTMLElement>('.history-contracts-body')!.style.position = 'absolute';
        fireEvent.click(picker.querySelector('summary')!);
        await screen.findByText('Added 10/21/2026');
        const tier = screen.getByRole('button', { name: 'Tier: Tier' });
        fireEvent.click(tier);
        fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: /Top Picks/ }), { key: 'Escape' });

        await waitFor(() => expect(screen.queryByRole('menu', { name: 'Tier' })).toBeNull());
        expect(picker.open).toBe(true);
        expect(document.activeElement).toBe(tier);
    });

    it('closes the floating contract picker on Escape from the search field', async () => {
        const { container } = mount();
        const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Find VADER contracts' });
        const picker = container.querySelector<HTMLDetailsElement>('.history-contracts')!;
        container.querySelector<HTMLElement>('.history-contracts-body')!.style.position = 'absolute';
        fireEvent.change(input, { target: { value: 'L' } });
        await waitFor(() => expect(picker.open).toBe(true));

        expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);

        await waitFor(() => expect(picker.open).toBe(false));
        expect(input.value).toBe('L');
    });
    it('shows only the latest captured percentage on each picker card, including losses and unavailable quotes', async () => {
        api.search.mockResolvedValue({
            items: [
                { ...contract, capturedPercent: 37.74 },
                { ...contract, key: 'MSFT', symbol: 'MSFT', capturedPercent: -12.5 },
                { ...contract, key: 'GM', symbol: 'GM', capturedPercent: null },
            ],
            hasMore: false,
            unmappedContracts: 0,
        });
        mount();
        const captured = await screen.findByLabelText('Premium captured 38%');
        expect(captured.textContent).toBe('38%');
        expect(screen.getByLabelText('Premium captured -13%').textContent).toBe('-13%');
        expect(screen.getByLabelText('Premium captured unavailable').textContent).toBe('--');
    });

    it('colors captured percentages green at 50 percent, using the unrounded value', async () => {
        api.search.mockResolvedValue({
            items: [49.9, 50, 75].map((capturedPercent, index) => ({
                ...contract,
                key: `threshold-${index}`,
                capturedPercent,
            })),
            hasMore: false,
            unmappedContracts: 0,
        });
        const { container } = mount();
        await waitFor(() => expect(container.querySelectorAll('.history-contract-captured')).toHaveLength(3));
        const values = [...container.querySelectorAll('.history-contract-captured')];
        expect(values.map((value) => value.classList.contains('is-target-met'))).toEqual([false, true, true]);
        expect(values.map((value) => value.textContent)).toEqual(['50%', '50%', '75%']);
    });

    it('places delta on the left and price or captured percentage on the right', async () => {
        mount();
        await screen.findByTestId('axis-price');
        expect(screen.getByTestId('axis-price').getAttribute('data-orientation')).toBe('right');
        expect(screen.getByTestId('axis-delta').getAttribute('data-orientation')).toBe('left');
        expect(
            screen.getByRole('img', { name: 'Signed delta on the left axis, premium captured percent on the right.' })
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Chart: Captured %' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Price/ }));
        expect(screen.getByTestId('axis-price').getAttribute('data-orientation')).toBe('right');
        expect(screen.getByTestId('axis-delta').getAttribute('data-orientation')).toBe('left');
        expect(
            screen.getByRole('img', { name: 'Signed delta on the left axis, mark price on the right.' })
        ).toBeTruthy();
    });

    it('shows one chart at a time, retaining the option metric and remembering the chart view', async () => {
        const page = mount();
        await screen.findByText('Premium captured (%)');
        expect(screen.getAllByRole('img')).toHaveLength(1);
        expect(screen.queryByText('Option price and delta')).toBeNull();
        const stockButton = screen.getByRole('button', { name: 'Stock' });
        expect(stockButton.closest('.history-tools')).toBeTruthy();
        fireEvent.click(stockButton);
        expect(stockButton.getAttribute('aria-pressed')).toBe('true');
        // A pane not yet built is built a frame after the click; the old one stays up meanwhile.
        await waitFor(() => expect(shownChart().queryByText('Premium captured (%)')).toBeNull());
        expect(screen.getAllByRole('img')).toHaveLength(1);
        const hidden = document.querySelector('.history-chart-pane[data-active="false"]')!;
        expect(hidden.getAttribute('aria-hidden')).toBe('true');
        expect(hidden.hasAttribute('inert')).toBe(true);
        expect(screen.queryByRole('button', { name: 'Chart: Captured %' })).toBeNull();
        expect(shownChart().getByText('Stock ($ / share)')).toBeTruthy();
        expect(screen.getByText(/Strike \$150.00/).closest('.history-title-row')).toBeTruthy();
        page.unmount();
        mount();
        await screen.findByText('Stock ($ / share)');
        fireEvent.click(screen.getByRole('button', { name: 'Option' }));
        await waitFor(() => expect(shownChart().getByText('Premium captured (%)')).toBeTruthy());
    });

    it('defaults to Option for an invalid stored chart view', async () => {
        localStorage.setItem('history_chart_view', 'invalid');
        mount();
        await screen.findByText('Premium captured (%)');
        expect(screen.getByRole('button', { name: 'Option' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps the day view and date when stepping contracts', async () => {
        const next = { ...contract, key: 'MSFT  261030P00150000', symbol: 'MSFT' };
        api.search.mockResolvedValue({ items: [contract, next], hasMore: false, unmappedContracts: 0 });
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=day&from=2026-10-21&to=2026-10-23`);
        await screen.findByRole('button', { name: 'Next contract' });
        fireEvent.click(screen.getByRole('button', { name: 'Next contract' }));
        await waitFor(() =>
            expect(api.history).toHaveBeenLastCalledWith(
                next.key,
                '2026-10-21',
                '2026-10-21',
                expect.any(AbortSignal),
                contract.added
            )
        );
        expect(screen.getByRole('button', { name: 'View: Intraday' })).toBeTruthy();
    });

    it('steps contracts with the arrow keys, but not while typing', async () => {
        const next = { ...contract, key: 'MSFT  261030P00150000', symbol: 'MSFT' };
        api.search.mockResolvedValue({ items: [contract, next], hasMore: false, unmappedContracts: 0 });
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=day&from=2026-10-21&to=2026-10-23`);
        await screen.findByRole('button', { name: 'Next contract' });
        fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowRight' });
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(api.history).not.toHaveBeenCalledWith(
            next.key,
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        );
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        await waitFor(() =>
            expect(api.history).toHaveBeenLastCalledWith(
                next.key,
                '2026-10-21',
                '2026-10-21',
                expect.any(AbortSignal),
                contract.added
            )
        );
    });

    it('opens the next contract on its full range when stepping in multi-day', async () => {
        const next = { ...contract, key: 'MSFT  261030P00150000', symbol: 'MSFT' };
        api.search.mockResolvedValue({ items: [contract, next], hasMore: false, unmappedContracts: 0 });
        api.dates.mockImplementation((key: string) =>
            Promise.resolve({ dates: key === next.key ? ['2026-10-26', '2026-10-23', '2026-10-20'] : ['2026-10-23'] })
        );
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=multi&from=2026-10-21&to=2026-10-23`);
        await screen.findByRole('button', { name: 'Next contract' });
        fireEvent.click(screen.getByRole('button', { name: 'Next contract' }));
        await waitFor(() =>
            expect(api.history).toHaveBeenLastCalledWith(
                next.key,
                '2026-10-20',
                '2026-10-26',
                expect.any(AbortSignal),
                contract.added
            )
        );
        expect(screen.getByRole('button', { name: 'View: Multi-day' })).toBeTruthy();
    });

    it('selects the first available date when switching to multi-day, within the 93-date limit', async () => {
        api.dates.mockResolvedValue({ dates: ['2026-10-23', '2026-07-23', '2026-07-22', '2026-06-01'] });
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=day&from=2026-10-23&to=2026-10-23`);
        await screen.findByRole('button', { name: 'View: Intraday' });
        fireEvent.click(screen.getByRole('button', { name: 'View: Intraday' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Multi-day/ }));
        await waitFor(() =>
            expect(api.history).toHaveBeenLastCalledWith(
                contract.key,
                '2026-07-23',
                '2026-10-23',
                expect.any(AbortSignal),
                undefined
            )
        );
    });

    it('spaces time ticks symmetrically even when samples do not divide evenly', async () => {
        api.history.mockResolvedValue({
            ...result,
            points: Array.from({ length: 8 }, (_, i) => ({
                ...result.points[0]!,
                time: result.points[0]!.time + i * 600000,
            })),
        });
        mount();
        await screen.findByTestId('time-axis');
        for (const view of ['Option', 'Stock']) {
            fireEvent.click(screen.getByRole('button', { name: view }));
            const axis = shownChart().getByTestId('time-axis');
            const ticks = JSON.parse(axis.getAttribute('data-ticks')!) as number[];
            expect(ticks).toHaveLength(6);
            for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(7 / 5);
        }
    });

    it('starts with compact summaries and keeps quote and analysis details expandable', async () => {
        mount();
        const target = await screen.findByRole('button', { name: 'Exit target: 50%' });
        const compactRows = document.querySelectorAll('.history-summary-row');
        expect(compactRows).toHaveLength(2);
        expect(compactRows[0]?.textContent).not.toContain('Since signal entry');
        expect(compactRows[1]?.textContent).toContain('Since signal entry');
        const quoteFields = compactRows[0]!.querySelectorAll('.history-summary-field');
        const analysisFields = compactRows[1]!.querySelectorAll('.history-summary-field');
        expect(quoteFields).toHaveLength(5);
        expect(analysisFields).toHaveLength(4);
        expect(quoteFields[0]?.querySelector('.history-summary-label')?.textContent).toBe('Entry:');
        expect(quoteFields[0]?.querySelector('strong')?.textContent).toBe('$2.00');
        expect(quoteFields[1]?.children).toHaveLength(2);
        expect(quoteFields[1]?.lastElementChild?.textContent).toBe('$1.50');
        expect(analysisFields[0]?.querySelector('.history-summary-label')?.textContent).toBe('50% target:');
        expect(analysisFields[0]?.querySelector('strong')?.textContent).toBe('$1.00');
        expect(compactRows[0]?.textContent).toContain('Underlying:');
        expect(compactRows[0]?.textContent).not.toContain(`${contract.symbol}:`);
        expect(document.body.textContent).not.toMatch(/Quote details|Analysis details/);
        expect(target.closest('details')).toBeNull();
        expect(compactRows[1]?.lastElementChild?.classList.contains('history-target-slot')).toBe(true);
        expect(screen.queryByText('Since signal entry')?.closest('details')?.open).toBe(false);
        expect(screen.queryByText(/target is outside the current chart scale/)).toBeNull();
        expect(screen.queryByText(/Collected .* to/)).toBeNull();
        expect(screen.queryByText(/Viewing /)).toBeNull();
        for (const details of document.querySelectorAll<HTMLDetailsElement>('.history-summary-details')) {
            expect(details.open).toBe(false);
            fireEvent.click(details.querySelector('summary')!);
            expect(details.open).toBe(true);
        }
        expect(screen.getByText('Underlying')).toBeTruthy();
        expect(screen.getByText('Entry delta -0.280')).toBeTruthy();
        expect(screen.getByText('Giveback from best')).toBeTruthy();
    });

    it('keeps the target slot on desktop when analysis is unavailable and hides it from assistive technology', async () => {
        api.history.mockResolvedValue({ ...result, analysis: null });
        mount();
        await screen.findByText('Entry quote unavailable. Target and giveback analysis unavailable.');
        expect(document.querySelector('.history-analysis-row')?.classList.contains('is-unavailable')).toBe(true);
        expect(document.querySelector('.history-target-slot')?.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('button', { name: 'Exit target: 50%' })).toBeNull();
    });

    it('joins sessions without removing genuine missing quotes from either chart', async () => {
        const first = result.points[0]!;
        const nextTime = Date.parse('2026-10-26T13:45:00Z');
        api.history.mockResolvedValue({
            ...result,
            to: '2026-10-26',
            points: [
                first,
                {
                    ...first,
                    time: first.time + 1,
                    kind: 'session_boundary',
                    mark: null,
                    delta: null,
                    underlyingPrice: null,
                },
                { ...first, sessionDate: '2026-10-26', time: nextTime },
                { ...first, sessionDate: '2026-10-26', time: nextTime + 600000, mark: null },
            ],
        });
        mount();
        await screen.findByTestId('history-chart-data');
        for (const view of ['Option', 'Stock']) {
            fireEvent.click(screen.getByRole('button', { name: view }));
            const chart = shownChart().getByTestId('history-chart-data');
            const points = JSON.parse(chart.getAttribute('data-points')!) as Array<{
                kind: string;
                slot: number;
                mark: number | null;
                time: number;
            }>;
            expect(points).toHaveLength(3);
            expect(points.map((point) => point.slot)).toEqual([0, 1, 2]);
            expect(points.some((point) => point.kind === 'session_boundary')).toBe(false);
            expect(points[1]?.time).toBe(nextTime);
            expect(points[2]?.mark).toBeNull();
        }
    });

    it('fits the stock axis to its movement without forcing a distant strike into range', async () => {
        api.history.mockResolvedValue({
            ...result,
            points: [
                { ...result.points[0]!, underlyingPrice: 160 },
                { ...result.points[0]!, time: result.points[0]!.time + 600000, underlyingPrice: 160.2 },
            ],
        });
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Stock' }));
        await screen.findByText('Stock ($ / share)');
        const domain = JSON.parse(screen.getByTestId('axis-stock').getAttribute('data-domain')!) as number[];
        expect(domain[0]).toBeCloseTo(159.98);
        expect(domain[1]).toBeCloseTo(160.22);
        expect(screen.getByText(/Strike \$150.00 below chart range/)).toBeDefined();
        expect(screen.queryByTestId('itm-area')).toBeNull();
        expect(screen.queryByText('Strike $150.00', { exact: true })).toBeNull();
    });
    it('shades the entire visible stock range when the strike is above it', async () => {
        api.history.mockResolvedValue({ ...result, contract: { ...contract, strike: 170 } });
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Stock' }));
        await screen.findByText(/Strike \$170.00 above chart range/);
        await screen.findByTestId('axis-stock');
        const domain = JSON.parse(screen.getByTestId('axis-stock').getAttribute('data-domain')!) as number[];
        const area = screen.getByTestId('itm-area');
        expect(Number(area.getAttribute('data-low'))).toBe(domain[0]);
        expect(Number(area.getAttribute('data-high'))).toBe(domain[1]);
    });
    it('retains the strike line and clips ITM shading when the stock crosses strike', async () => {
        api.history.mockResolvedValue({
            ...result,
            points: [
                { ...result.points[0]!, underlyingPrice: 149 },
                { ...result.points[0]!, time: result.points[0]!.time + 600000, underlyingPrice: 151 },
            ],
        });
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Stock' }));
        await screen.findByText('Strike $150.00', { exact: true });
        expect(Number(screen.getByTestId('itm-area').getAttribute('data-high'))).toBe(150);
        expect(screen.queryByText(/Strike \$150.00 (above|below) chart range/)).toBeNull();
    });
    it('shows all-history crossings, best, worst and giveback independently of the chart range', async () => {
        const { container } = mount();
        await screen.findAllByText('35.0 pp');
        expect(screen.getAllByText('60.0%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('-30.0%').length).toBeGreaterThan(0);
        expect(screen.getByText('$70.00 decline from best to latest')).toBeDefined();
        expect(screen.getByText('First observed crossing 10/22/2026 07:00')).toBeDefined();
        expect(screen.getByText('1d 0h 25m elapsed')).toBeDefined();
        expect(screen.getByText('$1.00 to close')).toBeDefined();
        expect(screen.queryByTestId('best-marker')).toBeNull();
        expect(screen.queryByText('First 50%')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Exit target: 50%' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /75%/ }));
        expect(screen.getByText('$0.50 to close')).toBeDefined();
        expect(screen.getByText('Not observed in collected history')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Exit target: 75%' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /25%/ }));
        expect(screen.getByText('First observed crossing 10/22/2026 07:00')).toBeDefined();
        expect(api.history).toHaveBeenCalledTimes(1);
        expect(container.querySelector('select,datalist')).toBeNull();
    });
    it('marks a visible best and first crossing, and converts the target line between price and percent', async () => {
        api.history.mockResolvedValue({
            ...result,
            from: '2026-10-21',
            to: '2026-10-23',
            points: [
                { ...result.points[0]!, time: Date.parse('2026-10-21T14:00:00Z'), mark: 2.6 },
                { ...result.points[0]!, time: Date.parse('2026-10-22T14:00:00Z'), mark: 0.8 },
                result.points[0]!,
            ],
        });
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=multi&from=2026-10-21&to=2026-10-23`);
        await screen.findByTestId('best-marker');
        expect(screen.getByText('First 50%')).toBeDefined();
        expect(screen.getByText('50% target').getAttribute('data-y')).toBe('50');
        fireEvent.click(screen.getByRole('button', { name: 'Chart: Captured %' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Price/ }));
        expect(screen.getByText('50% target').getAttribute('data-y')).toBe('1');
    });
    it('reports no valid observations without inventing crossings or giveback', async () => {
        api.history.mockResolvedValue({
            ...result,
            analysis: {
                ...result.analysis,
                validMarks: 0,
                best: null,
                worst: null,
                latest: null,
                giveback: null,
                targets: result.analysis!.targets.map((target) => ({ ...target, firstCrossing: null })),
            },
        });
        mount();
        await screen.findByText('No valid post-entry marks');
        expect(screen.queryByText(/First observed crossing/)).toBeNull();
        expect(screen.queryByText(/decline from best/)).toBeNull();
    });
    it('clears the old contract and shows the next one fresh, like a reload', async () => {
        const other = { ...contract, key: 'MSFT  261030P00400000', symbol: 'MSFT', strike: 400 };
        api.search.mockResolvedValue({ items: [contract, other], hasMore: false, unmappedContracts: 0 });
        mount();
        await screen.findAllByText('25.0%');
        let complete!: (response: HistoryResponse) => void;
        api.history.mockReturnValueOnce(
            new Promise<HistoryResponse>((resolve) => {
                complete = resolve;
            })
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next contract' })).toBeDefined());
        const before = screen.getByRole('region', { name: 'Contract price and delta history' });
        fireEvent.click(screen.getByRole('button', { name: 'Next contract' }));
        await waitFor(() =>
            expect(screen.queryByRole('region', { name: 'Contract price and delta history' })).toBeNull()
        );
        expect(screen.queryByText(/Loading selection/)).toBeNull();
        complete({ ...result, contract: other });
        const after = await screen.findByRole('region', { name: 'Contract price and delta history' });
        expect(after).not.toBe(before);
        expect(after.classList.contains('enter')).toBe(true);
        expect(screen.getByText(/MSFT \$400 put/)).toBeDefined();
    });
    it('shows signal-date entry and hypothetical captured dollars with a separate stock chart', async () => {
        mount(`?contract=${encodeURIComponent(contract.key)}&signalDate=2026-10-21&from=2026-10-23`);
        await screen.findAllByText('25.0%');
        expect(screen.getByText('+$50.00 / standard contract')).toBeDefined();
        expect(screen.getByText('Entry delta -0.280')).toBeDefined();
        expect(screen.getByText('Captured 10/21/2026 06:35')).toBeDefined();
        expect(screen.getByText('Premium captured (%)')).toBeDefined();
        expect(screen.queryByText('Mark ($ / share)')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
        await waitFor(() => expect(shownChart().getByText('Stock ($ / share)')).toBeDefined());
        expect(shownChart().queryByText('Premium captured (%)')).toBeNull();
    });
    it('keeps missing entry explicit without substituting the displayed mark', async () => {
        api.history.mockResolvedValue({ ...result, entry: null, analysis: null });
        mount();
        await screen.findByText('Entry quote unavailable');
        expect(screen.queryByText(/Entry delta/)).toBeNull();
        expect(screen.getByText(/Captured percentages cannot be calculated/)).toBeDefined();
    });
    it('changes the baseline for the same contract on another signal date and retains it across viewing dates', async () => {
        api.search.mockResolvedValue({
            items: [{ ...contract, added: '2026-10-22' }, contract],
            hasMore: false,
            unmappedContracts: 0,
        });
        api.dates.mockResolvedValue({ dates: ['2026-10-23', '2026-10-22'] });
        api.history.mockImplementation(
            (_key: string, from: string, to: string, _signal: AbortSignal, signalDate?: string) =>
                Promise.resolve({
                    ...result,
                    from,
                    to,
                    signalDate: signalDate ?? result.signalDate,
                    entry: {
                        ...result.entry,
                        signalDate: signalDate ?? result.signalDate,
                        mark: signalDate === '2026-10-22' ? 3 : 2,
                    },
                })
        );
        const { container } = mount();
        await screen.findAllByText('25.0%');
        await screen.findByText('Added 10/21/2026');
        fireEvent.click(screen.getByRole('button', { name: 'Later date' }));
        await screen.findByText('Added 10/22/2026');
        fireEvent.click(container.querySelector('.history-contract-list button')!);
        await screen.findAllByText('50.0%');
        expect(container.querySelector('.history-stats strong')!.textContent).toBe('$3.00');
        fireEvent.click(screen.getByRole('button', { name: 'Date: 10/23/2026' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /10\/22\/2026/ }));
        await waitFor(() =>
            expect(api.history).toHaveBeenLastCalledWith(
                contract.key,
                '2026-10-22',
                '2026-10-22',
                expect.any(AbortSignal),
                '2026-10-22'
            )
        );
        expect(container.querySelector('.history-stats strong')!.textContent).toBe('$3.00');
    });
    it('uses the latest underlying in the selected range for research context', async () => {
        const first = result.points[0]!;
        api.history.mockResolvedValue({
            ...result,
            contract: { ...contract, underlyingPrice: 190, underlyingAt: '2026-10-24T20:10:00Z' },
            points: [
                {
                    ...first,
                    time: Date.parse('2026-10-23T13:45:00Z'),
                    priceTime: '2026-10-23T13:44:00Z',
                    underlyingPrice: 158,
                },
                {
                    ...first,
                    time: Date.parse('2026-10-23T14:00:00Z'),
                    priceTime: '2026-10-23T13:59:00Z',
                    underlyingPrice: 160,
                },
            ],
        });
        mount();
        const seeking = await screen.findByRole<HTMLAnchorElement>('link', { name: 'AAPL Seeking Alpha' });
        const trading = screen.getByRole<HTMLAnchorElement>('link', { name: 'AAPL TradingView' });
        const context =
            '#trade_ticker=AAPL&trade_strike=150.00&trade_expiration=2026-10-30&trade_delta=-0.2000' +
            '&trade_optionPrice=1.50&trade_underlyingPrice=160.00&trade_strikePct=6.67';
        expect(seeking.getAttribute('href')).toBe(`https://seekingalpha.com/symbol/AAPL${context}`);
        expect(trading.getAttribute('href')).toBe(`https://www.tradingview.com/chart/?symbol=AAPL${context}`);
        expect(seeking.querySelector('.site-mark.site-seekingalpha')).not.toBeNull();
        expect(trading.querySelector('.site-mark.site-tradingview')).not.toBeNull();
        for (const link of [seeking, trading]) {
            expect(link.target).toBe('_blank');
            expect(link.rel).toBe('noopener noreferrer');
            expect(link.textContent).toBe('');
            expect(link.title).toBe(link.getAttribute('aria-label'));
        }
        expect(screen.getByText('Underlying:').parentElement?.querySelector('strong')?.textContent).toBe('$160.00');
        fireEvent.click(document.querySelector('.history-quote-summary > summary')!);
        expect(screen.getByText('Captured 10/23/2026 06:59')).toBeTruthy();
    });

    it('does not substitute a newer underlying when the selected range has none', async () => {
        api.history.mockResolvedValue({
            ...result,
            points: [{ ...result.points[0]!, underlyingPrice: null }],
        });
        mount();
        const seeking = await screen.findByRole<HTMLAnchorElement>('link', { name: 'AAPL Seeking Alpha' });
        expect(screen.getByText('Underlying:').parentElement?.querySelector('strong')?.textContent).toBe('Unavailable');
        expect(seeking.href).not.toContain('trade_underlyingPrice');
        expect(seeking.href).not.toContain('trade_strikePct');
        fireEvent.click(document.querySelector('.history-quote-summary > summary')!);
        expect(screen.getByText('Unavailable in this date range')).toBeTruthy();
    });

    it('supports keyboard view choices and returns focus on Escape', () => {
        mount('');
        const trigger = screen.getByRole('button', { name: 'View: Intraday' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const choices = screen.getAllByRole('menuitemradio');
        expect(document.activeElement).toBe(choices[0]);
        fireEvent.keyDown(choices[0]!, { key: 'End' });
        expect(document.activeElement).toBe(choices[1]);
        fireEvent.keyDown(choices[1]!, { key: 'Escape' });
        expect(document.activeElement).toBe(trigger);
    });
    it('opens latest collected date with both axes, signed delta and coverage', async () => {
        const { container } = mount();
        await screen.findAllByText('-0.200');
        expect(screen.getByRole('button', { name: 'Date: 10/23/2026' })).toBeDefined();
        expect(api.history).toHaveBeenCalledWith(
            contract.key,
            '2026-10-23',
            '2026-10-23',
            expect.any(AbortSignal),
            undefined
        );
        expect(screen.getByText('Axis price')).toBeDefined();
        expect(screen.getByText('Axis delta')).toBeDefined();
        expect(screen.queryByText(/slots with unknown coverage/)).toBeNull();
        expect(container.querySelector('select,datalist')).toBeNull();
        expect(screen.queryByText(/Observation 1 of/)).toBeNull();
    });
    it('supports a multi-day deep link without replacing its requested dates', async () => {
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=multi&from=2026-10-21&to=2026-10-23`);
        await waitFor(() =>
            expect(api.history).toHaveBeenCalledWith(
                contract.key,
                '2026-10-21',
                '2026-10-23',
                expect.any(AbortSignal),
                undefined
            )
        );
        const to = await screen.findByRole('button', { name: /^To: / });
        fireEvent.click(to);
        expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
            expect.stringContaining('10/21/2026'),
            expect.stringContaining('10/23/2026Latest collected'),
        ]);
    });
    it('reports history failures with retry', async () => {
        api.history.mockRejectedValueOnce(new Error('Contract history is unavailable.'));
        mount(`?contract=${encodeURIComponent(contract.key)}&from=2026-10-23`);
        await screen.findByRole('alert');
        fireEvent.click(screen.getByText('Retry'));
        await screen.findAllByText('$1.50');
    });
    it('shows an empty state for a known contract without observations', async () => {
        api.dates.mockResolvedValue({ dates: [] });
        mount();
        await screen.findByText('No usable observations have been collected for this contract.');
        expect(api.history).not.toHaveBeenCalled();
    });
    it('searches VADER contracts including expired results', async () => {
        mount('');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'aapl' } });
        await waitFor(() => expect(api.search).toHaveBeenCalledWith('AAPL', expect.any(AbortSignal)));
        await screen.findByText('Expires 10/30/2026');
        expect(screen.getByText('Aggressive', { selector: 'small' })).toBeDefined();
    });
    it('shows one date added at a time, top picks first, earliest expiration first', async () => {
        const make = (strike: number, added: string, tier: string | null, expiration: string, topPick = false) => ({
            ...contract,
            key: `AAPL  ${strike}`,
            symbol: strike === 143 ? 'ZS' : 'AAPL',
            strike,
            added,
            tier,
            expiration,
            topPick,
            tiers: tier ? [tier] : [],
        });
        api.search.mockResolvedValue({
            items: [
                make(140, '2026-10-20', 'aggressive', '2026-11-20'),
                make(141, '2026-10-22', 'aggressive', '2026-12-18'),
                make(142, '2026-10-22', null, '2026-11-20'),
                make(143, '2026-10-22', 'aggressive', '2026-11-06'),
                make(144, '2026-10-22', 'balanced', '2026-11-20', true),
                make(145, '2026-10-22', 'conservative', '2026-11-20'),
            ],
            hasMore: false,
            unmappedContracts: 0,
        });
        const { container } = mount('');
        await screen.findByText('Added 10/22/2026');
        expect(container.querySelectorAll('.history-added-group')).toHaveLength(1);
        const headings = () => [...container.querySelectorAll('h4')].map((node) => node.textContent);
        expect(headings()).toEqual(['Top Picks 1', 'Conservative 1', 'Aggressive 2', 'Other 1']);
        const aggressive = container.querySelectorAll('.history-tier-group')[2]!;
        expect([...aggressive.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
            'ZS $143',
            'AAPL $141',
        ]);
        const topPicks = container.querySelector('.history-tier-group')!;
        expect(topPicks.querySelector('strong.balanced')?.textContent).toBe('AAPL $144');
        expect(topPicks.querySelector('small')).toBeNull();
        expect(screen.getByRole('group', { name: 'Contract border legend' }).textContent).toBe(
            'Legend:ConservativeBalancedAggressiveITM'
        );
        expect(
            topPicks.closest('.history-added-group')!.querySelector('.history-day-nav .history-color-key')
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Later date' }).hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Earlier date' }));
        await screen.findByText('Added 10/20/2026');
        expect(headings()).toEqual(['Aggressive 1']);
        expect(screen.getByRole('button', { name: 'Earlier date' }).hasAttribute('disabled')).toBe(true);
    });
    it('marks ITM and expired cards and steps through the selected contract date', async () => {
        const itm = {
            ...contract,
            key: 'AAPL  200116P00150000',
            expiration: '2020-01-16',
            underlyingPrice: 149.5,
            topPick: true,
            tier: 'aggressive',
        };
        api.search.mockResolvedValue({ items: [contract, itm], hasMore: false, unmappedContracts: 0 });
        const { container } = mount();
        await screen.findAllByText('-0.200');
        expect(screen.getByText('Underlying')).toBeDefined();
        expect(screen.getAllByText('$160.00').length).toBeGreaterThan(0);
        expect(screen.getByText('6.7% above the $150 strike')).toBeDefined();
        await waitFor(() => expect(container.querySelectorAll('.history-contract-list button')).toHaveLength(2));
        const cards = [...container.querySelectorAll('.history-contract-list button')];
        expect(cards.map((card) => card.classList.contains('is-expired'))).toEqual([true, false]);
        expect(cards.map((card) => !!card.querySelector('strong.is-itm'))).toEqual([true, false]);
        expect(cards.every((card) => !card.classList.contains('is-itm'))).toBe(true);
        expect(cards[0]!.querySelector('strong')?.textContent).toBe('AAPL $150');
        expect(cards[0]!.querySelector('strong.aggressive')).toBeNull();
        expect(cards[0]!.querySelector('small')).toBeNull();
        expect(cards[0]!.querySelector('.moneyness-chip')).toBeNull();
        expect(cards[0]!.querySelector('.sr-only')?.textContent).toBe('In the money');
        expect(cards[0]!.querySelector('.history-contract-name .history-contract-captured')).toBeTruthy();
        expect(screen.getByText('2 of 2')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Next contract' }).hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Previous contract' }));
        await waitFor(() => expect(api.dates).toHaveBeenLastCalledWith(itm.key, expect.any(AbortSignal)));
    });
    it('updates research links when stepping to another underlying', async () => {
        const other = { ...contract, key: 'MSFT  261030P00400000', symbol: 'MSFT', strike: 400 };
        api.search.mockResolvedValue({ items: [contract, other], hasMore: false, unmappedContracts: 0 });
        api.history.mockImplementation((key: string) =>
            Promise.resolve({ ...result, contract: key === other.key ? other : contract })
        );
        mount();
        await screen.findByRole('link', { name: 'AAPL Seeking Alpha' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next contract' })).toBeDefined());
        fireEvent.click(screen.getByRole('button', { name: 'Next contract' }));
        const link = await screen.findByRole<HTMLAnchorElement>('link', { name: 'MSFT Seeking Alpha' });
        expect(link.href).toContain('https://seekingalpha.com/symbol/MSFT#trade_ticker=MSFT&trade_strike=400.00');
        expect(screen.queryByRole('link', { name: 'AAPL Seeking Alpha' })).toBeNull();
        expect(screen.getByRole<HTMLAnchorElement>('link', { name: 'MSFT TradingView' }).href).toContain(
            'symbol=MSFT#'
        );
        expect(api.dates.mock.calls.filter(([key]) => key === contract.key)).toHaveLength(1);
        expect(api.dates.mock.calls.filter(([key]) => key === other.key)).toHaveLength(1);
    });
    it('lists a contract under every date it was signaled and steps within the viewed date', async () => {
        const other = { ...contract, key: 'MSFT  261030P00400000', symbol: 'MSFT', strike: 400, tiers: ['balanced'] };
        const later = { ...contract, added: '2026-10-22', topPick: true, tiers: ['balanced'] };
        api.search.mockResolvedValue({ items: [later, contract, other], hasMore: false, unmappedContracts: 0 });
        const { container } = mount(`?contract=${encodeURIComponent(contract.key)}&signalDate=2026-10-22`);
        await screen.findByText('Added 10/22/2026');
        const headings = () => [...container.querySelectorAll('h4')].map((node) => node.textContent);
        expect(headings()).toEqual(['Top Picks 1']);
        expect(screen.queryByText('1 of 2')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Signal date: 10/22/2026' }));
        fireEvent.click(screen.getByRole('button', { name: '10/21/2026, 2 contracts' }));
        await screen.findByText('Added 10/21/2026');
        expect(headings()).toEqual(['Balanced 2']);
        expect(screen.getByText('1 of 2')).toBeDefined();
    });
});
