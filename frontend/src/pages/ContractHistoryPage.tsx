import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GROUP_LABELS, TIER_ORDER, hasExpired } from '@weboptions/shared';
import type { ContractSearchResponse, GroupId, HistoryContract, HistoryResponse } from '@weboptions/shared';
import { UnauthorizedError } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { ChevronFirstIcon, ChevronLastIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { SignalDatePicker } from '../components/SignalDatePicker';
import { TierFilterMenu } from '../signals/FilterMenu';
import { SELECTABLE_TIER_FILTERS, type TierSelection } from '../signals/grouping';
import { seekingAlphaUrl, tradeContext, tradingViewUrl, withContext } from '../signals/researchLinks';
import { getContractHistory, getHistoryDates, searchHistoryContracts } from '../history/api';
import { HistoryAnalysisSummary, HistoryAnalysisTargetControl, type TargetChoice } from '../history/HistoryAnalysis';
import {
    HistoryChartControls,
    HistoryCharts,
    HistoryViewSwitch,
    type ChartMetric,
    type ChartView,
} from '../history/HistoryCharts';
import {
    changeSummary,
    deltaText,
    money,
    pacificTime,
    premiumCaptured,
    sessionLabel,
    signedDelta,
    signedMoney,
    standardSpan,
    isExcludedCapture,
} from '../history/format';
import './ContractHistoryPage.css';
import '../components/SiteMarks.css';

const tierLabel = (tier: string) => GROUP_LABELS[tier as GroupId] ?? 'Other';
const GROUP_ORDER: readonly string[] = ['top-picks', ...TIER_ORDER, 'other'];
const groupOf = (item: HistoryContract) =>
    item.topPick ? 'top-picks' : item.tier && TIER_ORDER.includes(item.tier as never) ? item.tier : 'other';
const byExpiration = (a: HistoryContract, b: HistoryContract) =>
    a.expiration.localeCompare(b.expiration) || a.symbol.localeCompare(b.symbol) || a.strike - b.strike;
/** Every contract here is a put, so it is in the money once the underlying is below the strike. */
const inTheMoney = (item: HistoryContract) => item.underlyingPrice !== null && item.underlyingPrice < item.strike;
/** Measured against the strike, as webportfolio's strikePct is. */
function strikeDistance(underlying: number, strike: number) {
    const percent = ((underlying - strike) / strike) * 100;
    if (Math.abs(percent) < 0.05) return `At the $${strike} strike`;
    return `${Math.abs(percent).toFixed(1)}% ${percent > 0 ? 'above' : 'below'} the $${strike} strike${percent < 0 ? ' (ITM)' : ''}`;
}

interface AddedGroup {
    /** `yyyy-mm-dd`, or '' when the date added is unknown. */
    added: string;
    count: number;
    tiers: { tier: string; items: HistoryContract[] }[];
}

/**
 * Newest date added first. Within a date: top picks, conservative to aggressive,
 * then the rest; within a group, earliest expiration first, then symbol.
 * A top pick appears only under Top Picks, as on the live signals page.
 */
function groupByAdded(items: readonly HistoryContract[]): AddedGroup[] {
    const days = new Map<string, Map<string, HistoryContract[]>>();
    for (const item of items) {
        const day = days.get(item.added ?? '') ?? new Map<string, HistoryContract[]>();
        days.set(item.added ?? '', day);
        const group = groupOf(item);
        day.set(group, [...(day.get(group) ?? []), item]);
    }
    return [...days]
        .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : b.localeCompare(a)))
        .map(([added, tiers]) => ({
            added,
            count: [...tiers.values()].reduce((total, grouped) => total + grouped.length, 0),
            tiers: [...tiers]
                .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
                .map(([tier, grouped]) => ({ tier, items: grouped.sort(byExpiration) })),
        }));
}

const addedLabel = (added: string) => (added ? `Added ${sessionLabel(added)}` : 'Date added unknown');

