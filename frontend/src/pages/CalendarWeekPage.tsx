import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CalendarWeek } from '@weboptions/shared';
import { NotFoundError, UnauthorizedError, fetchCalendar } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { CalendarGrid } from '../calendars/CalendarGrid';
import { weekRangeLabel } from '../calendars/calendarGroups';
import { formatMDY } from '../signals/format';
import { Loading } from '../components/Loading';
import { usePublishedHeight } from '../hooks/usePublishedHeight';
import './CalendarWeekPage.css';

/**
 * One published weekly calendar: the macro read at the top, then the five days.
 *
 * The macro notes are the newsletter's own framing, so they lead — a trade on
 * Wednesday only makes sense once you know Wednesday is CPI day.
 */
export function CalendarWeekPage() {
    const { publishDate = '' } = useParams();
    const { forget } = useApiKey();
    const [week, setWeek] = useState<CalendarWeek | null>(null);
    const [error, setError] = useState<string | null>(null);
    const headRef = useRef<HTMLDivElement>(null);

    usePublishedHeight(headRef, '--calendar-head-height');

    useEffect(() => {
        let cancelled = false;
        setWeek(null);
        setError(null);
        fetchCalendar(publishDate)
            .then((result) => {
                if (!cancelled) setWeek(result);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(cause instanceof NotFoundError ? 'No calendar was ingested for that date.' : cause.message);
            });
        return () => {
            cancelled = true;
        };
    }, [publishDate, forget]);

    return (
        <main className="calendar-week-page">
            <div className="calendar-head" ref={headRef}>
                <p className="calendar-back">
                    <Link to="/calendars">&larr; All weekly calendars</Link>
                </p>

                {week && (
                    <section className="macro-banner enter">
                        <h1>{week.title ?? `Week of ${weekRangeLabel(week.weekStart, week.weekEnd)}`}</h1>
                        <p className="macro-meta">
                            {weekRangeLabel(week.weekStart, week.weekEnd)} · published {formatMDY(week.publishDate)}
                        </p>

                        {week.macro.length > 0 && (
                            <ul className="macro-grid">
                                {week.macro.map((note) => (
                                    <li key={note.label} className="macro-item">
                                        <b>{note.label}</b>
                                        <span>{note.text}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </div>

            {error && (
                <p className="signals-error" role="alert">
                    {error}
                </p>
            )}

            {!week && !error && <Loading label="Loading the calendar" />}

            {week && <CalendarGrid days={week.days} />}
        </main>
    );
}
