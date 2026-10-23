import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ContractSearchResponse, HistoryPoint, HistoryResponse } from '@weboptions/shared';
import { UnauthorizedError } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { Loading } from '../components/Loading';
import { getContractHistory, getHistoryDates, searchHistoryContracts } from '../history/api';
import { changeSummary, deltaText, money, pacificTime } from '../history/format';
import './ContractHistoryPage.css';

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
    const stale = !!history && (history.contract.key !== key || history.from !== from || history.to !== to);
    const label = history
        ? `${history.contract.symbol} $${history.contract.strike} put, expires ${history.contract.expiration}`
        : '';
    return (
        <main className="history-page">
            <div className="history-heading">
                <h1>Contract History</h1>
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                    Refresh
                </button>
            </div>
            <section className="history-controls" aria-label="Contract history controls">
                <label>
                    Find VADER contracts
                    <input
                        type="search"
                        value={search}
                        placeholder="Symbol, e.g. AAPL"
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
                        { value: 'multi', label: 'Multi-day', description: 'Every observation across selected dates' },
                    ]}
                    onChange={(value) => update({ mode: value, to: from })}
                />
                {key && (
                    <label>
                        {mode === 'day' ? 'Pacific date' : 'From (Pacific)'}
                        <input type="date" value={from} onChange={(event) => update({ from: event.target.value })} />
                    </label>
                )}
                {key && mode === 'multi' && (
                    <label>
                        To (Pacific)
                        <input
                            type="date"
                            value={to}
                            min={from}
                            onChange={(event) => update({ to: event.target.value })}
                        />
                    </label>
                )}
            </section>
            {searchError && (
                <p role="alert">
                    {searchError} <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
                </p>
            )}
            <details className="history-contracts" open={!key}>
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
                            {item.symbol} ${item.strike} put <span>Expires {item.expiration}</span>
                        </button>
                    ))}
                </div>
                <div className="history-pagination">
                    <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
                        Previous contracts
                    </button>
                    <span>Page {offset / 50 + 1}</span>
                    <button disabled={!contracts?.hasMore} onClick={() => setOffset(offset + 50)}>
                        Next contracts
                    </button>
                </div>
                {!!contracts?.unmappedContracts && (
                    <p>{contracts.unmappedContracts} legacy VADER contracts have no verified broker mapping.</p>
                )}
            </details>
            {key && dates.length > 0 && (
                <p className="history-dates">
                    Collected dates: {dates.at(-1)} through {dates[0]}. All times Pacific.
                </p>
            )}
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
                <section className="enter" aria-label="Contract price and delta history" aria-busy={pending}>
                    <h2>{label}</h2>
                    <p>
                        {history.from} through {history.to}
                        {stale ? ' (previous selection)' : ''}
                    </p>
                    <div className="history-stats">
                        <div>
                            <strong>Latest mark {money(price.value)}</strong>
                            <span>
                                Change {money(price.change)}
                                {price.percent !== null ? ` (${price.percent.toFixed(1)}%)` : ''}
                            </span>
                            {price.first && price.last && (
                                <small>
                                    {pacificTime(price.first.time)} to {pacificTime(price.last.time)}
                                </small>
                            )}
                        </div>
                        <div>
                            <strong>Latest delta {deltaText(delta.value)}</strong>
                            <span>Delta change {deltaText(delta.change)}</span>
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
                                    tickFormatter={(value: number) => pacificTime(value)}
                                    minTickGap={50}
                                />
                                <YAxis
                                    yAxisId="price"
                                    width={48}
                                    domain={[0, 'auto']}
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => `$${value.toFixed(2)}`}
                                />
                                <YAxis
                                    yAxisId="delta"
                                    orientation="right"
                                    width={44}
                                    domain={[-1, 0]}
                                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                                    tickFormatter={(value: number) => value.toFixed(2)}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        const point = payload?.[0]?.payload as HistoryPoint | undefined;
                                        return active && point ? (
                                            <div className="history-tooltip">
                                                <Observation point={point} />
                                            </div>
                                        ) : null;
                                    }}
                                />
                                <Legend />
                                <Line
                                    yAxisId="price"
                                    name="Mark ($ / share)"
                                    type="linear"
                                    dataKey="mark"
                                    stroke="var(--highlight)"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    activeDot={{ r: 4 }}
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
