import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import type { ContractSearchResponse, HistoryContract, HistoryPoint, HistoryResponse } from '@weboptions/shared';
import type { AppConfig } from '../config';
import { withHistory } from './db';

const execute = promisify(execFile);
export const MAX_DATES = 93;
export const MAX_POINTS = 10000;

export class HistoryRangeError extends Error {}

const CONTRACTS = `
WITH eligible AS (
 SELECT c.contract_key, c.symbol, c.expiration, c.strike
 FROM public.broker_contract c
 WHERE EXISTS (SELECT 1 FROM public.option_owner o WHERE o.contract_key=c.contract_key
               AND o.source_kind IN ('signal','vader_contract'))
    OR EXISTS (SELECT 1 FROM public.option_capture_owner o WHERE o.contract_key=c.contract_key
               AND o.source_kind IN ('signal','vader_contract'))
    OR EXISTS (SELECT 1 FROM public.vader_contract v
               WHERE (CASE WHEN v.symbol IN ('BRK-B','BRK.B','BRKB') THEN 'BRKB' ELSE v.symbol END)=c.symbol
               AND v.expiration=c.expiration AND v.strike=c.strike
               AND (CASE WHEN v.symbol IN ('BRK-B','BRK.B','BRKB')
                         THEN 'BRKB  ' || substring(v.occ_symbol FROM 7) ELSE v.occ_symbol END)=c.contract_key)
)`;

interface ContractRow {
    contract_key: string;
    symbol: string;
    expiration: string;
    strike: string;
    added: string | null;
    tier: string | null;
    tiers: string[] | null;
    top_pick: boolean | null;
    underlying_price: string | null;
    underlying_at: Date | null;
}

const VADER_MATCH = `(CASE WHEN v.symbol IN ('BRK-B','BRK.B','BRKB')
               THEN 'BRKB  ' || substring(v.occ_symbol FROM 7) ELSE v.occ_symbol END)=e.contract_key`;

// One row per contract: its first signal date, with that day's tier and top-pick flag.
const FIRST_SIGNAL = `
   SELECT COALESCE(min(g.report_date), min(v.first_seen))::text AS added,
          (array_agg(lower(g.tier) ORDER BY g.report_date, lower(g.tier))
             FILTER (WHERE g.tier IS NOT NULL))[1] AS tier,
          array_agg(DISTINCT lower(g.tier)) FILTER (WHERE g.tier IS NOT NULL) AS tiers,
          (array_agg(g.is_top_pick ORDER BY g.report_date, g.is_top_pick DESC)
             FILTER (WHERE g.report_date IS NOT NULL))[1] AS top_pick
   FROM public.vader_contract v LEFT JOIN public.vader_signal g ON g.contract_key=v.contract_key
   WHERE ${VADER_MATCH}`;

// One row per contract per signal date, as Live Signals lists them. A contract never
// signaled falls back to a single row on the date it was first seen.
const EACH_SIGNAL = `
   SELECT g.report_date::text AS added,
          (array_agg(lower(g.tier) ORDER BY lower(g.tier)) FILTER (WHERE g.tier IS NOT NULL))[1] AS tier,
          array_agg(DISTINCT lower(g.tier)) FILTER (WHERE g.tier IS NOT NULL) AS tiers,
          bool_or(g.is_top_pick) AS top_pick
   FROM public.vader_contract v JOIN public.vader_signal g ON g.contract_key=v.contract_key
   WHERE ${VADER_MATCH} AND g.report_date IS NOT NULL
   GROUP BY g.report_date
   UNION ALL
   SELECT min(v.first_seen)::text, NULL, NULL, false
   FROM public.vader_contract v
   WHERE ${VADER_MATCH}
   HAVING count(*) > 0 AND NOT bool_or(EXISTS (SELECT 1 FROM public.vader_signal g
            WHERE g.contract_key=v.contract_key AND g.report_date IS NOT NULL))`;

const contractColumns = (signals: string) => `e.contract_key,e.symbol,e.expiration::text,e.strike,
 s.added,s.tier,s.tiers,s.top_pick,u.underlying_price,u.underlying_at FROM eligible e
 LEFT JOIN LATERAL (${signals}
 ) s ON true
 LEFT JOIN LATERAL (
   SELECT q.underlying_price, COALESCE(q.price_received_at, r.scheduled_at) AS underlying_at
   FROM public.broker_option_quote q
   JOIN public.option_collection_run r ON r.id=q.run_id
   WHERE q.contract_key=e.contract_key AND q.underlying_price IS NOT NULL AND r.session_date <= e.expiration
   ORDER BY r.scheduled_at DESC, r.id DESC LIMIT 1
 ) u ON true`;

function contract(row: ContractRow): HistoryContract {
    return {
        key: row.contract_key,
        symbol: row.symbol,
        expiration: row.expiration,
        strike: Number(row.strike),
        added: row.added,
        tier: row.tier,
        tiers: row.tiers ?? [],
        topPick: row.top_pick === true,
        underlyingPrice: row.underlying_price === null ? null : Number(row.underlying_price),
        underlyingAt: row.underlying_at === null ? null : new Date(row.underlying_at).toISOString(),
    };
}

