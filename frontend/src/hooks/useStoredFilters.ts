import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps a page's filters between visits without taking the URL away from them.
 *
 * The URL stays the state every page reads. This only fills it in on arrival at
 * a bare path, and only from what the same page last had. A link that names any
 * of the page's own parameters is someone's deliberate view, so it is left
 * exactly as it came.
 */

export interface StoredFilters {
    /** Where the page's filters are kept. */
    storageKey: string;
    /** The parameters saved and restored. */
    keys: readonly string[];
    /**
     * Parameters that make the URL deliberate without ever being stored — the
     * week on live signals. Their presence calls off the restore.
     */
    guardKeys?: readonly string[];
}

function readStored(storageKey: string, keys: readonly string[]): URLSearchParams | null {
    let raw: string | null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        return null;
    }
    if (raw === null || raw === '') return null;
    const stored = new URLSearchParams(raw);
    // Only the page's own parameters come back, so an older version or a
    // hand-edited store cannot smuggle anything else into the URL.
    const kept = new URLSearchParams();
    for (const key of keys) {
        const value = stored.get(key);
        if (value !== null) kept.set(key, value);
    }
    return [...kept].length > 0 ? kept : null;
}

/**
 * Returns whether the page is showing the filters it is going to show. That is
 * true from the first render unless a restore is actually coming, so a page
 * that waits on it only ever waits when there is something to wait for.
 *
 * The restore itself cannot be a layout effect: react-router arms its own
 * navigation in one, and a setter called before that arms is dropped silently.
 */
export function useStoredFilters({ storageKey, keys, guardKeys = [] }: StoredFilters): boolean {
    const [params, setParams] = useSearchParams();
    const pending = useRef<URLSearchParams | null | undefined>(undefined);
    if (pending.current === undefined) {
        const spoken = [...keys, ...guardKeys].some((key) => params.has(key));
        pending.current = spoken ? null : readStored(storageKey, keys);
    }
    const [hydrated, setHydrated] = useState(pending.current === null);
    const restored = useRef(false);
    // What the page opened with. Writing that back would hand a shared link's
    // empty state over as the reader's own, so only a change is ever stored.
    const saved = useRef<string | null>(null);

    useEffect(() => {
        if (restored.current) return;
        restored.current = true;
        const stored = pending.current;
        if (stored !== null && stored !== undefined) {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    for (const [key, value] of stored) updated.set(key, value);
                    return updated;
                },
                { replace: true },
            );
        }
        setHydrated(true);
    }, [setParams]);

    const serialized = keys.map((key) => `${key}=${params.get(key) ?? ''}`).join('&');
    useEffect(() => {
        if (!hydrated) return;
        if (saved.current === null) {
            saved.current = serialized;
            return;
        }
        if (saved.current === serialized) return;
        saved.current = serialized;
        const next = new URLSearchParams();
        for (const key of keys) {
            const value = params.get(key);
            if (value !== null && value !== '') next.set(key, value);
        }
        try {
            const body = next.toString();
            if (body === '') localStorage.removeItem(storageKey);
            else localStorage.setItem(storageKey, body);
        } catch {
            // A blocked or full store only costs the filters their life beyond the tab.
        }
    }, [serialized, hydrated, storageKey, keys, params]);

    return hydrated;
}
