import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CalendarWeek } from '@weboptions/shared';
import { NotFoundError, UnauthorizedError, fetchCalendar } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';

// Phase 7 renders this properly (macro banner, risk groups, put/call colours).
// It is here now so the shell's routes are real rather than dead ends.
export function CalendarWeekPage() {
    const { publishDate = '' } = useParams();
    const { forget } = useApiKey();
    const [week, setWeek] = useState<CalendarWeek | null>(null);
    const [error, setError] = useState<string | null>(null);

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
                setError(cause instanceof NotFoundError ? 'No calendar for that date.' : cause.message);
            });
        return () => {
            cancelled = true;
        };
    }, [publishDate, forget]);

    return (
        <main>
            <h1>{week?.title ?? 'Weekly calendar'}</h1>
            {error && <p>{error}</p>}
            {!week && !error && <p>loading…</p>}

            {week && (
                <>
                    <p className="muted">
                        {week.weekStart} to {week.weekEnd}, published {week.publishDate}
                    </p>

                    {week.macro.length > 0 && (
                        <ul>
                            {week.macro.map((note) => (
                                <li key={note.label}>
                                    <strong>{note.label}</strong> {note.text}
                                </li>
                            ))}
                        </ul>
                    )}

                    {week.days.map((day) => (
                        <section key={`${day.name}-${day.date}`}>
                            <h2>
                                {day.name} {day.date}
                            </h2>
                            {day.rule && <p className="muted">{day.rule}</p>}
                            {day.event && <p className="muted">{day.event}</p>}
                            {day.trades.length === 0 ? (
                                <p className="muted">No trades.</p>
                            ) : (
                                <ul>
                                    {day.trades.map((trade, index) => (
                                        <li key={`${trade.ticker}-${trade.strike}-${index}`}>
                                            {trade.ticker} {trade.strike} {trade.optionRight} exp {trade.expiry}, delta{' '}
                                            {trade.delta}, {trade.annualizedYield}% ann, {trade.risk}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    ))}
                </>
            )}
        </main>
    );
}
