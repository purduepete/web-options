import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { UnauthorizedError, fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { Loading } from '../components/Loading';

/** The index is already sorted newest-first, so "latest" is just the first row. */
export function LatestCalendarPage() {
    const { forget } = useApiKey();
    const [publishDate, setPublishDate] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCalendars()
            .then((result) => {
                if (cancelled) return;
                const newest = result.calendars[0];
                if (!newest) {
                    setError('Nothing ingested yet.');
                    return;
                }
                setPublishDate(newest.publishDate);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(cause.message);
            });
        return () => {
            cancelled = true;
        };
    }, [forget]);

    if (publishDate) return <Navigate to={`/calendars/${publishDate}`} replace />;

    // No heading: this is a stop on the way to a week, and naming it would only
    // put a third title in front of the reader before the week's own arrives.
    return (
        <main>
            {error ? (
                <p className="signals-error" role="alert">
                    {error}
                </p>
            ) : (
                <Loading label="Finding the latest calendar" />
            )}
        </main>
    );
}
