import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
    DEFAULT_NUMBER_SOURCE,
    STORAGE_KEYS,
    parseExpiryFilter,
    parseHalfFilter,
    parseMoneynessFilter,
    parseSymbolList,
} from '@weboptions/shared';
import type { ExpiryFilter, HalfFilter, MoneynessFilter, SignalMonth, SignalSummaryResponse } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchSignalMonths, fetchSignalSummary } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { SummaryTable } from '../summary/SummaryTable';
import { AppliedFilters, type AppliedFilter } from '../signals/AppliedFilters';
import { SignalFilterControls } from '../signals/SignalFilterControls';
import { EXPIRY_FILTERS, HALF_FILTERS, MONEYNESS_FILTERS, cycle } from '../signals/grouping';
import { useNumberSource } from '../signals/useNumberSource';
import { isTyping } from '../hooks/useWeekArrows';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useStoredFilters } from '../hooks/useStoredFilters';
import { ChevronDownIcon, RotateCcwIcon, SlidersIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import './SummaryPage.css';

/**
 * Every week that has ever had signals, a row each, against the risk groups.
 *
 * Months are fetched one at a time as they are opened rather than all at once:
 * the archive only grows, and a reader opening one month should not wait on the
 * rest of the year. Answers are kept per month AND per symbol filter, so
 * collapsing and reopening a month costs nothing and clearing the filter puts
 * the unfiltered numbers straight back.
 */

/** The month the reader is in, in the shape the index is keyed by. */
function currentMonth(now: Date = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Which month opens on arrival: the one we are in, or failing that the newest. */
function initialMonth(months: readonly SignalMonth[]): string[] {
    const here = currentMonth();
    if (months.some((month) => month.month === here)) return [here];
    const newest = months[0];
    return newest ? [newest.month] : [];
}

/** What the page keeps between visits, so a bare path opens where it was left. */
const SUMMARY_FILTER_PARAMS = ['symbols', 'expiry', 'moneyness', 'half'] as const;

export function SummaryPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const hydrated = useStoredFilters({ storageKey: STORAGE_KEYS.summaryFilters, keys: SUMMARY_FILTER_PARAMS });
    const symbolsParam = params.get('symbols') ?? '';
    const expiry = parseExpiryFilter(params.get('expiry'));
    const moneyness = parseMoneynessFilter(params.get('moneyness'));
    const half = parseHalfFilter(params.get('half'));
    const [numberSource, setNumberSource] = useNumberSource();
    const [draft, setDraft] = useState(symbolsParam);
    const [months, setMonths] = useState<SignalMonth[] | null>(null);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [summaries, setSummaries] = useState<Record<string, SignalSummaryResponse>>({});
    const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [firstMonth, setFirstMonth] = useState<string | null>(null);
    // The index and the month it opens arrive one after the other. Waiting for
    // both spends one spinner instead of two, so the page settles once.
    const [opening, setOpening] = useState(true);
    const filterInputRef = useRef<HTMLInputElement>(null);
    const filtersTriggerRef = useRef<HTMLButtonElement>(null);
    const filtersPanelRef = useRef<HTMLDivElement>(null);
    const phone = useMediaQuery('(max-width: 640px)');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const inFlight = useRef(new Set<string>());
    // A filter change gives every open month a new cache key, and dropping the
    // table for a spinner while the answer comes back rebuilds the page under
    // the reader. Each month keeps the numbers it last showed until then.
    const lastShown = useRef<Record<string, SignalSummaryResponse>>({});

    const symbols = useMemo(() => parseSymbolList(symbolsParam), [symbolsParam]);
    // Both filters are part of a month's identity, not something applied
    // afterwards: the server does the narrowing before the numbers are rolled
    // up, so each combination has its own answer to cache.
    const cacheKey = useCallback(
        (month: string) => `${month}|${symbols.join(',')}|${expiry}|${moneyness}|${half}|${numberSource}`,
        [symbols, expiry, moneyness, half, numberSource]
    );

    // Typing narrows the whole archive, so it waits for a pause rather than
    // asking the server again on every letter.
    useEffect(() => {
        if (draft === symbolsParam) return;
        const timer = setTimeout(() => {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    if (draft) updated.set('symbols', draft);
                    else updated.delete('symbols');
                    return updated;
                },
                { replace: true }
            );
        }, 300);
        return () => clearTimeout(timer);
    }, [draft, symbolsParam, setParams]);

    // The box is seeded once, so a restore or a back button landing on a
    // different symbol list afterwards has to be caught here. Typing never
    // reaches this: the param only catches up once the pause has passed, and by
    // then it already matches the draft.
    useEffect(() => {
        setDraft(symbolsParam);
    }, [symbolsParam]);

    useEffect(() => {
        let cancelled = false;
        fetchSignalMonths()
            .then((result) => {
                if (cancelled) return;
                const opens = initialMonth(result.months);
                setMonths(result.months);
                setExpanded(new Set(opens));
                setFirstMonth(opens[0] ?? null);
                if (opens.length === 0) setOpening(false);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                setOpening(false);
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(describeFailure(cause));
            });
        return () => {
            cancelled = true;
        };
    }, [forget]);

    useEffect(() => {
        if (!opening || !firstMonth) return;
        const key = cacheKey(firstMonth);
        if (summaries[key] || failed.has(key)) setOpening(false);
    }, [opening, firstMonth, cacheKey, summaries, failed]);

    // No cancellation flag here on purpose. This effect reruns whenever ANY
    // month resolves, and a flag captured per run would disown the requests the
    // earlier run had started — with several months open, changing the filter
    // refetches them all and every one but the first would spin forever. The
    // cache key already makes a late answer harmless: it is filed under the
    // filter it was asked for, and only the current filter is ever read.
    useEffect(() => {
        // The stored filters are part of a month's cache key, so nothing is
        // asked for until the URL has them.
        if (!hydrated) return;
        for (const month of expanded) {
            const key = cacheKey(month);
            if (summaries[key] || failed.has(key) || inFlight.current.has(key)) continue;
            inFlight.current.add(key);
            fetchSignalSummary(month, { symbols, expiry, moneyness, half, owned: 'all', numberSource })
                .then((result) => {
                    setSummaries((current) => ({ ...current, [key]: result }));
                })
                .catch((cause: Error) => {
                    if (cause instanceof UnauthorizedError) {
                        forget();
                        return;
                    }
                    setError(describeFailure(cause));
                    setFailed((current) => new Set(current).add(key));
                })
                .finally(() => {
                    inFlight.current.delete(key);
                });
        }
    }, [hydrated, expanded, summaries, failed, symbols, expiry, moneyness, half, numberSource, cacheKey, forget]);

    const toggleMonth = useCallback((month: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(month)) next.add(month);
            return next;
        });
    }, []);

    const toggleAllMonths = useCallback(() => {
        const all = (months ?? []).map((month) => month.month);
        setExpanded((current) => (all.some((month) => current.has(month)) ? new Set() : new Set(all)));
    }, [months]);

    const setExpiry = useCallback(
        (next: ExpiryFilter) => {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    if (next === 'all') updated.delete('expiry');
                    else updated.set('expiry', next);
                    return updated;
                },
                { replace: true }
            );
        },
        [setParams]
    );

    const setFilterParam = useCallback(
        (name: 'moneyness' | 'half', next: string) => {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    if (next === 'all') updated.delete(name);
                    else updated.set(name, next);
                    return updated;
                },
                { replace: true }
            );
        },
        [setParams]
    );

    const clearSymbols = useCallback(() => {
        setDraft('');
        setParams(
            (current) => {
                const updated = new URLSearchParams(current);
                updated.delete('symbols');
                return updated;
            },
            { replace: true }
        );
    }, [setParams]);

    // The shortcut clears the whole head, where the cross clears only its own box.
    const reset = useCallback(() => {
        setDraft('');
        setNumberSource(DEFAULT_NUMBER_SOURCE);
        setParams(
            (current) => {
                const updated = new URLSearchParams(current);
                updated.delete('symbols');
                updated.delete('expiry');
                updated.delete('moneyness');
                updated.delete('half');
                updated.delete('owned');
                return updated;
            },
            { replace: true }
        );
    }, [setNumberSource, setParams]);

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

    const focusSymbolFilter = useCallback(() => {
        flushSync(() => setFiltersOpen(true));
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
    }, []);

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === '/') {
                // Without this the slash lands in the box we just focused.
                event.preventDefault();
                focusSymbolFilter();
            } else if (key === 'j') {
                event.preventDefault();
                toggleAllMonths();
            } else if (key === 'e') {
                event.preventDefault();
                setExpiry(cycle(EXPIRY_FILTERS, expiry));
            } else if (key === 'm') {
                event.preventDefault();
                setFilterParam('moneyness', cycle(MONEYNESS_FILTERS, moneyness));
            } else if (key === 'o') {
                event.preventDefault();
                setFilterParam('half', cycle(HALF_FILTERS, half));
            } else if (key === 'f') {
                event.preventDefault();
                setFiltersOpen((open) => !open);
            } else if (key === 'r') {
                event.preventDefault();
                reset();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleAllMonths, reset, setExpiry, expiry, moneyness, half, setFilterParam, focusSymbolFilter]);

    const atDefaults =
        symbolsParam.trim() === '' &&
        expiry === 'all' &&
        moneyness === 'all' &&
        half === 'all' &&
        numberSource === DEFAULT_NUMBER_SOURCE;
    const activeFilterCount =
        (symbolsParam.trim() ? 1 : 0) +
        (expiry !== 'all' ? 1 : 0) +
        (moneyness !== 'all' ? 1 : 0) +
        (half !== 'all' ? 1 : 0);

    const appliedFilters: AppliedFilter[] = [];
    if (symbolsParam.trim()) {
        appliedFilters.push({ key: 'symbols', label: `Symbols: ${symbolsParam.trim()}`, remove: clearSymbols });
    }
    if (expiry !== 'all') {
        appliedFilters.push({ key: 'expiry', label: `Expiry: ${expiry}`, remove: () => setExpiry('all') });
    }
    if (moneyness !== 'all') {
        appliedFilters.push({
            key: 'moneyness',
            label: `Moneyness: ${moneyness.toUpperCase()}`,
            remove: () => setFilterParam('moneyness', 'all'),
        });
    }
    if (half !== 'all') {
        appliedFilters.push({
            key: 'half',
            label: `Half: ${half === 'yes' ? 'Yes' : 'No'}`,
            remove: () => setFilterParam('half', 'all'),
        });
    }

    const filterControls = (
        <SignalFilterControls
            numberSource={numberSource}
            expiry={expiry}
            moneyness={moneyness}
            half={half}
            symbol={draft}
            symbolInputRef={filterInputRef}
            clearSymbolAriaLabel="Clear the symbol filter"
            onNumberSourceChange={setNumberSource}
            onExpiryChange={setExpiry}
            onMoneynessChange={(next: MoneynessFilter) => setFilterParam('moneyness', next)}
            onHalfChange={(next: HalfFilter) => setFilterParam('half', next)}
            onSymbolChange={(next) => {
                setDraft(next);
                if (next === '') clearSymbols();
            }}
        />
    );

    return (
        <main className="summary-page">
            <div className="page-head">
                <h1>Summary</h1>

                <button
                    type="button"
                    className={`menus-reset${atDefaults ? ' is-idle' : ''}`}
                    onClick={reset}
                    disabled={atDefaults}
                    aria-hidden={atDefaults || undefined}
                    tabIndex={atDefaults ? -1 : undefined}
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
                    aria-controls="summary-filters"
                    onClick={() => setFiltersOpen((open) => !open)}
                >
                    <SlidersIcon width={15} height={15} />
                    <span>{activeFilterCount ? `Filters · ${activeFilterCount}` : 'Filters'}</span>
                    <ChevronDownIcon width={14} height={14} className={filtersOpen ? 'rotated' : ''} />
                </button>

                {!phone && filtersOpen && (
                    <div
                        className="filter-bar"
                        id="summary-filters"
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
                        <div className="filter-bar" id="summary-filters">
                            {filterControls}
                        </div>
                    </Modal>
                )}
            </div>

            <AppliedFilters filters={appliedFilters} className="summary-applied-filters" />

            {error && (
                <p className="signals-error" role="alert">
                    {error}
                </p>
            )}

            {opening && <Loading />}

            {!opening && months?.length === 0 && !error && (
                <p className="summary-none enter">No signals have been recorded yet.</p>
            )}

            {!opening &&
                months?.map((month) => {
                    const key = cacheKey(month.month);
                    const open = expanded.has(month.month);
                    const fresh = summaries[key];
                    if (fresh) lastShown.current[month.month] = fresh;
                    const stale = fresh ? undefined : lastShown.current[month.month];
                    const summary = fresh ?? stale;
                    const bodyId = `summary-month-${month.month}`;
                    return (
                        <section className="summary-month enter" key={month.month}>
                            <button
                                type="button"
                                className="summary-month-head"
                                aria-expanded={open}
                                aria-controls={bodyId}
                                onClick={() => toggleMonth(month.month)}
                            >
                                <ChevronDownIcon width={16} height={16} className={open ? 'is-open' : ''} />
                                <span className="summary-month-name">{month.label}</span>
                                <span className="summary-month-count">
                                    {month.weekStarts.length} {month.weekStarts.length === 1 ? 'week' : 'weeks'}
                                </span>
                            </button>
                            <div
                                className={`summary-month-body${stale ? ' is-stale' : ''}`}
                                id={bodyId}
                                hidden={!open}
                                aria-busy={stale ? true : undefined}
                            >
                                {failed.has(key) && !fresh ? (
                                    <p className="summary-none">This month could not be loaded.</p>
                                ) : summary ? (
                                    <SummaryTable
                                        label={month.label}
                                        weeks={summary.weeks}
                                        total={summary.total}
                                        numberSource={numberSource}
                                    />
                                ) : (
                                    <Loading />
                                )}
                            </div>
                        </section>
                    );
                })}
        </main>
    );
}
