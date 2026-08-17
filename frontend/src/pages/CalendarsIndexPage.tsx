import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CalendarSummary } from '@weboptions/shared';
import { UnauthorizedError, fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { isLatest, weekRangeLabel } from '../calendars/calendarGroups';
import { formatMDY } from '../signals/format';
import { Loading } from '../components/Loading';
import './CalendarsIndexPage.css';

/**
 * Every ingested weekly newsletter, newest first.
 *
 * The publish date is only worth showing when it differs from the Monday the
 * week starts on — otherwise it just repeats the range that is already there.
 */
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
        <main className="calendars-page">
            <h1>Weekly calendars</h1>

            {error && (
                <p className="signals-error" role="alert">
                    Could not load the calendars: {error}
                </p>
            )}

            {!calendars && !error && <Loading label="Loading the calendars" />}

            {calendars?.length === 0 && <p className="empty-week">No weekly calendars have been ingested yet.</p>}

            {calendars && calendars.length > 0 && (
                <ul className="calendar-cards enter">
                    {calendars.map((calendar) => (
                        <li key={calendar.publishDate} className="calendar-card">
                            <div className="calendar-card-head">
                                <h2>{weekRangeLabel(calendar.weekStart, calendar.weekEnd)}</h2>
                                {isLatest(calendar.publishDate, calendars) && <span className="badge">Latest</span>}
                            </div>

                            {calendar.title && <p className="calendar-card-title">{calendar.title}</p>}

                            <p className="calendar-card-meta">
                                {calendar.tradeCount} {calendar.tradeCount === 1 ? 'trade' : 'trades'}
                                {calendar.publishDate !== calendar.weekStart &&
                                    ` · published ${formatMDY(calendar.publishDate)}`}
                            </p>

                            <Link className="calendar-card-open" to={`/calendars/${calendar.publishDate}`}>
                                Open calendar
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
