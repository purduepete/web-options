import type {
    CalendarWeek,
    CalendarsIndexResponse,
    CautionSymbolsResponse,
    EarliestWeekResponse,
    MeResponse,
    WeekSignalsResponse,
} from '@weboptions/shared';
import { readKey } from './auth/keyStore';

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
    const apiKey = key ?? readKey();
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
export function fetchMe(key: string): Promise<MeResponse> {
    return getJson<MeResponse>('/api/me', key);
}

export function fetchWeekSignals(week?: string): Promise<WeekSignalsResponse> {
    const query = week ? `?week=${encodeURIComponent(week)}` : '';
    return getJson<WeekSignalsResponse>(`/api/week-signals${query}`);
}

export function fetchEarliestWeek(): Promise<EarliestWeekResponse> {
    return getJson<EarliestWeekResponse>('/api/earliest-week');
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
