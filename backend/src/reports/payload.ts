import type { ReportCallout, ReportCalloutKind, ReportMetrics, WeeklyReport } from '@weboptions/shared';
import { parseInteger, parseMoney, parsePercent } from '../calendars/normalize';
import { fromIsoDate } from '../weeks';

/** The generator's sidecar shape: display strings/numbers exactly as read off the article. */
export interface RawCallout {
    ticker?: unknown;
    kind?: unknown;
    headline?: unknown;
    body?: unknown;
}

export interface RawMetrics {
    netPnl?: unknown;
    closedLegs?: unknown;
    winningLegs?: unknown;
    rollLegs?: unknown;
    hitRate?: unknown;
    winnersAmount?: unknown;
    rollCost?: unknown;
    collateral?: unknown;
    returnPct?: unknown;
    newPositions?: unknown;
    newPremium?: unknown;
    netCash?: unknown;
    medianDaysHeld?: unknown;
    openPositionsTotal?: unknown;
    openCalls?: unknown;
    openPuts?: unknown;
    openGreen?: unknown;
    openYellow?: unknown;
    openRed?: unknown;
}

export interface ReportPayload {
    publishDate: string;
    title?: string | null;
    sourceUrl?: string | null;
    macro?: { label: string; text: string }[];
    metrics: RawMetrics;
    callouts?: RawCallout[];
}

/** Extensible on purpose: a new kind is a one-line change here, not a migration. */
const CALLOUT_KINDS = new Set<string>(['roll', 'assignment', 'close', 'note']);

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Numbers already arrive as numbers in a hand-authored sidecar, but tolerate
 * display strings ('$6,853', '92.1%') too, matching the calendar ingest path. */
function money(value: unknown): number | null {
    return typeof value === 'number' ? value : parseMoney(value);
}

function percent(value: unknown): number | null {
    return typeof value === 'number' ? value : parsePercent(value);
}

function integer(value: unknown): number | null {
    return typeof value === 'number' ? (Number.isFinite(value) ? Math.trunc(value) : null) : parseInteger(value);
}

function toCallout(raw: RawCallout): ReportCallout {
    const kind = text(raw.kind)?.toLowerCase() ?? '';
    return {
        ticker: (text(raw.ticker) ?? '').toUpperCase(),
        kind: (CALLOUT_KINDS.has(kind) ? kind : 'note') as ReportCalloutKind,
        headline: text(raw.headline) ?? '',
        body: text(raw.body),
    };
}

function toMetrics(raw: RawMetrics): ReportMetrics {
    return {
        netPnl: money(raw.netPnl),
        closedLegs: integer(raw.closedLegs),
        winningLegs: integer(raw.winningLegs),
        rollLegs: integer(raw.rollLegs),
        hitRate: percent(raw.hitRate),
        winnersAmount: money(raw.winnersAmount),
        rollCost: money(raw.rollCost),
        collateral: money(raw.collateral),
        returnPct: percent(raw.returnPct),
        newPositions: integer(raw.newPositions),
        newPremium: money(raw.newPremium),
        netCash: money(raw.netCash),
        medianDaysHeld: integer(raw.medianDaysHeld),
        openPositionsTotal: integer(raw.openPositionsTotal),
        openCalls: integer(raw.openCalls),
        openPuts: integer(raw.openPuts),
        openGreen: integer(raw.openGreen),
        openYellow: integer(raw.openYellow),
        openRed: integer(raw.openRed),
    };
}

/** Non-fatal: a mismatch is logged so a typo in the sidecar surfaces during
 * ingest, but this is hand-authored editorial data, not untrusted input that
 * should block the whole week over one inconsistent count. */
export function checkInvariants(publishDate: string, metrics: ReportMetrics): string[] {
    const warnings: string[] = [];

    const sumOf = (...values: (number | null)[]): number | null =>
        values.every((v) => v !== null) ? values.reduce((sum, v) => sum! + v!, 0) : null;

    const callsPlusPuts = sumOf(metrics.openCalls, metrics.openPuts);
    if (callsPlusPuts !== null && metrics.openPositionsTotal !== null && callsPlusPuts !== metrics.openPositionsTotal) {
        warnings.push(
            `${publishDate}: openCalls + openPuts (${callsPlusPuts}) != openPositionsTotal (${metrics.openPositionsTotal})`,
        );
    }

    const gyr = sumOf(metrics.openGreen, metrics.openYellow, metrics.openRed);
    if (gyr !== null && metrics.openPositionsTotal !== null && gyr !== metrics.openPositionsTotal) {
        warnings.push(`${publishDate}: openGreen + openYellow + openRed (${gyr}) != openPositionsTotal (${metrics.openPositionsTotal})`);
    }

    const winPlusRoll = sumOf(metrics.winningLegs, metrics.rollLegs);
    if (winPlusRoll !== null && metrics.closedLegs !== null && winPlusRoll !== metrics.closedLegs) {
        warnings.push(`${publishDate}: winningLegs + rollLegs (${winPlusRoll}) != closedLegs (${metrics.closedLegs})`);
    }

    return warnings;
}

export function normalizePayload(payload: ReportPayload): WeeklyReport {
    const publishDate = payload.publishDate;
    // Throws on a malformed or impossible date rather than silently ingesting it.
    fromIsoDate(publishDate);

    const metrics = toMetrics(payload.metrics ?? {});
    for (const warning of checkInvariants(publishDate, metrics)) {
        console.warn(`[reports] ${warning}`);
    }

    return {
        publishDate,
        title: payload.title ?? null,
        sourceUrl: text(payload.sourceUrl) ?? null,
        macro: payload.macro ?? [],
        metrics,
        callouts: (payload.callouts ?? []).map(toCallout),
    };
}
