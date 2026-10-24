import { describe, expect, it } from 'vitest';
import { analyzeHistory, type AnalysisRow } from '../src/history/analysis';

const entry = { signalDate: '2026-10-21', mark: 2, delta: -0.3, capturedAt: '2026-10-21T14:00:00Z' };
function row(time: string, mark: string | null, price_status = 'ok'): AnalysisRow {
    return { session_date: time.slice(0, 10), scheduled_at: new Date(time), mark_per_share: mark, price_status };
}
describe('all-history exit analysis', () => {
    it('finds inclusive first crossings, extrema and giveback without relying on chart dates or input order', () => {
        const result = analyzeHistory(entry, [
            row('2026-10-23T14:00:00Z', '0.8'),
            row('2026-10-21T14:10:00Z', '2.6'),
            row('2026-10-21T14:20:00Z', '1.5'),
            row('2026-10-21T14:30:00Z', '1'),
            row('2026-10-22T14:00:00Z', '0.4'),
        ])!;
        expect(result.targets.map((item) => item.firstCrossing?.time)).toEqual([
            Date.parse('2026-10-21T14:20:00Z'),
            Date.parse('2026-10-21T14:30:00Z'),
            Date.parse('2026-10-22T14:00:00Z'),
        ]);
        expect(result.best).toMatchObject({ mark: 0.4, capturedPercent: 80, dollars: 160 });
        expect(result.worst?.capturedPercent).toBeCloseTo(-30);
        expect(result.worst?.dollars).toBeCloseTo(-60);
        expect(result.latest).toMatchObject({ mark: 0.8, capturedPercent: 60, dollars: 120 });
        expect(result.giveback).toEqual({ percentagePoints: 20, dollars: 40 });
        expect(result.validMarks).toBe(5);
    });
    it('excludes pre-signal, pre-entry, invalid and missing marks without bridging gaps', () => {
        const result = analyzeHistory(entry, [
            row('2026-10-20T14:30:00Z', '0'),
            row('2026-10-21T13:55:00Z', '0'),
            row('2026-10-21T14:10:00Z', '0', 'invalid'),
            row('2026-10-21T14:20:00Z', null),
            row('2026-10-21T14:30:00Z', '1.6'),
            row('2026-10-21T14:40:00Z', '-1'),
            row('2026-10-21T14:50:00Z', 'NaN'),
        ])!;
        expect(result.validMarks).toBe(1);
        expect(result.recordedGaps).toBe(4);
        expect(result.targets.every((target) => target.firstCrossing === null)).toBe(true);
        expect(result.giveback).toEqual({ percentagePoints: 0, dollars: 0 });
        expect(result.through).toBe(Date.parse('2026-10-21T14:50:00Z'));
        expect(result.latest?.time).toBe(Date.parse('2026-10-21T14:30:00Z'));
    });
    it('keeps all-losing best and worst negative and does not invent an entry observation', () => {
        const result = analyzeHistory(entry, [row('2026-10-21T14:00:00Z', '2.5'), row('2026-10-21T15:00:00Z', '3')])!;
        expect(result.best?.capturedPercent).toBe(-25);
        expect(result.worst?.capturedPercent).toBe(-50);
        expect(result.giveback).toEqual({ percentagePoints: 25, dollars: 50 });
    });
    it('uses earliest tied extrema, supports zero marks and reports zero giveback at a new best', () => {
        const result = analyzeHistory(entry, [
            row('2026-10-22T14:00:00Z', '1'),
            row('2026-10-21T15:00:00Z', '1'),
            row('2026-10-23T14:00:00Z', '0'),
        ])!;
        expect(result.worst?.time).toBe(Date.parse('2026-10-21T15:00:00Z'));
        expect(result.targets[1]?.firstCrossing?.time).toBe(Date.parse('2026-10-21T15:00:00Z'));
        expect(result.best?.capturedPercent).toBe(100);
        expect(result.giveback).toEqual({ percentagePoints: 0, dollars: 0 });
    });
    it('handles missing and nonpositive entries, no observations and missing capture times explicitly', () => {
        expect(analyzeHistory(null, [])).toBeNull();
        expect(analyzeHistory({ ...entry, mark: 0 }, [])).toBeNull();
        expect(analyzeHistory({ ...entry, mark: -1 }, [])).toBeNull();
        expect(analyzeHistory(entry, [])).toMatchObject({
            best: null,
            worst: null,
            latest: null,
            giveback: null,
            validMarks: 0,
        });
        const result = analyzeHistory({ ...entry, capturedAt: null }, [
            row('2026-10-20T14:00:00Z', '0'),
            row('2026-10-21T13:00:00Z', '1'),
        ])!;
        expect(result.validMarks).toBe(1);
    });
    it('does not mistake a near miss for a crossing at decimal thresholds', () => {
        const result = analyzeHistory({ ...entry, mark: 2.95 }, [
            row('2026-10-21T14:00:00Z', '1.47500001'),
            row('2026-10-21T14:10:00Z', '1.475'),
        ])!;
        expect(result.targets[1]?.firstCrossing?.time).toBe(Date.parse('2026-10-21T14:10:00Z'));
    });
});
