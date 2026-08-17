import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const { fetchMe } = vi.hoisted(() => ({ fetchMe: vi.fn() }));

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return { UnauthorizedError: actual.UnauthorizedError, fetchMe };
});

import { UnauthorizedError } from '../src/api';
import { ApiKeyProvider, useApiKey } from '../src/auth/ApiKeyProvider';

const STORAGE_KEY = 'weboptions_api_key';

function Harness() {
    const { status } = useApiKey();
    return <p data-testid="status">{status}</p>;
}

function renderProvider() {
    return render(
        <ApiKeyProvider>
            <Harness />
        </ApiKeyProvider>,
    );
}

describe('ApiKeyProvider startup check', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        fetchMe.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps a remembered key when the API has not finished starting up', async () => {
        localStorage.setItem(STORAGE_KEY, 'woak_stored');
        fetchMe.mockRejectedValue(new TypeError('Failed to fetch'));
        vi.useFakeTimers();

        renderProvider();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        expect(localStorage.getItem(STORAGE_KEY)).toBe('woak_stored');
        expect(screen.getByTestId('status').textContent).toBe('unlocked');
    });

    it('shows the app straight away rather than waiting out the check', () => {
        localStorage.setItem(STORAGE_KEY, 'woak_stored');
        fetchMe.mockReturnValue(new Promise(() => {}));

        renderProvider();

        expect(screen.getByTestId('status').textContent).toBe('unlocked');
    });

    it('forgets a key the API actually rejects', async () => {
        localStorage.setItem(STORAGE_KEY, 'woak_revoked');
        fetchMe.mockRejectedValue(new UnauthorizedError());

        renderProvider();

        await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('locked'));
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('unlocks once the API answers', async () => {
        localStorage.setItem(STORAGE_KEY, 'woak_stored');
        fetchMe.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({
            label: 'Laptop browser',
            scopes: [],
        });
        vi.useFakeTimers();

        renderProvider();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(screen.getByTestId('status').textContent).toBe('unlocked');
        expect(fetchMe).toHaveBeenCalledTimes(2);
    });
});