const TIER_FILTER_KEY = 'history_tier_filter';
function readTierFilter(): TierSelection[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(TIER_FILTER_KEY) ?? '[]');
        if (!Array.isArray(stored)) return [];
        const valid = SELECTABLE_TIER_FILTERS.filter((filter) => stored.includes(filter));
        return valid.length === SELECTABLE_TIER_FILTERS.length ? [] : valid;
    } catch {
        return [];
    }
}

/**
 * Keeps only the selected groups. A top pick counts as Top Picks, matching the
 * signals page. An empty selection keeps everything, including Other.
 */
function filterGroups(days: AddedGroup[], filters: readonly TierSelection[]): AddedGroup[] {
    if (filters.length === 0) return days;
    const selected = new Set<string>(filters);
    return days.map((day) => {
        const tiers = day.tiers.filter((group) => selected.has(group.tier));
        return { ...day, tiers, count: tiers.reduce((total, group) => total + group.items.length, 0) };
    });
}

/** Matches the server's MAX_DATES, counted inclusively in calendar dates. */
const MAX_RANGE_DATES = 93;
const DAY_MS = 86_400_000;
/**
 * Multi-day opens on the first available date through the latest. `dates` is
 * newest first. A span longer than the server allows starts at the earliest
 * date that still fits.
 */
function fullRange(dates: readonly string[]) {
    const to = dates[0] ?? '';
    const from =
        [...dates].reverse().find((date) => (Date.parse(to) - Date.parse(date)) / DAY_MS + 1 <= MAX_RANGE_DATES) ?? to;
    return { from, to };
}

// On a desktop with a contract loaded the picker, and the entry and target rows,
// float over the chart, so they close like a menu: on a pick, on Escape, or on a
// click anywhere else.
const floats = (body: Element | null | undefined) => !!body && getComputedStyle(body).position === 'absolute';
const pickerFloatsOver = (picker: HTMLDetailsElement | null) =>
    floats(picker?.querySelector('.history-contracts-body'));
const rowFloats = (row: HTMLDetailsElement) => floats(row.querySelector(':scope > :not(summary)'));
function closeFloatingPicker(picker: HTMLDetailsElement | null, onClose: () => void, force = false) {
    if (!picker?.open || (!force && !pickerFloatsOver(picker))) return;
    picker.open = false;
    onClose();
}

