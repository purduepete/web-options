import type { HistoryOverride } from '@weboptions/shared';
import { isExcludedCapture } from './analysis';

/** The columns the override rules read. Stored quote rows are never changed. */
export interface OverrideRow {
    session_date: string;
    scheduled_at: Date;
    capture_kind: string;
    mark_per_share: string | null;
    delta: string | null;
    underlying_price: string | null;
    price_status: string | null;
    delta_status: string | null;
    price_flags: string[] | null;
}

const NEIGHBOR_MS = 20 * 60 * 1000;
const SETTLE_DELTA_JUMP = 0.04;
const SPIKE_BASE = 0.08;
const SPIKE_REPAIR = 0.15;
const SPIKE_MIN_DOLLARS = 0.05;
const NEIGHBOR_AGREEMENT = 0.2;
const DELTA_CONFIRMS = 0.04;

// Prices and deltas arrive as decimals, so 0.28 - 0.24 is not exactly 0.04 in binary.
const EPSILON = 1e-9;
const above = (value: number, limit: number) => value - limit > EPSILON;
const atMost = (value: number, limit: number) => !above(value, limit);
const atLeast = (value: number, limit: number) => limit - value <= EPSILON;

const num = (value: string | null) => (value === null ? null : Number(value));
const mark = (row: OverrideRow) => {
    const value = row.price_status === 'ok' ? num(row.mark_per_share) : null;
    return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
};
const delta = (row: OverrideRow) => {
    const value = row.delta_status === 'ok' ? num(row.delta) : null;
    return value !== null && Number.isFinite(value) ? value : null;
};
const underlying = (row: OverrideRow) => {
    const value = row.price_status === 'ok' ? num(row.underlying_price) : null;
    return value !== null && Number.isFinite(value) ? value : null;
};

/**
 * Read-time overrides for captures the broker gets visibly wrong. Each one names the
 * substitute value, the capture it was carried from and the original it stands in for.
 *
 * - Settle delta: after the close the broker recomputes greeks while the mark and the
 *   underlying stay frozen, so a settle delta that jumps against an unchanged quote
 *   takes the 13:00 close delta.
 * - Isolated spike: a wide-spread mark that jumps away from both neighbours and comes
 *   straight back, with delta not following, takes the previous mark. Runs of such
 *   moves are left alone; that is how an illiquid quote really trades.
 */
export function findOverrides<T extends OverrideRow>(rows: readonly T[]): Map<T, HistoryOverride[]> {
    const result = new Map<T, HistoryOverride[]>();
    const add = (row: T, override: HistoryOverride) => result.set(row, [...(result.get(row) ?? []), override]);
    const sessions = new Map<string, T[]>();
    for (const row of [...rows].sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime())) {
        if (isExcludedCapture(row.scheduled_at)) continue;
        sessions.set(row.session_date, [...(sessions.get(row.session_date) ?? []), row]);
    }
    for (const session of sessions.values()) {
        const close = session.find((row) => row.capture_kind === 'close');
        const settle = session.find((row) => row.capture_kind === 'settle');
        if (close && settle) {
            const [closeMark, settleMark] = [mark(close), mark(settle)];
            const [closeDelta, settleDelta] = [delta(close), delta(settle)];
            const [closeUnder, settleUnder] = [underlying(close), underlying(settle)];
            if (
                closeMark !== null &&
                settleMark !== null &&
                closeDelta !== null &&
                settleDelta !== null &&
                closeUnder !== null &&
                settleUnder !== null &&
                above(Math.abs(settleDelta - closeDelta), SETTLE_DELTA_JUMP) &&
                atMost(Math.abs(settleMark - closeMark), Math.max(closeMark * 0.01, 0.01)) &&
                atMost(Math.abs(settleUnder - closeUnder), closeUnder * 0.002)
            )
                add(settle, {
                    field: 'delta',
                    value: closeDelta,
                    original: settleDelta,
                    sourceTime: close.scheduled_at.getTime(),
                    reason: 'Settle delta recomputed after the close; holding the 13:00 delta',
                });
        }
        // Neighbours are the adjacent captures, never the nearest valid ones: a gap
        // beside a spike leaves too little evidence to call it isolated.
        const valid = (row: T | undefined): row is T => !!row && mark(row) !== null && delta(row) !== null;
        // `strict` is the repair test. Without it this is the looser 8% test that finds a
        // noisy neighbour, which must not depend on the spike it is guarding.
        const deviation = (i: number, strict: boolean) => {
            const [before, row, after] = [session[i - 1], session[i], session[i + 1]];
            if (!valid(before) || !valid(row) || !valid(after)) return 0;
            if (!(row.price_flags ?? []).includes('wide_spread')) return 0;
            const time = row.scheduled_at.getTime();
            if (time - before.scheduled_at.getTime() > NEIGHBOR_MS || after.scheduled_at.getTime() - time > NEIGHBOR_MS)
                return 0;
            const [a, m, b] = [mark(before)!, mark(row)!, mark(after)!];
            const median = (a + b) / 2;
            if (median <= 0 || Math.sign(m - a) !== Math.sign(m - b) || m === a) return 0;
            const move = Math.min(Math.abs(m - a), Math.abs(m - b));
            if (!strict) return move / median;
            if (above(Math.abs(b - a) / median, NEIGHBOR_AGREEMENT)) return 0;
            const d = delta(row)!;
            if (above(Math.max(Math.abs(d - delta(before)!), Math.abs(d - delta(after)!)), DELTA_CONFIRMS)) return 0;
            return atLeast(move, SPIKE_MIN_DOLLARS) ? move / median : 0;
        };
        session.forEach((row, i) => {
            if (!above(deviation(i, true), SPIKE_REPAIR)) return;
            if (above(deviation(i - 1, false), SPIKE_BASE) || above(deviation(i + 1, false), SPIKE_BASE)) return;
            const before = session[i - 1]!;
            add(row, {
                field: 'mark',
                value: mark(before)!,
                original: mark(row)!,
                sourceTime: before.scheduled_at.getTime(),
                reason: 'Isolated wide-spread spike; holding the previous mark',
            });
        });
    }
    return result;
}
