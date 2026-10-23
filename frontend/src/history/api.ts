import type { ContractSearchResponse, HistoryResponse } from '@weboptions/shared';
import { UnauthorizedError } from '../api';
import { readKey } from '../auth/keyStore';
import { isAccessMode } from '../auth/mode';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const key = isAccessMode() ? null : readKey();
    const response = await fetch(`/api/contract-history${path}`, {
        signal,
        headers: key ? { 'X-API-Key': key } : {},
    });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) {
        const error: { error?: string } = await response.json();
        throw new Error(error.error ?? `History request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
}

export const searchHistoryContracts = (query: string, offset: number, signal?: AbortSignal) =>
    get<ContractSearchResponse>(`/contracts?${new URLSearchParams({ q: query, offset: String(offset) })}`, signal);
export const getHistoryDates = (key: string, signal?: AbortSignal) =>
    get<{ dates: string[] }>(`/${encodeURIComponent(key)}/dates`, signal);
export const getContractHistory = (key: string, from: string, to: string, signal?: AbortSignal) =>
    get<HistoryResponse>(`/${encodeURIComponent(key)}?${new URLSearchParams({ from, to })}`, signal);
