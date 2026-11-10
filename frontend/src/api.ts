import type {
    CalendarWeek,
    CalendarsIndexResponse,
    CautionSymbolsResponse,
    EarliestWeekResponse,
    GradeSettings,
    GradeSettingsResponse,
    MeResponse,
    OwnedOptionsResponse,
    SignalMonthsResponse,
    SummaryFilters,
    SignalSummaryResponse,
    SymbolDetail,
    Trade,
    VixResponse,
    WeekSignalsResponse,
} from '@weboptions/shared';
import { readKey } from './auth/keyStore';
import { isAccessMode } from './auth/mode';

/** Thrown when the server has no calendar for a date, so the page can say so. */
export class NotFoundError extends Error {
    constructor(message = 'not found') {
        super(message);
        this.name = 'NotFoundError';
    }
}

/** Thrown when the server rejects the key, so the UI can fall back to the key prompt. */
export class UnauthorizedError extends Error {
    constructor(message = 'api key rejected') {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

/** Thrown when the request never reached a server at all. */
export class NetworkError extends Error {
    constructor(message = 'the server did not answer') {
        super(message);
        this.name = 'NetworkError';
    }
}

/** Thrown when the server answered but its database did not. */
export class ServiceUnavailableError extends Error {
    readonly code: string;
    constructor(code: string) {
        super(code);
        this.name = 'ServiceUnavailableError';
        this.code = code;
    }
}

/**
 * Turns a failure into something worth reading. An unreachable server, a rejected
 * database login and a genuine bug are three different evenings, so they should
 * not share one message.
 */
export function describeFailure(error: unknown): string {
    if (error instanceof NetworkError) {
        return 'Cannot reach the Web Options server. Check that it is running.';
    }
    if (error instanceof ServiceUnavailableError) {
        return error.code === 'database_login_failed'
            ? 'The server is running, but the database rejected its login. The password may have been rotated.'
            : 'The server is running, but it cannot reach the database.';
    }
    if (error instanceof Error) return error.message;
    return 'Something went wrong.';
}

async function send<T>(path: string, init: RequestInit, key?: string): Promise<T> {
    const apiKey = isAccessMode() ? null : (key ?? readKey());
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    if (apiKey) headers['X-API-Key'] = apiKey;

    let response: Response;
    try {
        response = await fetch(path, { ...init, headers });
    } catch {
        throw new NetworkError();
    }

    if (response.status === 401) {
        throw new UnauthorizedError();
    }
    if (response.status === 404) {
        throw new NotFoundError();
    }
    if (!response.ok) {
        // This API only ever answers JSON, so an error that is not JSON came from
        // something in front of it. The dev proxy dresses a dead API up as a 500
        // of its own, which would otherwise read as a bug in the server.
        if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
            throw new NetworkError();
        }
        const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
        if (response.status === 503) {
            throw new ServiceUnavailableError(body.code ?? 'database_unreachable');
        }
        // A rejected save says which entry was wrong, and that is the whole point
        // of the message, so it is passed through rather than replaced.
        if (response.status === 400 && body.error) {
            throw new Error(body.error);
        }
        throw new Error(`The server returned ${response.status}.`);
    }
    return (await response.json()) as T;
}

function getJson<T>(path: string, key?: string): Promise<T> {
    return send<T>(path, {}, key);
}

/** Takes the key explicitly so a candidate can be checked before it is stored. */
export function fetchMe(key?: string): Promise<MeResponse> {
    return getJson<MeResponse>('/api/me', key);
}

export function fetchWeekSignals(week?: string): Promise<WeekSignalsResponse> {
    const query = week ? `?week=${encodeURIComponent(week)}` : '';
    return getJson<WeekSignalsResponse>(`/api/week-signals${query}`);
}

export function fetchEarliestWeek(): Promise<EarliestWeekResponse> {
    return getJson<EarliestWeekResponse>('/api/earliest-week');
}

/** One signal, so the drill-in can jump to a contract from a week the page has not loaded. */
export function fetchSignal(target: {
    symbol: string;
    reportDate: string;
    strike: number;
    expiration: string;
}): Promise<Trade> {
    const query = new URLSearchParams({
        symbol: target.symbol,
        reportDate: target.reportDate,
        strike: String(target.strike),
        expiration: target.expiration,
    });
    return getJson<Trade>(`/api/signal?${query}`);
}

export function fetchSignalMonths(): Promise<SignalMonthsResponse> {
    return getJson<SignalMonthsResponse>('/api/signal-months');
}

export function fetchSignalSummary(month: string, filters: SummaryFilters): Promise<SignalSummaryResponse> {
    const query = new URLSearchParams({ month });
    if (filters.symbols.length > 0) query.set('symbols', filters.symbols.join(','));
    if (filters.expiry !== 'all') query.set('expiry', filters.expiry);
    if (filters.moneyness !== 'all') query.set('moneyness', filters.moneyness);
    if (filters.half !== 'all') query.set('half', filters.half);
    if (filters.owned !== 'all') query.set('owned', filters.owned);
    query.set('numberSource', filters.numberSource);
    return getJson<SignalSummaryResponse>(`/api/signal-summary?${query}`);
}

export function fetchOwnedContracts(refresh = false): Promise<OwnedOptionsResponse> {
    return getJson<OwnedOptionsResponse>(refresh ? '/api/owned-contracts?refresh=true' : '/api/owned-contracts');
}

export function fetchCalendars(): Promise<CalendarsIndexResponse> {
    return getJson<CalendarsIndexResponse>('/api/calendars');
}

export function fetchCalendar(publishDate: string): Promise<CalendarWeek> {
    return getJson<CalendarWeek>(`/api/calendars/${encodeURIComponent(publishDate)}`);
}

export function fetchCautionSymbols(): Promise<CautionSymbolsResponse> {
    return getJson<CautionSymbolsResponse>('/api/caution-symbols');
}

export function saveCautionSymbols(symbols: readonly string[]): Promise<CautionSymbolsResponse> {
    return send<CautionSymbolsResponse>('/api/caution-symbols', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
    });
}

/**
 * The contract is passed along so it can be kept out of its own past-signals list,
 * and with the report date it also names the signal whose end-of-day rollup comes
 * back. This is the one call that waits on an outside service, so it is the one the
 * modal shows a spinner for.
 */
export function fetchSymbolDetail(
    symbol: string,
    contract: { strike: number | null; expiration: string | null; reportDate?: string | null } = {
        strike: null,
        expiration: null,
    }
): Promise<SymbolDetail> {
    const query = new URLSearchParams();
    if (contract.strike !== null) query.set('strike', String(contract.strike));
    if (contract.expiration !== null) query.set('expiration', contract.expiration);
    if (contract.reportDate) query.set('reportDate', contract.reportDate);
    const suffix = query.size > 0 ? `?${query}` : '';
    return getJson<SymbolDetail>(`/api/symbols/${encodeURIComponent(symbol)}${suffix}`);
}

export function fetchVix(): Promise<VixResponse> {
    return getJson<VixResponse>('/api/vix');
}

export function fetchGradeSettings(): Promise<GradeSettingsResponse> {
    return getJson<GradeSettingsResponse>('/api/grade-settings');
}

export function saveGradeSettings(settings: GradeSettings): Promise<GradeSettingsResponse> {
    return send<GradeSettingsResponse>('/api/grade-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
    });
}
