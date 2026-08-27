import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import type { OwnedOptionPosition, UnderlyingQuote } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchOwnedContracts, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import {
    ArrowDownNarrowWideIcon,
    ArrowUpNarrowWideIcon,
    ChevronDownIcon,
    CloseIcon,
    FlaskConicalIcon,
    RotateCcwIcon,
    SlidersIcon,
    TrendingDownIcon,
    TrendingUpIcon,
    ZapIcon,
} from '../components/icons';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { isTyping } from '../hooks/useWeekArrows';
import { clearOwnedCache, readOwnedCache, writeOwnedCache } from '../owned/cache';
import {
    CAPTURED_FILTERS,
    CAPTURED_LABELS,
    annualizedReturn,
    deltaBand,
    filterOwnedPositions,
    parseLocalDate,
    readCapturedFilter,
    strikeCushion,
    type CapturedFilter,
} from '../owned/filters';
import { applyPriceSource, readPriceSource, writePriceSource, type PriceSource } from '../owned/priceSource';
import { OwnedPriceSourceMenu } from '../owned/PriceSourceMenu';
import { quoteIssue, quoteSourceLabel } from '../owned/quoteStatus';
import { mergeRoster } from '../owned/roster';
import { OwnedSortMenu } from '../owned/SortMenu';
import {
    OWNED_SORT_LABELS,
    readOwnedSort,
    sortOwnedPositions,
    writeOwnedSort,
    type OwnedSortState,
} from '../owned/sort';
import { signalFor, signalKey, type SignalMap, type SignalMatch } from '../owned/types';
import { CapturedFilterMenu, MoneynessFilterMenu } from '../signals/FilterMenu';
import { EMPTY, formatDelta } from '../signals/format';
import { MONEYNESS_FILTERS, cycle, readMoneynessFilter, type MoneynessFilter } from '../signals/grouping';
import './OwnedContractsPage.css';

