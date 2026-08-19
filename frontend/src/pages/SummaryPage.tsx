import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseSymbolList } from '@weboptions/shared';
import type { SignalMonth, SignalSummaryResponse } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchSignalMonths, fetchSignalSummary } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { SummaryTable } from '../summary/SummaryTable';
import { isTyping } from '../hooks/useWeekArrows';
import { ChevronDownIcon, CloseIcon } from '../components/icons';
import { Loading } from '../components/Loading';
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

export function SummaryPage() {
    const { forget } = useApiKey();
    const [params, setParams] = useSearchParams();
    const symbolsParam = params.get('symbols') ?? '';
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
    const inFlight = useRef(new Set<string>());

    const symbols = useMemo(() => parseSymbolList(symbolsParam), [symbolsParam]);
    // The filter is part of a month's identity, not something applied afterwards:
    // the server does the narrowing, so each filter has its own answer to cache.
    const cacheKey = useCallback((month: string) => `${month}|${symbols.join(',')}`, [symbols]);

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
                { replace: true },
            );
        }, 300);
        return () => clearTimeout(timer);
    }, [draft, symbolsParam, setParams]);

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
        for (const month of expanded) {
            const key = cacheKey(month);
            if (summaries[key] || failed.has(key) || inFlight.current.has(key)) continue;
            inFlight.current.add(key);
            fetchSignalSummary(month, symbols)
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
    }, [expanded, summaries, failed, symbols, cacheKey, forget]);

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

    const reset = useCallback(() => {
        setDraft('');
        setParams(
            (current) => {
                const updated = new URLSearchParams(current);
                updated.delete('symbols');
                return updated;
            },
            { replace: true },
        );
    }, [setParams]);

    useEffect(() => {
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
            if (isTyping(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === '/') {
                // Without this the slash lands in the box we just focused.
                event.preventDefault();
                filterInputRef.current?.focus();
                filterInputRef.current?.select();
            } else if (key === 'j') {
                event.preventDefault();
                toggleAllMonths();
            } else if (key === 'r') {
                event.preventDefault();
                reset();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleAllMonths, reset]);

    return (
        <main className="summary-page">
            <div className="page-head">
                <h1>Summary</h1>

                <div className={`symbol-filter${draft ? ' has-value' : ''}`}>
                    <input
                        type="text"
                        ref={filterInputRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') event.currentTarget.blur();
                        }}
                        placeholder="Filter by symbol"
                        aria-label="Filter by symbols, comma separated"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {draft && (
                        <button
                            type="button"
                            className="symbol-filter-clear"
                            onClick={reset}
                            aria-label="Clear the symbol filter"
                        >
                            <CloseIcon width={14} height={14} />
                        </button>
                    )}
                </div>
            </div>

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
                    const summary = summaries[key];
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
                            <div className="summary-month-body" id={bodyId} hidden={!open}>
                                {summary ? (
                                    <SummaryTable label={month.label} weeks={summary.weeks} total={summary.total} />
                                ) : failed.has(key) ? (
                                    <p className="summary-none">This month could not be loaded.</p>
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
