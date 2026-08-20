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
import {
    ExpiryFilterMenu,
    GradeFilterMenu,
    HalfFilterMenu,
    MoneynessFilterMenu,
    OwnedFilterMenu,
} from '../signals/FilterMenu';
import {
    EXPIRY_FILTERS,
    HALF_FILTERS,
    MONEYNESS_FILTERS,
    OWNED_FILTERS,
    buildGroups,
    cycle,
    filterDaysByExpiry,
    filterDaysByHalf,
    filterDaysByGrade,
    filterDaysByMoneyness,
    filterDaysByOwned,
    filterDaysBySymbol,
    groupTrades,
    shiftWeek,
} from '../signals/grouping';
import type { ExpiryFilter, GradeFilter, GroupId, HalfFilter, MoneynessFilter, OwnedFilter } from '../signals/grouping';
import { WEEK_TITLE_SPACER, formatWeekTitle } from '../signals/format';
import { useNumberSource } from '../signals/useNumberSource';
import { useSignalShortcuts } from '../signals/useSignalShortcuts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ChevronDownIcon, CloseIcon, RotateCcwIcon, SlidersIcon, TableIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import { WeekNav } from '../components/WeekNav';
import { useCautionSymbols } from '../caution/CautionProvider';
import { useGradeSettings } from '../grade/GradeSettingsProvider';
import { useVixValue } from '../grade/VixProvider';
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

function readHalfFilter(value: string | null): HalfFilter {
    return HALF_FILTERS.includes(value as HalfFilter) ? (value as HalfFilter) : 'all';
}

function readOwnedFilter(value: string | null): OwnedFilter {
    return OWNED_FILTERS.includes(value as OwnedFilter) ? (value as OwnedFilter) : 'all';
}

function readGradeFilter(value: string | null): GradeFilter[] {
    const allowed: GradeFilter[] = ['red', 'yellow', 'green'];
    const selected =
        value?.split(',').filter((item): item is GradeFilter => allowed.includes(item as GradeFilter)) ?? [];
    return allowed.filter((item) => selected.includes(item));
}

