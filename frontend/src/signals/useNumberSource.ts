import { useCallback, useState } from 'react';
import { DEFAULT_NUMBER_SOURCE, NUMBER_SOURCES, STORAGE_KEYS } from '@weboptions/shared';
import type { NumberSource } from '@weboptions/shared';

/**
 * Which numbers a page shows, remembered for the reader rather than the link.
 *
 * Shared by the week grid and the summary through one storage key, so choosing
 * VADER's numbers on one page is still in force after navigating to the other.
 * Each page reads it on mount; they do not track each other live, because they
 * are never on screen at the same time.
 */

function isNumberSource(value: string | null): value is NumberSource {
    return NUMBER_SOURCES.includes(value as NumberSource);
}

export function readNumberSource(): NumberSource {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.signalNumberSource);
        return isNumberSource(stored) ? stored : DEFAULT_NUMBER_SOURCE;
    } catch {
        return DEFAULT_NUMBER_SOURCE;
    }
}

export function useNumberSource(): [NumberSource, (next: NumberSource) => void] {
    const [numberSource, setState] = useState<NumberSource>(readNumberSource);

    const setNumberSource = useCallback((next: NumberSource) => {
        setState(next);
        try {
            localStorage.setItem(STORAGE_KEYS.signalNumberSource, next);
        } catch {
            // Storage blocked: the choice still applies for this session.
        }
    }, []);

    return [numberSource, setNumberSource];
}
