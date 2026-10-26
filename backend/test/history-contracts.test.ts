import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config';
import { searchContracts } from '../src/history/repository';

const query = vi.hoisted(() => vi.fn());
vi.mock('../src/history/db', () => ({
    withHistory: (_config: unknown, work: (db: { query: typeof query }) => unknown) => work({ query }),
}));

describe('history contract captured percentages', () => {
    it.each(['37.75', '-12.5', '0', null])(
        'returns %s without changing its sign or treating zero as missing',
        async (value) => {
            query.mockReset();
            query
                .mockResolvedValueOnce({
                    rows: [
                        {
                            contract_key: 'AAPL',
                            symbol: 'AAPL',
                            expiration: '2026-11-20',
                            strike: '150',
                            added: '2026-10-23',
                            tier: 'balanced',
                            tiers: ['balanced'],
                            top_pick: false,
                            underlying_price: '160',
                            underlying_at: null,
                            captured_percent: value,
                        },
                    ],
                })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });
            const result = await searchContracts({} as AppConfig, '', 0, 100);
            expect(result.items[0]?.capturedPercent).toBe(value === null ? null : Number(value));
            const sql = query.mock.calls[0]![0] as string;
            expect(sql).toContain('g.report_date=s.added::date');
            expect(sql).toContain('b.entry_mark_per_share > 0');
            expect(sql).toContain('(b.entry_mark_per_share - m.mark_per_share) / b.entry_mark_per_share * 100');
            expect(sql).toContain("q.price_status='ok' AND q.mark_per_share >= 0");
            expect(sql).toContain('r.session_date BETWEEN s.added::date AND e.expiration');
            expect(sql).toContain('r.scheduled_at >= COALESCE(b.captured_at');
            expect(sql).toContain('r.scheduled_at <= CURRENT_TIMESTAMP');
            expect(sql).toContain('ORDER BY r.scheduled_at DESC,r.id DESC LIMIT 1');
        }
    );
});