export function LiveSignalsPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const week = params.get('week') ?? undefined;
    const symbol = params.get('symbol') ?? '';
    const expiry = readExpiryFilter(params.get('expiry'));
    const moneyness = readMoneynessFilter(params.get('moneyness'));
    const half = readHalfFilter(params.get('half'));
    const owned = readOwnedFilter(params.get('owned'));
    const grades = readGradeFilter(params.get('grade'));
    const [data, setData] = useState<WeekSignalsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    // The drill-in. Held here rather than in the grid so the page can suspend its
    // own single-key shortcuts while it is open.
    const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
    const [numberSource, setNumberSource] = useNumberSource();
    const gradeSettings = useGradeSettings();
    const cautionSymbols = useCautionSymbols();
    const vix = useVixValue();
    // Only a phone folds the filters away, and it opens them closed.
    const phone = useMediaQuery('(max-width: 640px)');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const symbolInputRef = useRef<HTMLInputElement>(null);
    const filtersTriggerRef = useRef<HTMLButtonElement>(null);
    const filtersPanelRef = useRef<HTMLDivElement>(null);

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
            filterDaysByOwned(
                filterDaysByGrade(
                    filterDaysByHalf(
                        filterDaysByMoneyness(
                            filterDaysByExpiry(filterDaysBySymbol(data?.days ?? [], symbol), expiry),
                            moneyness,
                        ),
                        half,
                    ),
                    grades,
                    numberSource,
                    gradeSettings,
                    [...cautionSymbols],
                    vix,
                ),
                owned,
            ),
        [data, symbol, expiry, moneyness, half, owned, grades, numberSource, gradeSettings, cautionSymbols, vix],
    );
    const groups = useMemo(() => buildGroups(days), [days]);

    // The day the open trade came from, in the order the grid lays it out, so the
    // arrows walk the tickets the reader can see rather than the raw response. Its
    // date is also what names the trade's row in the end-of-day rollup, since the
    // same put signalled on two mornings is two trades.
    const selectedDay = useMemo(
        () => (selectedTrade ? (days.find((entry) => entry.trades.includes(selectedTrade)) ?? null) : null),
        [selectedTrade, days],
    );

    const daySiblings = useMemo(() => {
        if (!selectedDay) return [];
        return groups.flatMap((group) => groupTrades(group, selectedDay.trades, numberSource));
    }, [selectedDay, groups, numberSource]);

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

    const setOwnedParam = useCallback(
        (next: OwnedFilter) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next === 'all') updated.delete('owned');
                else updated.set('owned', next);
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

    const setHalfParam = useCallback(
        (next: HalfFilter) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next === 'all') updated.delete('half');
                else updated.set('half', next);
                return updated;
            });
        },
        [setParams],
    );

    const setGradeParam = useCallback(
        (next: GradeFilter[]) => {
            const ordered = ['red', 'yellow', 'green'].filter((filter) => next.includes(filter as GradeFilter));
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (ordered.length === 0 || ordered.length === 3) updated.delete('grade');
                else updated.set('grade', ordered.join(','));
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
            updated.delete('symbol');
            updated.delete('expiry');
            updated.delete('moneyness');
            updated.delete('half');
            updated.delete('owned');
            updated.delete('grade');
            return updated;
        });
    }, [setNumberSource, setParams]);

    const atMenuDefaults =
        symbol.trim() === '' &&
        numberSource === DEFAULT_NUMBER_SOURCE &&
        expiry === 'all' &&
        moneyness === 'all' &&
        half === 'all' &&
        owned === 'all' &&
        grades.length === 0;
    const activeFilterCount =
        (symbol.trim() !== '' ? 1 : 0) +
        (expiry !== 'all' ? 1 : 0) +
        (moneyness !== 'all' ? 1 : 0) +
        (half !== 'all' ? 1 : 0) +
        (owned !== 'all' ? 1 : 0) +
        (grades.length > 0 ? 1 : 0);
    const filtersNarrowed = activeFilterCount > 0;
    const appliedFilters = [
        symbol.trim() ? `Symbol: ${symbol.trim()}` : null,
        expiry !== 'all' ? `Expiry: ${expiry}` : null,
        moneyness !== 'all' ? `Moneyness: ${moneyness.toUpperCase()}` : null,
        half !== 'all' ? `Half: ${half === 'yes' ? 'Yes' : 'No'}` : null,
        owned !== 'all' ? 'Owned' : null,
        grades.length > 0
            ? `Grade: ${grades.map((grade) => grade[0]!.toUpperCase() + grade.slice(1)).join(' + ')}`
            : null,
    ].filter((filter): filter is string => filter !== null);

    useEffect(() => {
        if (!filtersOpen || phone) return;
        function onPointerDown(event: Event) {
            const target = event.target as Node | null;
            if (!filtersPanelRef.current?.contains(target) && !filtersTriggerRef.current?.contains(target)) {
                setFiltersOpen(false);
                filtersTriggerRef.current?.focus();
            }
        }
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setFiltersOpen(false);
            filtersTriggerRef.current?.focus();
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [filtersOpen, phone]);

    // Selected, not just focused: the next symbol typed replaces the last one.
    // On a phone the box may be folded away, and nothing hidden can take the
    // caret, so the fold is opened in the DOM before the focus is aimed at it.
    const focusSymbolFilter = useCallback(() => {
        flushSync(() => setFiltersOpen(true));
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
    }, []);

    const toggleFilters = useCallback(() => {
        setFiltersOpen((open) => !open);
    }, []);

    const cycleExpiry = useCallback(() => setExpiryParam(cycle(EXPIRY_FILTERS, expiry)), [expiry, setExpiryParam]);

    const cycleMoneyness = useCallback(
        () => setMoneynessParam(cycle(MONEYNESS_FILTERS, moneyness)),
        [moneyness, setMoneynessParam],
    );

    const cycleHalf = useCallback(() => setHalfParam(cycle(HALF_FILTERS, half)), [half, setHalfParam]);

    const cycleOwned = useCallback(() => setOwnedParam(cycle(OWNED_FILTERS, owned)), [owned, setOwnedParam]);

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

    const toggleAllGroups = useCallback(() => {
        const visible = groups.map((group) => group.id);
        setCollapsed((current) => (visible.some((id) => current.has(id)) ? new Set() : new Set(visible)));
    }, [groups]);

    useSignalShortcuts({
        onPreviousWeek: goPrevious,
        onNextWeek: goNext,
        onIsolateGroup: toggleGroup,
        onToggleAllGroups: toggleAllGroups,
        onFocusSymbolFilter: focusSymbolFilter,
        onToggleFilters: toggleFilters,
        onCycleExpiry: cycleExpiry,
        onCycleMoneyness: cycleMoneyness,
        onCycleHalf: cycleHalf,
        onCycleOwned: cycleOwned,
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

    const filterControls = (
        <>
            <div className="filter-section filter-section-view">
                <h2>View</h2>
                <NumberSourceMenu value={numberSource} onChange={setNumberSource} />
            </div>
            <div className="filter-section filter-section-expiry">
                <h2>Contract</h2>
                <ExpiryFilterMenu value={expiry} onChange={setExpiryParam} />
            </div>
            <div className="filter-section filter-section-half">
                <h2>Performance</h2>
                <HalfFilterMenu value={half} onChange={setHalfParam} />
            </div>
            <div className="filter-section filter-section-owned">
                <h2>Ownership</h2>
                <OwnedFilterMenu
                    value={owned}
                    onChange={(next) =>
                        setParams((current) => {
                            const updated = new URLSearchParams(current);
                            if (next === 'all') updated.delete('owned');
                            else updated.set('owned', next);
                            return updated;
                        })
                    }
                />
            </div>
            <div className="filter-section filter-section-moneyness">
                <h2>Contract</h2>
                <MoneynessFilterMenu value={moneyness} onChange={setMoneynessParam} />
            </div>
            <div className="filter-section filter-section-grade">
                <h2>Performance</h2>
                <GradeFilterMenu value={grades} onChange={setGradeParam} />
            </div>
            <div className="filter-section filter-section-symbol">
                <h2>Symbol</h2>
                <div className={`symbol-filter${symbol ? ' has-value' : ''}`}>
                    <input
                        type="text"
                        ref={symbolInputRef}
                        value={symbol}
                        onChange={(event) => setSymbolParam(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
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
        </>
    );

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

                <button
                    type="button"
                    className={`menus-reset${atMenuDefaults ? ' is-idle' : ''}`}
                    onClick={resetMenus}
                    disabled={atMenuDefaults}
                    aria-hidden={atMenuDefaults || undefined}
                    tabIndex={atMenuDefaults ? -1 : undefined}
                    title="Reset filters"
                >
                    <RotateCcwIcon width={14} height={14} />
                    <span>Reset</span>
                </button>

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

                <button
                    type="button"
                    ref={filtersTriggerRef}
                    className={`filters-toggle${filtersNarrowed ? ' narrowed' : ''}`}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    aria-controls="signal-filters"
                    onClick={() => setFiltersOpen((open) => !open)}
                >
                    <SlidersIcon width={15} height={15} />
                    <span>{activeFilterCount ? `Filters · ${activeFilterCount}` : 'Filters'}</span>
                    <ChevronDownIcon width={14} height={14} className={filtersOpen ? 'rotated' : ''} />
                </button>

                {!phone && filtersOpen && (
                    <div
                        className="filter-bar"
                        id="signal-filters"
                        ref={filtersPanelRef}
                        role="dialog"
                        aria-label="Filters"
                    >
                        {filterControls}
                    </div>
                )}

                {phone && (
                    <Modal
                        open={filtersOpen}
                        title="Filters"
                        onClose={() => setFiltersOpen(false)}
                        className="signal-filters-modal"
                    >
                        <div className="filter-bar" id="signal-filters">
                            {filterControls}
                        </div>
                    </Modal>
                )}
            </div>

            {error && (
                <p className="signals-error" role="alert">
                    Could not load this week: {error}
                </p>
            )}

            {loading && <Loading label="Loading this week" />}

            {data && !loading && !error && (
                <>
                    <WeekScore days={days} numberSource={numberSource} appliedFilters={appliedFilters} />
                    <WeekGrid
                        days={days}
                        groups={groups}
                        collapsed={collapsed}
                        onToggleGroup={toggleGroup}
                        symbolFilter={symbol}
                        expiryFilter={expiry}
                        moneynessFilter={moneyness}
                        halfFilter={half}
                        gradeFilter={grades}
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
                reportDate={selectedDay?.date ?? null}
                position={siblingIndex >= 0 ? `${siblingIndex + 1} of ${daySiblings.length}` : null}
                onPrevious={previousTrade}
                onNext={nextTrade}
            />
        </main>
    );
}
