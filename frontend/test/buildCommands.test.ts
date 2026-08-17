import { describe, expect, it, vi } from 'vitest';
import { buildCommands } from '../src/search/buildCommands';
import { findNavItem } from '../src/navigation/navModel';
import type { NavItem } from '../src/navigation/navModel';

function item(id: string): NavItem {
    const found = findNavItem(id);
    if (!found) throw new Error(`no nav item ${id}`);
    return found;
}

function build(overrides: Partial<Parameters<typeof buildCommands>[0]> = {}) {
    return buildCommands({
        navigate: vi.fn(),
        favorites: [],
        recent: [],
        preference: 'midnight',
        setPreference: vi.fn(),
        forget: vi.fn(),
        ...overrides,
    });
}

function ids(commands: ReturnType<typeof buildCommands>): string[] {
    return commands.map((command) => command.id);
}

describe('buildCommands', () => {
    it('offers every navigable page and no placeholders', () => {
        const commands = build();

        expect(ids(commands)).toContain('page:/');
        expect(ids(commands)).toContain('page:/calendars/latest');
        expect(ids(commands)).toContain('page:/settings/appearance');
        expect(ids(commands).some((id) => id.includes('week-explorer'))).toBe(false);
        expect(ids(commands).some((id) => id.includes('symbol-lookup'))).toBe(false);
    });

    it('navigates to the page it describes', () => {
        const navigate = vi.fn();
        const commands = build({ navigate });

        commands.find((command) => command.id === 'page:/calendars/latest')?.run();

        expect(navigate).toHaveBeenCalledWith('/calendars/latest');
    });

    it('lists favourites and recents first, boosted, and does not repeat them under Pages', () => {
        const commands = build({ favorites: [item('/calendars/latest')], recent: [item('/settings/key')] });

        expect(ids(commands).slice(0, 2)).toEqual(['page:/calendars/latest', 'page:/settings/key']);
        expect(commands[0]?.group).toBe('Favourites');
        expect(commands[1]?.group).toBe('Recent');
        expect(commands[0]?.boost).toBeGreaterThan(commands[1]?.boost ?? 0);
        expect(ids(commands).filter((id) => id === 'page:/calendars/latest')).toHaveLength(1);
    });

    it('prefers the favourite entry when a page is both favourite and recent', () => {
        const commands = build({ favorites: [item('/calendars/latest')], recent: [item('/calendars/latest')] });

        expect(ids(commands).filter((id) => id === 'page:/calendars/latest')).toHaveLength(1);
        expect(commands[0]?.group).toBe('Favourites');
    });

    it('leaves the individual weeks out: the calendar page steps through them', () => {
        const commands = build();
        expect(commands.some((command) => command.group === 'Calendars')).toBe(false);
        expect(ids(commands).some((id) => id.startsWith('calendar:'))).toBe(false);
    });

    it('offers one theme action per preference and skips the current one', () => {
        const setPreference = vi.fn();
        const commands = build({ preference: 'midnight', setPreference });
        const themes = commands.filter((command) => command.id.startsWith('theme:'));

        expect(themes.map((command) => command.id)).toEqual(['theme:system', 'theme:light', 'theme:dark']);

        themes[1]?.run();
        expect(setPreference).toHaveBeenCalledWith('light');
    });

    it('offers to forget the API key', () => {
        const forget = vi.fn();
        const commands = build({ forget });

        commands.find((command) => command.id === 'action:forget-key')?.run();

        expect(forget).toHaveBeenCalledTimes(1);
    });

    it('gives every command a unique id', () => {
        const commands = build({ favorites: [item('/')], recent: [item('/calendars/latest')] });
        expect(new Set(ids(commands)).size).toBe(commands.length);
    });
});
