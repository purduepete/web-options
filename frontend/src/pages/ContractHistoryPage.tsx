import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ContractSearchResponse, HistoryPoint, HistoryResponse } from '@weboptions/shared';
import { UnauthorizedError } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { Loading } from '../components/Loading';
import { getContractHistory, getHistoryDates, searchHistoryContracts } from '../history/api';
import {
    axisTime,
    changeSummary,
    deltaText,
    fitDomain,
    money,
    pacificTime,
    sessionLabel,
    signedDelta,
    signedMoney,
} from '../history/format';
import './ContractHistoryPage.css';

function TooltipBody({ point }: { point: HistoryPoint }) {
    return (
        <div className="history-tooltip">
            <strong>{pacificTime(point.time)}</strong>
            <span>Mark {money(point.mark)}</span>
            <span>Delta {deltaText(point.delta)}</span>
            {point.reason && <small>{point.reason}</small>}
        </div>
    );
}

function Observation({ point }: { point: HistoryPoint }) {
    return (
        <div className="history-observation">
            <strong>
                {pacificTime(point.time)} ({point.kind})
            </strong>
            <span>
                Mark: {money(point.mark)} / share. Delta: {deltaText(point.delta)}
            </span>
            <span>
                Price event: {point.priceTime ? pacificTime(point.priceTime) : 'unknown'}. Received:{' '}
                {point.priceReceivedAt ? pacificTime(point.priceReceivedAt) : 'unknown'}.
            </span>
            <span>
                Delta event: {point.deltaTime ? pacificTime(point.deltaTime) : 'unknown'}. Received:{' '}
                {point.deltaReceivedAt ? pacificTime(point.deltaReceivedAt) : 'unknown'}.
            </span>
            {(point.reason || point.flags.length > 0) && (
                <span>{[point.reason, ...point.flags].filter(Boolean).join('; ')}</span>
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
    const [offset, setOffset] = useState(0);
    const [contracts, setContracts] = useState<ContractSearchResponse | null>(null);
    const [history, setHistory] = useState<HistoryResponse | null>(null);
    const [dates, setDates] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [searchError, setSearchError] = useState('');
    const [pending, setPending] = useState(false);
    const [revision, setRevision] = useState(0);
    const [index, setIndex] = useState(0);
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
            void searchHistoryContracts(search, offset, controller.signal)
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
    }, [search, offset, revision, lock]);

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
                    setIndex(0);
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

    const shown = history?.points.filter((point) => point.kind !== 'session_boundary') ?? [];
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
                                setOffset(0);
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
                <div className="history-contract-list">
                    {contracts?.items.map((item) => (
                        <button
                            type="button"
                            key={item.key}
                            aria-pressed={item.key === key}
                            onClick={() => update({ contract: item.key, from: '', to: '' })}
                        >
                            <strong>
                                {item.symbol} ${item.strike} put
                            </strong>
                            <span>Expires {sessionLabel(item.expiration)}</span>
                        </button>
                    ))}
                </div>
                {(offset > 0 || contracts?.hasMore) && (
                    <div className="history-pagination">
                        <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
                            Previous contracts
                        </button>
                        <span>Page {offset / 50 + 1}</span>
                        <button disabled={!contracts?.hasMore} onClick={() => setOffset(offset + 50)}>
                            Next contracts
                        </button>
                    </div>
                )}
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
                        <h2>{label}</h2>
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
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => `$${value.toFixed(2)}`}
                                />
                                <YAxis
                                    yAxisId="delta"
                                    orientation="right"
                                    width={48}
                                    domain={deltaDomain}
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
                    <p className="history-coverage">
                        {history.coverage.observations} observations. {history.coverage.validPrices} valid prices,{' '}
                        {history.coverage.validDeltas} valid deltas. {history.coverage.knownPriceGaps} known price gaps,{' '}
                        {history.coverage.knownDeltaGaps} known delta gaps. {history.coverage.unknownSlots} slots with
                        unknown coverage.
                    </p>
                    <details>
                        <summary>Coverage and quality notes</summary>
                        {history.warnings.map((warning) => (
                            <p key={warning}>{warning}</p>
                        ))}
                    </details>
                    {shown.length > 0 && (
                        <section className="history-readout" aria-label="Accessible observation details">
                            <label>
                                Observation {index + 1} of {shown.length}
                                <input
                                    type="range"
                                    min={0}
                                    max={shown.length - 1}
                                    value={index}
                                    onChange={(event) => setIndex(Number(event.target.value))}
                                />
                            </label>
                            <div className="history-pagination">
                                <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
                                    Previous observation
                                </button>
                                <button disabled={index === shown.length - 1} onClick={() => setIndex(index + 1)}>
                                    Next observation
                                </button>
                            </div>
                            {shown[index] && <Observation point={shown[index]} />}
                        </section>
                    )}
                </section>
            )}
        </main>
    );
}
