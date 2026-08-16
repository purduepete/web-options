/**
 * Pure list maths for the two nav lists. Kept separate from the providers so the
 * caps and the ordering can be tested without rendering anything.
 */

export const MAX_FAVORITES = 15;
export const MAX_RECENT = 8;

/** Newest first, no duplicates, capped. */
export function recordVisit(list: readonly string[], id: string, max = MAX_RECENT): string[] {
    return [id, ...list.filter((entry) => entry !== id)].slice(0, max);
}

export interface ToggleResult {
    list: string[];
    /** False when the cap refused the addition, so the caller can say so. */
    changed: boolean;
}

/**
 * Favourites keep insertion order rather than jumping to the front: the menu is
 * a stable list the user builds, not a history.
 */
export function toggleFavorite(list: readonly string[], id: string, max = MAX_FAVORITES): ToggleResult {
    if (list.includes(id)) {
        return { list: list.filter((entry) => entry !== id), changed: true };
    }
    if (list.length >= max) {
        return { list: [...list], changed: false };
    }
    return { list: [...list, id], changed: true };
}

/** Drops anything that is no longer a real route, e.g. after a menu rename. */
export function pruneUnknown(list: readonly string[], isKnown: (id: string) => boolean): string[] {
    return list.filter(isKnown);
}

export function readStringList(key: string): string[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
        return [];
    }
}

export function writeStringList(key: string, list: readonly string[]): void {
    try {
        localStorage.setItem(key, JSON.stringify(list));
    } catch {
        // Storage blocked: the list still works for this session.
    }
}
