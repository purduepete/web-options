import { useEffect, useState } from 'react';

/**
 * Matches a media query and keeps up with it. Falls back to false when there is
 * no matchMedia, which is what jsdom looks like before the test setup patches it.
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
    );

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const list = window.matchMedia(query);
        setMatches(list.matches);
        const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}
