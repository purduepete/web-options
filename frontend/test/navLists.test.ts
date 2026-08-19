import { describe, expect, it } from 'vitest';
import {
    MAX_FAVORITES,
    pruneUnknown,
    readStringList,
    recordVisit,
    toggleFavorite,
    writeStringList,
} from '../src/navigation/navLists';
import { findNavItem, navigableItems } from '../src/navigation/navModel';

describe('recordVisit', () => {
    it('puts the newest first', () => {
        expect(recordVisit(['/a'], '/b')).toEqual(['/b', '/a']);
    });

    it('moves a repeat visit to the front instead of duplicating it', () => {
        expect(recordVisit(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b']);
    });

    it('caps the list', () => {
        const list = ['1', '2', '3'];
        expect(recordVisit(list, '4', 3)).toEqual(['4', '1', '2']);
    });
});

describe('toggleFavorite', () => {
    it('appends rather than prepending, so the menu order stays stable', () => {
        expect(toggleFavorite(['/a'], '/b').list).toEqual(['/a', '/b']);
    });

    it('removes one that is already there', () => {
        expect(toggleFavorite(['/a', '/b'], '/a')).toEqual({ list: ['/b'], changed: true });
    });

    it('refuses to go past the cap and reports that it refused', () => {
        const full = Array.from({ length: MAX_FAVORITES }, (_, index) => `/item-${index}`);
        const result = toggleFavorite(full, '/one-too-many');
        expect(result.changed).toBe(false);
        expect(result.list).toEqual(full);
    });

    it('still allows removal when full', () => {
        const full = Array.from({ length: MAX_FAVORITES }, (_, index) => `/item-${index}`);
        const result = toggleFavorite(full, '/item-0');
        expect(result.changed).toBe(true);
        expect(result.list).toHaveLength(MAX_FAVORITES - 1);
    });
});

describe('pruneUnknown', () => {
    it('drops ids that are no longer routes', () => {
        const known = new Set(['/', '/calendars']);
        expect(pruneUnknown(['/', '/gone', '/calendars'], (id) => known.has(id))).toEqual(['/', '/calendars']);
    });
});

describe('stored lists', () => {
    it('round-trips', () => {
        writeStringList('test_key', ['/a', '/b']);
        expect(readStringList('test_key')).toEqual(['/a', '/b']);
    });

    it('survives garbage in storage', () => {
        localStorage.setItem('test_key', 'not json');
        expect(readStringList('test_key')).toEqual([]);
        localStorage.setItem('test_key', '{"a":1}');
        expect(readStringList('test_key')).toEqual([]);
        localStorage.setItem('test_key', '["/a", 7, null]');
        expect(readStringList('test_key')).toEqual(['/a']);
    });
});

describe('nav model', () => {
    it('exposes only real routes as navigable', () => {
        const ids = navigableItems().map((item) => item.id);
        expect(ids).toEqual(['/', '/calendars/latest', '/settings/appearance', '/settings/caution', '/settings/key']);
    });

    it('keeps placeholders findable but not navigable', () => {
        expect(findNavItem('week-explorer')?.disabled).toBe(true);
        expect(findNavItem('nope')).toBeUndefined();
    });
});
