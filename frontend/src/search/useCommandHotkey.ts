import { useEffect } from 'react';

/**
 * Ctrl+K is the shortcut everyone already knows; Ctrl+/ matches webportfolio,
 * so the same fingers work in both apps. Both are modified, so they are safe to
 * listen for globally — there is no risk of stealing a keystroke from a form.
 */
export function useCommandHotkey(onToggle: () => void): void {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.altKey) return;
            if (!event.ctrlKey && !event.metaKey) return;

            const key = event.key.toLowerCase();
            if (key !== 'k' && key !== '/') return;

            event.preventDefault();
            onToggle();
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onToggle]);
}
