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

function dateText(value: string | null): string {
    return value ?? 'n/a';
}

function sourceLabel(position: OwnedOptionPosition): string {
    return position.isPaper ? 'Paper' : 'Live';
}

function quoteLabel(position: OwnedOptionPosition): string {
    if (position.quote.quoteStatus === 'ok') return position.quote.asOf ? `Live ${position.quote.asOf}` : 'Live';
    if (position.quote.quoteStatus === 'cached')
        return position.quote.asOf ? `Cached ${position.quote.asOf}` : 'Cached';
    if (position.cachedPrice.priceDate) return `Daily close ${position.cachedPrice.priceDate}`;
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
                        {generatedAt ? `Updated ${generatedAt}` : 'Current open positions'}
                    </p>
                </div>
                <button
                    type="button"
                    className="icon-button text-button"
                    onClick={() => load('refresh')}
                    disabled={refreshing}
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
                        className="owned-contract-row"
                        key={`${position.isPaper ? 'paper' : 'live'}-${position.id}`}
                    >
                        <div className="owned-contract-main">
                            <span className="owned-contract-symbol">{position.symbol}</span>
                            <span className="owned-contract-contract">
                                {position.expirationDate} {position.putCall}
                                {position.strikePrice.toFixed(2)}
                            </span>
                            <span
                                className={
                                    position.isPaper ? 'owned-contract-source is-paper' : 'owned-contract-source'
                                }
                            >
                                {sourceLabel(position)}
                            </span>
                        </div>
                        <dl className="owned-contract-fields">
                            <Field label="Qty" value={String(position.contracts)} />
                            <Field label="DTE" value={position.dte === null ? 'n/a' : String(position.dte)} />
                            <Field label="Entry" value={money(position.optionPrice)} />
                            <Field label="Quote" value={money(quotePrice(position))} />
                            <Field label="Captured" value={percent(position.unrealizedCreditCapturedPct)} />
                            <Field label="Open P/L" value={currency(position.unrealizedCreditCaptured)} />
                            <Field
                                label="Delta"
                                value={position.quote.delta === null ? 'n/a' : position.quote.delta.toFixed(2)}
                            />
                            <Field label="As of" value={quoteLabel(position)} />
                            <Field label="Account" value={position.accountName ?? 'n/a'} />
                            <Field label="Opened" value={dateText(position.transactionDate)} />
                        </dl>
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

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}
