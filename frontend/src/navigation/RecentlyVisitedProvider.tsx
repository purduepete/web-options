import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { STORAGE_KEYS } from '@weboptions/shared';
import { pruneUnknown, readStringList, recordVisit, writeStringList } from './navLists';
import { findNavItem, type NavItem } from './navModel';

interface RecentlyVisitedValue {
    recent: readonly NavItem[];
}

const RecentlyVisitedContext = createContext<RecentlyVisitedValue | null>(null);

function isNavigable(id: string): boolean {
    const item = findNavItem(id);
    return Boolean(item?.path && !item.disabled);
}

export function RecentlyVisitedProvider({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const [ids, setIds] = useState<string[]>(() =>
        pruneUnknown(readStringList(STORAGE_KEYS.recentlyVisited), isNavigable)
    );

    useEffect(() => {
        // Only menu destinations are recorded. A deep link like /calendars/2026-08-10
        // is not in the model and would show up as an unlabeled row.
        if (!isNavigable(pathname)) return;
        setIds((current) => {
            const next = recordVisit(current, pathname);
            writeStringList(STORAGE_KEYS.recentlyVisited, next);
            return next;
        });
    }, [pathname]);

    const value = useMemo<RecentlyVisitedValue>(
        () => ({ recent: ids.map(findNavItem).filter((item): item is NavItem => Boolean(item)) }),
        [ids]
    );

    return <RecentlyVisitedContext.Provider value={value}>{children}</RecentlyVisitedContext.Provider>;
}

export function useRecentlyVisited(): RecentlyVisitedValue {
    const value = useContext(RecentlyVisitedContext);
    if (!value) throw new Error('useRecentlyVisited must be used inside a RecentlyVisitedProvider');
    return value;
}
