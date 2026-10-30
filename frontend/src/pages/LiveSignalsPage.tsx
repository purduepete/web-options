import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { DEFAULT_NUMBER_SOURCE, STORAGE_KEYS } from '@weboptions/shared';
import type { IsoDate, Trade, WeekSignalsResponse } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchEarliestWeek, fetchSignal, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { WeekGrid } from '../signals/WeekGrid';
import { TradeDetail } from '../signals/TradeDetail';
import type { SignalTarget } from '../signals/TradeDetail';
import { WeekScore } from '../signals/WeekScore';
import type { AppliedFilter } from '../signals/AppliedFilters';
import { SignalFilterControls } from '../signals/SignalFilterControls';
import {
    EXPIRY_FILTERS,
    HALF_FILTERS,
    LIVE_GROUP_LABELS,
    MONEYNESS_FILTERS,
    OWNED_FILTERS,
    SELECTABLE_TIER_FILTERS,
    buildGroups,
    cycle,
    filterDaysByExpiry,
    filterDaysByHalf,
    filterDaysByGrade,
    filterDaysByMoneyness,
    filterDaysByOwned,
    filterDaysBySymbol,
    filterDaysByTier,
    groupTrades,
    readMoneynessFilter,
    shiftWeek,
} from '../signals/grouping';
import type {
    ExpiryFilter,
    GradeFilter,
    HalfFilter,
    MoneynessFilter,
    OwnedFilter,
    TierSelection,
} from '../signals/grouping';
import { WEEK_TITLE_SPACER, formatWeekTitle } from '../signals/format';
import { useNumberSource } from '../signals/useNumberSource';
import { useSignalShortcuts } from '../signals/useSignalShortcuts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useStoredFilters } from '../hooks/useStoredFilters';
import { ChevronDownIcon, RotateCcwIcon, SlidersIcon, TableIcon } from '../components/icons';
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

function readTierFilter(value: string | null): TierSelection[] {
    const selected =
        value
            ?.split(',')
            .filter((item): item is TierSelection => SELECTABLE_TIER_FILTERS.includes(item as TierSelection)) ?? [];
    return SELECTABLE_TIER_FILTERS.filter((item) => selected.includes(item));
}

/** What the page keeps between visits. The week is navigation, so it is not here. */
const LIVE_FILTER_PARAMS = ['symbol', 'expiry', 'moneyness', 'half', 'owned', 'grade', 'tier'] as const;

