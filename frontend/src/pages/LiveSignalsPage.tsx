import { useEffect, useState } from 'react';
import type { WeekSignalsResponse } from '@weboptions/shared';
import { UnauthorizedError, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';

// Still the Phase 1 table. Phase 7 replaces it with the real ticket cards, risk
// groups, symbol filter and URL state.
export function LiveSignalsPage() {
    const { forget } = useApiKey();
    const [week, setWeek] = useState<string | undefined>(undefined);
    const [data, setData] = useState<WeekSignalsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchWeekSignals(week)
            .then((result) => {
                if (!cancelled) setData(result);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                // Revoked or expired while the tab was open: send them back to the prompt.
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(cause.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [week, forget]);

    function shiftWeek(days: number) {
        if (!data) return;
        const [y, m, d] = data.weekStart.split('-').map(Number);
        const next = new Date(y!, m! - 1, d! + days);
        setWeek(
            `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(
                2,
                '0',
            )}`,
        );
    }

    return (
        <main>
            <h1>VADER live signals</h1>

            <p>
                <button type="button" onClick={() => shiftWeek(-7)} disabled={!data?.hasPriorWeekData}>
                    previous week
                </button>{' '}
                <button type="button" onClick={() => setWeek(undefined)}>
                    current week
                </button>{' '}
                <button type="button" onClick={() => shiftWeek(7)} disabled={!data?.hasNextWeekData}>
                    next week
                </button>
            </p>

            {loading && <p>loading…</p>}
            {error && <p>failed: {error}</p>}

            {data && (
                <>
                    <p>
                        {data.weekStart} to {data.weekEnd}
                        {data.isCurrentWeek ? ' (current week)' : ''}
                    </p>
                    {data.days.length === 0 && <p>no signals for this week</p>}
                    {data.days.map((day) => (
                        <section key={day.date}>
                            <h2>
                                {day.name} {day.date}, {day.trades.length} trades
                            </h2>
                            <table>
                                <thead>
                                    <tr>
                                        <th>symbol</th>
                                        <th>strike</th>
                                        <th>expiration</th>
                                        <th>dte</th>
                                        <th>delta</th>
                                        <th>ann. yield</th>
                                        <th>premium</th>
                                        <th>collateral</th>
                                        <th>tier</th>
                                        <th>top pick</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {day.trades.map((trade, index) => (
                                        <tr key={`${trade.symbol}-${trade.strike}-${trade.expiration}-${index}`}>
                                            <td>{trade.symbol}</td>
                                            <td>{trade.strike}</td>
                                            <td>{trade.expiration}</td>
                                            <td>{trade.dte}</td>
                                            <td>{trade.delta}</td>
                                            <td>{trade.annualizedYield}</td>
                                            <td>{trade.premium}</td>
                                            <td>{trade.collateral}</td>
                                            <td>{trade.tier}</td>
                                            <td>{trade.isTopPick ? 'yes' : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    ))}
                </>
            )}
        </main>
    );
}
