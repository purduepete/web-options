/**
 * The mega menu is described by data, not by JSX, so the command palette (Phase 6)
 * can walk the same list without duplicating the labels or the routes.
 *
 * `disabled` items are deliberate placeholders: they show what is coming without
 * pretending to work.
 */

export interface NavItem {
    /** Stable id, also the favorites key. Equals `path` for real routes. */
    id: string;
    label: string;
    description: string;
    path?: string;
    disabled?: boolean;
}

export interface NavSection {
    id: string;
    label: string;
    items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
    {
        id: 'signals',
        label: 'Signals',
        items: [
            {
                id: '/',
                label: 'Live Signals',
                description: 'This week of VADER Telegram puts',
                path: '/',
            },
            {
                id: 'week-explorer',
                label: 'Week Explorer',
                description: 'Compare several weeks side by side',
                disabled: true,
            },
        ],
    },
    {
        id: 'calendars',
        label: 'Calendars',
        items: [
            {
                id: '/calendars/latest',
                label: 'Weekly Calendars',
                // The week page steps back through the archive, so the newest
                // one is the way in to all of them.
                description: 'The newest published week',
                path: '/calendars/latest',
            },
        ],
    },
    {
        id: 'reports',
        label: 'Reports',
        items: [
            {
                id: '/reports/latest',
                label: 'Weekly Report',
                description: 'The newest weekly results review',
                path: '/reports/latest',
            },
        ],
    },
    {
        id: 'tools',
        label: 'Tools',
        items: [
            {
                id: 'symbol-lookup',
                label: 'Symbol Lookup',
                description: 'Every signal ever seen for one ticker',
                disabled: true,
            },
            {
                id: 'export',
                label: 'Export',
                description: 'Download a week as CSV',
                disabled: true,
            },
        ],
    },
    {
        id: 'settings',
        label: 'Settings',
        items: [
            {
                id: '/settings/appearance',
                label: 'Appearance',
                description: 'Theme and highlight colour',
                path: '/settings/appearance',
            },
            {
                id: '/settings/key',
                label: 'API Key',
                description: 'The key this browser is using',
                path: '/settings/key',
            },
        ],
    },
];

const ITEMS_BY_ID = new Map(NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.id, item]));

export function findNavItem(id: string): NavItem | undefined {
    return ITEMS_BY_ID.get(id);
}

/** Only real routes can be favourited or recorded as visited. */
export function navigableItems(): readonly NavItem[] {
    return [...ITEMS_BY_ID.values()].filter((item) => item.path && !item.disabled);
}
