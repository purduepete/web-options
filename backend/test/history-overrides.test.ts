import { describe, expect, it } from 'vitest';
import { analyzeHistory } from '../src/history/analysis';
import { findOverrides, type OverrideRow } from '../src/history/overrides';
import { buildTimeline, type QuoteRow } from '../src/history/repository';

function q(time: string, mark: number, delta: number, changes: Partial<OverrideRow> = {}): OverrideRow {
    return {
        session_date: '2026-10-28',
        scheduled_at: new Date(`2026-10-28T${time}:00Z`),
        capture_kind: 'open_session',
        mark_per_share: String(mark),
        delta: String(delta),
        underlying_price: '266.66',
        price_status: 'ok',
        delta_status: 'ok',
        price_flags: [],
        ...changes,
    };
}
const wide = { price_flags: ['wide_spread'] };
const close = (delta: number, changes: Partial<OverrideRow> = {}) =>
    q('20:00', 6.75, delta, { capture_kind: 'close', ...changes });
const settle = (delta: number, changes: Partial<OverrideRow> = {}) =>
    q('20:10', 6.75, delta, { capture_kind: 'settle', ...changes });

describe('history overrides', () => {
    it('holds the close delta when the settle delta jumps against a frozen quote', () => {
        const rows = [q('19:50', 6.7, -0.255), close(-0.2581), settle(-0.3881)];
        const overrides = findOverrides(rows);
        expect(overrides.size).toBe(1);
        expect(overrides.get(rows[2]!)).toEqual([
            {
                field: 'delta',
                value: -0.2581,
                original: -0.3881,
                sourceTime: Date.parse('2026-10-28T20:00:00Z'),
                reason: expect.stringContaining('Settle delta'),
            },
        ]);
        expect(rows[2]!.delta).toBe('-0.3881');
    });
    it('keeps ordinary settle drift and settle moves the quote explains', () => {
        expect(findOverrides([close(-0.2581), settle(-0.29)]).size).toBe(0);
        expect(findOverrides([close(-0.2581), settle(-0.3881, { mark_per_share: '7.2' })]).size).toBe(0);
        expect(findOverrides([close(-0.2581), settle(-0.3881, { underlying_price: '262' })]).size).toBe(0);
        expect(findOverrides([close(-0.2581), settle(-0.3881, { delta_status: 'missing' })]).size).toBe(0);
    });
    it('holds the previous mark through an isolated wide-spread spike', () => {
        const rows = [q('16:25', 0.03, -0.043), q('16:35', 0.085, -0.067, wide), q('16:45', 0.025, -0.038)];
        const overrides = findOverrides(rows);
        expect(overrides.get(rows[1]!)).toEqual([
            expect.objectContaining({ field: 'mark', value: 0.03, original: 0.085 }),
        ]);
        expect(overrides.size).toBe(1);
    });
    it('leaves spikes under 15%, narrow quotes, delta-confirmed moves and unpriced delta alone', () => {
        // HAS 10/28: about 9% away from its neighbours.
        expect(
            findOverrides([q('16:15', 1.8, -0.281), q('16:25', 2.25, -0.308, wide), q('16:35', 2.075, -0.311)]).size
        ).toBe(0);
        expect(findOverrides([q('16:25', 1, -0.2), q('16:35', 1.5, -0.2), q('16:45', 1, -0.2)]).size).toBe(0);
        expect(findOverrides([q('16:25', 1, -0.2), q('16:35', 1.5, -0.3, wide), q('16:45', 1, -0.2)]).size).toBe(0);
        expect(
            findOverrides([
                q('16:25', 1, -0.2),
                q('16:35', 1.5, -0.2, { ...wide, delta_status: 'missing' }),
                q('16:45', 1, -0.2),
            ]).size
        ).toBe(0);
    });
    it('leaves sawtooth runs, step changes, edges and cross-session neighbours alone', () => {
        const sawtooth = [
            q('16:05', 0.5, -0.09),
            q('16:15', 0.4, -0.09, wide),
            q('16:25', 0.55, -0.09, wide),
            q('16:35', 0.4, -0.09, wide),
            q('16:45', 0.5, -0.09),
        ];
        expect(findOverrides(sawtooth).size).toBe(0);
        const steep = [0.5, 0.4, 0.65, 0.4, 0.5].map((mark, i) =>
            q(`16:${String(5 + i * 10).padStart(2, '0')}`, mark, -0.09, i % 4 ? wide : {})
        );
        expect(findOverrides(steep).size).toBe(0);
        expect(findOverrides([q('16:25', 1, -0.2), q('16:35', 1.5, -0.2, wide), q('16:45', 1.5, -0.2)]).size).toBe(0);
        expect(findOverrides([q('16:35', 1.5, -0.2, wide), q('16:45', 1, -0.2)]).size).toBe(0);
        expect(
            findOverrides([
                q('16:25', 1, -0.2, { session_date: '2026-10-27' }),
                q('16:35', 1.5, -0.2, wide),
                q('16:45', 1, -0.2),
            ]).size
        ).toBe(0);
        expect(findOverrides([q('15:55', 1, -0.2), q('16:35', 1.5, -0.2, wide), q('16:45', 1, -0.2)]).size).toBe(0);
    });
    it('does not bridge an unpriced capture to find a neighbour', () => {
        const rows = [
            q('16:15', 1, -0.2),
            q('16:25', 1, -0.2, { price_status: 'missing', mark_per_share: null }),
            q('16:35', 1.5, -0.2, wide),
            q('16:45', 1, -0.2),
        ];
        expect(findOverrides(rows).size).toBe(0);
        rows[1] = q('16:25', 1, -0.2, { delta_status: 'missing' });
        expect(findOverrides(rows).size).toBe(0);
    });
    it('treats exact decimal thresholds as written', () => {
        expect(findOverrides([close(-0.24), settle(-0.28)]).size).toBe(0);
        const rows = [q('16:25', 0.25, -0.1), q('16:35', 0.3, -0.1, wide), q('16:45', 0.25, -0.1)];
        expect(findOverrides(rows).get(rows[1]!)).toEqual([expect.objectContaining({ field: 'mark', value: 0.25 })]);
    });
    it('ignores the excluded 06:35 capture as a neighbour', () => {
        const rows = [q('13:35', 1, -0.2), q('13:45', 1.5, -0.2, wide), q('13:55', 1, -0.2)];
        expect(findOverrides(rows).size).toBe(0);
    });
    it('keeps an overridden mark out of best, worst and targets without counting it as a gap', () => {
        const entry = { signalDate: '2026-10-28', mark: 0.1, delta: -0.05, capturedAt: '2026-10-28T16:00:00Z' };
        const rows = [q('16:25', 0.03, -0.043), q('16:35', 0.085, -0.067, wide), q('16:45', 0.025, -0.038)];
        const raw = analyzeHistory(entry, rows)!;
        expect(raw.worst?.mark).toBe(0.085);
        const result = analyzeHistory(entry, rows, findOverrides(rows))!;
        expect(result.worst?.mark).toBe(0.03);
        expect(result.validMarks).toBe(2);
        expect(result.recordedGaps).toBe(0);
        expect(result.overriddenMarks).toBe(1);
        expect(result.latest?.time).toBe(Date.parse('2026-10-28T16:45:00Z'));
    });
    it('attaches overrides to timeline points and leaves the captured values in place', () => {
        const quote = (row: OverrideRow, id: string): QuoteRow => ({
            ...row,
            run_id: id,
            status: 'complete',
            discovery_status: 'ok',
            contract_key: 'CRWD  261120P00245000',
            delta_flags: [],
            provider_quote_time: null,
            delta_event_time: null,
            price_received_at: null,
            delta_received_at: null,
            eligible: true,
        });
        const result = buildTimeline([quote(close(-0.2581), '1'), quote(settle(-0.3881), '2')], [], '2026-11-20');
        expect(result.points[0]?.overrides).toBeUndefined();
        expect(result.points[1]).toMatchObject({
            delta: -0.3881,
            overrides: [expect.objectContaining({ field: 'delta', value: -0.2581, original: -0.3881 })],
        });
        expect(result.coverage.validDeltas).toBe(2);
    });
});