export async function searchContracts(
    config: AppConfig,
    query: string,
    offset: number,
    limit: number
): Promise<ContractSearchResponse> {
    return withHistory(config, async (db) => {
        const rows = await db.query<ContractRow>(
            `${CONTRACTS} SELECT ${contractColumns(EACH_SIGNAL)}
             WHERE e.symbol ILIKE $1
             ORDER BY s.added DESC NULLS LAST,
               CASE WHEN s.top_pick THEN 0 WHEN s.tier='conservative' THEN 1 WHEN s.tier='balanced' THEN 2
                    WHEN s.tier='aggressive' THEN 3 ELSE 4 END,
               e.expiration,e.symbol,e.strike,e.contract_key
             OFFSET $2 LIMIT $3`,
            [`${query}%`, offset, limit + 1]
        );
        const unmapped = await db.query<{ count: string }>(
            `${CONTRACTS} SELECT count(*) FROM public.vader_contract v WHERE NOT EXISTS (
               SELECT 1 FROM eligible e WHERE
               (CASE WHEN v.symbol IN ('BRK-B','BRK.B','BRKB') THEN 'BRKB  ' ||
                 substring(v.occ_symbol FROM 7) ELSE v.occ_symbol END)=e.contract_key)`
        );
        return {
            items: rows.rows.slice(0, limit).map(contract),
            hasMore: rows.rows.length > limit,
            unmappedContracts: Number(unmapped.rows[0]?.count ?? 0),
        };
    });
}

async function findContract(db: PoolClient, key: string): Promise<HistoryContract | null> {
    const result = await db.query<ContractRow>(
        `${CONTRACTS} SELECT ${contractColumns(FIRST_SIGNAL)} WHERE e.contract_key=$1`,
        [key]
    );
    return result.rows[0] ? contract(result.rows[0]) : null;
}

export async function historyDates(config: AppConfig, key: string): Promise<string[] | null> {
    return withHistory(config, async (db) => {
        if (!(await findContract(db, key))) return null;
        const result = await db.query<{ date: string }>(
            `SELECT DISTINCT r.session_date::text AS date FROM public.broker_option_quote q
             JOIN public.option_collection_run r ON r.id=q.run_id WHERE q.contract_key=$1
             AND ((q.price_status='ok' AND q.mark_per_share IS NOT NULL)
               OR (q.delta_status='ok' AND q.delta IS NOT NULL)) ORDER BY date DESC`,
            [key]
        );
        return result.rows.map((row) => row.date);
    });
}

export interface ScheduleSlot {
    sessionDate: string;
    captureKind: string;
    scheduledAt: string;
}

async function readSchedule(config: AppConfig, from: string, to: string): Promise<ScheduleSlot[]> {
    if (!config.history?.python) throw new Error('History schedule executable is not configured');
    const result = await execute(
        config.history.python,
        ['-m', 'collector.history_schedule', '--from', from, '--to', to],
        { cwd: config.history.collectorRoot, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }
    );
    const value: unknown = JSON.parse(result.stdout);
    if (
        !Array.isArray(value) ||
        value.length > MAX_POINTS ||
        !value.every(
            (slot: unknown) =>
                typeof slot === 'object' &&
                slot !== null &&
                'sessionDate' in slot &&
                typeof slot.sessionDate === 'string' &&
                'captureKind' in slot &&
                typeof slot.captureKind === 'string' &&
                'scheduledAt' in slot &&
                typeof slot.scheduledAt === 'string' &&
                Number.isFinite(Date.parse(slot.scheduledAt))
        )
    )
        throw new Error('Invalid history schedule output');
    return value;
}

export interface QuoteRow {
    run_id: string;
    session_date: string;
    scheduled_at: Date;
    capture_kind: string;
    status: string;
    discovery_status: string;
    contract_key: string | null;
    mark_per_share: string | null;
    delta: string | null;
    price_status: string | null;
    delta_status: string | null;
    price_flags: string[] | null;
    delta_flags: string[] | null;
    provider_quote_time: Date | null;
    delta_event_time: Date | null;
    price_received_at: Date | null;
    delta_received_at: Date | null;
    eligible: boolean;
}

