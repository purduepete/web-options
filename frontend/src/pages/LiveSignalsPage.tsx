import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WeekSignalsResponse } from '@weboptions/shared';
import { UnauthorizedError, fetchEarliestWeek, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { WeekGrid } from '../signals/WeekGrid';
import { buildGroups, filterDaysBySymbol, shiftWeek } from '../signals/grouping';
import type { GroupId } from '../signals/grouping';
import { formatWeekTitle } from '../signals/format';
import { useSignalShortcuts } from '../signals/useSignalShortcuts';
import { CloseIcon } from '../components/icons';
import './LiveSignalsPage.css';

/**
 * The week of VADER put signals.
 *
 * The URL is the state: `?week=` and `?symbol=` are what the back button
 * restores and what a shared link carries. Nothing is mirrored into component
 * state, so there is no two-way sync to keep honest. Which groups are collapsed
 * is deliberately NOT in the URL — it is a reading preference, not a view.
 */
export function LiveSignalsPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const week = params.get('week') ?? undefined;
    const symbol = params.get('symbol') ?? '';

    const [data, setData] = useState<WeekSignalsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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
                // Revoked or expired while the tab was open: back to the prompt.
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(cause.message);
                setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [week, forget]);

    const days = useMemo(() => filterDaysBySymbol(data?.days ?? [], symbol), [data, symbol]);
    const groups = useMemo(() => buildGroups(days), [days]);

    const setWeekParam = useCallback(
        (next: string | null) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next) updated.set('week', next);
                else updated.delete('week');
                return updated;
            });
        },
        [setParams],
    );

    const setSymbolParam = useCallback(
        (next: string) => {
            // The filter changes on every keystroke, so it replaces rather than
            // stacking one history entry per letter typed.
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    if (next) updated.set('symbol', next);
                    else updated.delete('symbol');
                    return updated;
                },
                { replace: true },
            );
        },
        [setParams],
    );

    const goPrevious = useCallback(() => {
        if (!data?.hasPriorWeekData) return;
        setWeekParam(shiftWeek(data.weekStart, -7));
    }, [data, setWeekParam]);

    const goNext = useCallback(() => {
        if (!data?.hasNextWeekData) return;
        setWeekParam(shiftWeek(data.weekStart, 7));
    }, [data, setWeekParam]);

    const goEarliest = useCallback(() => {
        fetchEarliestWeek()
            .then((result) => {
                if (result.weekStart) setWeekParam(result.weekStart);
            })
            .catch((cause: Error) => setError(cause.message));
    }, [setWeekParam]);

    const isolateGroup = useCallback(
        (id: GroupId) => {
            // Only ever acts on groups actually on screen, so a key never
            // collapses everything in favour of a group this week does not have.
            const visible = groups.map((group) => group.id);
            if (!visible.includes(id)) return;
            setCollapsed(new Set(visible.filter((other) => other !== id)));
        },
        [groups],
    );

    const toggleAllGroups = useCallback(() => {
        const visible = groups.map((group) => group.id);
        setCollapsed((current) => (visible.some((id) => current.has(id)) ? new Set() : new Set(visible)));
    }, [groups]);

    useSignalShortcuts({
        onPreviousWeek: goPrevious,
        onNextWeek: goNext,
        onIsolateGroup: isolateGroup,
        onToggleAllGroups: toggleAllGroups,
    });

    function toggleGroup(id: string) {
        setCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    }

    return (
        <main className="signals-page">
            <div className="signals-head">
                <h1>{data ? formatWeekTitle(data.weekStart, data.weekEnd) : 'VADER daily put recommendations'}</h1>

                <div className="week-nav">
                    <button type="button" onClick={goEarliest} disabled={!data?.hasPriorWeekData}>
                        First
                    </button>
                    <button type="button" onClick={goPrevious} disabled={!data?.hasPriorWeekData}>
                        Previous
                    </button>
                    <button type="button" onClick={goNext} disabled={!data?.hasNextWeekData}>
                        Next
                    </button>
                    <button type="button" onClick={() => setWeekParam(null)} disabled={data?.isCurrentWeek !== false}>
                        Current
                    </button>
                </div>

                <div className={`symbol-filter${symbol ? ' has-value' : ''}`}>
                    <input
                        type="text"
                        value={symbol}
                        onChange={(event) => setSymbolParam(event.target.value.toUpperCase())}
                        placeholder="Filter by symbol"
                        aria-label="Filter by symbol"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {symbol && (
                        <button
                            type="button"
                            className="symbol-filter-clear"
                            onClick={() => setSymbolParam('')}
                            aria-label="Clear symbol filter"
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <p className="signals-error" role="alert">
                    Could not load this week: {error}
                </p>
            )}

            <p className="signals-status" role="status">
                {loading ? 'Loading this week…' : ''}
            </p>

            {data && !error && (
                <WeekGrid
                    days={days}
                    groups={groups}
                    collapsed={collapsed}
                    onToggleGroup={toggleGroup}
                    symbolFilter={symbol}
                />
            )}

            <details className="shortcuts">
                <summary>Keyboard shortcuts</summary>
                <dl>
                    <dt>←</dt>
                    <dd>Previous week</dd>
                    <dt>→</dt>
                    <dd>Next week</dd>
                    <dt>t</dt>
                    <dd>Top picks only</dd>
                    <dt>c</dt>
                    <dd>Conservative only</dd>
                    <dt>b</dt>
                    <dd>Balanced only</dd>
                    <dt>a</dt>
                    <dd>Aggressive only</dd>
                    <dt>o</dt>
                    <dd>Other only</dd>
                    <dt>j</dt>
                    <dd>Collapse or expand every group</dd>
                </dl>
            </details>
        </main>
    );
}
