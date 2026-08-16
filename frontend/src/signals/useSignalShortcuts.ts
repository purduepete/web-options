import { useEffect } from 'react';
import type { GroupId } from './grouping';

/**
 * The page's single-key shortcuts.
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

function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useSignalShortcuts(handlers: Handlers): void {
    const { onPreviousWeek, onNextWeek, onIsolateGroup, onToggleAllGroups } = handlers;

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;

            const key = event.key.toLowerCase();
            if (key === 'arrowleft') {
                event.preventDefault();
                onPreviousWeek();
            } else if (key === 'arrowright') {
                event.preventDefault();
                onNextWeek();
            } else if (key === 'j') {
                event.preventDefault();
                onToggleAllGroups();
            } else if (key in ISOLATE_KEYS) {
                event.preventDefault();
                onIsolateGroup(ISOLATE_KEYS[key]!);
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onPreviousWeek, onNextWeek, onIsolateGroup, onToggleAllGroups]);
}
