import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Loading } from '../src/components/Loading';

describe('Loading', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows nothing at first, so a quick answer does not flash a spinner', () => {
        render(<Loading />);
        expect(screen.queryByRole('status')).toBeNull();

        act(() => vi.advanceTimersByTime(249));
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('appears once the wait is long enough to be worth explaining', () => {
        render(<Loading label="Loading this week" />);

        act(() => vi.advanceTimersByTime(250));
        const status = screen.getByRole('status');
        expect(status.getAttribute('aria-label')).toBe('Loading this week');
        expect(status.getAttribute('class')).toBe('spinner');
    });
});
