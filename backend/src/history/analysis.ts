import type { HistoryAnalysis, HistoryEntry, HistoryOutcome } from '@weboptions/shared';

export interface AnalysisRow {
    session_date: string;
    scheduled_at: Date;
    mark_per_share: string | null;
    price_status: string | null;
}

export function analyzeHistory(entry: HistoryEntry | null, rows: readonly AnalysisRow[]): HistoryAnalysis | null {
    if (!entry || !Number.isFinite(entry.mark) || entry.mark <= 0) return null;
    const capturedAt = entry.capturedAt ? Date.parse(entry.capturedAt) : null;
    const analysis: HistoryAnalysis = {
        validMarks: 0,
        recordedGaps: 0,
        firstObservedAt: null,
        through: null,
        best: null,
        worst: null,
        latest: null,
        giveback: null,
        targets: ([25, 50, 75] as const).map((percent) => ({
            percent,
            closingMark: entry.mark * (1 - percent / 100),
            firstCrossing: null,
        })),
    };
    for (const row of rows) {
        const time = row.scheduled_at.getTime();
        if (row.session_date < entry.signalDate || (capturedAt !== null && time < capturedAt)) continue;
        analysis.through = Math.max(analysis.through ?? time, time);
        const mark = row.mark_per_share === null ? null : Number(row.mark_per_share);
        if (row.price_status !== 'ok' || mark === null || !Number.isFinite(mark) || mark < 0) {
            analysis.recordedGaps++;
            continue;
        }
        const outcome: HistoryOutcome = {
            time,
            mark,
            capturedPercent: ((entry.mark - mark) / entry.mark) * 100,
            dollars: (entry.mark - mark) * 100,
        };
        analysis.validMarks++;
        analysis.firstObservedAt = Math.min(analysis.firstObservedAt ?? time, time);
        if (!analysis.best || mark < analysis.best.mark || (mark === analysis.best.mark && time < analysis.best.time))
            analysis.best = outcome;
        if (
            !analysis.worst ||
            mark > analysis.worst.mark ||
            (mark === analysis.worst.mark && time < analysis.worst.time)
        )
            analysis.worst = outcome;
        if (!analysis.latest || time > analysis.latest.time) analysis.latest = outcome;
        for (const target of analysis.targets) {
            // Allow only floating-point rounding at the exact threshold.
            if (mark <= target.closingMark + 1e-10 && (!target.firstCrossing || time < target.firstCrossing.time))
                target.firstCrossing = outcome;
        }
    }
    if (analysis.best && analysis.latest) {
        analysis.giveback = {
            percentagePoints: analysis.best.capturedPercent - analysis.latest.capturedPercent,
            dollars: analysis.best.dollars - analysis.latest.dollars,
        };
    }
    return analysis;
}
