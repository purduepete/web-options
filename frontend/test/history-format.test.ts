import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from '@weboptions/shared';
import {
    axisTime,
    changeSummary,
    evenTicks,
    elapsedTime,
    fitDomain,
    pacificTime,
    premiumCaptured,
    sessionLabel,
    standardSpan,
    targetPrice,
} from '../src/history/format';

function point(time: number, mark: number | null, delta: number | null): HistoryPoint {
    return {
        time,
        sessionDate: '2026-10-23',
        kind: 'open_session',
        mark,
        delta,
        underlyingPrice: null,
        priceTime: null,
        deltaTime: null,
        priceReceivedAt: null,
        deltaReceivedAt: null,
        flags: [],
        reason: null,
    };
}
describe('history summaries', () => {
    it('treats only open-to-settle across the viewed dates as the standard span', () => {
        const open = Date.parse('2026-10-21T13:45:00Z');
        const settle = Date.parse('2026-10-23T20:10:00Z');
        expect(standardSpan(open, settle, '2026-10-21', '2026-10-23')).toBe(true);
        expect(standardSpan(Date.parse('2026-10-23T13:45:00Z'), settle, '2026-10-23', '2026-10-23')).toBe(true);
        expect(standardSpan(Date.parse('2026-10-21T13:35:00Z'), settle, '2026-10-21', '2026-10-23')).toBe(false);
        expect(standardSpan(Date.parse('2026-10-21T14:05:00Z'), settle, '2026-10-21', '2026-10-23')).toBe(false);
        expect(standardSpan(open, Date.parse('2026-10-23T18:15:00Z'), '2026-10-21', '2026-10-23')).toBe(false);
        expect(standardSpan(open, settle, '2026-10-20', '2026-10-23')).toBe(false);
    });
    it('keeps exact fractional-cent target prices rather than rounding a near miss into a crossing', () => {
        expect(targetPrice(0.7125)).toBe('$0.7125');
        expect(targetPrice(0.35625)).toBe('$0.35625');
        expect(targetPrice(1)).toBe('$1.00');
    });
    it('formats target elapsed time including nights and missing capture times', () => {
        expect(elapsedTime('2026-10-21T14:00:00Z', Date.parse('2026-10-22T15:25:00Z'))).toBe('1d 1h 25m elapsed');
        expect(elapsedTime(null, 0)).toBe('Entry capture time unavailable');
        expect(elapsedTime('2026-10-21T14:00:00Z', Date.parse('2026-10-21T14:00:00Z'))).toBe('0h 0m elapsed');
    });
    it('calculates captured premium against entry and rejects missing, zero and pre-entry baselines', () => {
        const entry = { signalDate: '2026-10-23', mark: 2, delta: -0.28, capturedAt: '2026-10-23T13:35:00Z' };
        const at = Date.parse('2026-10-23T14:00:00Z');
        expect(premiumCaptured(entry, point(at, 0.8, -0.2))).toBe(60);
        expect(premiumCaptured(entry, point(at, 2.6, -0.2))).toBeCloseTo(-30);
        expect(premiumCaptured(entry, point(at, 0, -0.2))).toBe(100);
        expect(premiumCaptured({ ...entry, mark: 0 }, point(at, 1, null))).toBeNull();
        expect(premiumCaptured(null, point(at, 1, null))).toBeNull();
        expect(premiumCaptured(entry, point(at, null, -0.2))).toBeNull();
        expect(premiumCaptured(entry, point(at - 86400000, 1, null))).toBeNull();
        const held = (sourceTime: number) => ({
            ...point(at, 1, -0.2),
            overrides: [{ field: 'mark' as const, value: 1, original: 1.5, sourceTime, reason: 'spike' }],
        });
        expect(premiumCaptured(entry, held(Date.parse('2026-10-23T13:25:00Z')))).toBeNull();
        expect(premiumCaptured(entry, held(Date.parse('2026-10-23T13:50:00Z')))).toBe(50);
    });
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
