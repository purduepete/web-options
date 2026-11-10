import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    WRAPUP_HEADERS,
    WRAPUP_SECTIONS,
    isIsoDate,
    type WeeklyWrapup,
    type WrapupContract,
    type WrapupSummary,
} from '@weboptions/shared';

export const DEFAULT_WRAPUP_DIRECTORY = String.raw`C:\ProgramData\SolutionDeploy\apps\web-options\shared\weekly-wrapups`;
const NAMES = { management: 'Management Plan', closed: 'Closed Trades', rolls: 'Rolls' };

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contract(value: unknown): value is WrapupContract {
    return (
        object(value) &&
        typeof value.symbol === 'string' &&
        /^[A-Z][A-Z0-9.^-]{0,15}$/.test(value.symbol) &&
        typeof value.strike === 'number' &&
        Number.isFinite(value.strike) &&
        value.strike > 0 &&
        value.optionRight === 'P' &&
        typeof value.expiration === 'string' &&
        isIsoDate(value.expiration)
    );
}

function rowNumbers(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((n) => Number.isInteger(n) && n > 0 && n <= 10000);
}

export function validateWrapup(value: unknown): asserts value is WeeklyWrapup {
    const fail = () => {
        throw new Error('Invalid weekly wrap-up file; run the validated workbook importer.');
    };
    if (
        !object(value) ||
        value.version !== 1 ||
        typeof value.id !== 'string' ||
        !isIsoDate(value.id) ||
        typeof value.sourceUrl !== 'string' ||
        !/^https:\/\/[^\s]+$/.test(value.sourceUrl) ||
        typeof value.sourceHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
        typeof value.importedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.importedAt)) ||
        !object(value.sections) ||
        Object.keys(value.sections).sort().join() !== [...WRAPUP_SECTIONS].sort().join()
    )
        return fail();
    for (const key of WRAPUP_SECTIONS) {
        const section = value.sections[key];
        if (
            !object(section) ||
            section.name !== NAMES[key] ||
            typeof section.start !== 'string' ||
            !isIsoDate(section.start) ||
            typeof section.end !== 'string' ||
            !isIsoDate(section.end) ||
            section.end < section.start ||
            !(section.quoteDate === null || (typeof section.quoteDate === 'string' && isIsoDate(section.quoteDate))) ||
            !rowNumbers(section.headerRows) ||
            !object(section.audit) ||
            !rowNumbers(section.audit.calls) ||
            !rowNumbers(section.audit.notes) ||
            !Number.isInteger(section.sourceRows) ||
            !Array.isArray(section.tables) ||
            section.tables.length < 1 ||
            section.tables.length > 2
        )
            return fail();
        const used = [...section.headerRows, ...section.audit.calls, ...section.audit.notes];
        const kinds = new Set<string>();
        for (const table of section.tables) {
            if (
                !object(table) ||
                typeof table.kind !== 'string' ||
                !(table.kind === key || (key === 'closed' && table.kind === 'controlled')) ||
                kinds.has(table.kind) ||
                !Array.isArray(table.headers) ||
                table.headers.join('\0') !== WRAPUP_HEADERS[table.kind].join('\0') ||
                !Array.isArray(table.rows) ||
                table.rows.length > 10000
            )
                return fail();
            kinds.add(table.kind);
            for (const row of table.rows) {
                if (
                    !object(row) ||
                    !rowNumbers([row.sourceRow]) ||
                    !contract(row.contract) ||
                    !Array.isArray(row.cells) ||
                    row.cells.length !== table.headers.length ||
                    !row.cells.every((cell) => typeof cell === 'string' && cell.length <= 20000) ||
                    (['rolls', 'controlled'].includes(table.kind)
                        ? !contract(row.newContract)
                        : row.newContract !== null)
                )
                    return fail();
                used.push(Number(row.sourceRow));
            }
        }
        if (!kinds.has(key) || used.length !== section.sourceRows || new Set(used).size !== used.length) return fail();
    }
    if (!object(value.sections.closed) || value.sections.closed.end !== value.id) return fail();
}

function missing(error: unknown): boolean {
    return object(error) && error.code === 'ENOENT';
}

export async function readWrapup(directory: string, id: string): Promise<WeeklyWrapup | null> {
    if (!isIsoDate(id)) throw new Error('Invalid weekly wrap-up id');
    const file = path.join(directory, `${id}.json`);
    try {
        if ((await stat(file)).size > 10 * 1024 * 1024) throw new Error('Weekly wrap-up file exceeds size limit');
        const value: unknown = JSON.parse(await readFile(file, 'utf8'));
        validateWrapup(value);
        if (value.id !== id) throw new Error('Weekly wrap-up filename does not match report');
        return value;
    } catch (error) {
        if (missing(error)) return null;
        throw error;
    }
}

export async function listWrapups(directory: string): Promise<WrapupSummary[]> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch (error) {
        if (missing(error)) return [];
        throw error;
    }
    const reports: WrapupSummary[] = [];
    for (const name of names
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
        .sort()
        .reverse()) {
        const report = await readWrapup(directory, name.slice(0, -5));
        if (report)
            reports.push({ id: report.id, start: report.sections.closed.start, end: report.sections.closed.end });
    }
    return reports;
}
