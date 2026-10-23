import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignalDatePicker } from '../src/components/SignalDatePicker';

const dates = [
    { added: '2026-10-23', count: 32 },
    { added: '2026-10-21', count: 24 },
    { added: '2026-09-30', count: 16 },
];

describe('signal date calendar', () => {
    it('shows counts, disables days without signals and selects a date', () => {
        const onChange = vi.fn();
        const { container } = render(<SignalDatePicker dates={dates} value="2026-10-23" onChange={onChange} />);
        const trigger = screen.getByRole('button', { name: 'Signal date: 10/23/2026' });
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Choose signal date' });
        expect(container.contains(dialog)).toBe(false);
        expect(screen.getByText('10/2026')).toBeDefined();
        expect(screen.getByRole('button', { name: '10/23/2026, 32 contracts' }).textContent).toBe('2332');
        expect(screen.getByRole('button', { name: '10/22/2026, no signals' }).hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '10/21/2026, 24 contracts' }));
        expect(onChange).toHaveBeenCalledWith('2026-10-21');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(container.querySelector('select, input[type="date"]')).toBeNull();
    });

    it('navigates months within the available range and dismisses on Escape or outside tap', () => {
        render(<SignalDatePicker dates={dates} value="2026-10-21" onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Signal date: 10/21/2026' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
        expect(screen.getByText('09/2026')).toBeDefined();
        expect(screen.getByRole('button', { name: /previous month/i }).getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: /next month/i }));
        expect(screen.getByText('10/2026')).toBeDefined();
        expect(screen.getByRole('button', { name: /next month/i }).getAttribute('aria-disabled')).toBe('true');
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(document.activeElement).toBe(trigger);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('supports keyboard day selection and Tab returns to the surrounding controls', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <>
                <SignalDatePicker dates={dates} value="2026-10-21" onChange={onChange} />
                <button>After calendar</button>
            </>
        );
        const trigger = screen.getByRole('button', { name: 'Signal date: 10/21/2026' });
        await user.click(trigger);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('10/21/2026, 24 contracts');
        await user.keyboard('{ArrowRight}{Enter}');
        expect(onChange).toHaveBeenCalledWith('2026-10-23');
        await user.click(trigger);
        await user.tab();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After calendar' }));
    });
});
