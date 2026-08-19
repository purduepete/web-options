import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DEFAULT_NUMBER_SOURCE } from '@weboptions/shared';
import type { WeekSignalsResponse } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchEarliestWeek, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { WeekGrid } from '../signals/WeekGrid';
import { WeekScore } from '../signals/WeekScore';
import { NumberSourceMenu } from '../signals/NumberSourceMenu';
import { ExpiryFilterMenu, MoneynessFilterMenu } from '../signals/FilterMenu';
import {
    EXPIRY_FILTERS,
    MONEYNESS_FILTERS,
    buildGroups,
    cycle,
    filterDaysByExpiry,
    filterDaysByMoneyness,
    filterDaysBySymbol,
    shiftWeek,
} from '../signals/grouping';
import type { ExpiryFilter, GroupId, MoneynessFilter } from '../signals/grouping';
import { WEEK_TITLE_SPACER, formatWeekTitle } from '../signals/format';
import { useNumberSource } from '../signals/useNumberSource';
import { useSignalShortcuts } from '../signals/useSignalShortcuts';
import { CloseIcon, RotateCcwIcon, TableIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { WeekNav } from '../components/WeekNav';
import './LiveSignalsPage.css';

/**
 * The week of VADER put signals.
 *
 * The URL is the state: `?week=` and `?symbol=` are what the back button
 * restores and what a shared link carries. Nothing is mirrored into component
 * state, so there is no two-way sync to keep honest. Which groups are collapsed
 * is deliberately NOT in the URL — it is a reading preference, not a view. The
 * same goes for which numbers are shown: it belongs to the reader, not the link.
 */

function readExpiryFilter(value: string | null): ExpiryFilter {
    return EXPIRY_FILTERS.includes(value as ExpiryFilter) ? (value as ExpiryFilter) : 'all';
}

function readMoneynessFilter(value: string | null): MoneynessFilter {
    return MONEYNESS_FILTERS.includes(value as MoneynessFilter) ? (value as MoneynessFilter) : 'all';
}

export function LiveSignalsPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const week = params.get('week') ?? undefined;
    const symbol = params.get('symbol') ?? '';
    const expiry = readExpiryFilter(params.get('expiry'));
    const moneyness = readMoneynessFilter(params.get('moneyness'));
    const [data, setData] = useState<WeekSignalsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [numberSource, setNumberSource] = useNumberSource();
    const symbolInputRef = useRef<HTMLInputElement>(null);

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
                setError(describeFailure(cause));
                setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [week, forget]);

    const days = useMemo(
        () =>
            filterDaysByMoneyness(filterDaysByExpiry(filterDaysBySymbol(data?.days ?? [], symbol), expiry), moneyness),
        [data, symbol, expiry, moneyness],
    );
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

    const setExpiryParam = useCallback(
        (next: ExpiryFilter) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next === 'all') updated.delete('expiry');
                else updated.set('expiry', next);
                return updated;
            });
        },
        [setParams],
    );

    const setMoneynessParam = useCallback(
        (next: MoneynessFilter) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next === 'all') updated.delete('moneyness');
                else updated.set('moneyness', next);
                return updated;
            });
        },
        [setParams],
    );

    // Both filters live in the URL, so they clear in one write rather than two
    // history entries that each undo half of it.
    const resetMenus = useCallback(() => {
        setNumberSource(DEFAULT_NUMBER_SOURCE);
        setParams((current) => {
            const updated = new URLSearchParams(current);
            updated.delete('expiry');
            updated.delete('moneyness');
            return updated;
        });
    }, [setNumberSource, setParams]);

    const atMenuDefaults = numberSource === DEFAULT_NUMBER_SOURCE && expiry === 'all' && moneyness === 'all';

    // Selected, not just focused: the next symbol typed replaces the last one.
    const focusSymbolFilter = useCallback(() => {
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
    }, []);

    const cycleExpiry = useCallback(() => setExpiryParam(cycle(EXPIRY_FILTERS, expiry)), [expiry, setExpiryParam]);

    const cycleMoneyness = useCallback(
        () => setMoneynessParam(cycle(MONEYNESS_FILTERS, moneyness)),
        [moneyness, setMoneynessParam],
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
            .catch((cause: Error) => setError(describeFailure(cause)));
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
        onFocusSymbolFilter: focusSymbolFilter,
        onCycleExpiry: cycleExpiry,
        onCycleMoneyness: cycleMoneyness,
        onResetMenus: resetMenus,
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
            <div className="page-head">
                <h1>
                    {data ? (
                        formatWeekTitle(data.weekStart, data.weekEnd)
                    ) : (
                        /* Unnamed until the week is known, but holding the room a
                           name will take, so nothing shifts when it arrives. */
                        <span className="week-title-spacer" aria-hidden="true">
                            {WEEK_TITLE_SPACER}
                        </span>
                    )}
                </h1>

                {/* This week is one row of the summary, so the way out to the
                    rest of them belongs beside its name — but only once there is
                    a week to leave. The slot holds the control run in place. */}
                <span className="summary-link-slot">
                    {data && (
                        <Link className="summary-link" to="/summary" title="Summary" aria-label="Summary">
                            <TableIcon width={16} height={16} />
                        </Link>
                    )}
                </span>

                <NumberSourceMenu value={numberSource} onChange={setNumberSource} />

                {/* Read across the whole week rather than a single card, so they
                    sit with the other week-wide control and not inside the grid. */}
                <ExpiryFilterMenu value={expiry} onChange={setExpiryParam} />

                <MoneynessFilterMenu value={moneyness} onChange={setMoneynessParam} />

                {/* Absent while it would do nothing, so the bar only carries the
                    control once there is something to undo. */}
                {!atMenuDefaults && (
                    <button type="button" className="menus-reset" onClick={resetMenus}>
                        <RotateCcwIcon width={14} height={14} />
                        <span>Reset</span>
                    </button>
                )}

                <WeekNav
                    onFirst={goEarliest}
                    onPrevious={goPrevious}
                    onNext={goNext}
                    onJump={() => setWeekParam(null)}
                    jump={{ label: 'This week', edge: 'end' }}
                    disabled={{
                        first: !data?.hasPriorWeekData,
                        previous: !data?.hasPriorWeekData,
                        next: !data?.hasNextWeekData,
                        jump: data?.isCurrentWeek !== false,
                    }}
                />

                <div className={`symbol-filter${symbol ? ' has-value' : ''}`}>
                    <input
                        type="text"
                        ref={symbolInputRef}
                        value={symbol}
                        onChange={(event) => setSymbolParam(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                            // Leaves the box without touching what was typed.
                            if (event.key === 'Escape') event.currentTarget.blur();
                        }}
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

            {loading && <Loading label="Loading this week" />}

            {data && !loading && !error && (
                <>
                    <WeekScore days={days} numberSource={numberSource} />
                    <WeekGrid
                        days={days}
                        groups={groups}
                        collapsed={collapsed}
                        onToggleGroup={toggleGroup}
                        symbolFilter={symbol}
                        expiryFilter={expiry}
                        moneynessFilter={moneyness}
                        numberSource={numberSource}
                    />
                </>
            )}
        </main>
    );
}
