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

const contract = { key: 'AAPL  261030P00150000', symbol: 'AAPL', strike: 150, expiration: '2026-10-30' };
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
        await screen.findByText('Latest delta -0.200');
        expect(api.history).toHaveBeenCalledWith(contract.key, '2026-10-23', '2026-10-23', expect.any(AbortSignal));
        expect(screen.getByText('Axis price')).toBeDefined();
        expect(screen.getByText('Axis delta')).toBeDefined();
        expect(screen.getByText(/2 slots with unknown coverage/)).toBeDefined();
        expect(container.querySelector('select,datalist')).toBeNull();
        expect(screen.getByText(/Price event: unknown/)).toBeDefined();
    });
    it('supports a multi-day deep link without replacing its requested dates', async () => {
        mount(`?contract=${encodeURIComponent(contract.key)}&mode=multi&from=2026-10-21&to=2026-10-23`);
        await waitFor(() =>
            expect(api.history).toHaveBeenCalledWith(contract.key, '2026-10-21', '2026-10-23', expect.any(AbortSignal))
        );
        expect(screen.getByLabelText('To (Pacific)')).toBeDefined();
    });
    it('reports history failures with retry', async () => {
        api.history.mockRejectedValueOnce(new Error('Contract history is unavailable.'));
        mount(`?contract=${encodeURIComponent(contract.key)}&from=2026-10-23`);
        await screen.findByRole('alert');
        fireEvent.click(screen.getByText('Retry'));
        await screen.findByText('Latest mark $1.50');
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
        await waitFor(() => expect(api.search).toHaveBeenCalledWith('AAPL', 0, expect.any(AbortSignal)));
        await screen.findByText('Expires 2026-10-30');
    });
});
