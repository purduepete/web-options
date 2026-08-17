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
            <div className="spinner" role="status" aria-label={label} />
        </div>
    );
}
