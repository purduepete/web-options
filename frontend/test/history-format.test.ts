import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from '@weboptions/shared';
import { changeSummary, pacificTime } from '../src/history/format';

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
    it('formats Pacific time across daylight saving changes', () => {
        expect(pacificTime('2026-10-23T13:35:00Z')).toContain('6:35');
        expect(pacificTime('2026-11-03T14:35:00Z')).toContain('6:35');
    });
});
