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
    YAxis: ({ yAxisId }: { yAxisId: string }) => <span>Axis {yAxisId}</span>,
    Line: ({ name }: { name: string }) => <span>{name}</span>,
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
    points: [
        {
            time: Date.parse('2026-10-23T13:35:00Z'),
            sessionDate: '2026-10-23',
            kind: 'open_session',
            mark: 1.5,
            delta: -0.2,
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
        expect(api.history).toHaveBeenCalledWith(contract.key, '2026-10-23', '2026-10-23', expect.any(AbortSignal));
        expect(screen.getByText('Axis price')).toBeDefined();
        expect(screen.getByText('Axis delta')).toBeDefined();
        expect(screen.getByText(/2 slots with unknown coverage/)).toBeDefined();
        expect(container.querySelector('select,datalist')).toBeNull();
        expect(screen.queryByText(/Observation 1 of/)).toBeNull();
    });
    it('supports a multi-day deep link without replacing its requested dates', async () => {
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=multi&from=2026-10-21&to=2026-10-23`);
        await waitFor(() =>
            expect(api.history).toHaveBeenCalledWith(contract.key, '2026-10-21', '2026-10-23', expect.any(AbortSignal))
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
});
