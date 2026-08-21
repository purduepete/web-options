import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchOwnedContracts } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { Loading } from '../components/Loading';
import { RotateCcwIcon } from '../components/icons';
import './OwnedContractsPage.css';

function currency(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function money(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function percent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    return `${value.toFixed(1)}%`;
}

function parseLocalDate(value: string | null): Date | null {
    if (!value) return null;
    const [datePart, timePart] = value.split('T');
    const [year, month, day] = (datePart ?? '').split('-').map(Number);
    if (!year || !month || !day) return null;
    if (!timePart) return new Date(year, month - 1, day);

    const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, second);
}

function twoDigits(value: number): string {
    return String(value).padStart(2, '0');
}

function numericDate(date: Date): string {
    return `${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}/${date.getFullYear()}`;
}

function dateText(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? 'n/a';
    return numericDate(date);
}

function timestampText(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? 'n/a';
    return `${numericDate(date)} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function shortDate(value: string | null): string {
    const date = parseLocalDate(value);
    if (!date) return value ?? 'n/a';
    return numericDate(date);
}

function contractLabel(position: OwnedOptionPosition): string {
    return `$${position.strikePrice.toFixed(2)}${position.putCall}`;
}

function toneFor(value: number | null): 'good' | 'bad' | 'flat' {
    if (value === null || value === 0) return 'flat';
    return value > 0 ? 'good' : 'bad';
}

function sourceLabel(position: OwnedOptionPosition): string {
    return position.isPaper ? 'Paper' : 'Live';
}

function quoteLabel(position: OwnedOptionPosition): string {
    if (position.quote.quoteStatus === 'ok') return position.quote.asOf ? `Live ${timestampText(position.quote.asOf)}` : 'Live';
    if (position.quote.quoteStatus === 'cached')
        return position.quote.asOf ? `Cached ${timestampText(position.quote.asOf)}` : 'Cached';
    if (position.cachedPrice.priceDate) return `Daily close ${shortDate(position.cachedPrice.priceDate)}`;
    return 'No quote';
}

function quotePrice(position: OwnedOptionPosition): number | null {
    return (
        position.quote.midPrice ??
        position.quote.bid ??
        position.quote.ask ??
        position.cachedPrice.mark ??
        position.cachedPrice.mid
    );
}

export function OwnedContractsPage() {
    const { forget } = useApiKey();
    const [positions, setPositions] = useState<OwnedOptionPosition[] | null>(null);
    const [generatedAt, setGeneratedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(
        (mode: 'initial' | 'refresh') => {
            if (mode === 'initial') setLoading(true);
            else setRefreshing(true);
            setError(null);
            fetchOwnedContracts()
                .then((result) => {
                    setPositions(result.positions);
                    setGeneratedAt(result.generatedAt);
                })
                .catch((cause: Error) => {
                    if (cause instanceof UnauthorizedError) {
                        forget();
                        return;
                    }
                    setError(describeFailure(cause));
                })
                .finally(() => {
                    if (mode === 'initial') setLoading(false);
                    else setRefreshing(false);
                });
        },
        [forget],
    );

    useEffect(() => {
        load('initial');
    }, [load]);

    const summary = useMemo(() => {
        const rows = positions ?? [];
        const live = rows.filter((row) => !row.isPaper);
        const paper = rows.filter((row) => row.isPaper);
        const collateral = rows.reduce((sum, row) => sum + row.collateralAtStrike, 0);
        const credit = rows.reduce((sum, row) => sum + row.entryCredit, 0);
        const captured = rows.reduce((sum, row) => sum + (row.unrealizedCreditCaptured ?? 0), 0);
        return { total: rows.length, live: live.length, paper: paper.length, collateral, credit, captured };
    }, [positions]);

    if (loading) return <Loading label="Loading owned contracts" />;

    return (
        <main className="owned-contracts-page enter">
            <header className="page-head owned-contracts-head">
                <div>
                    <h1>Owned Contracts</h1>
                    <p className="owned-contracts-subtitle">
                        {generatedAt ? `Updated ${timestampText(generatedAt)}` : 'Current open positions'}
                    </p>
                </div>
                <button
                    type="button"
                    className="owned-refresh-button"
                    onClick={() => load('refresh')}
                    disabled={refreshing}
                    title="Refresh owned contracts"
                >
                    <RotateCcwIcon aria-hidden="true" />
                    {refreshing ? 'Refreshing' : 'Refresh'}
                </button>
            </header>

            {error ? (
                <p role="alert" className="error-banner">
                    {error}
                </p>
            ) : null}

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

            {positions && positions.length === 0 ? <p className="summary-none">No open owned contracts.</p> : null}

            <section
                className={refreshing ? 'owned-contract-list is-stale' : 'owned-contract-list'}
                aria-busy={refreshing}
            >
                {(positions ?? []).map((position) => (
                    <article
                        className={`owned-contract-row is-${toneFor(position.unrealizedCreditCaptured)}`}
                        key={`${position.isPaper ? 'paper' : 'live'}-${position.id}`}
                    >
                        <div className="owned-contract-identity">
                            <div className="owned-contract-title">
                                <span className="owned-contract-symbol">{position.symbol}</span>
                                <span className="owned-contract-contract">{contractLabel(position)}</span>
                            </div>
                            <div className="owned-contract-subline">
                                <span>{shortDate(position.expirationDate)}</span>
                                <span>{position.dte === null ? 'n/a' : `${position.dte} DTE`}</span>
                                <span
                                    className={
                                        position.isPaper ? 'owned-contract-source is-paper' : 'owned-contract-source'
                                    }
                                >
                                    {sourceLabel(position)}
                                </span>
                            </div>
                        </div>
                        <div className="owned-contract-number is-quiet">
                            <span>Qty</span>
                            <strong>{position.contracts}</strong>
                        </div>
                        <div className="owned-contract-price-stack">
                            <MetricLine label="Entry" value={money(position.optionPrice)} />
                            <MetricLine label="Quote" value={money(quotePrice(position))} />
                        </div>
                        <div className={`owned-contract-number is-${toneFor(position.unrealizedCreditCapturedPct)}`}>
                            <span>Captured</span>
                            <strong>{percent(position.unrealizedCreditCapturedPct)}</strong>
                        </div>
                        <div className={`owned-contract-number is-${toneFor(position.unrealizedCreditCaptured)}`}>
                            <span>Open P/L</span>
                            <strong>{currency(position.unrealizedCreditCaptured)}</strong>
                        </div>
                        <div className="owned-contract-price-stack is-meta">
                            <MetricLine
                                label="Delta"
                                value={position.quote.delta === null ? 'n/a' : position.quote.delta.toFixed(2)}
                            />
                            <MetricLine label="Quote" value={quoteLabel(position)} />
                        </div>
                        <div className="owned-contract-meta">
                            <span>{position.accountName ?? 'n/a'}</span>
                            <span>Opened {dateText(position.transactionDate)}</span>
                        </div>
                    </article>
                ))}
            </section>
        </main>
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

function MetricLine({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}
