import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/api', () => ({
    fetchVix: vi.fn(),
}));

import { fetchVix } from '../src/api';
import { VixProvider } from '../src/grade/VixProvider';
import { VixChip } from '../src/navigation/VixChip';

const mockFetchVix = vi.mocked(fetchVix);

function renderChip() {
    return render(
        <VixProvider>
            <VixChip />
        </VixProvider>
    );
}

describe('VixChip', () => {
    let dayOfWeek: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dayOfWeek = vi.spyOn(Date.prototype, 'getDay').mockReturnValue(3);
    });

    afterEach(() => {
        dayOfWeek.mockRestore();
    });

    it('uses the weekday level thresholds and colors a decline red', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toBe('vix-chip level-medium');
        expect(container.querySelector('.vix-chip .change')?.className).toBe('change falling');
    });

    it('shows the day change against the close before it', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        renderChip();

        await waitFor(() => expect(screen.getByText('-6.00%')).toBeTruthy());
    });

    it('signs a rise, which is the good news to a put seller', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 21.4, asOf: '2026-08-19', previousValue: 20.1 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('+6.47%')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toBe('vix-chip level-high');
        expect(container.querySelector('.vix-chip .change')?.className).toBe('change rising');
    });

    it('shows a flat change without an arrow or direction color', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 14.89 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('0.00%')).toBeTruthy());
        expect(container.querySelector('.vix-chip .change')?.className).toBe('change');
        expect(container.querySelector('.vix-chip .change svg')).toBeNull();
        expect(container.querySelector('.vix-chip')?.getAttribute('title')).toContain('0.00%');
    });

    it.each([
        [15.01, 'level-high'],
        [15, 'level-medium'],
        [12.01, 'level-medium'],
        [12, 'level-low'],
    ])('uses strict weekday thresholds for %s', async (value, expectedClass) => {
        mockFetchVix.mockResolvedValue({ vix: { value, asOf: '2026-08-19', previousValue: null } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText(value.toFixed(2))).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toBe(`vix-chip ${expectedClass}`);
    });

    it('does not assign a level color on weekends', async () => {
        dayOfWeek.mockReturnValue(6);
        mockFetchVix.mockResolvedValue({ vix: { value: 18, asOf: '2026-08-21', previousValue: 17 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('18.00')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toBe('vix-chip');
    });

    it('leaves no empty change space when there is no session before it', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: null } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        expect(container.querySelector('.vix-chip .change')).toBeNull();
    });

    it('holds its place before the figure lands, so the buttons beside it stay put', () => {
        mockFetchVix.mockReturnValue(new Promise(() => undefined));
        const { container } = renderChip();

        const chip = container.querySelector('.vix-chip');
        expect(chip?.className).toContain('pending');
        expect(chip?.getAttribute('aria-hidden')).toBe('true');
    });

    it('stays quiet when there is no VIX to show', async () => {
        mockFetchVix.mockRejectedValue(new Error('offline'));
        const { container } = renderChip();

        await waitFor(() => expect(mockFetchVix).toHaveBeenCalled());
        expect(container.querySelector('.vix-chip')?.className).toContain('pending');
    });
});
