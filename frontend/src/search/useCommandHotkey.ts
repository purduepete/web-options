import { useEffect } from 'react';

/** Ctrl+/ matches webportfolio and is safe to listen for globally. */
export function useCommandHotkey(onToggle: () => void): void {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.altKey) return;
            if (!event.ctrlKey && !event.metaKey) return;

            if (event.key !== '/') return;

            event.preventDefault();
            onToggle();
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onToggle]);
}
