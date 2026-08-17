import { useEffect } from 'react';
import { isTyping, useWeekArrows } from '../hooks/useWeekArrows';
import type { GroupId } from './grouping';

/**
 * The page's single-key shortcuts. Stepping between weeks with the arrows is
 * shared with the published calendars, so it lives in `useWeekArrows`.
 *
 * Anything with a modifier is left alone: Ctrl+K belongs to the command palette
 * and Ctrl+R belongs to the browser. Typing in a field is left alone too, or
 * filtering for "AMD" would isolate the aggressive group on the way past.
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
}

export function useSignalShortcuts(handlers: Handlers): void {
    const { onPreviousWeek, onNextWeek, onIsolateGroup, onToggleAllGroups } = handlers;

    useWeekArrows({ onPrevious: onPreviousWeek, onNext: onNextWeek });

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;

            const key = event.key.toLowerCase();
            if (key === 'j') {
                event.preventDefault();
                onToggleAllGroups();
            } else if (key in ISOLATE_KEYS) {
                event.preventDefault();
                onIsolateGroup(ISOLATE_KEYS[key]!);
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onIsolateGroup, onToggleAllGroups]);
}
