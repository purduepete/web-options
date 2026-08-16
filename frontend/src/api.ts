import type {
    CalendarWeek,
    CalendarsIndexResponse,
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

async function getJson<T>(path: string, key?: string): Promise<T> {
    const apiKey = key ?? readKey();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const response = await fetch(path, { headers });
    if (response.status === 401) {
        throw new UnauthorizedError();
    }
    if (response.status === 404) {
        throw new NotFoundError();
    }
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
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
