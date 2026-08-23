export interface ShortcutEntry {
    chords: string[][];
    description: string;
    scope?: string;
}

export interface ShortcutGroup {
    title: string;
    entries: ShortcutEntry[];
}

/** The one list the app documents itself from, so nothing drifts. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: 'Anywhere',
        entries: [
            {
                chords: [
                    ['Ctrl', 'K'],
                    ['Ctrl', '/'],
                ],
                description: 'Open the command palette',
            },
            { chords: [['Ctrl', '\\']], description: 'Open the menu' },
            { chords: [['Ctrl', 'Shift', '?']], description: 'Show this list' },
            { chords: [['Esc']], description: 'Close the palette, the menu or this list' },
        ],
    },
    {
        title: 'Pages',
        entries: [
            { chords: [['←'], ['→']], description: 'Previous or next week', scope: 'Live · Calendars' },
            { chords: [['/']], description: 'Focus the symbol filter', scope: 'Live · Summary · Owned' },
            { chords: [['r']], description: 'Reset filters', scope: 'Live · Summary · Owned' },
            { chords: [['f']], description: 'Toggle the filter panel', scope: 'Live · Summary · Owned' },
            {
                chords: [['e']],
                description: 'Next contracts filter (All → Expired → Active)',
                scope: 'Live · Summary',
            },
            {
                chords: [['m']],
                description: 'Next moneyness filter (All → ITM → OTM)',
                scope: 'Live · Summary · Owned',
            },
            { chords: [['o']], description: 'Next over-half filter', scope: 'Live · Summary' },
            { chords: [['u']], description: 'Next owned filter', scope: 'Live' },
            { chords: [['j']], description: 'Toggle every group or month', scope: 'Live · Summary' },
        ],
    },
    {
        title: 'Live signals only',
        entries: [
            { chords: [['t']], description: 'Toggle Top Picks tier' },
            { chords: [['c']], description: 'Toggle Conservative tier' },
            { chords: [['b']], description: 'Toggle Balanced tier' },
            { chords: [['a']], description: 'Toggle Aggressive tier' },
        ],
    },
    {
        title: 'Owned contracts only',
        entries: [{ chords: [['c']], description: 'Next captured filter' }],
    },
];
