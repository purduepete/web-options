import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { AppConfig } from '../src/config';
import { createApp } from '../src/app';
import { buildTimeline, type QuoteRow } from '../src/history/repository';
import * as repository from '../src/history/repository';
import * as core from '../src/db';

const config: AppConfig = {
    db: { server: '', database: '', user: '', password: '' },
    auth: { mode: 'access', allowedOrigins: ['https://example.com'] },
    webportfolio: { apiUrl: null, serviceKey: null },
    port: 5057,
    host: '127.0.0.1',
    nodeEnv: 'test',
    webRoot: null,
};
const key = encodeURIComponent('AAPL  261030P00150000');

function row(changes: Partial<QuoteRow> = {}): QuoteRow {
    return {
        run_id: '1',
        session_date: '2026-10-23',
        scheduled_at: new Date('2026-10-23T13:35:00Z'),
        capture_kind: 'open_session',
        status: 'complete',
        discovery_status: 'ok',
        contract_key: 'AAPL  261030P00150000',
        mark_per_share: '0',
        delta: '0',
        price_status: 'ok',
        delta_status: 'ok',
        price_flags: [],
        delta_flags: [],
        provider_quote_time: null,
        delta_event_time: null,
        price_received_at: null,
        delta_received_at: null,
        eligible: true,
        ...changes,
    };
}
afterEach(() => vi.restoreAllMocks());

describe('history timeline', () => {
    it('preserves zero price and signed/zero delta', () => {
        const result = buildTimeline([row(), row({ run_id: '2', delta: '-0.35' })], [], '2026-10-30');
        expect(result.points[0]).toMatchObject({ mark: 0, delta: 0 });
        expect(result.points[1]?.delta).toBe(-0.35);
        expect(result.coverage.validDeltas).toBe(2);
    });
    it('gaps each component independently', () => {
        const result = buildTimeline([row({ price_status: 'invalid', delta: '-0.2' })], [], '2026-10-30');
        expect(result.points[0]).toMatchObject({ mark: null, delta: -0.2 });
        expect(result.coverage).toMatchObject({ knownPriceGaps: 1, knownDeltaGaps: 0 });
    });
    it('reports absent historical eligibility as unknown rather than a miss denominator', () => {
        const result = buildTimeline(
            [],
            [
                {
                    sessionDate: '2026-10-23',
                    captureKind: 'open_session',
                    scheduledAt: '2026-10-23T13:35:00Z',
                },
            ],
            '2026-10-30',
            Date.parse('2026-10-23T20:00:00Z')
        );
        expect(result.coverage).toMatchObject({ unknownSlots: 1, knownExpected: 0, knownPriceGaps: 0 });
        expect(result.points[0]).toMatchObject({ mark: null, delta: null });
    });
    it('separates sessions and keeps recovery and settle', () => {
        const result = buildTimeline(
            [
                row(),
                row({ run_id: '2', capture_kind: 'recovery' }),
                row({ run_id: '3', capture_kind: 'settle' }),
                row({ run_id: '4', session_date: '2026-10-26', scheduled_at: new Date('2026-10-26T13:35:00Z') }),
            ],
            [],
            '2026-10-30'
        );
        expect(result.points).toHaveLength(5);
        expect(result.points.find((point) => point.kind === 'session_boundary')).toMatchObject({
            mark: null,
            delta: null,
        });
    });
    it('does not create future or post-expiry gaps', () => {
        const result = buildTimeline(
            [],
            [
                { sessionDate: '2026-10-23', captureKind: 'close', scheduledAt: '2026-10-23T20:00:00Z' },
                { sessionDate: '2026-10-26', captureKind: 'close', scheduledAt: '2026-10-26T20:00:00Z' },
            ],
            '2026-10-23',
            Date.parse('2026-10-23T19:00:00Z')
        );
        expect(result.points).toEqual([]);
    });
});

describe('history routes', () => {
    it('requires the existing API key boundary outside Access mode', async () => {
        const app = createApp({ ...config, auth: { mode: 'api-key', allowedOrigins: [] } });
        const response = await request(app).get('/api/contract-history/contracts');
        expect(response.status).toBe(401);
    });
    it('keeps core readiness healthy when history is not configured', async () => {
        vi.spyOn(core, 'pingDatabase').mockResolvedValue();
        const app = createApp(config);
        expect((await request(app).get('/readyz')).status).toBe(200);
        expect((await request(app).get('/api/contract-history/readiness')).status).toBe(503);
    });
    it('rejects over-range, malformed date and invalid contract requests', async () => {
        const app = createApp(config);
        for (const path of [
            `/${key}?from=2026-01-01&to=2026-12-01`,
            `/${key}?from=2026-02-30&to=2026-03-01`,
            '/bad/dates',
        ])
            expect((await request(app).get(`/api/contract-history${path}`)).status).toBe(400);
    });
    it('validates search limits and passes parameterized search arguments', async () => {
        const search = vi
            .spyOn(repository, 'searchContracts')
            .mockResolvedValue({ items: [], hasMore: false, unmappedContracts: 0 });
        const app = createApp(config);
        expect((await request(app).get('/api/contract-history/contracts?q=aapl&limit=10')).status).toBe(200);
        expect(search).toHaveBeenCalledWith(config, 'AAPL', 0, 10);
        expect((await request(app).get('/api/contract-history/contracts?limit=1001')).status).toBe(400);
        expect((await request(app).get('/api/contract-history/contracts?q[]=AAPL')).status).toBe(400);
    });
    it('reports range overflow explicitly and hides database errors', async () => {
        const fetch = vi.spyOn(repository, 'fetchHistory').mockRejectedValue(new repository.HistoryRangeError());
        const url = `/api/contract-history/${key}?from=2026-10-21&to=2026-10-23`;
        expect((await request(createApp(config)).get(url)).body.code).toBe('history_range_too_large');
        fetch.mockRejectedValue(new Error('password=secret'));
        const result = await request(createApp(config)).get(url);
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain('secret');
    });
});
