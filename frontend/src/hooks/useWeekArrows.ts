import { useEffect, useRef } from 'react';

/**
 * Left and right step a week at a time. Both the live signals and the published
 * calendars read this way, so the binding lives here rather than with either.
 *
 * Modified presses are left alone, and so is a reader in a field: filtering for
 * "AMD" should not walk off the week on the way past.
 */

export function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface WeekArrowHandlers {
    onPrevious: () => void;
    onNext: () => void;
    /** Set while a dialog is open: the arrows belong to whatever is on top. */
    suspended?: boolean;
}

export function useWeekArrows(handlers: WeekArrowHandlers): void {
    // Read through a ref so a caller can pass a fresh closure each render
    // without rebinding the listener.
    const latest = useRef(handlers);
    latest.current = handlers;

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (latest.current.suspended) return;
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                latest.current.onPrevious();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                latest.current.onNext();
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