export function ContractHistoryPage() {
    const [params, setParams] = useSearchParams();
    const key = params.get('contract') ?? '';
    const mode = params.get('mode') === 'multi' ? 'multi' : 'day';
    const from = params.get('from') ?? '';
    const to = mode === 'day' ? from : (params.get('to') ?? from);
    const signalDate = params.get('signalDate') ?? '';
    const [search, setSearch] = useState('');
    const [pickerOpen, setPickerOpen] = useState(!key);
    const [target, setTarget] = useState<TargetChoice>('50');
    const [metric, setMetric] = useState<ChartMetric>('captured');
    const [chartView, setChartView] = useState<ChartView>(() => {
        try {
            return localStorage.getItem('history_chart_view') === 'stock' ? 'stock' : 'option';
        } catch {
            return 'option';
        }
    });
    const [tierFilter, setTierFilterState] = useState<TierSelection[]>(readTierFilter);
    const setTierFilter = (next: TierSelection[]) => {
        setTierFilterState(next);
        try {
            localStorage.setItem(TIER_FILTER_KEY, JSON.stringify(next));
        } catch {
            // Storage can be unavailable; the choice still applies for this visit.
        }
    };
    const [addedDay, setAddedDay] = useState<string | null>(null);
    const [contracts, setContracts] = useState<ContractSearchResponse | null>(null);
    const [history, setHistory] = useState<HistoryResponse | null>(null);
    const [dates, setDates] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [searchError, setSearchError] = useState('');
    const [pending, setPending] = useState(false);
    const [revision, setRevision] = useState(0);
    const { lock } = useApiKey();
    const currentParams = useRef(params);
    const loadedDates = useRef<{ key: string; revision: number; dates: string[] } | null>(null);
    const picker = useRef<HTMLDetailsElement>(null);
    currentParams.current = params;

    useEffect(() => {
        if (!key) setPickerOpen(true);
    }, [key]);
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const details = picker.current;
            // The signal-date calendar renders in a portal outside the picker, so a
            // click in it must not count as a click elsewhere.
            const inDatePopup = event.target instanceof Element && !!event.target.closest('.signal-date-popup');
            if (details?.open && !details.contains(event.target as Node) && !inDatePopup)
                closeFloatingPicker(details, () => setPickerOpen(false));
            for (const row of document.querySelectorAll<HTMLDetailsElement>('.history-summary-details[open]'))
                if (!row.contains(event.target as Node) && rowFloats(row)) row.open = false;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('.choice-panel, .signal-date-popup, .theme-picker-popover, [role="dialog"]')) return;
            const details = picker.current;
            if (details?.open && pickerFloatsOver(details)) {
                closeFloatingPicker(details, () => setPickerOpen(false), true);
                event.preventDefault();
                if (target && details.contains(target)) details.querySelector('summary')?.focus();
                return;
            }
            for (const row of document.querySelectorAll<HTMLDetailsElement>('.history-summary-details[open]'))
                if (rowFloats(row)) {
                    row.open = false;
                    event.preventDefault();
                }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    function update(changes: Record<string, string>) {
        const next = new URLSearchParams(params);
        for (const [name, value] of Object.entries(changes)) {
            if (value) next.set(name, value);
            else next.delete(name);
        }
        setParams(next);
    }

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setSearchError('');
            void searchHistoryContracts(search, controller.signal)
                .then(setContracts)
                .catch((failure: unknown) => {
                    if (controller.signal.aborted) return;
                    if (failure instanceof UnauthorizedError) lock();
                    setSearchError(failure instanceof Error ? failure.message : 'Contract search failed.');
                });
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [search, revision, lock]);

    useEffect(() => {
        if (!key) return;
        const controller = new AbortController();
        setPending(true);
        setError('');
        const cachedDates = loadedDates.current;
        const datesRequest =
            cachedDates?.key === key && cachedDates.revision === revision
                ? Promise.resolve({ dates: cachedDates.dates })
                : getHistoryDates(key, controller.signal);
        void datesRequest
            .then((result) => {
                if (controller.signal.aborted) return;
                loadedDates.current = { key, revision, dates: result.dates };
                setDates(result.dates);
                const selectedFrom = from || result.dates[0];
                if (!selectedFrom) {
                    setHistory(null);
                    setPending(false);
                    return;
                }
                if (!from) {
                    const range = mode === 'multi' ? fullRange(result.dates) : { from: selectedFrom, to: selectedFrom };
                    const next = new URLSearchParams(currentParams.current);
                    next.set('from', range.from);
                    next.set('to', range.to);
                    setParams(next, { replace: true });
                    return;
                }
                return getContractHistory(
                    key,
                    selectedFrom,
                    to || selectedFrom,
                    controller.signal,
                    signalDate || undefined
                ).then((result) => {
                    if (controller.signal.aborted) return;
                    setHistory({ ...result, points: result.points.filter((point) => !isExcludedCapture(point.time)) });
                    setPending(false);
                });
            })
            .catch((failure: unknown) => {
                if (controller.signal.aborted) return;
                if (failure instanceof UnauthorizedError) lock();
                setError(failure instanceof Error ? failure.message : 'History request failed.');
                setPending(false);
            });
        return () => controller.abort();
    }, [key, mode, from, to, signalDate, revision, lock, setParams]);

    const price = changeSummary(history?.points ?? [], 'mark');
    // A different contract clears the page and fades in fresh, the way a reload
    // does. A new date range for the same contract dims and swaps in place.
    const shown = history && history.contract.key === key ? history : null;
    const delta = changeSummary(history?.points ?? [], 'delta');
    const underlyingPoint =
        history?.points.reduce<(typeof history.points)[number] | null>(
            (latest, point) =>
                point.underlyingPrice !== null && (!latest || point.time > latest.time) ? point : latest,
            null
        ) ?? null;
    const underlyingPrice = underlyingPoint?.underlyingPrice ?? null;
    const underlyingAt = underlyingPoint ? (underlyingPoint.priceTime ?? underlyingPoint.time) : null;
    const researchContext = history
        ? tradeContext({
              symbol: history.contract.symbol,
              strike: history.contract.strike,
              expiration: history.contract.expiration,
              delta: delta.value,
              premium: price.value === null ? null : price.value * 100,
              underlyingPrice,
              underlyingChangePct: null,
          })
        : [];
    const captured = history && price.last ? premiumCaptured(history.entry, price.last) : null;
    const label = history
        ? `${history.contract.symbol} $${history.contract.strike} put, expires ${sessionLabel(history.contract.expiration)}`
        : '';
    const dateOptions = (from && !dates.includes(from) ? [from, ...dates] : dates).map((date) => ({
        value: date,
        label: sessionLabel(date),
        description: date === dates[0] ? 'Latest collected' : '',
    }));
    // A new contract blanks the range until its dates load. Keep the last range
    // on the menus meanwhile, so they don't shrink to empty boxes and shift the row.
    const heldRange = useRef({ from, to, dateOptions });
    if (from) heldRange.current = { from, to, dateOptions };
    const range = heldRange.current;
    const days = filterGroups(groupByAdded(contracts?.items ?? []), tierFilter);
    // Open on the chosen date, else the newest date that lists the selected contract, else the newest.
    // A contract signaled on several dates is listed under each of them.
    const chosen = days.findIndex((option) => option.added === addedDay);
    const lists = (index: number) => !!days[index]?.tiers.some((group) => group.items.some((item) => item.key === key));
    const signalIndex = days.findIndex((option) => option.added === (signalDate || history?.signalDate));
    const owning = lists(chosen)
        ? chosen
        : lists(signalIndex)
          ? signalIndex
          : days.findIndex((_, index) => lists(index));
    const dayIndex = chosen >= 0 ? chosen : Math.max(owning, 0);
    const day = days[dayIndex];
    const goToDay = (index: number) => setAddedDay(days[index]?.added ?? null);
    // The selected contract's own date, in picker order, so the title can step through it.
    const siblings = owning >= 0 ? (days[owning]?.tiers.flatMap((group) => group.items) ?? []) : [];
    const position = siblings.findIndex((item) => item.key === key);
    const openContract = (item: HistoryContract | undefined) => {
        // Multi-day reopens on the new contract's full range, filled in once its dates load.
        if (!item) return;
        closeFloatingPicker(picker.current, () => setPickerOpen(false), true);
        update({
            contract: item.key,
            signalDate: item.added ?? '',
            mode,
            ...(mode === 'multi' ? { from: '', to: '' } : {}),
        });
    };
    const stepContract = useRef<(step: number) => void>(() => {});
    stepContract.current = (step) => {
        if (position >= 0) openContract(siblings[position + step]);
    };
    useEffect(() => {
        // Left and right step through the contracts, unless a control that uses the
        // arrows itself has focus: a text field, a menu, the date calendar or the chart.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const target = event.target instanceof Element ? event.target : null;
            if (
                target?.closest(
                    'input, textarea, select, [contenteditable], [role="listbox"], [role="menu"], [role="slider"], .signal-date-popup, .recharts-wrapper'
                )
            )
                return;
            event.preventDefault();
            stepContract.current(event.key === 'ArrowLeft' ? -1 : 1);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);
    return (
        <main className="history-page">
            <div className="page-head history-head">
                <h1>Contract History</h1>
                <div className="history-tools">
                    <label className="symbol-filter">
                        <span className="sr-only">Find VADER contracts</span>
                        <input
                            type="search"
                            value={search}
                            placeholder="Find symbol"
                            maxLength={12}
                            onChange={(event) => {
                                const next = event.target.value.toUpperCase();
                                setSearch(next);
                                setAddedDay(null);
                                setPickerOpen(!key || !!next);
                            }}
                        />
                    </label>
                    <ChoiceMenu
                        name="View"
                        icon={null}
                        value={mode}
                        options={[
                            { value: 'day', label: 'Intraday', description: 'Every observation for one Pacific date' },
                            {
                                value: 'multi',
                                label: 'Multi-day',
                                description: 'Every observation across selected dates',
                            },
                        ]}
                        onChange={(value) =>
                            update(value === 'multi' ? { mode: value, from: '', to: '' } : { mode: value, to: from })
                        }
                    />
                    {key && range.dateOptions.length > 0 && (
                        <ChoiceMenu
                            name={mode === 'day' ? 'Date' : 'From'}
                            icon={null}
                            value={range.from}
                            options={range.dateOptions}
                            onChange={(value) =>
                                update(mode === 'multi' && value > to ? { from: value, to: value } : { from: value })
                            }
                        />
                    )}
                    {key && mode === 'multi' && range.dateOptions.length > 0 && (
                        <ChoiceMenu
                            name="To"
                            icon={null}
                            value={range.to}
                            options={range.dateOptions.filter((option) => option.value >= range.from)}
                            onChange={(value) => update({ to: value })}
                        />
                    )}
                    {history && <HistoryViewSwitch view={chartView} setView={setChartView} />}
                </div>
            </div>
            {searchError && (
                <p role="alert">
                    {searchError} <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
                </p>
            )}
            <details
                ref={picker}
                className="history-contracts"
                open={pickerOpen}
                onToggle={(event) => setPickerOpen(event.currentTarget.open)}
            >
                <summary>{key ? 'Change contract' : 'Choose a contract (expired contracts included)'}</summary>
                <div className="history-contracts-body">
                    {contracts?.items.length === 0 && <p>No matching VADER contracts.</p>}
                    {day && (
                        <section className="history-added-group">
                            <div className="history-day-nav week-nav">
                                <div className="week-steps">
                                    <button
                                        type="button"
                                        aria-label="Oldest date"
                                        title="Oldest date"
                                        disabled={dayIndex === days.length - 1}
                                        onClick={() => goToDay(days.length - 1)}
                                    >
                                        <ChevronFirstIcon />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Earlier date"
                                        title="Earlier date"
                                        disabled={dayIndex === days.length - 1}
                                        onClick={() => goToDay(dayIndex + 1)}
                                    >
                                        <ChevronLeftIcon />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Later date"
                                        title="Later date"
                                        disabled={dayIndex === 0}
                                        onClick={() => goToDay(dayIndex - 1)}
                                    >
                                        <ChevronRightIcon />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Newest date"
                                        title="Newest date"
                                        disabled={dayIndex === 0}
                                        onClick={() => goToDay(0)}
                                    >
                                        <ChevronLastIcon />
                                    </button>
                                </div>
                                <SignalDatePicker value={day.added} dates={days} onChange={setAddedDay} />
                                <TierFilterMenu value={tierFilter} onChange={setTierFilter} />
                                <div className="history-color-key" role="group" aria-label="Contract border legend">
                                    <span>Legend:</span>
                                    <span className="conservative">Conservative</span>
                                    <span className="balanced">Balanced</span>
                                    <span className="aggressive">Aggressive</span>
                                    <span className="is-itm">ITM</span>
                                </div>
                            </div>
                            <h3 className="sr-only">{addedLabel(day.added)}</h3>
                            <div className="history-tier-groups">
                                {day.tiers.length === 0 && <p>No contracts in the selected tiers on this date.</p>}
                                {day.tiers.map((group) => (
                                    <div key={group.tier} className="history-tier-group">
                                        <h4>
                                            {tierLabel(group.tier)} <span>{group.items.length}</span>
                                        </h4>
                                        <div className="history-contract-list">
                                            {group.items.map((item) => {
                                                const others = item.tiers.filter((tier) => tier !== group.tier);
                                                const itm = inTheMoney(item);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={item.key}
                                                        className={
                                                            hasExpired(item.expiration) ? 'is-expired' : undefined
                                                        }
                                                        aria-pressed={item.key === key}
                                                        onClick={() => openContract(item)}
                                                    >
                                                        <span className="history-contract-name">
                                                            <strong
                                                                className={
                                                                    itm
                                                                        ? 'is-itm'
                                                                        : item.topPick
                                                                          ? (item.tier ?? undefined)
                                                                          : undefined
                                                                }
                                                            >
                                                                {item.symbol} ${item.strike}
                                                            </strong>
                                                            <span
                                                                className={`history-contract-captured${item.capturedPercent != null && item.capturedPercent >= 50 ? ' is-target-met' : ''}`}
                                                                aria-label={
                                                                    item.capturedPercent == null
                                                                        ? 'Premium captured unavailable'
                                                                        : `Premium captured ${item.capturedPercent.toFixed(0)}%`
                                                                }
                                                            >
                                                                {item.capturedPercent == null
                                                                    ? '--'
                                                                    : `${item.capturedPercent.toFixed(0)}%`}
                                                            </span>
                                                        </span>
                                                        <span className="history-contract-expiration">
                                                            <span>
                                                                {hasExpired(item.expiration) ? 'Expired' : 'Expires'}{' '}
                                                                {sessionLabel(item.expiration)}
                                                            </span>
                                                            {itm && <span className="sr-only">In the money</span>}
                                                        </span>
                                                        {item.topPick && item.tier && (
                                                            <span className="sr-only">{tierLabel(item.tier)}</span>
                                                        )}
                                                        {!item.topPick && others.length > 0 && (
                                                            <small>{others.map(tierLabel).join(', ')}</small>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                    {contracts?.hasMore && (
                        <p>Showing the newest 1,000 contracts. Search a symbol to narrow the list.</p>
                    )}
                    {!!contracts?.unmappedContracts && (
                        <p>{contracts.unmappedContracts} legacy VADER contracts have no verified broker mapping.</p>
                    )}
                </div>
            </details>
            {error && (
                <p role="alert">
                    {error} <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
                </p>
            )}
            {pending && !shown && <Loading />}
            {key && !pending && !error && !history && (
                <p>No usable observations have been collected for this contract.</p>
            )}
            {history && shown && (
                <section
                    key={shown.contract.key}
                    className="enter history-result"
                    aria-label="Contract price and delta history"
                    aria-busy={pending}
                >
                    <div className="history-title">
                        <div className="history-title-row">
                            <h2>{label}</h2>
                            {position >= 0 && siblings.length > 1 && (
                                <div className="history-contract-steps week-nav">
                                    <div className="week-steps">
                                        <button
                                            type="button"
                                            aria-label="Previous contract"
                                            title="Previous contract"
                                            disabled={position === 0}
                                            onClick={() => openContract(siblings[position - 1])}
                                        >
                                            <ChevronLeftIcon />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Next contract"
                                            title="Next contract"
                                            disabled={position === siblings.length - 1}
                                            onClick={() => openContract(siblings[position + 1])}
                                        >
                                            <ChevronRightIcon />
                                        </button>
                                    </div>
                                    <span className="history-contract-position">
                                        {position + 1} of {siblings.length}
                                    </span>
                                </div>
                            )}
                            <nav className="history-research-links" aria-label="Underlying research">
                                <a
                                    href={withContext(seekingAlphaUrl(history.contract.symbol), researchContext)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`${history.contract.symbol} Seeking Alpha`}
                                    title={`${history.contract.symbol} Seeking Alpha`}
                                >
                                    <span className="site-mark site-seekingalpha" aria-hidden="true" />
                                </a>
                                <a
                                    href={withContext(tradingViewUrl(history.contract.symbol), researchContext)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`${history.contract.symbol} TradingView`}
                                    title={`${history.contract.symbol} TradingView`}
                                >
                                    <span className="site-mark site-tradingview" aria-hidden="true" />
                                </a>
                            </nav>
                            <HistoryChartControls
                                history={history}
                                metric={metric}
                                setMetric={setMetric}
                                view={chartView}
                            />
                        </div>
                    </div>
                    <div className="history-summary-rows">
                        <div className="history-summary-row">
                            <details name="history-summary" className="history-summary-details history-quote-summary">
                                <summary>
                                    <span className="history-summary-field">
                                        <span className="history-summary-label">Entry:</span>
                                        <strong>{history.entry ? money(history.entry.mark) : 'Unavailable'}</strong>
                                    </span>
                                    <span className="history-summary-field">
                                        <span className="history-summary-label">Mark:</span>
                                        <strong>{money(price.value)}</strong>
                                    </span>
                                    <span className="history-summary-field">
                                        <span className="history-summary-label">Delta:</span>
                                        <strong>{deltaText(delta.value)}</strong>
                                    </span>
                                    <span className="history-summary-field">
                                        <span className="history-summary-label">Captured:</span>
                                        <strong>{captured === null ? 'Unavailable' : `${captured.toFixed(1)}%`}</strong>
                                    </span>
                                    <span className="history-summary-field">
                                        <span className="history-summary-label">Underlying:</span>
                                        <strong>{money(underlyingPrice)}</strong>
                                    </span>
                                </summary>
                                <div className="history-stats">
                                    <div>
                                        <small>
                                            Entry{history.signalDate ? ` · ${sessionLabel(history.signalDate)}` : ''}
                                        </small>
                                        <strong>
                                            {history.entry ? money(history.entry.mark) : 'Entry quote unavailable'}
                                        </strong>
                                        {history.entry && (
                                            <>
                                                <span>Entry delta {deltaText(history.entry.delta)}</span>
                                                <small>
                                                    {history.entry.capturedAt
                                                        ? `Captured ${pacificTime(history.entry.capturedAt)}`
                                                        : 'Capture time unavailable'}
                                                </small>
                                            </>
                                        )}
                                    </div>
                                    <div>
                                        <small>Mark</small>
                                        <strong>{money(price.value)}</strong>
                                        <span>
                                            {signedMoney(price.change)}
                                            {price.percent !== null ? ` (${price.percent.toFixed(1)}%)` : ''}
                                        </span>
                                        {price.first &&
                                            price.last &&
                                            !standardSpan(
                                                price.first.time,
                                                price.last.time,
                                                history.from,
                                                history.to
                                            ) && (
                                                <small>
                                                    {pacificTime(price.first.time)} to {pacificTime(price.last.time)}
                                                </small>
                                            )}
                                    </div>
                                    <div>
                                        <small>Delta</small>
                                        <strong>{deltaText(delta.value)}</strong>
                                        <span>{signedDelta(delta.change)}</span>
                                        {delta.first &&
                                            delta.last &&
                                            !standardSpan(
                                                delta.first.time,
                                                delta.last.time,
                                                history.from,
                                                history.to
                                            ) && (
                                                <small>
                                                    {pacificTime(delta.first.time)} to {pacificTime(delta.last.time)}
                                                </small>
                                            )}
                                    </div>
                                    <div>
                                        <small>Premium captured</small>
                                        <strong>{captured === null ? 'Unavailable' : `${captured.toFixed(1)}%`}</strong>
                                        {captured !== null && history.entry && price.value !== null && (
                                            <span>
                                                {signedMoney((history.entry.mark - price.value) * 100)} / standard
                                                contract
                                            </span>
                                        )}
                                        {captured === null && (
                                            <small>
                                                {history.entry?.mark === 0
                                                    ? 'Entry credit is zero; percentage unavailable.'
                                                    : 'Requires an entry quote and a mark at or after entry.'}
                                            </small>
                                        )}
                                    </div>
                                    <div>
                                        <small>Underlying</small>
                                        <strong>{money(underlyingPrice)}</strong>
                                        {underlyingPrice !== null && (
                                            <span>{strikeDistance(underlyingPrice, history.contract.strike)}</span>
                                        )}
                                        <small>
                                            {underlyingAt === null
                                                ? 'Unavailable in this date range'
                                                : `Captured ${pacificTime(underlyingAt)}`}
                                        </small>
                                    </div>
                                </div>
                            </details>
                        </div>
                        <div
                            className={`history-summary-row history-analysis-row${history.analysis ? '' : ' is-unavailable'}`}
                        >
                            <HistoryAnalysisSummary history={history} target={target} />
                            <div
                                className={`history-target-slot${history.analysis ? '' : ' is-unavailable'}`}
                                aria-hidden={history.analysis ? undefined : true}
                            >
                                <HistoryAnalysisTargetControl target={target} onTargetChange={setTarget} />
                            </div>
                        </div>
                    </div>
                    <HistoryCharts history={history} metric={metric} target={target} view={chartView} />
                </section>
            )}
        </main>
    );
}
