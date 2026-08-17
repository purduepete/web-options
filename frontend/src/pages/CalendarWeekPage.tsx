import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CalendarSummary, CalendarWeek } from '@weboptions/shared';
import { NotFoundError, UnauthorizedError, describeFailure, fetchCalendar, fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { CalendarGrid } from '../calendars/CalendarGrid';
import { weekRangeLabel } from '../calendars/calendarGroups';
import { formatMDY } from '../signals/format';
import { Loading } from '../components/Loading';
import { usePublishedHeight } from '../hooks/usePublishedHeight';
import { useWeekArrows } from '../hooks/useWeekArrows';
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
    const navigate = useNavigate();
    const [week, setWeek] = useState<CalendarWeek | null>(null);
    const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const headRef = useRef<HTMLDivElement>(null);

    usePublishedHeight(headRef, '--calendar-head-height');

    // The archive index doubles as the map for stepping through it. It is a
    // handful of rows, and fetching it here is what replaces listing it.
    useEffect(() => {
        let cancelled = false;
        fetchCalendars()
            .then((result) => {
                if (!cancelled) setCalendars(result.calendars);
            })
            .catch((cause: Error) => {
                if (!cancelled && cause instanceof UnauthorizedError) forget();
            });
        return () => {
            cancelled = true;
        };
    }, [forget]);

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
                setError(
                    cause instanceof NotFoundError
                        ? 'No calendar was ingested for that date.'
                        : describeFailure(cause),
                );
            });
        return () => {
            cancelled = true;
        };
    }, [publishDate, forget]);

    // The index arrives newest first, so the older week is the next one along.
    const position = calendars.findIndex((entry) => entry.publishDate === publishDate);
    const current = position >= 0 ? calendars[position] : undefined;
    const older = position >= 0 ? calendars[position + 1] : undefined;
    const newer = position > 0 ? calendars[position - 1] : undefined;
    const earliest = calendars[calendars.length - 1];
    const latest = calendars[0];

    const open = (entry: CalendarSummary | undefined) => {
        if (entry) navigate(`/calendars/${entry.publishDate}`);
    };

    useWeekArrows({ onPrevious: () => open(older), onNext: () => open(newer) });

    return (
        <main className="calendar-week-page">
            <div className="calendar-head" ref={headRef}>
                <div className="page-head">
                    {/* Empty until the week is known: a name that is replaced a
                        moment later reads as a page that changed underfoot. */}
                    <h1>{week ? (week.title ?? `Week of ${weekRangeLabel(week.weekStart, week.weekEnd)}`) : ''}</h1>

                    <div className="week-nav">
                        <button
                            type="button"
                            onClick={() => open(earliest)}
                            disabled={!earliest || earliest === current}
                        >
                            First
                        </button>
                        <button type="button" onClick={() => open(older)} disabled={!older}>
                            Previous
                        </button>
                        <button type="button" onClick={() => open(newer)} disabled={!newer}>
                            Next
                        </button>
                        <button type="button" onClick={() => open(latest)} disabled={!latest || latest === current}>
                            Latest
                        </button>
                    </div>
                </div>

                {week && (
                    <section className="macro-banner enter">
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

                        <p className="macro-meta">published {formatMDY(week.publishDate)}</p>
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
