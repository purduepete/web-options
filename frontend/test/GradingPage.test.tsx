import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GRADE_DEFAULTS } from '@weboptions/shared';

const fetchGradeSettings = vi.fn();
const saveGradeSettings = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchGradeSettings: () => fetchGradeSettings(),
        saveGradeSettings: (settings: unknown) => saveGradeSettings(settings),
    };
});

const { GradeSettingsProvider } = await import('../src/grade/GradeSettingsProvider');
const { GradingPage } = await import('../src/pages/GradingPage');

function renderPage() {
    return render(
        <GradeSettingsProvider>
            <GradingPage />
        </GradeSettingsProvider>
    );
}

function field(label: RegExp): HTMLInputElement {
    return screen.getByLabelText(label) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
}

/** Save stays disabled until the stored thresholds have arrived. */
async function whenLoaded(): Promise<void> {
    await waitFor(() => expect(saveButton().disabled).toBe(false));
}

beforeEach(() => {
    vi.clearAllMocks();
    fetchGradeSettings.mockResolvedValue({ settings: GRADE_DEFAULTS });
    saveGradeSettings.mockImplementation(async (settings: unknown) => ({ settings }));
});

describe('GradingPage', () => {
    it('seeds the fields from what is stored', async () => {
        fetchGradeSettings.mockResolvedValue({ settings: { ...GRADE_DEFAULTS, deltaThreshold: -0.4 } });
        renderPage();

        await waitFor(() => expect(field(/delta threshold/i).value).toBe('-0.4'));
        expect(field(/cushion percent/i).value).toBe('10');
    });

    it('does not overwrite what is being typed when a save comes back', async () => {
        renderPage();
        await whenLoaded();

        fireEvent.change(field(/cushion percent/i), { target: { value: '12' } });
        fireEvent.click(saveButton());
        await screen.findByText('Saved.');

        fireEvent.change(field(/cushion percent/i), { target: { value: '14' } });
        await waitFor(() => expect(field(/cushion percent/i).value).toBe('14'));
    });

    it('sends all four, so a partial save cannot leave the page ahead of the server', async () => {
        renderPage();
        await whenLoaded();

        fireEvent.change(field(/delta threshold/i), { target: { value: '-0.3' } });
        fireEvent.click(saveButton());

        await waitFor(() =>
            expect(saveGradeSettings).toHaveBeenCalledWith({ ...GRADE_DEFAULTS, deltaThreshold: -0.3 })
        );
    });

    it('takes a decimal that is still being typed without rejecting the keystroke', async () => {
        // A `type="number"` input reports '' mid-entry for '-0.', which would blank
        // the field under the reader's caret. These are text inputs for that reason.
        renderPage();
        await whenLoaded();

        fireEvent.change(field(/delta threshold/i), { target: { value: '-0.' } });

        expect(field(/delta threshold/i).value).toBe('-0.');
    });

    describe('refusing a threshold it cannot use', () => {
        it.each([
            ['a positive delta threshold', /delta threshold/i, '0.25'],
            ['a delta past -1', /delta threshold/i, '-2'],
            ['a cushion below zero', /cushion percent/i, '-5'],
            ['something that is not a number at all', /cushion percent/i, 'ten'],
        ])('will not save %s', async (_label, label, value) => {
            renderPage();
            await whenLoaded();

            fireEvent.change(field(label), { target: { value } });

            expect(saveButton().disabled).toBe(true);
            expect(saveGradeSettings).not.toHaveBeenCalled();
        });

        it('will not save red above yellow, which nothing could grade yellow', async () => {
            renderPage();
            await whenLoaded();

            fireEvent.change(field(/red below/i), { target: { value: '40' } });

            expect(saveButton().disabled).toBe(true);
            expect(screen.getByText(/nothing can grade yellow/i)).toBeTruthy();
        });

        it('says why, rather than leaving a dead button', async () => {
            renderPage();
            await whenLoaded();

            fireEvent.change(field(/delta threshold/i), { target: { value: '5' } });

            expect(screen.getByText(/deltaThreshold must be a number between -1 and 0/)).toBeTruthy();
        });
    });

    it('puts the defaults back without saving them, so the reader can still change their mind', async () => {
        fetchGradeSettings.mockResolvedValue({ settings: { ...GRADE_DEFAULTS, deltaThreshold: -0.4 } });
        renderPage();
        await waitFor(() => expect(field(/delta threshold/i).value).toBe('-0.4'));

        fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));

        expect(field(/delta threshold/i).value).toBe('-0.25');
        expect(saveGradeSettings).not.toHaveBeenCalled();
    });

    it('reports a failed save without pretending it worked', async () => {
        saveGradeSettings.mockRejectedValue(new Error('database_unreachable'));
        renderPage();
        await whenLoaded();

        fireEvent.click(saveButton());

        expect(await screen.findByText(/database_unreachable/)).toBeTruthy();
        expect(screen.queryByText('Saved.')).toBeNull();
    });

    it('cannot be saved before the stored thresholds have arrived', async () => {
        renderPage();

        // Otherwise the first click would overwrite what is stored with the defaults.
        expect(saveButton().disabled).toBe(true);
        await whenLoaded();
    });
});
