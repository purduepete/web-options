/**
 * The mega menu is described by data, not by JSX, so the command palette (Phase 6)
 * can walk the same list without duplicating the labels or the routes.
 *
 * `disabled` items are future placeholders kept out of the rendered menu.
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
                id: '/summary',
                label: 'Summary',
                description: 'Every week rolled up by risk group',
                path: '/summary',
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
                id: '/weekly-wrapups',
                label: 'Weekly Wrap-up',
                description: 'Put management plans, closed trades, and rolls',
                path: '/weekly-wrapups',
            },
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
        id: 'tools',
        label: 'Tools',
        items: [
            {
                id: '/contract-history',
                label: 'Contract History',
                description: 'VADER option prices and delta throughout each session',
                path: '/contract-history',
            },
            {
                id: '/owned-contracts',
                label: 'Owned Contracts',
                description: 'Current live and paper option positions',
                path: '/owned-contracts',
            },
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
                id: '/settings/favorites',
                label: 'Favorites',
                description: 'Order favorite pages and their shortcuts',
                path: '/settings/favorites',
            },
            {
                id: '/settings/grading',
                label: 'Grading',
                description: 'Thresholds behind the trade grade',
                path: '/settings/grading',
            },
            {
                id: '/settings/caution',
                label: 'Caution Symbols',
                description: 'Underlyings to flag on every ticket',
                path: '/settings/caution',
            },
            {
                id: '/settings/appearance',
                label: 'Appearance',
                description: 'Theme and highlight color',
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

/** Only real routes can be favorited or recorded as visited. */
export function navigableItems(): readonly NavItem[] {
    return [...ITEMS_BY_ID.values()].filter((item) => item.path && !item.disabled);
}
