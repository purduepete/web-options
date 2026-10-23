import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from '@weboptions/shared';
import { axisTime, changeSummary, evenTicks, fitDomain, pacificTime, sessionLabel } from '../src/history/format';

function point(time: number, mark: number | null, delta: number | null): HistoryPoint {
    return {
        time,
        sessionDate: '2026-10-23',
        kind: 'open_session',
        mark,
        delta,
        priceTime: null,
        deltaTime: null,
        priceReceivedAt: null,
        deltaReceivedAt: null,
        flags: [],
        reason: null,
    };
}
describe('history summaries', () => {
    it('uses first and last valid values per component and preserves negative delta', () => {
        const data = [point(1, 2, null), point(2, null, -0.4), point(3, 1, -0.2)];
        expect(changeSummary(data, 'mark')).toMatchObject({ value: 1, change: -1, percent: -50 });
        expect(changeSummary(data, 'delta').change).toBeCloseTo(0.2);
        expect(changeSummary(data, 'delta').first?.time).toBe(2);
    });
    it('does not divide by zero or invent changes from one observation', () => {
        expect(changeSummary([point(1, 0, 0), point(2, 1, -0.1)], 'mark').percent).toBeNull();
        expect(changeSummary([point(1, 1, -0.2)], 'mark').change).toBeNull();
    });
    it('formats Pacific time as mm/dd/yyyy HH:mm across daylight saving changes', () => {
        expect(pacificTime('2026-10-23T13:35:00Z')).toBe('10/23/2026 06:35');
        expect(pacificTime('2026-11-03T14:35:00Z')).toBe('11/03/2026 06:35');
        expect(pacificTime('2026-10-23T20:05:00Z')).toBe('10/23/2026 13:05');
    });
    it('formats axis ticks and session dates', () => {
        expect(axisTime(Date.parse('2026-10-23T20:05:00Z'), false)).toBe('13:05');
        expect(axisTime(Date.parse('2026-10-23T20:05:00Z'), true)).toBe('10/23 13:05');
        expect(sessionLabel('2026-10-23')).toBe('10/23/2026');
    });
    it('fits an axis to the data rather than to zero', () => {
        const [low, high] = fitDomain([2.49, 2.09, null, 2.6], 0.1, [0, Infinity]);
        expect(low).toBeCloseTo(2.039);
        expect(high).toBeCloseTo(2.651);
        const [flatLow, flatHigh] = fitDomain([-0.2, -0.2], 0.02, [-1, 1]);
        expect(flatLow).toBeCloseTo(-0.212);
        expect(flatHigh).toBeCloseTo(-0.188);
        expect(fitDomain([0.01], 0.1, [0, Infinity])[0]).toBe(0);
        expect(fitDomain([null], 0.02, [-1, 1])).toEqual([-1, 1]);
    });
    it('spaces axis ticks evenly from bottom to top', () => {
        const ticks = evenTicks([2.68, 4.91]);
        expect(ticks).toHaveLength(5);
        expect(ticks[0]).toBe(2.68);
        expect(ticks[4]).toBeCloseTo(4.91);
        const steps = ticks.slice(1).map((tick, index) => tick - ticks[index]!);
        for (const step of steps) expect(step).toBeCloseTo(0.5575);
    });
});
