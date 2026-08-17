import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Publishes an element's height on the document as a custom property.
 *
 * The page pins one bar under another, and the offsets cannot be written down:
 * the navbar's height follows its touch targets and the signals bar wraps to a
 * second row on a narrow screen. Measuring is the only honest answer.
 */
export function usePublishedHeight(ref: RefObject<HTMLElement | null>, property: string): void {
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        // The fractional height, not offsetHeight: rounding to whole pixels left
        // a hairline of the page showing between one pinned bar and the next.
        const publish = () =>
            document.documentElement.style.setProperty(property, `${element.getBoundingClientRect().height}px`);
        publish();

        const observer = new ResizeObserver(publish);
        observer.observe(element);
        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty(property);
        };
    }, [ref, property]);
}
