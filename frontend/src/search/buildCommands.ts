import type { CalendarSummary } from '@weboptions/shared';
import { THEME_PREFERENCES, type ThemePreference } from '@weboptions/shared';
import { navigableItems, type NavItem } from '../navigation/navModel';
import type { Command } from './commandModel';

/** Favourites beat recents, recents beat everything else, at equal match quality. */
const FAVORITE_BOOST = 40;
const RECENT_BOOST = 20;

const THEME_LABELS: Record<ThemePreference, string> = {
    system: 'Use the system theme',
    light: 'Switch to the light theme',
    dark: 'Switch to the dark theme',
    midnight: 'Switch to the midnight theme',
};

export interface BuildCommandsArgs {
    navigate: (path: string) => void;
    favorites: readonly NavItem[];
    recent: readonly NavItem[];
    calendars: readonly CalendarSummary[];
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => void;
    forget: () => void;
}

/**
 * Flattens everything the palette can reach into one list. Pure apart from the
 * callbacks it is handed, so the whole command set can be asserted in a test.
 */
export function buildCommands({
    navigate,
    favorites,
    recent,
    calendars,
    preference,
    setPreference,
    forget,
}: BuildCommandsArgs): Command[] {
    const commands: Command[] = [];
    const seen = new Set<string>();

    function addPage(item: NavItem, group: string, boost?: number) {
        const id = `page:${item.id}`;
        if (!item.path || seen.has(id)) return;
        seen.add(id);
        commands.push({
            id,
            label: item.label,
            hint: item.description,
            group,
            icon: group === 'Favourites' ? 'star' : group === 'Recent' ? 'clock' : 'page',
            boost,
            run: () => navigate(item.path as string),
        });
    }

    favorites.forEach((item) => addPage(item, 'Favourites', FAVORITE_BOOST));
    recent.forEach((item) => addPage(item, 'Recent', RECENT_BOOST));
    navigableItems().forEach((item) => addPage(item, 'Pages'));

    for (const week of calendars) {
        commands.push({
            id: `calendar:${week.publishDate}`,
            label: `Week of ${week.publishDate}`,
            hint: week.title ?? `${week.tradeCount} trades`,
            keywords: `${week.weekStart} ${week.weekEnd} calendar week`,
            group: 'Calendars',
            icon: 'calendar',
            run: () => navigate(`/calendars/${encodeURIComponent(week.publishDate)}`),
        });
    }

    for (const candidate of THEME_PREFERENCES) {
        if (candidate === preference) continue;
        commands.push({
            id: `theme:${candidate}`,
            label: THEME_LABELS[candidate],
            keywords: 'appearance colour scheme dark light',
            group: 'Actions',
            icon: 'theme',
            run: () => setPreference(candidate),
        });
    }

    commands.push({
        id: 'action:forget-key',
        label: 'Forget the API key on this browser',
        hint: 'Locks the app and asks for the key again',
        keywords: 'sign out log out lock',
        group: 'Actions',
        icon: 'key',
        run: forget,
    });

    return commands;
}
