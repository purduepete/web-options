import { useDelayedLoading } from '../hooks/useDelayedLoading';
import './Loading.css';

interface Props {
    label?: string;
    /** Cover the page below the navbar with the page background and center the ring. */
    page?: boolean;
}

/** Held back a moment, so a quick answer never flashes a spinner on the way in. */
export function Loading({ label = 'Loading', page = false }: Props) {
    const show = useDelayedLoading(true);

    if (!show) return null;

    return (
        <div className={page ? 'loading loading-page' : 'loading'} role="status" aria-label={label}>
            <svg className="spinner" viewBox="0 0 36 36" aria-hidden="true">
                <circle className="spinner-track" cx="18" cy="18" r="16.5" />
                <circle className="spinner-arc" cx="18" cy="18" r="16.5" />
            </svg>
        </div>
    );
}
