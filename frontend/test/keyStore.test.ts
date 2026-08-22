import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKey, isRemembered, readKey, saveKey } from '../src/auth/keyStore';

const STORAGE_KEY = 'weboptions_api_key';

/** Makes every storage call throw, the way a private mode or a blocked context does. */
function refuseStorage() {
    const boom = () => {
        throw new Error('denied');
    };
    // jsdom does not route its storage objects through Storage.prototype, so the
    // spy has to go on the instances the app actually reaches.
    for (const store of [window.sessionStorage, window.localStorage]) {
        vi.spyOn(store, 'getItem').mockImplementation(boom);
        vi.spyOn(store, 'setItem').mockImplementation(boom);
        vi.spyOn(store, 'removeItem').mockImplementation(boom);
    }
}

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    clearKey();
});

afterEach(() => {
    vi.restoreAllMocks();
    clearKey();
});

describe('key store', () => {
    it('keeps the key for the tab by default', () => {
        saveKey('abc', false);

        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('abc');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(readKey()).toBe('abc');
        expect(isRemembered()).toBe(false);
    });

    it('keeps the key for the device when asked to remember', () => {
        saveKey('abc', true);

        expect(localStorage.getItem(STORAGE_KEY)).toBe('abc');
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(isRemembered()).toBe(true);
    });

    it('moves the key rather than leaving a copy behind', () => {
        saveKey('abc', true);
        saveKey('def', false);

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('def');
        expect(readKey()).toBe('def');
    });

    it('forgets the key from both stores', () => {
        saveKey('abc', true);
        clearKey();

        expect(readKey()).toBeNull();
        expect(isRemembered()).toBe(false);
    });

    it('reports no key rather than throwing when storage is refused', () => {
        refuseStorage();

        expect(readKey()).toBeNull();
        expect(isRemembered()).toBe(false);
        expect(() => clearKey()).not.toThrow();
    });

    it('holds the key in memory for the session when storage is refused', () => {
        refuseStorage();

        expect(() => saveKey('abc', true)).not.toThrow();
        expect(readKey()).toBe('abc');
        // Nothing was written, so the remember-me choice cannot have survived.
        expect(isRemembered()).toBe(false);

        clearKey();
        expect(readKey()).toBeNull();
    });

    it('prefers a stored key over one left in memory', () => {
        saveKey('stored', false);
        sessionStorage.setItem(STORAGE_KEY, 'newer');

        expect(readKey()).toBe('newer');
    });
});
