import { useEffect, useState } from 'react';
import './Loading.css';

interface Props {
    label?: string;
}

/** Held back a moment, so a quick answer never flashes a spinner on the way in. */
export function Loading({ label = 'Loading' }: Props) {
    const [show, setShow] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setShow(true), 250);
        return () => clearTimeout(timer);
    }, []);

    if (!show) return null;

    return (
        <div className="loading">
            <svg className="spinner" viewBox="0 0 36 36" role="status" aria-label={label}>
                <circle className="spinner-track" cx="18" cy="18" r="16.5" />
                <circle className="spinner-arc" cx="18" cy="18" r="16.5" />
            </svg>
        </div>
    );
}
