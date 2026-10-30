import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CalendarSummary, CalendarWeek } from '@weboptions/shared';
import { NotFoundError, UnauthorizedError, describeFailure, fetchCalendar, fetchCalendars } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { CalendarGrid } from '../calendars/CalendarGrid';
import { weekRangeLabel } from '../calendars/calendarGroups';
import { formatMDY } from '../signals/format';
import { ChevronDownIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { WeekNav } from '../components/WeekNav';
import { useMediaQuery } from '../hooks/useMediaQuery';
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
    // The head is pinned, so on a phone a week's notes stand in front of the
    // days they frame. Only a phone folds them, and it opens them closed.
    const phone = useMediaQuery('(max-width: 640px)');
    const [notesOpen, setNotesOpen] = useState(false);

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
                    cause instanceof NotFoundError ? 'No calendar was ingested for that date.' : describeFailure(cause)
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

                    <WeekNav
                        onFirst={() => open(earliest)}
                        onPrevious={() => open(older)}
                        onNext={() => open(newer)}
                        onJump={() => open(latest)}
                        jump={{ label: 'Latest', edge: 'end' }}
                        disabled={{
                            first: !earliest || earliest === current,
                            previous: !older,
                            next: !newer,
                            jump: !latest || latest === current,
                        }}
                    />
                </div>

                {week && (
                    <section className="macro-banner enter">
                        {phone && week.macro.length > 0 && (
                            <button
                                type="button"
                                className="macro-toggle"
                                aria-expanded={notesOpen}
                                aria-controls="macro-notes"
                                onClick={() => setNotesOpen((open) => !open)}
                            >
                                <span>Week notes</span>
                                <ChevronDownIcon width={14} height={14} className={notesOpen ? 'rotated' : ''} />
                            </button>
                        )}

                        {week.macro.length > 0 && (
                            <ul className="macro-grid" id="macro-notes" hidden={phone && !notesOpen}>
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

            {!week && !error && <Loading page label="Loading the calendar" />}

            {week && <CalendarGrid days={week.days} />}
        </main>
    );
}
