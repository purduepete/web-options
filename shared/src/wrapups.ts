export const WRAPUP_SECTIONS = ['management', 'closed', 'rolls'] as const;
export type WrapupSectionKey = (typeof WRAPUP_SECTIONS)[number];

export const WRAPUP_HEADERS = {
    management: [
        'Zone',
        'This Week',
        'Category',
        'Ticker',
        'Contracts',
        'Position',
        'Exp',
        'Stock',
        'P&L %',
        'Delta',
        'Management Plan',
    ],
    closed: ['#', 'Ticker', 'Contracts', 'Position', 'Exp', 'Opened', 'Entry', 'Exit', 'P&L %', 'Days Held'],
    controlled: [
        '#',
        'Ticker',
        'Contracts',
        'Old Position',
        'New Position',
        'Reason',
        'Close-Leg P&L',
        'Delta Change',
        'Type',
    ],
    rolls: [
        '#',
        'Ticker',
        'Contracts',
        'Old Position',
        'New Position',
        'Close-Leg P&L',
        'Delta Change',
        'Roll Txn Net',
    ],
} as const;

export interface WrapupContract {
    symbol: string;
    strike: number;
    expiration: string;
    optionRight: 'P';
}

export interface WrapupRow {
    sourceRow: number;
    cells: string[];
    contract: WrapupContract;
    newContract: WrapupContract | null;
}

export interface WrapupTable {
    kind: keyof typeof WRAPUP_HEADERS;
    headers: string[];
    rows: WrapupRow[];
}

export interface WrapupSection {
    name: string;
    start: string;
    end: string;
    quoteDate: string | null;
    tables: WrapupTable[];
    audit: { calls: number[]; notes: number[] };
    headerRows: number[];
    sourceRows: number;
}

export interface WeeklyWrapup {
    version: 1;
    id: string;
    sourceUrl: string;
    sourceHash: string;
    importedAt: string;
    sections: Record<WrapupSectionKey, WrapupSection>;
}

export interface WrapupSummary {
    id: string;
    start: string;
    end: string;
}
