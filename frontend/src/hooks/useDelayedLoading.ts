import { useEffect, useState } from 'react';

/** Matches Web Portfolio: requests that finish sooner never flash a spinner. */
export const LOADING_DELAY_MS = 250;

/** True only after `isLoading` has stayed true for the shared delay. */
export function useDelayedLoading(isLoading: boolean): boolean {
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setShow(false);
            return;
        }
        const timer = setTimeout(() => setShow(true), LOADING_DELAY_MS);
        return () => clearTimeout(timer);
    }, [isLoading]);

    return show;
}