function currency(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return EMPTY;
    return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function money(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return EMPTY;
    return value.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function percent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return EMPTY;
    return `${value.toFixed(1)}%`;
}

function signedPercent(value: number | null, fractionDigits = 1): string {
    if (value === null || !Number.isFinite(value)) return EMPTY;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(fractionDigits)}%`;
}

function twoDigits(value: number): string {
    return String(value).padStart(2, '0');
}

function numericDate(date: Date): string {
    return `${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}/${date.getFullYear()}`;
}

function dateText(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? EMPTY;
    return numericDate(date);
}

function timestampText(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? EMPTY;
    return `${numericDate(date)} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function shortDate(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? EMPTY;
    return numericDate(date);
}

function contractLabel(position: OwnedOptionPosition): string {
    return `$${position.strikePrice.toFixed(2)}${position.putCall}`;
}

function toneFor(value: number | null): 'good' | 'bad' | 'flat' {
    if (value === null || value === 0) return 'flat';
    return value > 0 ? 'good' : 'bad';
}

function SourceIcon({ position }: { position: OwnedOptionPosition }) {
    return position.isPaper ? <FlaskConicalIcon width={14} height={14} /> : <ZapIcon width={14} height={14} />;
}

function ownershipLabel(position: OwnedOptionPosition): string {
    return position.isPaper ? 'Paper owned contract' : 'Live owned contract';
}

function weekStart(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

function signalUrl(position: OwnedOptionPosition): string {
    const params = new URLSearchParams({ week: weekStart(position.transactionDate), symbol: position.symbol });
    return `/?${params.toString()}`;
}

function underlyingPrice(position: OwnedOptionPosition, signal: SignalMatch | undefined): number | null {
    return position.underlyingPrice ?? signal?.trade.closeUnderlying ?? signal?.trade.actualUnderlying ?? null;
}

interface UnderlyingSnapshot {
    price: string;
    move: string | null;
    moveTone: 'good' | 'bad' | 'flat';
}

/**
 * The percentage is today's move, so it comes from the live quote or not at all.
 * Without one the signal-day price still shows, but bare: the move it implies is
 * the drift since the signal, which is a different number wearing the same badge.
 */
function underlyingSnapshot(
    position: OwnedOptionPosition,
    signal: SignalMatch | undefined,
    quote: UnderlyingQuote | undefined,
): UnderlyingSnapshot | null {
    if (quote) {
        const change = quote.changePct;
        return {
            price: money(quote.price),
            move: change === null ? null : signedPercent(change, 2),
            moveTone: change === null || change === 0 ? 'flat' : change < 0 ? 'bad' : 'good',
        };
    }
    const current = underlyingPrice(position, signal);
    return current === null ? null : { price: money(current), move: null, moveTone: 'good' };
}

function moneynessText(position: OwnedOptionPosition, signal: SignalMatch | undefined): string | null {
    const moneyness = position.moneyness ?? signal?.trade.moneyness;
    if (!moneyness) return null;
    return moneyness.toUpperCase();
}

function strikeCushionText(position: OwnedOptionPosition, signal: SignalMatch | undefined): string {
    const cushion = strikeCushion(position, signal);
    return cushion === null ? EMPTY : signedPercent(cushion);
}

function strikeCushionTone(position: OwnedOptionPosition, signal: SignalMatch | undefined): string {
    const cushion = strikeCushion(position, signal);
    if (cushion === null) return 'quiet';
    return cushion < 0 ? 'bad' : 'good';
}

/** The chosen source has already been written into the quote by this point. */
function quotePrice(position: OwnedOptionPosition): number | null {
    return position.quote.midPrice ?? position.quote.bid ?? position.quote.ask;
}

function entryMarkText(position: OwnedOptionPosition): string {
    return `${money(position.optionPrice)} / ${money(quotePrice(position))}`;
}

function annualizedReturnText(position: OwnedOptionPosition): string {
    return percent(annualizedReturn(position));
}

function expirationRiskText(position: OwnedOptionPosition): string | null {
    if (position.expirationBucket === 'expired') return 'EXPIRED';
    if (position.expirationBucket === 'this_week') return 'THIS WEEK';
    return null;
}

function capturedPercent(position: OwnedOptionPosition): number | null {
    if (position.unrealizedCreditCapturedPct !== null) return position.unrealizedCreditCapturedPct;
    if (position.estimatedBuybackCost === null || position.entryCredit <= 0) return null;
    return ((position.entryCredit - position.estimatedBuybackCost) / position.entryCredit) * 100;
}

function exitTargetText(position: OwnedOptionPosition): string {
    const captured = capturedPercent(position);
    if (captured === null) return EMPTY;
    const nextTarget = [25, 50, 75].find((target) => captured < target);
    if (nextTarget === undefined) return 'Past 75%';
    const shares = position.contracts * 100;
    if (shares <= 0 || position.entryCredit <= 0) return EMPTY;
    return `${nextTarget}% @ ${money((position.entryCredit * (1 - nextTarget / 100)) / shares)}`;
}

export function OwnedContractsPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const symbol = params.get('symbol') ?? '';
    const moneynessFilter = readMoneynessFilter(params.get('moneyness'));
    const capturedFilter = readCapturedFilter(params.get('captured'));
    // The sort and the price source are reading preferences rather than views
    // worth sharing, so they live in local storage instead of the URL.
    const [sort, setSortState] = useState<OwnedSortState>(readOwnedSort);
    const [priceSource, setPriceSourceState] = useState<PriceSource>(readPriceSource);
    const [cached] = useState(readOwnedCache);
    const [positions, setPositions] = useState<OwnedOptionPosition[] | null>(cached?.response.positions ?? null);
    const [underlyings, setUnderlyings] = useState<Record<string, UnderlyingQuote>>(cached?.response.underlyings ?? {});
    const [generatedAt, setGeneratedAt] = useState<string | null>(cached?.response.generatedAt ?? null);
    const [signals, setSignals] = useState<SignalMap>(() => cached?.signals ?? new Map());
    const [fromCache, setFromCache] = useState(cached !== null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(cached === null);
    const [refreshing, setRefreshing] = useState(false);
    // Refreshing is manual, so a second load can start while the first is still
    // settling. Only the newest may publish, or the signals and the cache drift.
    const latestLoad = useRef(0);
    // Only a phone folds the filters away, and it opens them closed.
    const phone = useMediaQuery('(max-width: 640px)');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const symbolInputRef = useRef<HTMLInputElement>(null);
    const filtersTriggerRef = useRef<HTMLButtonElement>(null);
    const filtersPanelRef = useRef<HTMLDivElement>(null);

    const load = useCallback(
        (mode: 'initial' | 'refresh' | 'roster') => {
            const id = ++latestLoad.current;
            if (mode === 'initial') setLoading(true);
            else if (mode === 'refresh') setRefreshing(true);
            setError(null);
            fetchOwnedContracts(mode === 'refresh')
                .then(async (result) => {
                    if (id !== latestLoad.current) return;
                    // A roster load settles which contracts are open and nothing else,
                    // so what the reader is reading only moves when they ask it to.
                    const prior = mode === 'roster' ? cached : null;
                    const next =
                        prior === null ? result.positions : mergeRoster(prior.response.positions, result.positions);
                    setPositions(next);
                    if (prior === null) {
                        setUnderlyings(result.underlyings);
                        setGeneratedAt(result.generatedAt);
                        setFromCache(false);
                    }
                    // The rows are worth reading before the signals that annotate them.
                    setLoading(false);
                    const weeks = [...new Set(next.map((position) => weekStart(position.transactionDate)))];
                    const responses = await Promise.allSettled(weeks.map((week) => fetchWeekSignals(week)));
                    if (id !== latestLoad.current) return;
                    const matches = new Map<string, SignalMatch>();
                    responses.forEach((response) => {
                        if (response.status !== 'fulfilled') return;
                        response.value.days.forEach((day) => {
                            day.trades.forEach((trade) => {
                                if (trade.strike === null || trade.expiration === null) return;
                                matches.set(signalKey(day.date, trade.symbol, trade.strike, trade.expiration), {
                                    trade,
                                    reportDate: day.date,
                                });
                            });
                        });
                    });
                    setSignals(matches);
                    writeOwnedCache(prior === null ? result : { ...prior.response, positions: next }, matches);
                })
                .catch((cause: Error) => {
                    if (id !== latestLoad.current) return;
                    if (cause instanceof UnauthorizedError) {
                        clearOwnedCache();
                        forget();
                        return;
                    }
                    setError(describeFailure(cause));
                })
                .finally(() => {
                    if (id !== latestLoad.current) return;
                    if (mode === 'initial') setLoading(false);
                    else if (mode === 'refresh') setRefreshing(false);
                });
        },
        [cached, forget],
    );

    useEffect(() => {
        // The cache is held for the life of the component, so this always reads the
        // roster against what was painted rather than against its own last answer.
        load(cached === null ? 'initial' : 'roster');
    }, [cached, load]);

    const setSort = useCallback((next: OwnedSortState) => {
        setSortState(next);
        writeOwnedSort(next);
    }, []);

    const setPriceSource = useCallback((next: PriceSource) => {
        setPriceSourceState(next);
        writePriceSource(next);
    }, []);

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

    const setCapturedParam = useCallback(
        (next: CapturedFilter) => {
            setParams((current) => {
                const updated = new URLSearchParams(current);
                if (next === 'all') updated.delete('captured');
                else updated.set('captured', next);
                return updated;
            });
        },
        [setParams],
    );

    // Both filters live in the URL, so they clear in one write rather than two
    // history entries that each undo half of it.
    const resetMenus = useCallback(() => {
        setParams((current) => {
            const updated = new URLSearchParams(current);
            updated.delete('symbol');
            updated.delete('moneyness');
            updated.delete('captured');
            return updated;
        });
    }, [setParams]);

    const atMenuDefaults = symbol.trim() === '' && moneynessFilter === 'all' && capturedFilter === 'all';
    const activeFilterCount =
        (symbol.trim() !== '' ? 1 : 0) + (moneynessFilter !== 'all' ? 1 : 0) + (capturedFilter !== 'all' ? 1 : 0);

    // The trigger only counts them, and the panel is shut most of the time, so
    // what is narrowing the list is said outside both.
    const appliedFilters = useMemo(() => {
        const applied: { key: string; label: string; clear: () => void }[] = [];
        if (symbol.trim() !== '') {
            applied.push({ key: 'symbol', label: symbol.trim(), clear: () => setSymbolParam('') });
        }
        if (moneynessFilter !== 'all') {
            applied.push({
                key: 'moneyness',
                label: moneynessFilter.toUpperCase(),
                clear: () => setMoneynessParam('all'),
            });
        }
        if (capturedFilter !== 'all') {
            applied.push({
                key: 'captured',
                label: `Captured ${CAPTURED_LABELS[capturedFilter]}`,
                clear: () => setCapturedParam('all'),
            });
        }
        return applied;
    }, [capturedFilter, moneynessFilter, setCapturedParam, setMoneynessParam, setSymbolParam, symbol]);

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

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;
            if (event.shiftKey && event.key === 'R') {
                if (priceSource !== 'live' || loading || refreshing) return;
                event.preventDefault();
                load('refresh');
                return;
            }
            if (event.key === '/') {
                event.preventDefault();
                // Nothing hidden can take the caret, so the fold is opened in the
                // DOM before the focus is aimed at it.
                flushSync(() => setFiltersOpen(true));
                symbolInputRef.current?.focus();
                symbolInputRef.current?.select();
                return;
            }
            if (event.key === 'f') setFiltersOpen((open) => !open);
            else if (event.key === 'm') setMoneynessParam(cycle(MONEYNESS_FILTERS, moneynessFilter));
            else if (event.key === 'c') setCapturedParam(cycle(CAPTURED_FILTERS, capturedFilter));
            else if (!event.shiftKey && event.key === 'r') resetMenus();
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [
        capturedFilter,
        load,
        loading,
        moneynessFilter,
        priceSource,
        refreshing,
        resetMenus,
        setCapturedParam,
        setMoneynessParam,
    ]);

    // Everything downstream — the filters, the order, the totals and the rows —
    // reads one projection, so none of them has to know which source is on.
    const sourced = useMemo(
        () => applyPriceSource(positions ?? [], priceSource, underlyings),
        [positions, priceSource, underlyings],
    );

    // Stored prices are cached by definition, whether they were read back from the
    // browser or pulled with the payload.
    const showCacheBadge = fromCache || priceSource === 'eod';

    const visible = useMemo(
        () =>
            sortOwnedPositions(
                filterOwnedPositions(sourced, signals, {
                    symbol,
                    moneyness: moneynessFilter,
                    captured: capturedFilter,
                }),
                signals,
                sort,
            ),
        [capturedFilter, moneynessFilter, signals, sort, sourced, symbol],
    );

    const summary = useMemo(() => {
        const rows = visible;
        const live = rows.filter((row) => !row.isPaper);
        const paper = rows.filter((row) => row.isPaper);
        const collateral = rows.reduce((sum, row) => sum + row.collateralAtStrike, 0);
        const credit = rows.reduce((sum, row) => sum + row.entryCredit, 0);
        const captured = rows.reduce((sum, row) => sum + (row.unrealizedCreditCaptured ?? 0), 0);
        // What the page as a whole is showing, so a row only says anything when
        // it is the odd one out.
        const quoteSource: 'Live' | 'Cached' =
            rows.length > 0 && rows.every((row) => quoteSourceLabel(row, fromCache) === 'Cached') ? 'Cached' : 'Live';
        return {
            total: rows.length,
            live: live.length,
            paper: paper.length,
            collateral,
            credit,
            captured,
            quoteSource,
        };
    }, [fromCache, visible]);

    const filterControls = (
        <>
            <div className="filter-section owned-filter-sort">
                <h2>Sort</h2>
                <OwnedSortMenu value={sort} onChange={setSort} />
            </div>
            <div className="filter-section owned-filter-moneyness">
                <h2>Contract</h2>
                <MoneynessFilterMenu value={moneynessFilter} onChange={setMoneynessParam} />
            </div>
            <div className="filter-section owned-filter-captured">
                <h2>Captured</h2>
                <CapturedFilterMenu value={capturedFilter} onChange={setCapturedParam} />
            </div>
            <div className="filter-section owned-filter-symbol">
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
        <main className="owned-contracts-page enter">
            <header className="page-head owned-contracts-head">
                <div className="owned-contracts-title">
                    <h1>Owned Contracts</h1>
                    <p className="owned-contracts-subtitle">
                        {generatedAt ? `Updated ${timestampText(generatedAt)}` : 'Current open positions'}
                        <span
                            className={showCacheBadge ? 'owned-cache-badge' : 'owned-cache-badge is-idle'}
                            aria-hidden={!showCacheBadge}
                        >
                            Cached
                        </span>
                    </p>
                </div>

                <div className="owned-quote-controls">
                    {phone ? <OwnedPriceSourceMenu value={priceSource} onChange={setPriceSource} /> : null}
                    {/* Refreshing repulls the live quote, so it is offered to the mode
                        that reads one. Hidden rather than removed: the head keeps the
                        width it had, and the controls beside it stay where they were. */}
                    <button
                        type="button"
                        className={`owned-refresh-button${priceSource === 'live' ? '' : ' is-idle'}`}
                        onClick={() => load('refresh')}
                        disabled={priceSource !== 'live' || loading || refreshing}
                        aria-hidden={priceSource === 'live' ? undefined : true}
                        tabIndex={priceSource === 'live' ? undefined : -1}
                        title="Refresh owned contracts"
                    >
                        <RotateCcwIcon width={14} height={14} aria-hidden="true" />
                        {refreshing ? 'Refreshing' : 'Refresh'}
                    </button>
                </div>

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

                <button
                    type="button"
                    ref={filtersTriggerRef}
                    className={`filters-toggle${activeFilterCount > 0 ? ' narrowed' : ''}`}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    aria-controls="owned-filters"
                    onClick={() => setFiltersOpen((open) => !open)}
                >
                    <SlidersIcon width={15} height={15} />
                    <span>{activeFilterCount ? `Sort & Filter · ${activeFilterCount}` : 'Sort & Filter'}</span>
                    <ChevronDownIcon width={14} height={14} className={filtersOpen ? 'rotated' : ''} />
                </button>

                {!phone && filtersOpen && (
                    <div
                        className="filter-bar"
                        id="owned-filters"
                        ref={filtersPanelRef}
                        role="dialog"
                        aria-label="Sort and filter"
                    >
                        {filterControls}
                    </div>
                )}

                {phone && (
                    <Modal
                        open={filtersOpen}
                        title="Sort & Filter"
                        onClose={() => setFiltersOpen(false)}
                        className="owned-filters-modal"
                    >
                        <div className="filter-bar" id="owned-filters">
                            {filterControls}
                        </div>
                    </Modal>
                )}
            </header>

            {error ? (
                <p role="alert" className="error-banner">
                    {error}
                </p>
            ) : null}

            {loading ? <Loading label="Loading owned contracts" /> : null}

            {loading ? null : (
                <>
                    {/* Always present: the order is a fact about the list even when
                        nothing is narrowing it, and a row that comes and goes would
                        move the totals under it. */}
                    <div className="owned-applied-filters" aria-label="Sort and applied filters">
                        {/* Which prices are on reads as a property of the list, so it is
                            chosen here rather than from behind the filter trigger. */}
                        {phone ? null : <OwnedPriceSourceMenu value={priceSource} onChange={setPriceSource} />}
                        <span
                            className="owned-sort-chip"
                            aria-label={`Sorted by ${OWNED_SORT_LABELS[sort.key]}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
                        >
                            {sort.direction === 'asc' ? (
                                <ArrowDownNarrowWideIcon width={13} height={13} aria-hidden="true" />
                            ) : (
                                <ArrowUpNarrowWideIcon width={13} height={13} aria-hidden="true" />
                            )}
                            <span>{OWNED_SORT_LABELS[sort.key]}</span>
                        </span>
                        {appliedFilters.map((filter) => (
                            <button
                                key={filter.key}
                                type="button"
                                className="owned-applied-filter"
                                onClick={filter.clear}
                                aria-label={`Clear ${filter.label} filter`}
                                title={`Clear ${filter.label} filter`}
                            >
                                <span>{filter.label}</span>
                                <CloseIcon width={12} height={12} />
                            </button>
                        ))}
                    </div>

                    <section className="owned-contracts-metrics" aria-label="Owned contract totals">
                        <Metric label="Contracts" value={String(summary.total)} />
                        <Metric label="Live" value={String(summary.live)} />
                        <Metric label="Paper" value={String(summary.paper)} />
                        <Metric label="Collateral" value={currency(summary.collateral)} />
                        <Metric label="Entry credit" value={currency(summary.credit)} />
                        <Metric
                            label="Open P/L"
                            value={currency(summary.captured)}
                            tone={summary.captured < 0 ? 'bad' : 'good'}
                        />
                    </section>

                    {positions && positions.length === 0 ? (
                        <p className="summary-none">No open owned contracts.</p>
                    ) : null}

                    {positions && positions.length > 0 && visible.length === 0 ? (
                        <p className="summary-none">No contracts match these filters.</p>
                    ) : null}

                    <section
                        className={refreshing ? 'owned-contract-list is-stale' : 'owned-contract-list'}
                        aria-busy={refreshing}
                    >
                        {visible.map((position) => (
                            <OwnedContractRow
                                key={`${position.isPaper ? 'paper' : 'live'}-${position.id}`}
                                position={position}
                                quoteSource={quoteSourceLabel(position, fromCache)}
                                pageQuoteSource={summary.quoteSource}
                                showQuoteIssue={priceSource === 'live'}
                                underlying={underlyings[position.symbol]}
                                signal={signalFor(signals, position)}
                            />
                        ))}
                    </section>
                </>
            )}
        </main>
    );
}

function OwnedContractRow({
    position,
    quoteSource,
    pageQuoteSource,
    showQuoteIssue,
    underlying: quote,
    signal,
}: {
    position: OwnedOptionPosition;
    quoteSource: 'Live' | 'Cached';
    pageQuoteSource: 'Live' | 'Cached';
    showQuoteIssue: boolean;
    underlying: UnderlyingQuote | undefined;
    signal: SignalMatch | undefined;
}) {
    const underlying = underlyingSnapshot(position, signal, quote);
    const expirationRisk = expirationRiskText(position);
    const moneyness = moneynessText(position, signal);
    const delta = deltaBand(position.quote.delta);
    const issue = showQuoteIssue ? quoteIssue(position) : null;
    return (
        <article className={`owned-contract-row is-${toneFor(position.unrealizedCreditCaptured)}`}>
            <div className="owned-contract-identity">
                <div className="owned-contract-title">
                    <span
                        className={position.isPaper ? 'owned-contract-source is-paper' : 'owned-contract-source'}
                        title={ownershipLabel(position)}
                    >
                        <SourceIcon position={position} />
                        <span className="sr-only">{ownershipLabel(position)}</span>
                    </span>
                    <span className="owned-contract-symbol">{position.symbol}</span>
                    <a className="owned-contract-contract" href={signalUrl(position)} title="Open original signal">
                        <span className="owned-contract-contract-label">{contractLabel(position)}</span>
                        {underlying ? (
                            <span className="owned-contract-current-price">
                                ({underlying.price}
                                {underlying.move ? (
                                    <>
                                        {', '}
                                        <span className={`owned-contract-move is-${underlying.moveTone}`}>
                                            {underlying.moveTone === 'good' ? (
                                                <TrendingUpIcon width={12} height={12} aria-hidden="true" />
                                            ) : null}
                                            {underlying.moveTone === 'bad' ? (
                                                <TrendingDownIcon width={12} height={12} aria-hidden="true" />
                                            ) : null}
                                            {underlying.move}
                                        </span>
                                    </>
                                ) : null}
                                )
                            </span>
                        ) : null}
                    </a>
                </div>
                <div className="owned-contract-subline">
                    <span>Exp {shortDate(position.expirationDate)}</span>
                    <span>{position.dte === null ? EMPTY : `${position.dte} DTE`}</span>
                    {expirationRisk ? <span className="owned-contract-expiration-risk">{expirationRisk}</span> : null}
                </div>
                <MetricLine
                    className="owned-contract-identity-metric"
                    label="Annualized"
                    value={annualizedReturnText(position)}
                />
                <MetricLine className="owned-contract-identity-metric" label="Exit" value={exitTargetText(position)} />
            </div>
            <div className="owned-contract-number is-quiet">
                <span>Qty</span>
                <strong>{position.contracts}</strong>
            </div>
            <div className="owned-contract-price-stack">
                <MetricLine label="Entry / Mark" value={entryMarkText(position)} />
            </div>
            <div className={`owned-contract-number is-${toneFor(position.unrealizedCreditCapturedPct)}`}>
                <span>Captured</span>
                <strong>{percent(position.unrealizedCreditCapturedPct)}</strong>
            </div>
            <div className={`owned-contract-number is-${toneFor(position.unrealizedCreditCaptured)}`}>
                <span>Open P/L</span>
                <strong>{currency(position.unrealizedCreditCaptured)}</strong>
            </div>
            <div className={`owned-contract-number is-${strikeCushionTone(position, signal)}`}>
                <span>Cushion</span>
                <strong>{strikeCushionText(position, signal)}</strong>
            </div>
            <div className="owned-contract-price-stack is-meta">
                <div className="owned-contract-delta-row">
                    <div className="owned-contract-delta-metric">
                        <span>Delta</span>
                        <strong className={delta ? `is-${delta}` : undefined}>
                            {formatDelta(position.quote.delta)}
                        </strong>
                    </div>
                    {quoteSource === pageQuoteSource ? null : <span className="owned-quote-status">{quoteSource}</span>}
                    <span
                        className={issue ? 'owned-quote-issue' : 'owned-quote-issue is-idle'}
                        aria-hidden={issue === null}
                        title={issue ?? undefined}
                    >
                        {issue ?? 'Live quote unavailable'}
                    </span>
                </div>
            </div>
            <div className="owned-contract-meta">
                <div className="owned-contract-account-details">
                    <span>{position.accountName ?? EMPTY}</span>
                    <span>Opened {dateText(position.transactionDate)}</span>
                </div>
                <span
                    className={
                        moneyness
                            ? `moneyness ${position.moneyness ?? signal?.trade.moneyness ?? ''} owned-contract-moneyness enter`
                            : 'moneyness owned-contract-moneyness is-idle'
                    }
                    aria-hidden={moneyness === null}
                >
                    {/* The signal can land after the row, so the slot holds its width meanwhile. */}
                    {moneyness ?? 'OTM'}
                </span>
            </div>
        </article>
    );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
    return (
        <div className={tone ? `owned-contract-metric is-${tone}` : 'owned-contract-metric'}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function MetricLine({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={className}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}
