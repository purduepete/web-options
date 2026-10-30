import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TooltipLayer } from '../src/components/Tooltip';

function renderTooltip() {
    return render(
        <>
            <button type="button" data-tip="Save changes">
                Save
            </button>
            <button type="button">Other</button>
            <TooltipLayer />
        </>
    );
}

describe('shared tooltip', () => {
    it('shows on hover and connects the trigger to the tooltip for assistive technology', async () => {
        const user = userEvent.setup();
        renderTooltip();
        const trigger = screen.getByRole('button', { name: 'Save' });

        await user.hover(trigger);

        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toBe('Save changes');
        expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
    });

    it('shows on keyboard focus and closes on Escape', async () => {
        const user = userEvent.setup();
        renderTooltip();
        const trigger = screen.getByRole('button', { name: 'Save' });

        await user.tab();
        expect(screen.getByRole('tooltip').textContent).toBe('Save changes');

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('stays open while the pointer moves from its trigger onto the tooltip', async () => {
        const user = userEvent.setup();
        renderTooltip();
        const trigger = screen.getByRole('button', { name: 'Save' });
        await user.hover(trigger);
        const tooltip = screen.getByRole('tooltip');

        fireEvent.pointerOut(trigger, { relatedTarget: tooltip });
        fireEvent.pointerOver(tooltip);

        expect(screen.getByRole('tooltip')).toBe(tooltip);
    });

    it('opens on touch and closes after an outside click', () => {
        renderTooltip();
        const trigger = screen.getByRole('button', { name: 'Save' });

        fireEvent.pointerDown(trigger, { pointerType: 'touch' });
        expect(screen.getByRole('tooltip').textContent).toBe('Save changes');

        fireEvent.click(screen.getByRole('button', { name: 'Other' }));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('closes on scroll', async () => {
        const user = userEvent.setup();
        renderTooltip();
        await user.hover(screen.getByRole('button', { name: 'Save' }));

        fireEvent.scroll(window);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });
});
