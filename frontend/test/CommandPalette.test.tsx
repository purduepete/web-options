import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../src/search/CommandPalette';
import type { Command } from '../src/search/commandModel';

function command(id: string, label: string, extra: Partial<Command> = {}): Command {
    return { id, label, group: 'Pages', icon: 'page', run: () => {}, ...extra };
}

function options(): HTMLElement[] {
    return screen.queryAllByRole('option');
}

function activeOptionLabel(): string {
    const input = screen.getByRole('combobox');
    const id = input.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    const active = document.getElementById(id as string);
    expect(active?.getAttribute('aria-selected')).toBe('true');
    return active?.textContent ?? '';
}

function renderPalette(commands: readonly Command[], onClose = () => {}) {
    return render(<CommandPalette open commands={commands} onClose={onClose} />);
}

const COMMANDS: readonly Command[] = [
    command('/', 'Live Signals', { hint: 'This week of VADER puts' }),
    command('/calendars', 'All Calendars', { hint: 'Every ingested week' }),
    command('/calendars/latest', 'Latest Calendar'),
    command('theme:dark', 'Switch to dark theme', { group: 'Actions', icon: 'theme' }),
];

describe('CommandPalette', () => {
    it('renders nothing at all when it is closed', () => {
        const { container } = render(<CommandPalette open={false} commands={COMMANDS} onClose={() => {}} />);
        expect(container.textContent).toBe('');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a modal dialog with a combobox wired to the listbox', () => {
        renderPalette(COMMANDS);

        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe('Command palette');

        const input = screen.getByRole('combobox');
        const list = screen.getByRole('listbox');
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-controls')).toBe(list.id);
        expect(input.getAttribute('aria-autocomplete')).toBe('list');
        expect(document.activeElement).toBe(input);
    });

    it('lists every command under its group heading before anything is typed', () => {
        renderPalette(COMMANDS);

        expect(options()).toHaveLength(4);
        expect(screen.getByText('Pages')).toBeTruthy();
        expect(screen.getByText('Actions')).toBeTruthy();
        expect(activeOptionLabel()).toContain('Live Signals');
    });

    it('filters as you type and keeps the first result selected', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('cal');

        expect(options().map((option) => option.textContent)).toEqual([
            expect.stringContaining('All Calendars'),
            expect.stringContaining('Latest Calendar'),
        ]);
        expect(activeOptionLabel()).toContain('All Calendars');
    });

    it('says so when nothing matches', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('zebra');

        expect(options()).toHaveLength(0);
        expect(screen.getByRole('status').textContent).toContain('No matches');
    });

    it('moves the selection with the arrow keys and wraps at both ends', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('{ArrowDown}');
        expect(activeOptionLabel()).toContain('All Calendars');

        await user.keyboard('{ArrowUp}');
        expect(activeOptionLabel()).toContain('Live Signals');

        await user.keyboard('{ArrowUp}');
        expect(activeOptionLabel()).toContain('Switch to dark theme');

        await user.keyboard('{ArrowDown}');
        expect(activeOptionLabel()).toContain('Live Signals');
    });

    it('jumps to the ends with Home and End', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('{End}');
        expect(activeOptionLabel()).toContain('Switch to dark theme');

        await user.keyboard('{Home}');
        expect(activeOptionLabel()).toContain('Live Signals');
    });

    it('runs the selected command on Enter and closes', async () => {
        const user = userEvent.setup();
        const run = vi.fn();
        const onClose = vi.fn();
        renderPalette([command('a', 'Only One', { run })], onClose);

        await user.keyboard('{Enter}');

        expect(run).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does nothing on Enter when the list is empty', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderPalette(COMMANDS, onClose);

        await user.keyboard('zebra{Enter}');

        expect(onClose).not.toHaveBeenCalled();
    });

    it('runs a command when it is clicked', async () => {
        const user = userEvent.setup();
        const run = vi.fn();
        const onClose = vi.fn();
        renderPalette([command('a', 'Only One', { run })], onClose);

        await user.click(screen.getByRole('option', { name: /Only One/ }));

        expect(run).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape and when the backdrop is clicked', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderPalette(COMMANDS, onClose);

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);

        await user.click(screen.getByTestId('palette-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('keeps the dialog open when the dialog itself is clicked', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderPalette(COMMANDS, onClose);

        await user.click(screen.getByRole('listbox'));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('announces how many results there are', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('cal');

        expect(screen.getByRole('status').textContent).toContain('2 results');
    });

    it('highlights the part of the label that matched', async () => {
        const user = userEvent.setup();
        renderPalette(COMMANDS);

        await user.keyboard('cal');

        const marks = screen.getAllByText('Cal', { selector: 'mark' });
        expect(marks.length).toBeGreaterThan(0);
    });

    it('groups the options with role="group" rather than loose text in the listbox', () => {
        renderPalette(COMMANDS);

        const groups = screen.getAllByRole('group');
        expect(groups.map((group) => group.getAttribute('aria-label') ?? nameOf(group))).toEqual(['Pages', 'Actions']);
        // Every option lives inside a group, so the listbox holds nothing loose.
        for (const option of options()) {
            expect(option.closest('[role="group"]')).toBeTruthy();
        }
    });

    it('closes when focus tabs away', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderPalette(COMMANDS, onClose);

        await user.tab();

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('forgets the previous query when it is reopened', async () => {
        const user = userEvent.setup();
        const view = render(<CommandPalette open commands={COMMANDS} onClose={() => {}} />);
        const value = () => (screen.getByRole('combobox') as HTMLInputElement).value;

        await user.keyboard('cal');
        expect(value()).toBe('cal');

        view.rerender(<CommandPalette open={false} commands={COMMANDS} onClose={() => {}} />);
        view.rerender(<CommandPalette open commands={COMMANDS} onClose={() => {}} />);

        expect(value()).toBe('');
    });
});

/*
 * Handing focus back to the trigger is right when the palette was dismissed from
 * the keyboard and wrong when it was dismissed with the mouse: the browser reads
 * a programmatic focus out of a text field as keyboard intent and paints a focus
 * ring, so a click would leave a glowing button behind it.
 */
describe('CommandPalette focus restore', () => {
    /** Renders a trigger, focuses it, opens the palette from it, and hands back a closer. */
    function openFromTrigger() {
        const trigger = document.createElement('button');
        trigger.textContent = 'Search';
        document.body.append(trigger);
        trigger.focus();

        const view = render(<CommandPalette open commands={COMMANDS} onClose={() => {}} />);
        return {
            trigger,
            close: () => view.rerender(<CommandPalette open={false} commands={COMMANDS} onClose={() => {}} />),
        };
    }

    it('gives focus back to whatever opened it when escape closes it', async () => {
        const user = userEvent.setup();
        const { trigger, close } = openFromTrigger();
        expect(document.activeElement).toBe(screen.getByRole('combobox'));

        await user.keyboard('{Escape}');
        close();

        expect(document.activeElement).toBe(trigger);
    });

    it('leaves focus alone when a result is clicked', async () => {
        const user = userEvent.setup();
        const { trigger, close } = openFromTrigger();

        const first = options()[0];
        expect(first).toBeTruthy();
        await user.click(first as HTMLElement);
        close();

        expect(document.activeElement).not.toBe(trigger);
    });

    it('leaves focus alone when tab closes it, because tab is a way out', async () => {
        const user = userEvent.setup();
        const { trigger, close } = openFromTrigger();

        await user.tab();
        close();

        expect(document.activeElement).not.toBe(trigger);
    });
});

/** `@testing-library/jest-dom` is not installed, so the name is read by hand. */
function nameOf(element: HTMLElement): string {
    const id = element.getAttribute('aria-labelledby');
    return id ? (document.getElementById(id)?.textContent ?? '') : '';
}

describe('CommandPalette initial focus by device', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each([
        {
            label: 'desktop',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            platform: 'Win32',
            touches: 0,
            ios: false,
        },
        {
            label: 'iPhone',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
            platform: 'iPhone',
            touches: 5,
            ios: true,
        },
        {
            label: 'iPad desktop identity',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            platform: 'MacIntel',
            touches: 5,
            ios: true,
        },
    ])(
        'focuses the $label search only where it will not open a keyboard',
        async ({ userAgent, platform, touches, ios }) => {
            vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
            vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
            vi.stubGlobal('navigator', Object.create(navigator, { maxTouchPoints: { value: touches } }));
            const user = userEvent.setup();
            const onClose = vi.fn();
            renderPalette(COMMANDS, onClose);

            const input = screen.getByRole('combobox');
            expect(document.activeElement).toBe(ios ? screen.getByRole('dialog') : input);

            await user.click(input);
            expect(document.activeElement).toBe(input);
            await user.keyboard('cal');
            expect((input as HTMLInputElement).value).toBe('cal');
            await user.keyboard('{Escape}');
            expect(onClose).toHaveBeenCalled();
        }
    );
});
