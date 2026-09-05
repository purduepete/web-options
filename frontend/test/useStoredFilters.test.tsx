import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStoredFilters } from '../src/hooks/useStoredFilters';

const KEY = 'test.filters.v1';
const KEYS = ['symbol', 'moneyness'] as const;

function Harness({ guardKeys }: { guardKeys?: readonly string[] }) {
    const [params, setParams] = useSearchParams();
    const hydrated = useStoredFilters({ storageKey: KEY, keys: KEYS, guardKeys });
    return (
        <>
            <output data-testid="query">{params.toString()}</output>
            <output data-testid="hydrated">{String(hydrated)}</output>
            <button type="button" onClick={() => setParams(new URLSearchParams({ symbol: 'MSFT' }))}>
                Filter
            </button>
            <button type="button" onClick={() => setParams(new URLSearchParams())}>
                Clear
            </button>
        </>
    );
}

function renderAt(path: string, guardKeys?: readonly string[]) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Harness guardKeys={guardKeys} />
        </MemoryRouter>,
    );
}

const query = () => screen.getByTestId('query').textContent;

describe('useStoredFilters', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('restores the stored filters onto a bare path', () => {
        localStorage.setItem(KEY, 'symbol=AAPL&moneyness=itm');
        renderAt('/owned');
        expect(query()).toBe('symbol=AAPL&moneyness=itm');
    });

    it('leaves a URL that names one of its own filters alone', () => {
        localStorage.setItem(KEY, 'symbol=AAPL&moneyness=itm');
        renderAt('/owned?moneyness=otm');
        expect(query()).toBe('moneyness=otm');
    });

    it('stands down when a value is present but empty', () => {
        localStorage.setItem(KEY, 'symbol=AAPL');
        renderAt('/owned?symbol=');
        expect(query()).toBe('symbol=');
    });

    it('stands down for a guard key it never stores', () => {
        localStorage.setItem(KEY, 'symbol=AAPL');
        renderAt('/live?week=2026-08-31', ['week']);
        expect(query()).toBe('week=2026-08-31');
    });

    it('keeps parameters it does not own when it restores', () => {
        localStorage.setItem(KEY, 'symbol=AAPL');
        renderAt('/owned?sort=delta');
        expect(query()).toBe('sort=delta&symbol=AAPL');
    });

    it('drops anything in storage that is not one of its own keys', () => {
        localStorage.setItem(KEY, 'symbol=AAPL&week=2026-08-31&rogue=1');
        renderAt('/owned');
        expect(query()).toBe('symbol=AAPL');
    });

    it('reports the pass finished even when it restored nothing', () => {
        renderAt('/owned?symbol=NVDA');
        expect(screen.getByTestId('hydrated').textContent).toBe('true');
    });

    it('does not write an empty page over what was stored', () => {
        localStorage.setItem(KEY, 'symbol=AAPL');
        renderAt('/owned?week=2026-08-31', ['week']);
        expect(localStorage.getItem(KEY)).toBe('symbol=AAPL');
    });

    it('leaves what was stored alone when a restore is only read, never touched', () => {
        localStorage.setItem(KEY, 'symbol=AAPL&moneyness=itm');
        renderAt('/owned');
        expect(localStorage.getItem(KEY)).toBe('symbol=AAPL&moneyness=itm');
    });

    it('saves a filter as it is applied', async () => {
        const user = userEvent.setup();
        renderAt('/owned');
        await user.click(screen.getByRole('button', { name: 'Filter' }));
        expect(localStorage.getItem(KEY)).toBe('symbol=MSFT');
    });

    it('forgets the filters once they are cleared, and stays cleared', async () => {
        const user = userEvent.setup();
        localStorage.setItem(KEY, 'symbol=AAPL');
        const view = renderAt('/owned');
        expect(query()).toBe('symbol=AAPL');
        await user.click(screen.getByRole('button', { name: 'Clear' }));
        expect(localStorage.getItem(KEY)).toBeNull();
        view.unmount();
        renderAt('/owned');
        expect(query()).toBe('');
    });

    it('survives a store that will not answer', () => {
        localStorage.setItem(KEY, 'not a query &&& %%');
        renderAt('/owned');
        expect(screen.getByTestId('hydrated').textContent).toBe('true');
    });
});
