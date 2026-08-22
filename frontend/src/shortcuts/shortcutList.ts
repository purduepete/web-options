export interface Shortcut {
    keys: string[];
    description: string;
}

export interface ShortcutSection {
    title: string;
    shortcuts: Shortcut[];
}

/** The one list the app documents itself from, so nothing drifts. */
export const SHORTCUT_SECTIONS: ShortcutSection[] = [
    {
        title: 'Anywhere',
        shortcuts: [
            { keys: ['Ctrl', 'K'], description: 'Open the command palette' },
            { keys: ['Ctrl', '/'], description: 'Open the command palette' },
            { keys: ['Ctrl', '\\'], description: 'Open the menu' },
            { keys: ['Ctrl', 'Shift', '?'], description: 'Show this list' },
            { keys: ['Esc'], description: 'Close the palette, the menu or this list' },
        ],
    },
    {
        title: 'Live signals',
        shortcuts: [
            { keys: ['←'], description: 'Previous week' },
            { keys: ['→'], description: 'Next week' },
            { keys: ['t'], description: 'Top picks only' },
            { keys: ['c'], description: 'Conservative only' },
            { keys: ['b'], description: 'Balanced only' },
            { keys: ['a'], description: 'Aggressive only' },
            { keys: ['j'], description: 'Collapse or expand every group' },
            { keys: ['f'], description: 'Toggle the filter panel' },
            { keys: ['/'], description: 'Filter by symbol, or !symbol to exclude' },
            { keys: ['e'], description: 'Next contracts filter' },
            { keys: ['m'], description: 'Next moneyness filter' },
            { keys: ['o'], description: 'Next over-half filter' },
            { keys: ['u'], description: 'Next owned filter' },
            { keys: ['r'], description: 'Reset the menus' },
        ],
    },
    {
        title: 'Summary',
        shortcuts: [
            { keys: ['/'], description: 'Filter by symbols, or !symbol to exclude' },
            { keys: ['j'], description: 'Collapse or expand every month' },
            { keys: ['e'], description: 'Next contracts filter' },
            { keys: ['r'], description: 'Clear every filter' },
        ],
    },
    {
        title: 'Owned contracts',
        shortcuts: [
            { keys: ['f'], description: 'Toggle the filter panel' },
            { keys: ['/'], description: 'Filter by symbol, or !symbol to exclude' },
            { keys: ['m'], description: 'Next moneyness filter' },
            { keys: ['r'], description: 'Reset the menus' },
        ],
    },
    {
        title: 'Weekly calendars',
        shortcuts: [
            { keys: ['←'], description: 'Previous week' },
            { keys: ['→'], description: 'Next week' },
        ],
    },
];
