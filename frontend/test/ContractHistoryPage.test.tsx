import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HistoryResponse } from '@weboptions/shared';
import { ContractHistoryPage } from '../src/pages/ContractHistoryPage';

const api = vi.hoisted(() => ({ search: vi.fn(), dates: vi.fn(), history: vi.fn(), lock: vi.fn() }));
vi.mock('../src/auth/ApiKeyProvider', () => ({ useApiKey: () => ({ lock: api.lock }) }));
vi.mock('../src/history/api', () => ({
    searchHistoryContracts: api.search,
    getHistoryDates: api.dates,
    getContractHistory: api.history,
}));
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: ({ yAxisId, domain }: { yAxisId: string; domain?: number[] }) => (
        <span data-testid={`axis-${yAxisId}`} data-domain={JSON.stringify(domain)}>
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
        through: Date.parse('2026-10-23T13:35:00Z'),
        best: { time: Date.parse('2026-10-22T14:00:00Z'), mark: 0.8, capturedPercent: 60, dollars: 120 },
        worst: { time: Date.parse('2026-10-21T14:00:00Z'), mark: 2.6, capturedPercent: -30, dollars: -60 },
        latest: { time: Date.parse('2026-10-23T13:35:00Z'), mark: 1.5, capturedPercent: 25, dollars: 50 },
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
            time: Date.parse('2026-10-23T13:35:00Z'),
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
beforeEach(() => {
    vi.clearAllMocks();
    api.search.mockResolvedValue({ items: [contract], hasMore: false, unmappedContracts: 0 });
    api.dates.mockResolvedValue({ dates: ['2026-10-23'] });
    api.history.mockResolvedValue(result);
});
describe('contract history page', () => {
    it('fits the stock axis to its movement without forcing a distant strike into range', async () => {
        api.history.mockResolvedValue({
            ...result,
            points: [
                { ...result.points[0]!, underlyingPrice: 160 },
                { ...result.points[0]!, time: result.points[0]!.time + 600000, underlyingPrice: 160.2 },
            ],
        });
        mount();
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
        await screen.findByText(/Strike \$170.00 above chart range/);
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
        await screen.findByText('Strike $150.00', { exact: true });
        expect(Number(screen.getByTestId('itm-area').getAttribute('data-high'))).toBe(150);
        expect(screen.queryByText(/Strike \$150.00 (above|below) chart range/)).toBeNull();
    });
    it('shows all-history crossings, best, worst and giveback independently of the chart range', async () => {
        const { container } = mount();
        await screen.findByText('35.0 pp');
        expect(screen.getByText('60.0%')).toBeDefined();
        expect(screen.getByText('-30.0%')).toBeDefined();
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
        expect(screen.getByText('50% target').getAttribute('data-y')).toBe('1');
        fireEvent.click(screen.getByRole('button', { name: 'Chart: Price' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Captured %/ }));
        expect(screen.getByText('50% target').getAttribute('data-y')).toBe('50');
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
    it('keeps the chart visible during refresh without a loading-selection message', async () => {
        mount();
        await screen.findByText('25.0%');
        let complete!: (response: HistoryResponse) => void;
        api.history.mockReturnValueOnce(
            new Promise<HistoryResponse>((resolve) => {
                complete = resolve;
            })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        const chart = screen.getByRole('region', { name: 'Contract price and delta history' });
        await waitFor(() => expect(chart.getAttribute('aria-busy')).toBe('true'));
        expect(screen.queryByText(/Loading selection/)).toBeNull();
        expect(screen.getByText('Stock ($ / share)')).toBeDefined();
        complete(result);
        await waitFor(() => expect(chart.getAttribute('aria-busy')).toBe('false'));
    });
    it('shows signal-date entry and hypothetical captured dollars with a separate stock chart', async () => {
        mount(`?contract=${encodeURIComponent(contract.key)}&signalDate=2026-10-21&from=2026-10-23`);
        await screen.findByText('25.0%');
        expect(screen.getByText('+$50.00 / standard contract')).toBeDefined();
        expect(screen.getByText('Entry delta -0.280')).toBeDefined();
        expect(screen.getByText('Captured 10/21/2026 06:35')).toBeDefined();
        expect(screen.getByText('Stock ($ / share)')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Chart: Price' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Captured %/ }));
        expect(screen.getByText('Premium captured (%)')).toBeDefined();
        expect(screen.queryByText('Mark ($ / share)')).toBeNull();
    });
    it('keeps missing entry explicit without substituting the displayed mark', async () => {
        api.history.mockResolvedValue({ ...result, entry: null, analysis: null });
        mount();
        await screen.findByText('Entry quote unavailable');
        expect(screen.queryByText(/Entry delta/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Chart: Price' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Captured %/ }));
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
        await screen.findByText('25.0%');
        await screen.findByText('Added 10/21/2026');
        fireEvent.click(screen.getByRole('button', { name: 'Later date' }));
        await screen.findByText('Added 10/22/2026');
        fireEvent.click(container.querySelector('.history-contract-list button')!);
        await screen.findByText('50.0%');
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
    it('links the selected underlying to research pages with the displayed option context', async () => {
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
        await screen.findByText('-0.200');
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
        expect(screen.getByText(/2 slots with unknown coverage/)).toBeDefined();
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
        await screen.findByText('$1.50');
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
        expect(screen.getByText('Also Aggressive')).toBeDefined();
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
            'ZS $143 put',
            'AAPL $141 put',
        ]);
        expect(screen.getByText('Also Balanced')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Later date' }).hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Earlier date' }));
        await screen.findByText('Added 10/20/2026');
        expect(headings()).toEqual(['Aggressive 1']);
        expect(screen.getByRole('button', { name: 'Earlier date' }).hasAttribute('disabled')).toBe(true);
    });
    it('marks ITM and expired cards and steps through the selected contract date', async () => {
        const itm = { ...contract, key: 'AAPL  200116P00150000', expiration: '2020-01-16', underlyingPrice: 149.5 };
        api.search.mockResolvedValue({ items: [contract, itm], hasMore: false, unmappedContracts: 0 });
        const { container } = mount();
        await screen.findByText('-0.200');
        expect(screen.getByText('AAPL stock')).toBeDefined();
        expect(screen.getByText('$160.00')).toBeDefined();
        expect(screen.getByText('6.7% above the $150 strike')).toBeDefined();
        await waitFor(() => expect(container.querySelectorAll('.history-contract-list button')).toHaveLength(2));
        const cards = [...container.querySelectorAll('.history-contract-list button')];
        expect(cards.map((card) => card.classList.contains('is-expired'))).toEqual([true, false]);
        expect(cards.map((card) => !!card.querySelector('.moneyness-chip.itm'))).toEqual([true, false]);
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
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(api.dates.mock.calls.filter(([key]) => key === other.key)).toHaveLength(2));
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
