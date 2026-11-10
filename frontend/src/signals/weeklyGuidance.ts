import type { Trade, WeeklyWrapup, WrapupContract } from '@weboptions/shared';

export type GuidanceZone = 'red' | 'yellow' | 'green' | 'unclassified';

export interface WeeklyGuidance {
    reportId: string;
    sourceRow: number;
    contract: WrapupContract;
    start: string;
    end: string;
    quoteDate: string | null;
    zone: GuidanceZone;
    action: string;
    category: string;
    note: string;
}

export type GuidanceIndex = ReadonlyMap<string, readonly WeeklyGuidance[]>;
type ContractIdentity = Pick<Trade, 'symbol' | 'optionRight' | 'strike' | 'expiration'>;

function contractKey(contract: ContractIdentity): string | null {
    if (contract.optionRight !== 'P' || contract.strike === null || contract.expiration === null) return null;
    return JSON.stringify([contract.symbol.trim().toUpperCase(), 'P', contract.strike, contract.expiration]);
}

export function indexWeeklyGuidance(report: WeeklyWrapup | null): GuidanceIndex {
    const index = new Map<string, WeeklyGuidance[]>();
    if (!report) return index;
    const section = report.sections.management;
    for (const table of section.tables) {
        if (table.kind !== 'management') continue;
        const field = (cells: string[], name: string) => cells[table.headers.indexOf(name)] ?? '';
        for (const row of table.rows) {
            const key = contractKey(row.contract);
            if (!key) continue;
            const sourceZone = field(row.cells, 'Zone').trim().toLowerCase();
            const zone =
                sourceZone === 'red' || sourceZone === 'yellow' || sourceZone === 'green' ? sourceZone : 'unclassified';
            const guidance: WeeklyGuidance = {
                reportId: report.id,
                sourceRow: row.sourceRow,
                contract: row.contract,
                start: section.start,
                end: section.end,
                quoteDate: section.quoteDate,
                zone,
                action: field(row.cells, 'This Week'),
                category: field(row.cells, 'Category'),
                note: field(row.cells, 'Management Plan'),
            };
            const matches = index.get(key) ?? [];
            matches.push(guidance);
            index.set(key, matches);
        }
    }
    return index;
}

export function weeklyGuidanceFor(
    index: GuidanceIndex | undefined,
    trade: ContractIdentity & Pick<Trade, 'isTopPick'>,
    reportDate: string | null,
    now = new Date()
): readonly WeeklyGuidance[] {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const currentWeek = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    if (!trade.isTopPick || !reportDate || reportDate >= currentWeek) return [];
    const key = contractKey(trade);
    return (key && index?.get(key)) || [];
}

export function guidanceRowId(row: number): string {
    return `management-row-${row}`;
}

export function guidanceLink(guidance: WeeklyGuidance): string {
    const params = new URLSearchParams({
        report: guidance.reportId,
        view: 'management',
        row: String(guidance.sourceRow),
    });
    return `/weekly-wrapups?${params}#${guidanceRowId(guidance.sourceRow)}`;
}
