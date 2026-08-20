import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { DEFAULT_NUMBER_SOURCE } from '@weboptions/shared';
import type { Trade, WeekSignalsResponse } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchEarliestWeek, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { WeekGrid } from '../signals/WeekGrid';
import { TradeDetail } from '../signals/TradeDetail';
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
    groupTrades,
    shiftWeek,
} from '../signals/grouping';
import type { ExpiryFilter, GroupId, MoneynessFilter } from '../signals/grouping';
import { WEEK_TITLE_SPACER, formatWeekTitle } from '../signals/format';
import { useNumberSource } from '../signals/useNumberSource';
import { useSignalShortcuts } from '../signals/useSignalShortcuts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ChevronDownIcon, CloseIcon, RotateCcwIcon, SlidersIcon, TableIcon } from '../components/icons';
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
    // The drill-in. Held here rather than in the grid so the page can suspend its
    // own single-key shortcuts while it is open.
    const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
    const [numberSource, setNumberSource] = useNumberSource();
    // Only a phone folds the filters away, and it opens them closed.
    const phone = useMediaQuery('(max-width: 640px)');
    const [filtersOpen, setFiltersOpen] = useState(false);
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

    // The day the open trade came from, in the order the grid lays it out, so the
    // arrows walk the tickets the reader can see rather than the raw response.
    const daySiblings = useMemo(() => {
        if (!selectedTrade) return [];
        const day = days.find((entry) => entry.trades.includes(selectedTrade));
        if (!day) return [];
        return groups.flatMap((group) => groupTrades(group, day.trades, numberSource));
    }, [selectedTrade, days, groups, numberSource]);

    const siblingIndex = selectedTrade ? daySiblings.indexOf(selectedTrade) : -1;

    const stepTrade = useCallback(
        (by: number) => {
            setSelectedTrade((current) => {
                if (!current) return current;
                return daySiblings[daySiblings.indexOf(current) + by] ?? current;
            });
        },
        [daySiblings],
    );

    const previousTrade = useMemo(() => (siblingIndex > 0 ? () => stepTrade(-1) : null), [siblingIndex, stepTrade]);
    const nextTrade = useMemo(
        () => (siblingIndex >= 0 && siblingIndex < daySiblings.length - 1 ? () => stepTrade(1) : null),
        [siblingIndex, daySiblings.length, stepTrade],
    );

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
    const filtersNarrowed = !atMenuDefaults || symbol !== '';

    // Selected, not just focused: the next symbol typed replaces the last one.
    // On a phone the box may be folded away, and nothing hidden can take the
    // caret, so the fold is opened in the DOM before the focus is aimed at it.
    const focusSymbolFilter = useCallback(() => {
        flushSync(() => setFiltersOpen(true));
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
        // Every shortcut here is a bare letter, so `r` in an open dialog would
        // otherwise reset the filters behind it.
        suspended: selectedTrade !== null,
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

                {/* A phone has no room for a week's worth of controls above the
                    week itself, so there they fold away behind one button. It is
                    rendered only where it works: at every other width the bar is
                    laid out as though this wrapper were not there at all. */}
                {phone && (
                    <button
                        type="button"
                        className={`filters-toggle${filtersNarrowed ? ' narrowed' : ''}`}
                        aria-expanded={filtersOpen}
                        aria-controls="signal-filters"
                        onClick={() => setFiltersOpen((open) => !open)}
                    >
                        <SlidersIcon width={15} height={15} />
                        <span>Filters</span>
                        <ChevronDownIcon width={14} height={14} className={filtersOpen ? 'rotated' : ''} />
                    </button>
                )}

                <div className="filter-bar" id="signal-filters" hidden={phone && !filtersOpen}>
                    <NumberSourceMenu value={numberSource} onChange={setNumberSource} />

                    {/* Read across the whole week rather than a single card, so they
                        sit with the other week-wide control and not inside the grid. */}
                    <ExpiryFilterMenu value={expiry} onChange={setExpiryParam} />

                    <MoneynessFilterMenu value={moneyness} onChange={setMoneynessParam} />

                    {/* Held out of sight rather than out of the bar while it would
                        do nothing: arriving between the menus and the week would
                        take its width out of the row and push the symbol filter onto
                        a line of its own. It keeps the space and gives up everything
                        else — nothing to see, to press, to focus or to hear. */}
                    <button
                        type="button"
                        className={`menus-reset${atMenuDefaults ? ' is-idle' : ''}`}
                        onClick={resetMenus}
                        disabled={atMenuDefaults}
                        aria-hidden={atMenuDefaults || undefined}
                        tabIndex={atMenuDefaults ? -1 : undefined}
                    >
                        <RotateCcwIcon width={14} height={14} />
                        <span>Reset</span>
                    </button>

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
                        onOpenTrade={setSelectedTrade}
                        currentWeek={data.isCurrentWeek}
                    />
                </>
            )}

            <TradeDetail
                trade={selectedTrade}
                numberSource={numberSource}
                onClose={() => setSelectedTrade(null)}
                position={siblingIndex >= 0 ? `${siblingIndex + 1} of ${daySiblings.length}` : null}
                onPrevious={previousTrade}
                onNext={nextTrade}
            />
        </main>
    );
}
