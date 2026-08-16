import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CalendarSummary } from '@weboptions/shared';
import { UnauthorizedError, fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';

// Plain list for now; Phase 7 turns this into the card grid with the Latest badge.
export function CalendarsIndexPage() {
    const { forget } = useApiKey();
    const [calendars, setCalendars] = useState<readonly CalendarSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCalendars()
            .then((result) => {
                if (!cancelled) setCalendars(result.calendars);
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

    return (
        <main>
            <h1>Weekly calendars</h1>
            {error && <p>failed: {error}</p>}
            {!calendars && !error && <p>loading…</p>}
            {calendars?.length === 0 && <p className="muted">Nothing ingested yet.</p>}
            <ul>
                {calendars?.map((calendar) => (
                    <li key={calendar.publishDate}>
                        <Link to={`/calendars/${calendar.publishDate}`}>
                            {calendar.weekStart} to {calendar.weekEnd}
                        </Link>{' '}
                        <span className="muted">
                            published {calendar.publishDate}, {calendar.tradeCount} trades
                        </span>
                    </li>
                ))}
            </ul>
        </main>
    );
}