export function LiveSignalsPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    // A week in the URL makes it someone's link, so the stored filters stand down.
    useStoredFilters({
        storageKey: STORAGE_KEYS.liveSignalsFilters,
        keys: LIVE_FILTER_PARAMS,
        guardKeys: ['week'],
    });
    const week = params.get('week') ?? undefined;
    const symbol = params.get('symbol') ?? '';
    const expiry = readExpiryFilter(params.get('expiry'));
    const moneyness = readMoneynessFilter(params.get('moneyness'));
    const half = readHalfFilter(params.get('half'));
    const owned = readOwnedFilter(params.get('owned'));
    const tier = readTierFilter(params.get('tier'));
    const grades = readGradeFilter(params.get('grade'));
    const [data, setData] = useState<WeekSignalsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    // The drill-in. Held here rather than in the grid so the page can suspend its
    // own single-key shortcuts while it is open.
    const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
    // Set only when the drill-in jumped to a signal from another week. That trade is
    // not in `days`, so `selectedDay` cannot supply its report date and the outcome
    // lookup would go missing without this.
    const [jumpedReportDate, setJumpedReportDate] = useState<IsoDate | null>(null);
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
            filterDaysByTier(
                filterDaysByOwned(
                    filterDaysByGrade(
                        filterDaysByHalf(
                            filterDaysByMoneyness(
                                filterDaysByExpiry(filterDaysBySymbol(data?.days ?? [], symbol), expiry),
                                moneyness
                            ),
                            half
                        ),
                        grades,
                        numberSource,
                        gradeSettings,
                        [...cautionSymbols],
                        vix
                    ),
                    owned
                ),
                tier
            ),
        [data, symbol, expiry, moneyness, half, owned, tier, grades, numberSource, gradeSettings, cautionSymbols, vix]
    );
    const groups = useMemo(() => buildGroups(days), [days]);

    // The day the open trade came from, in the order the grid lays it out, so the
    // arrows walk the tickets the reader can see rather than the raw response. Its
    // date is also what names the trade's row in the end-of-day rollup, since the
    // same put signalled on two mornings is two trades.
    const selectedDay = useMemo(
        () => (selectedTrade ? (days.find((entry) => entry.trades.includes(selectedTrade)) ?? null) : null),
        [selectedTrade, days]
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
        [daySiblings]
    );

    const previousTrade = useMemo(() => (siblingIndex > 0 ? () => stepTrade(-1) : null), [siblingIndex, stepTrade]);
    const nextTrade = useMemo(
        () => (siblingIndex >= 0 && siblingIndex < daySiblings.length - 1 ? () => stepTrade(1) : null),
        [siblingIndex, daySiblings.length, stepTrade]
    );

    const openFromGrid = useCallback((trade: Trade) => {
        setJumpedReportDate(null);
        setSelectedTrade(trade);
    }, []);

    const closeDetail = useCallback(() => {
        setJumpedReportDate(null);
        setSelectedTrade(null);
    }, []);

    /**
     * Swaps the drill-in onto another signal on the same underlying. The trade is
     * fetched because it may belong to a week this page has not loaded. A click while
     * an earlier one is still in flight wins, so a slow first answer cannot land on
     * top of a later choice.
     */
    const jumpToken = useRef(0);
    const openSignal = useCallback((target: SignalTarget) => {
        const token = (jumpToken.current += 1);
        fetchSignal(target)
            .then((trade) => {
                if (jumpToken.current !== token) return;
                setJumpedReportDate(target.reportDate);
                setSelectedTrade(trade);
            })
            .catch(() => undefined);
    }, []);

    const setWeekParam = useCallback(
        (next: string | null) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next) updated.set('week', next);
                else updated.delete('week');
                return updated;
            });
        },
        [setParams]
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
                { replace: true }
            );
        },
        [setParams]
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
        [setParams]
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
        [setParams]
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
        [setParams]
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
        [setParams]
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
        [setParams]
    );

    const setTierParam = useCallback(
        (next: TierSelection[]) => {
            const ordered = SELECTABLE_TIER_FILTERS.filter((filter) => next.includes(filter));
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (ordered.length === 0 || ordered.length === SELECTABLE_TIER_FILTERS.length) updated.delete('tier');
                else updated.set('tier', ordered.join(','));
                return updated;
            });
        },
        [setParams]
    );

    // The filters live in the URL, so they clear in one write rather than a
    // history entry for each control.
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
            updated.delete('tier');
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
        tier.length === 0 &&
        grades.length === 0;
    const activeFilterCount =
        (symbol.trim() !== '' ? 1 : 0) +
        (expiry !== 'all' ? 1 : 0) +
        (moneyness !== 'all' ? 1 : 0) +
        (half !== 'all' ? 1 : 0) +
        (owned !== 'all' ? 1 : 0) +
        (tier.length > 0 ? 1 : 0) +
        (grades.length > 0 ? 1 : 0);
    const filtersNarrowed = activeFilterCount > 0;
    const appliedFilters: AppliedFilter[] = [];
    if (symbol.trim()) {
        appliedFilters.push({ key: 'symbol', label: `Symbol: ${symbol.trim()}`, remove: () => setSymbolParam('') });
    }
    if (expiry !== 'all') {
        appliedFilters.push({ key: 'expiry', label: `Expiry: ${expiry}`, remove: () => setExpiryParam('all') });
    }
    if (moneyness !== 'all') {
        appliedFilters.push({
            key: 'moneyness',
            label: `Moneyness: ${moneyness.toUpperCase()}`,
            remove: () => setMoneynessParam('all'),
        });
    }
    if (half !== 'all') {
        appliedFilters.push({
            key: 'half',
            label: `Half: ${half === 'yes' ? 'Yes' : 'No'}`,
            remove: () => setHalfParam('all'),
        });
    }
    if (owned !== 'all') {
        appliedFilters.push({ key: 'owned', label: 'Owned', remove: () => setOwnedParam('all') });
    }
    if (tier.length > 0) {
        appliedFilters.push({
            key: 'tier',
            label: `Tier: ${tier.map((filter) => LIVE_GROUP_LABELS[filter]).join(' + ')}`,
            remove: () => setTierParam([]),
        });
    }
    if (grades.length > 0) {
        appliedFilters.push({
            key: 'grade',
            label: `Grade: ${grades.map((grade) => grade[0]!.toUpperCase() + grade.slice(1)).join(' + ')}`,
            remove: () => setGradeParam([]),
        });
    }

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
        [moneyness, setMoneynessParam]
    );

    const cycleHalf = useCallback(() => setHalfParam(cycle(HALF_FILTERS, half)), [half, setHalfParam]);

    const cycleOwned = useCallback(() => setOwnedParam(cycle(OWNED_FILTERS, owned)), [owned, setOwnedParam]);

    const toggleTier = useCallback(
        (next: TierSelection) =>
            setTierParam(tier.includes(next) ? tier.filter((filter) => filter !== next) : [...tier, next]),
        [tier, setTierParam]
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

    const toggleAllGroups = useCallback(() => {
        const visible = groups.map((group) => group.id);
        setCollapsed((current) => (visible.some((id) => current.has(id)) ? new Set() : new Set(visible)));
    }, [groups]);

    useSignalShortcuts({
        onPreviousWeek: goPrevious,
        onNextWeek: goNext,
        onToggleTier: toggleTier,
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
        <SignalFilterControls
            numberSource={numberSource}
            expiry={expiry}
            moneyness={moneyness}
            half={half}
            owned={owned}
            tier={tier}
            symbol={symbol}
            symbolAriaLabel="Filter by symbol"
            symbolInputRef={symbolInputRef}
            onNumberSourceChange={setNumberSource}
            onExpiryChange={setExpiryParam}
            onMoneynessChange={setMoneynessParam}
            onHalfChange={setHalfParam}
            onOwnedChange={setOwnedParam}
            onTierChange={setTierParam}
            onSymbolChange={setSymbolParam}
            grades={grades}
            onGradesChange={setGradeParam}
        />
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
                        <Link className="summary-link" to="/summary" data-tip="Summary" aria-label="Summary">
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
                    data-tip="Reset filters"
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
                        onOpenTrade={openFromGrid}
                        currentWeek={data.isCurrentWeek}
                    />
                </>
            )}

            <TradeDetail
                trade={selectedTrade}
                numberSource={numberSource}
                onClose={closeDetail}
                reportDate={jumpedReportDate ?? selectedDay?.date ?? null}
                position={siblingIndex >= 0 ? `${siblingIndex + 1} of ${daySiblings.length}` : null}
                onPrevious={previousTrade}
                onNext={nextTrade}
                onOpenSignal={openSignal}
            />
        </main>
    );
}
