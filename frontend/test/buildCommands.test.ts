import { describe, expect, it, vi } from 'vitest';
import type { CalendarSummary } from '@weboptions/shared';
import { buildCommands } from '../src/search/buildCommands';
import { findNavItem } from '../src/navigation/navModel';
import type { NavItem } from '../src/navigation/navModel';

const CALENDARS: readonly CalendarSummary[] = [
    {
        publishDate: '2026-01-05',
        weekStart: '2026-01-05',
        weekEnd: '2026-01-09',
        title: 'New year kick-off',
        tradeCount: 19,
    },
    { publishDate: '2025-12-29', weekStart: '2025-12-29', weekEnd: '2026-01-02', title: null, tradeCount: 7 },
];

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
        calendars: [],
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
        expect(ids(commands)).toContain('page:/calendars');
        expect(ids(commands)).toContain('page:/settings/appearance');
        expect(ids(commands).some((id) => id.includes('week-explorer'))).toBe(false);
        expect(ids(commands).some((id) => id.includes('symbol-lookup'))).toBe(false);
    });

    it('navigates to the page it describes', () => {
        const navigate = vi.fn();
        const commands = build({ navigate });

        commands.find((command) => command.id === 'page:/calendars')?.run();

        expect(navigate).toHaveBeenCalledWith('/calendars');
    });

    it('lists favourites and recents first, boosted, and does not repeat them under Pages', () => {
        const commands = build({ favorites: [item('/calendars')], recent: [item('/settings/key')] });

        expect(ids(commands).slice(0, 2)).toEqual(['page:/calendars', 'page:/settings/key']);
        expect(commands[0]?.group).toBe('Favourites');
        expect(commands[1]?.group).toBe('Recent');
        expect(commands[0]?.boost).toBeGreaterThan(commands[1]?.boost ?? 0);
        expect(ids(commands).filter((id) => id === 'page:/calendars')).toHaveLength(1);
    });

    it('prefers the favourite entry when a page is both favourite and recent', () => {
        const commands = build({ favorites: [item('/calendars')], recent: [item('/calendars')] });

        expect(ids(commands).filter((id) => id === 'page:/calendars')).toHaveLength(1);
        expect(commands[0]?.group).toBe('Favourites');
    });

    it('turns each ingested week into a command', () => {
        const navigate = vi.fn();
        const commands = build({ calendars: CALENDARS, navigate });
        const week = commands.find((command) => command.id === 'calendar:2026-01-05');

        expect(week?.group).toBe('Calendars');
        expect(week?.label).toContain('2026-01-05');
        expect(week?.hint).toBe('New year kick-off');
        expect(week?.keywords).toContain('2026-01-09');

        week?.run();
        expect(navigate).toHaveBeenCalledWith('/calendars/2026-01-05');
    });

    it('falls back to the trade count when a week has no title', () => {
        const commands = build({ calendars: CALENDARS });
        expect(commands.find((command) => command.id === 'calendar:2025-12-29')?.hint).toBe('7 trades');
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
        const commands = build({ calendars: CALENDARS, favorites: [item('/')], recent: [item('/calendars')] });
        expect(new Set(ids(commands)).size).toBe(commands.length);
    });
});
