import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCommandHotkey } from '../src/search/useCommandHotkey';

function Probe({ onToggle }: { onToggle: () => void }) {
    useCommandHotkey(onToggle);
    return <input aria-label="somewhere else" />;
}

describe('useCommandHotkey', () => {
    it('toggles on Ctrl+/ and Cmd+/', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(<Probe onToggle={onToggle} />);

        await user.keyboard('{Control>}/{/Control}');
        expect(onToggle).toHaveBeenCalledTimes(1);

        await user.keyboard('{Meta>}/{/Meta}');
        expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it('fires even while a text field has focus', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        const { getByRole } = render(<Probe onToggle={onToggle} />);

        await user.click(getByRole('textbox'));
        await user.keyboard('{Control>}/{/Control}');

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('ignores Ctrl+K, Cmd+K and other combinations', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(<Probe onToggle={onToggle} />);

        await user.keyboard('k');
        await user.keyboard('{Control>}k{/Control}');
        await user.keyboard('{Meta>}k{/Meta}');
        await user.keyboard('{Alt>}k{/Alt}');
        await user.keyboard('{Shift>}K{/Shift}');

        expect(onToggle).not.toHaveBeenCalled();
    });

    it('stops listening once the component is gone', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        const view = render(<Probe onToggle={onToggle} />);

        view.unmount();
        await user.keyboard('{Control>}/{/Control}');

        expect(onToggle).not.toHaveBeenCalled();
    });
});
