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
import { MoneynessChip } from '../grade/GradeBadge';
import { seekingAlphaUrl, tradeContext, tradingViewUrl, withContext } from '../signals/researchLinks';
import { getContractHistory, getHistoryDates, searchHistoryContracts } from '../history/api';
import { HistoryCharts } from '../history/HistoryCharts';
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

export function ContractHistoryPage() {
    const [params, setParams] = useSearchParams();
    const key = params.get('contract') ?? '';
    const mode = params.get('mode') === 'multi' ? 'multi' : 'day';
    const from = params.get('from') ?? '';
    const to = mode === 'day' ? from : (params.get('to') ?? from);
    const signalDate = params.get('signalDate') ?? '';
    const [search, setSearch] = useState('');
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
    currentParams.current = params;

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
                    const next = new URLSearchParams(currentParams.current);
                    next.set('from', selectedFrom);
                    next.set('to', selectedFrom);
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
                    setHistory(result);
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
    }, [key, from, to, signalDate, revision, lock, setParams]);

    const coverage = history?.coverage;
    const hasGaps = !!coverage && coverage.knownPriceGaps + coverage.knownDeltaGaps + coverage.unknownSlots > 0;
    const price = changeSummary(history?.points ?? [], 'mark');
    const delta = changeSummary(history?.points ?? [], 'delta');
    const researchContext = history
        ? tradeContext({
              symbol: history.contract.symbol,
              strike: history.contract.strike,
              expiration: history.contract.expiration,
              delta: delta.value,
              premium: price.value === null ? null : price.value * 100,
              underlyingPrice: history.contract.underlyingPrice,
              underlyingChangePct: null,
          })
        : [];
    const captured = history && price.last ? premiumCaptured(history.entry, price.last) : null;
    const stale =
        !!history &&
        (history.contract.key !== key ||
            history.from !== from ||
            history.to !== to ||
            (!!signalDate && history.signalDate !== signalDate));
    const label = history
        ? `${history.contract.symbol} $${history.contract.strike} put, expires ${sessionLabel(history.contract.expiration)}`
        : '';
    const dateOptions = (from && !dates.includes(from) ? [from, ...dates] : dates).map((date) => ({
        value: date,
        label: sessionLabel(date),
        description: date === dates[0] ? 'Latest collected' : '',
    }));
    const days = groupByAdded(contracts?.items ?? []);
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
        if (item) update({ contract: item.key, signalDate: item.added ?? '', from: '', to: '' });
    };
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
                                setSearch(event.target.value.toUpperCase());
                                setAddedDay(null);
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
                        onChange={(value) => update({ mode: value, to: from })}
                    />
                    {key && dateOptions.length > 0 && (
                        <ChoiceMenu
                            name={mode === 'day' ? 'Date' : 'From'}
                            icon={null}
                            value={from}
                            options={dateOptions}
                            onChange={(value) =>
                                update(mode === 'multi' && value > to ? { from: value, to: value } : { from: value })
                            }
                        />
                    )}
                    {key && mode === 'multi' && dateOptions.length > 0 && (
                        <ChoiceMenu
                            name="To"
                            icon={null}
                            value={to}
                            options={dateOptions.filter((option) => option.value >= from)}
                            onChange={(value) => update({ to: value })}
                        />
                    )}
                    <button type="button" className="history-refresh" onClick={() => setRevision((value) => value + 1)}>
                        Refresh
                    </button>
                </div>
            </div>
            {searchError && (
                <p role="alert">
                    {searchError} <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
                </p>
            )}
            <details className="history-contracts" open={!key || !!search}>
                <summary>{key ? 'Choose another contract' : 'Choose a contract (expired contracts included)'}</summary>
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
                        </div>
                        <h3 className="sr-only">{addedLabel(day.added)}</h3>
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
                                                className={hasExpired(item.expiration) ? 'is-expired' : undefined}
                                                aria-pressed={item.key === key}
                                                onClick={() => openContract(item)}
                                            >
                                                <span className="history-contract-name">
                                                    <strong>
                                                        {item.symbol} ${item.strike} put
                                                    </strong>
                                                    {itm && (
                                                        <MoneynessChip
                                                            moneyness="itm"
                                                            title={`Underlying ${money(item.underlyingPrice)} on the latest capture`}
                                                        />
                                                    )}
                                                </span>
                                                <span>
                                                    {hasExpired(item.expiration) ? 'Expired' : 'Expires'}{' '}
                                                    {sessionLabel(item.expiration)}
                                                </span>
                                                {others.length > 0 && (
                                                    <small>Also {others.map(tierLabel).join(', ')}</small>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </section>
                )}
                {contracts?.hasMore && <p>Showing the newest 1,000 contracts. Search a symbol to narrow the list.</p>}
                {!!contracts?.unmappedContracts && (
                    <p>{contracts.unmappedContracts} legacy VADER contracts have no verified broker mapping.</p>
                )}
            </details>
            {error && (
                <p role="alert">
                    {error} <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
                </p>
            )}
            {pending && !history && <Loading />}
            {key && !pending && !error && !history && (
                <p>No usable observations have been collected for this contract.</p>
            )}
            {history && (
                <section
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
                        </div>
                        <p>
                            {history.signalDate && <>Signal {sessionLabel(history.signalDate)}. Viewing </>}
                            {history.from === history.to
                                ? sessionLabel(history.from)
                                : `${sessionLabel(history.from)} to ${sessionLabel(history.to)}`}
                            {stale ? ' (previous selection)' : ''}
                            {dates.length > 0 &&
                                `. Collected ${sessionLabel(dates.at(-1) ?? '')} to ${sessionLabel(dates[0] ?? '')}`}
                            .
                        </p>
                    </div>
                    <div className="history-stats">
                        <div>
                            <small>Entry{history.signalDate ? ` · ${sessionLabel(history.signalDate)}` : ''}</small>
                            <strong>{history.entry ? money(history.entry.mark) : 'Entry quote unavailable'}</strong>
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
                                !standardSpan(price.first.time, price.last.time, history.from, history.to) && (
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
                                !standardSpan(delta.first.time, delta.last.time, history.from, history.to) && (
                                    <small>
                                        {pacificTime(delta.first.time)} to {pacificTime(delta.last.time)}
                                    </small>
                                )}
                        </div>
                        <div>
                            <small>Premium captured</small>
                            <strong>{captured === null ? 'Unavailable' : `${captured.toFixed(1)}%`}</strong>
                            {captured !== null && history.entry && price.value !== null && (
                                <span>{signedMoney((history.entry.mark - price.value) * 100)} / standard contract</span>
                            )}
                            {captured === null && (
                                <small>
                                    {history.entry?.mark === 0
                                        ? 'Entry credit is zero; percentage unavailable.'
                                        : 'Requires an entry quote and a mark at or after entry.'}
                                </small>
                            )}
                        </div>
                        {history.contract.underlyingPrice !== null && (
                            <div>
                                <small>{history.contract.symbol} stock</small>
                                <strong>{money(history.contract.underlyingPrice)}</strong>
                                <span>{strikeDistance(history.contract.underlyingPrice, history.contract.strike)}</span>
                                {history.contract.underlyingAt && (
                                    <small>
                                        {hasExpired(history.contract.expiration) ? 'Last captured ' : 'Captured '}
                                        {pacificTime(history.contract.underlyingAt)}
                                    </small>
                                )}
                            </div>
                        )}
                    </div>
                    <HistoryCharts history={history} />
                    {hasGaps && (
                        <p className="history-coverage">
                            {history.coverage.knownPriceGaps} price gaps, {history.coverage.knownDeltaGaps} delta gaps
                            and {history.coverage.unknownSlots} slots with unknown coverage across{' '}
                            {history.coverage.observations} observations.
                        </p>
                    )}
                </section>
            )}
        </main>
    );
}
