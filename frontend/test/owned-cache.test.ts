import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedOptionsResponse } from '@weboptions/shared';
import { clearOwnedCache, readOwnedCache, writeOwnedCache } from '../src/owned/cache';
import { signalKey } from '../src/owned/types';

const KEY = 'weboptions.owned-contracts.v1';

const remembered = vi.hoisted(() => ({ value: false }));
vi.mock('../src/auth/keyStore', () => ({ isRemembered: () => remembered.value }));

function response(overrides: Partial<OwnedOptionsResponse> = {}): OwnedOptionsResponse {
    return {
        positions: [{ symbol: 'PLTR' }],
        underlyings: { PLTR: { price: 150 } },
        generatedAt: '2026-08-21T18:43:00.000Z',
        ...overrides,
    } as OwnedOptionsResponse;
}

beforeEach(() => {
    remembered.value = false;
    sessionStorage.clear();
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('owned contracts cache', () => {
    it('returns nothing when the store is empty', () => {
        expect(readOwnedCache()).toBeNull();
    });

    it('round-trips a payload with its signal map', () => {
        const key = signalKey('2026-08-05', 'PLTR', 150, '2026-09-18');
        const signals = new Map([[key, { reportDate: '2026-08-05', trade: { symbol: 'PLTR' } }]]);

        writeOwnedCache(response(), signals as never);
        const read = readOwnedCache();

        expect(read?.response.positions).toEqual([{ symbol: 'PLTR' }]);
        expect(read?.response.generatedAt).toBe('2026-08-21T18:43:00.000Z');
        expect(read?.signals.get(key)?.reportDate).toBe('2026-08-05');
    });

    it('follows the key onto local storage only when the key is remembered', () => {
        writeOwnedCache(response(), new Map());
        expect(sessionStorage.getItem(KEY)).not.toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();

        sessionStorage.clear();
        remembered.value = true;
        writeOwnedCache(response(), new Map());
        expect(localStorage.getItem(KEY)).not.toBeNull();
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('prefers the session entry over a remembered one', () => {
        localStorage.setItem(KEY, JSON.stringify({ positions: [{ symbol: 'OLD' }] }));
        sessionStorage.setItem(KEY, JSON.stringify({ positions: [{ symbol: 'NEW' }] }));

        expect(readOwnedCache()?.response.positions).toEqual([{ symbol: 'NEW' }]);
    });

    it('discards an entry that is not JSON', () => {
        sessionStorage.setItem(KEY, 'not json{{');
        expect(readOwnedCache()).toBeNull();
    });

    it('discards an entry without an array of positions', () => {
        sessionStorage.setItem(KEY, JSON.stringify({ positions: 'PLTR' }));
        expect(readOwnedCache()).toBeNull();

        sessionStorage.setItem(KEY, JSON.stringify({ underlyings: {} }));
        expect(readOwnedCache()).toBeNull();

        sessionStorage.setItem(KEY, JSON.stringify(null));
        expect(readOwnedCache()).toBeNull();
    });

    it('floors the fields an older entry can predate', () => {
        sessionStorage.setItem(KEY, JSON.stringify({ positions: [] }));

        const read = readOwnedCache();
        expect(read?.response.underlyings).toEqual({});
        expect(read?.response.generatedAt).toBe('');
        expect(read?.signals.size).toBe(0);
    });

    it('floors an underlyings field that is present but not an object', () => {
        sessionStorage.setItem(KEY, JSON.stringify({ positions: [], underlyings: null, signals: 'nope' }));

        const read = readOwnedCache();
        expect(read?.response.underlyings).toEqual({});
        expect(read?.signals.size).toBe(0);
    });

    it('clears both stores', () => {
        sessionStorage.setItem(KEY, JSON.stringify({ positions: [] }));
        localStorage.setItem(KEY, JSON.stringify({ positions: [] }));

        clearOwnedCache();

        expect(sessionStorage.getItem(KEY)).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('survives a store that refuses every call', () => {
        const boom = () => {
            throw new Error('denied');
        };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

        expect(readOwnedCache()).toBeNull();
        expect(() => writeOwnedCache(response(), new Map())).not.toThrow();
        expect(() => clearOwnedCache()).not.toThrow();
    });
});
