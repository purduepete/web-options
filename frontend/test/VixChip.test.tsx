import { describe, expect, it, vi } from 'vitest';
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
        </VixProvider>,
    );
}

describe('VixChip', () => {
    it('keeps the chip and change free of grade classes', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toBe('vix-chip');
        expect(container.querySelector('.vix-chip .change')?.className).toBe('change');
    });

    it('shows the day change against the close before it', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('-6.00%')).toBeTruthy());
    });

    it('signs a rise, which is the good news to a put seller', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 21.4, asOf: '2026-08-19', previousValue: 20.1 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('+6.47%')).toBeTruthy());
    });

    it('hides a change that rounds to zero', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 14.89 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        expect(screen.queryByText('0.00%')).toBeNull();
        expect(container.querySelector('.vix-chip .change')).toBeNull();
        expect(container.querySelector('.vix-chip')?.getAttribute('title')).not.toContain('0.00%');
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
