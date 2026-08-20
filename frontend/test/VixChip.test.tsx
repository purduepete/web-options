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
    it('grades a calm market yellow', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toContain('yellow');
    });

    it('grades a paying market green', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 21.4, asOf: '2026-08-19', previousValue: 20.1 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('21.40')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toContain('green');
    });

    it('grades a dead market red', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 11.8, asOf: '2026-08-19', previousValue: 12.9 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('11.80')).toBeTruthy());
        expect(container.querySelector('.vix-chip')?.className).toContain('red');
    });

    it('shows the day change against the close before it', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('-6.00%')).toBeTruthy());
        expect(container.querySelector('.vix-chip .change')?.className).toContain('falling');
    });

    it('signs a rise, which is the good news to a put seller', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 21.4, asOf: '2026-08-19', previousValue: 20.1 } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('+6.47%')).toBeTruthy());
        expect(container.querySelector('.vix-chip .change')?.className).toContain('rising');
    });

    it('holds the change open when there is no session before it', async () => {
        mockFetchVix.mockResolvedValue({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: null } });
        const { container } = renderChip();

        await waitFor(() => expect(screen.getByText('14.89')).toBeTruthy());
        const change = container.querySelector('.vix-chip .change');
        expect(change?.className).toContain('pending');
        expect(change?.getAttribute('aria-hidden')).toBe('true');
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