export function buildTimeline(
    rows: QuoteRow[],
    schedule: ScheduleSlot[],
    expiration: string,
    now = Date.now()
): { points: HistoryPoint[]; coverage: HistoryResponse['coverage'] } {
    const points: HistoryPoint[] = [];
    const existing = new Set(rows.map((row) => `${row.scheduled_at.getTime()}|${row.capture_kind}`));
    const coverage = {
        observations: 0,
        validPrices: 0,
        validDeltas: 0,
        knownExpected: 0,
        knownPriceGaps: 0,
        knownDeltaGaps: 0,
        unknownSlots: 0,
    };
    for (const row of rows) {
        const mark = row.price_status === 'ok' && row.mark_per_share !== null ? Number(row.mark_per_share) : null;
        const delta = row.delta_status === 'ok' && row.delta !== null ? Number(row.delta) : null;
        const known = row.eligible && row.contract_key !== null;
        if (row.contract_key !== null) coverage.observations++;
        if (mark !== null) coverage.validPrices++;
        if (delta !== null) coverage.validDeltas++;
        if (known) {
            coverage.knownExpected++;
            if (mark === null) coverage.knownPriceGaps++;
            if (delta === null) coverage.knownDeltaGaps++;
        } else coverage.unknownSlots++;
        points.push({
            time: row.scheduled_at.getTime(),
            sessionDate: row.session_date,
            kind: row.capture_kind,
            mark,
            delta,
            priceTime: row.provider_quote_time?.toISOString() ?? null,
            deltaTime: row.delta_event_time?.toISOString() ?? null,
            priceReceivedAt: row.price_received_at?.toISOString() ?? null,
            deltaReceivedAt: row.delta_received_at?.toISOString() ?? null,
            flags: [...new Set([...(row.price_flags ?? []), ...(row.delta_flags ?? [])])],
            reason: !known
                ? `Unknown eligibility (${row.status}; discovery ${row.discovery_status})`
                : mark === null || delta === null
                  ? `Incomplete quote (price ${row.price_status}; delta ${row.delta_status})`
                  : null,
        });
    }
    for (const slot of schedule) {
        const time = Date.parse(slot.scheduledAt);
        if (time > now || slot.sessionDate > expiration || existing.has(`${time}|${slot.captureKind}`)) continue;
        coverage.unknownSlots++;
        points.push({
            time,
            sessionDate: slot.sessionDate,
            kind: slot.captureKind,
            mark: null,
            delta: null,
            priceTime: null,
            deltaTime: null,
            priceReceivedAt: null,
            deltaReceivedAt: null,
            flags: [],
            reason: 'Unknown coverage: no historical run or discovery evidence for this current-schedule slot.',
        });
    }
    points.sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind));
    const separated: HistoryPoint[] = [];
    let previous: HistoryPoint | undefined;
    for (const point of points) {
        if (previous && previous.sessionDate !== point.sessionDate) {
            separated.push({
                ...point,
                time: previous.time + 1,
                kind: 'session_boundary',
                mark: null,
                delta: null,
                reason: 'Market session boundary',
                flags: [],
            });
        }
        separated.push(point);
        previous = point;
    }
    if (separated.length > MAX_POINTS) throw new HistoryRangeError();
    return { points: separated, coverage };
}

export async function fetchHistory(
    config: AppConfig,
    key: string,
    from: string,
    to: string
): Promise<HistoryResponse | null> {
    const snapshot = await withHistory(config, async (db) => {
        const selected = await findContract(db, key);
        if (!selected) return null;
        const activation = await db.query<{ first: string | null }>(
            'SELECT min(session_date)::text AS first FROM public.option_collection_run WHERE started_at IS NOT NULL'
        );
        const result = await db.query<QuoteRow>(
            `SELECT r.id AS run_id,r.session_date::text,r.scheduled_at,r.capture_kind,r.status,r.discovery_status,
             q.contract_key,q.mark_per_share,q.delta,q.price_status,q.delta_status,q.price_flags,q.delta_flags,
             q.provider_quote_time,q.delta_event_time,q.price_received_at,q.delta_received_at,
             EXISTS(SELECT 1 FROM public.option_capture_owner o WHERE o.run_id=r.id AND o.contract_key=$1
               AND o.source_kind IN ('signal','vader_contract')) AS eligible
             FROM public.option_collection_run r LEFT JOIN public.broker_option_quote q
               ON q.run_id=r.id AND q.contract_key=$1
             WHERE r.session_date BETWEEN $2::date AND $3::date AND r.session_date <= $4::date
               AND r.scheduled_at <= CURRENT_TIMESTAMP
             ORDER BY r.scheduled_at,r.id LIMIT 10001`,
            [key, from, to, selected.expiration]
        );
        if (result.rows.length > MAX_POINTS) throw new HistoryRangeError();
        return { selected, rows: result.rows, activation: activation.rows[0]?.first };
    });
    if (!snapshot) return null;
    const schedule = (await readSchedule(config, from, to)).filter(
        (slot) =>
            snapshot.activation !== null && snapshot.activation !== undefined && slot.sessionDate >= snapshot.activation
    );
    const built = buildTimeline(snapshot.rows, schedule, snapshot.selected.expiration);
    return {
        contract: snapshot.selected,
        from,
        to,
        ...built,
        warnings: [
            'Sampled observations can miss moves between captures. Price and delta are separate broker events.',
            'Missing run/discovery evidence is unknown coverage. Historical cadence may differ from the current schedule.',
            ...(built.coverage.unknownSlots
                ? ['Some intervals have unknown eligibility or missing collection evidence.']
                : []),
            'Settle and recovery observations are labeled separately. Market-session lines break overnight.',
        ],
    };
}
