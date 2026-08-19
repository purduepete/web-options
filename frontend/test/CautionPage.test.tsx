import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchCautionSymbols = vi.fn();
const saveCautionSymbols = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchCautionSymbols: () => fetchCautionSymbols(),
        saveCautionSymbols: (symbols: readonly string[]) => saveCautionSymbols(symbols),
    };
});

const { CautionProvider } = await import('../src/caution/CautionProvider');
const { CautionBadge } = await import('../src/caution/CautionBadge');
const { CautionPage } = await import('../src/pages/CautionPage');

function renderPage() {
    return render(
        <CautionProvider>
            <CautionPage />
        </CautionProvider>,
    );
}

function textarea(): HTMLTextAreaElement {
    return screen.getByLabelText(/symbols/i) as HTMLTextAreaElement;
}

function saveButton(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
}

/** Save stays disabled until the stored list has arrived, so this is the ready signal. */
async function whenLoaded(): Promise<void> {
    await waitFor(() => expect(saveButton().disabled).toBe(false));
}

beforeEach(() => {
    vi.clearAllMocks();
    fetchCautionSymbols.mockResolvedValue({ symbols: [] });
    saveCautionSymbols.mockImplementation(async (symbols: readonly string[]) => ({ symbols: [...symbols].sort() }));
});

describe('CautionPage', () => {
    it('seeds the box from the stored list, one per line and sorted', async () => {
        fetchCautionSymbols.mockResolvedValue({ symbols: ['SMCI', 'KTOS'] });
        renderPage();
        await waitFor(() => expect(textarea().value).toBe('KTOS\nSMCI'));
    });

    it('does not overwrite what is being typed when a save comes back', async () => {
        fetchCautionSymbols.mockResolvedValue({ symbols: ['KTOS'] });
        renderPage();
        await waitFor(() => expect(textarea().value).toBe('KTOS'));

        fireEvent.change(textarea(), { target: { value: 'KTOS SMCI' } });
        fireEvent.click(saveButton());
        await screen.findByText('Saved 2 symbols.');

        fireEvent.change(textarea(), { target: { value: 'KTOS\nSMCI\nPLT' } });
        await waitFor(() => expect(textarea().value).toBe('KTOS\nSMCI\nPLT'));
    });

    it('sends the parsed list, however it was separated', async () => {
        renderPage();
        await whenLoaded();

        fireEvent.change(textarea(), { target: { value: ' ktos, smci\n\nktos ' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(saveCautionSymbols).toHaveBeenCalledWith(['KTOS', 'SMCI']));
        expect(await screen.findByText('Saved 2 symbols.')).toBeTruthy();
    });

    it('counts what would be saved rather than what was typed', async () => {
        renderPage();
        await whenLoaded();
        fireEvent.change(textarea(), { target: { value: 'KTOS ktos SMCI' } });
        expect(screen.getByText('2 of 200')).toBeTruthy();
    });

    it('shows the reason a save was refused', async () => {
        saveCautionSymbols.mockRejectedValue(new Error('"DROP TABLE" is not a ticker'));
        renderPage();
        await whenLoaded();

        fireEvent.change(textarea(), { target: { value: 'KTOS' } });
        fireEvent.click(saveButton());

        expect(await screen.findByText('"DROP TABLE" is not a ticker')).toBeTruthy();
    });

    it('will not save before the stored list has arrived', () => {
        fetchCautionSymbols.mockReturnValue(new Promise(() => {}));
        renderPage();
        expect(saveButton().disabled).toBe(true);
    });
});

describe('CautionBadge', () => {
    it('flags a listed underlying and leaves the rest alone', async () => {
        fetchCautionSymbols.mockResolvedValue({ symbols: ['KTOS'] });
        const { container } = render(
            <CautionProvider>
                <CautionBadge symbol="ktos" />
                <CautionBadge symbol="PM" />
            </CautionProvider>,
        );
        await waitFor(() => expect(container.querySelectorAll('.caution-flag')).toHaveLength(1));
    });

    it('shows nothing while the list is still loading', () => {
        fetchCautionSymbols.mockReturnValue(new Promise(() => {}));
        const { container } = render(
            <CautionProvider>
                <CautionBadge symbol="KTOS" />
            </CautionProvider>,
        );
        expect(container.querySelector('.caution-flag')).toBeNull();
    });
});
