import type { EarliestWeekResponse, WeekSignalsResponse } from '@weboptions/shared';

async function getJson<T>(path: string): Promise<T> {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}

export function fetchWeekSignals(week?: string): Promise<WeekSignalsResponse> {
    const query = week ? `?week=${encodeURIComponent(week)}` : '';
    return getJson<WeekSignalsResponse>(`/api/week-signals${query}`);
}

export function fetchEarliestWeek(): Promise<EarliestWeekResponse> {
    return getJson<EarliestWeekResponse>('/api/earliest-week');
}
