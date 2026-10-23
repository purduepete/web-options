import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GROUP_LABELS, TIER_ORDER, hasExpired } from '@weboptions/shared';
import type {
    ContractSearchResponse,
    GroupId,
    HistoryContract,
    HistoryPoint,
    HistoryResponse,
} from '@weboptions/shared';
import { UnauthorizedError } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { ChevronFirstIcon, ChevronLastIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { MoneynessChip } from '../grade/GradeBadge';
import { getContractHistory, getHistoryDates, searchHistoryContracts } from '../history/api';
import {
    axisTime,
    changeSummary,
    deltaText,
    evenTicks,
    fitDomain,
    money,
    pacificTime,
    sessionLabel,
    signedDelta,
    signedMoney,
} from '../history/format';
import './ContractHistoryPage.css';

const tierLabel = (tier: string) => GROUP_LABELS[tier as GroupId] ?? 'Other';
const GROUP_ORDER: readonly string[] = ['top-picks', ...TIER_ORDER, 'other'];
const groupOf = (item: HistoryContract) =>
    item.topPick ? 'top-picks' : item.tier && TIER_ORDER.includes(item.tier as never) ? item.tier : 'other';
const byExpiration = (a: HistoryContract, b: HistoryContract) =>
    a.expiration.localeCompare(b.expiration) || a.symbol.localeCompare(b.symbol) || a.strike - b.strike;
/** Every contract here is a put, so it is in the money once the underlying is below the strike. */
const inTheMoney = (item: HistoryContract) => item.underlyingPrice !== null && item.underlyingPrice < item.strike;

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

function TooltipBody({ point }: { point: HistoryPoint }) {
    return (
        <div className="history-tooltip">
            <strong>{pacificTime(point.time)}</strong>
            <span>Mark {money(point.mark)}</span>
            <span>Delta {deltaText(point.delta)}</span>
            {(point.reason || point.flags.length > 0) && (
                <small>{[point.reason, ...point.flags].filter(Boolean).join('; ').replaceAll('_', ' ')}</small>
            )}
        </div>
    );
}

export function ContractHistoryPage() {
    const [params, setParams] = useSearchParams();
    const key = params.get('contract') ?? '';
    const mode = params.get('mode') === 'multi' ? 'multi' : 'day';
    const from = params.get('from') ?? '';
    const to = mode === 'day' ? from : (params.get('to') ?? from);
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
        void getHistoryDates(key, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
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
                return getContractHistory(key, selectedFrom, to || selectedFrom, controller.signal).then((result) => {
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
    }, [key, from, to, revision, lock, setParams]);

    const coverage = history?.coverage;
    const hasGaps = !!coverage && coverage.knownPriceGaps + coverage.knownDeltaGaps + coverage.unknownSlots > 0;
    const price = changeSummary(history?.points ?? [], 'mark');
    const delta = changeSummary(history?.points ?? [], 'delta');
    const priceDomain = fitDomain(
        (history?.points ?? []).map((point) => point.mark),
        0.1,
        [0, Number.POSITIVE_INFINITY]
    );
    const deltaDomain = fitDomain(
        (history?.points ?? []).map((point) => point.delta),
        0.02,
        [-1, 1]
    );
    const stale = !!history && (history.contract.key !== key || history.from !== from || history.to !== to);
    const label = history
        ? `${history.contract.symbol} $${history.contract.strike} put, expires ${sessionLabel(history.contract.expiration)}`
        : '';
    const dateOptions = (from && !dates.includes(from) ? [from, ...dates] : dates).map((date) => ({
        value: date,
        label: sessionLabel(date),
        description: date === dates[0] ? 'Latest collected' : '',
    }));
    const days = groupByAdded(contracts?.items ?? []);
    // Open on the chosen date, else the selected contract's date, else the newest.
    const chosen = days.findIndex((option) => option.added === addedDay);
    const owning = days.findIndex((option) =>
        option.tiers.some((group) => group.items.some((item) => item.key === key))
    );
    const dayIndex = chosen >= 0 ? chosen : Math.max(owning, 0);
    const day = days[dayIndex];
    const goToDay = (index: number) => setAddedDay(days[index]?.added ?? null);
    // The selected contract's own date, in picker order, so the title can step through it.
    const siblings = owning >= 0 ? (days[owning]?.tiers.flatMap((group) => group.items) ?? []) : [];
    const position = siblings.findIndex((item) => item.key === key);
    const openContract = (item: HistoryContract | undefined) => {
        if (item) update({ contract: item.key, from: '', to: '' });
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
                            <ChoiceMenu
                                name="Added"
                                icon={null}
                                value={day.added}
                                options={days.map((option) => ({
                                    value: option.added,
                                    label: option.added ? sessionLabel(option.added) : 'Unknown',
                                    description: `${option.count} contract${option.count === 1 ? '' : 's'}`,
                                }))}
                                onChange={setAddedDay}
                            />
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
            {pending && history && <p role="status">Loading selection. The previous chart remains below.</p>}
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
                        </div>
                        <p>
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
                            <small>Mark</small>
                            <strong>{money(price.value)}</strong>
                            <span>
                                {signedMoney(price.change)}
                                {price.percent !== null ? ` (${price.percent.toFixed(1)}%)` : ''}
                            </span>
                            {price.first && price.last && (
                                <small>
                                    {pacificTime(price.first.time)} to {pacificTime(price.last.time)}
                                </small>
                            )}
                        </div>
                        <div>
                            <small>Delta</small>
                            <strong>{deltaText(delta.value)}</strong>
                            <span>{signedDelta(delta.change)}</span>
                            {delta.first && delta.last && (
                                <small>
                                    {pacificTime(delta.first.time)} to {pacificTime(delta.last.time)}
                                </small>
                            )}
                        </div>
                    </div>
                    <div
                        className="history-chart"
                        role="img"
                        aria-label="Mark price on the left axis, signed delta on the right. Detailed observations follow."
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={history.points} margin={{ top: 12, right: 0, bottom: 16, left: 0 }}>
                                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                                <XAxis
                                    type="number"
                                    dataKey="time"
                                    domain={['dataMin', 'dataMax']}
                                    scale="time"
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => axisTime(value, history.from !== history.to)}
                                    minTickGap={50}
                                />
                                <YAxis
                                    yAxisId="price"
                                    width={48}
                                    domain={priceDomain}
                                    ticks={evenTicks(priceDomain)}
                                    interval={0}
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => `$${value.toFixed(2)}`}
                                />
                                <YAxis
                                    yAxisId="delta"
                                    orientation="right"
                                    width={48}
                                    domain={deltaDomain}
                                    ticks={evenTicks(deltaDomain)}
                                    interval={0}
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => value.toFixed(3)}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        const point = payload?.[0]?.payload as HistoryPoint | undefined;
                                        return active && point ? <TooltipBody point={point} /> : null;
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                <Line
                                    yAxisId="price"
                                    name="Mark ($ / share)"
                                    type="linear"
                                    dataKey="mark"
                                    stroke="var(--highlight)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    activeDot={{ r: 3 }}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="delta"
                                    name="Signed delta"
                                    type="linear"
                                    dataKey="delta"
                                    stroke="var(--history-delta)"
                                    strokeWidth={2}
                                    strokeDasharray="5 3"
                                    dot={{ r: 2 }}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
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
