import { useEffect, useRef } from 'react';
import { isTyping, useWeekArrows } from '../hooks/useWeekArrows';
import type { GroupId } from './grouping';

/**
 * The page's single-key shortcuts. Stepping between weeks with the arrows is
 * shared with the published calendars, so it lives in `useWeekArrows`.
 *
 * Anything with a modifier is left alone: Ctrl+K belongs to the command palette
 * and Ctrl+R belongs to the browser. Typing in a field is left alone too, or
 * filtering for "AMD" would isolate the aggressive group on the way past. That
 * guard is also why Escape out of the symbol box belongs to the input itself.
 */

const ISOLATE_KEYS: Record<string, GroupId> = {
    t: 'top-picks',
    c: 'conservative',
    b: 'balanced',
    a: 'aggressive',
    o: 'other',
};

interface Handlers {
    onPreviousWeek: () => void;
    onNextWeek: () => void;
    onIsolateGroup: (id: GroupId) => void;
    onToggleAllGroups: () => void;
    onFocusSymbolFilter: () => void;
    onCycleExpiry: () => void;
    onCycleMoneyness: () => void;
    onResetMenus: () => void;
}

export function useSignalShortcuts(handlers: Handlers): void {
    useWeekArrows({ onPrevious: handlers.onPreviousWeek, onNext: handlers.onNextWeek });

    // Read through a ref so the listener binds once, however many handlers the
    // page passes and however often they are rebuilt.
    const latest = useRef(handlers);
    latest.current = handlers;

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;

            const key = event.key.toLowerCase();
            if (key === 'j') {
                event.preventDefault();
                latest.current.onToggleAllGroups();
            } else if (key === '/') {
                // Without this the slash lands in the box we just focused.
                event.preventDefault();
                latest.current.onFocusSymbolFilter();
            } else if (key === 'e') {
                event.preventDefault();
                latest.current.onCycleExpiry();
            } else if (key === 'm') {
                event.preventDefault();
                latest.current.onCycleMoneyness();
            } else if (key === 'r') {
                event.preventDefault();
                latest.current.onResetMenus();
            } else if (key in ISOLATE_KEYS) {
                event.preventDefault();
                latest.current.onIsolateGroup(ISOLATE_KEYS[key]!);
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
