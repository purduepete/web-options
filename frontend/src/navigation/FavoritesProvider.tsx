import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '@weboptions/shared';
import {
    MAX_FAVORITES,
    pruneUnknown,
    readStringList,
    reorderFavorite,
    toggleFavorite as toggle,
    writeStringList,
} from './navLists';
import { findNavItem, type NavItem } from './navModel';

interface FavoritesValue {
    favorites: readonly NavItem[];
    isFavorite: (id: string) => boolean;
    /** False when the cap refused the addition. */
    toggleFavorite: (id: string) => boolean;
    reorderFavorites: (startIndex: number, endIndex: number) => void;
    isFull: boolean;
}

const FavoritesContext = createContext<FavoritesValue | null>(null);

function isNavigable(id: string): boolean {
    const item = findNavItem(id);
    return Boolean(item?.path && !item.disabled);
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
    // Prune on load: a menu rename between releases would otherwise leave dead ids.
    const [ids, setIds] = useState<string[]>(() => pruneUnknown(readStringList(STORAGE_KEYS.favorites), isNavigable));

    useEffect(() => {
        writeStringList(STORAGE_KEYS.favorites, ids);
    }, [ids]);

    const toggleFavorite = useCallback(
        (id: string) => {
            if (!isNavigable(id)) return false;
            const result = toggle(ids, id);
            if (result.changed) setIds(result.list);
            return result.changed;
        },
        [ids],
    );

    const reorderFavorites = useCallback((startIndex: number, endIndex: number) => {
        setIds((current) => reorderFavorite(current, startIndex, endIndex));
    }, []);

    const value = useMemo<FavoritesValue>(() => {
        const favorites = ids.map(findNavItem).filter((item): item is NavItem => Boolean(item));
        return {
            favorites,
            isFavorite: (id: string) => ids.includes(id),
            toggleFavorite,
            reorderFavorites,
            isFull: ids.length >= MAX_FAVORITES,
        };
    }, [ids, reorderFavorites, toggleFavorite]);

    return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesValue {
    const value = useContext(FavoritesContext);
    if (!value) throw new Error('useFavorites must be used inside a FavoritesProvider');
    return value;
}
