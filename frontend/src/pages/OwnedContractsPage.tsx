import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OwnedOptionPosition, Trade, UnderlyingQuote } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchOwnedContracts, fetchWeekSignals } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { Loading } from '../components/Loading';
import { FlaskConicalIcon, RotateCcwIcon, ZapIcon } from '../components/icons';
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

function signedPercent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
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

interface SignalMatch {
    trade: Trade;
    reportDate: string;
}

function signalKey(reportDate: string, symbol: string, strike: number, expiration: string): string {
    return `${reportDate}|${symbol}|${strike}|${expiration}`;
}

function underlyingPrice(position: OwnedOptionPosition, signal: SignalMatch | undefined): number | null {
    return position.underlyingPrice ?? signal?.trade.closeUnderlying ?? signal?.trade.actualUnderlying ?? null;
}

interface UnderlyingSnapshot {
    price: string;
    move: string | null;
    moveTone: 'good' | 'bad';
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
            move: change === null ? null : signedPercent(change),
            moveTone: change !== null && change < 0 ? 'bad' : 'good',
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

function strikeCushion(position: OwnedOptionPosition, signal: SignalMatch | undefined): number | null {
    return position.percentFromStrike ?? signal?.trade.percentFromStrike ?? null;
}

function strikeCushionText(position: OwnedOptionPosition, signal: SignalMatch | undefined): string {
    const cushion = strikeCushion(position, signal);
    return cushion === null ? 'n/a' : signedPercent(cushion);
}

function strikeCushionTone(position: OwnedOptionPosition, signal: SignalMatch | undefined): string {
    const cushion = strikeCushion(position, signal);
    if (cushion === null) return 'quiet';
    return cushion < 0 ? 'bad' : 'good';
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

function entryMarkText(position: OwnedOptionPosition): string {
    return `${money(position.optionPrice)} / ${money(quotePrice(position))}`;
}

function annualizedReturnText(position: OwnedOptionPosition): string {
    if (position.collateralAtStrike <= 0) return 'n/a';
    const opened = parseLocalDate(position.transactionDate);
    const expires = parseLocalDate(position.expirationDate);
    if (opened === null || expires === null) return 'n/a';
    // The return is earned over the whole holding period, not the days still left on it.
    const heldDays = Math.round((expires.getTime() - opened.getTime()) / 86_400_000);
    if (heldDays <= 0) return 'n/a';
    return percent((position.entryCredit / position.collateralAtStrike) * (365 / heldDays) * 100);
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
    if (captured === null) return 'n/a';
    const nextTarget = [25, 50, 75].find((target) => captured < target);
    if (nextTarget === undefined) return 'Past 75%';
    const shares = position.contracts * 100;
    if (shares <= 0 || position.entryCredit <= 0) return 'n/a';
    return `${nextTarget}% @ ${money((position.entryCredit * (1 - nextTarget / 100)) / shares)}`;
}

export function OwnedContractsPage() {
    const { forget } = useApiKey();
    const [positions, setPositions] = useState<OwnedOptionPosition[] | null>(null);
    const [underlyings, setUnderlyings] = useState<Record<string, UnderlyingQuote>>({});
    const [generatedAt, setGeneratedAt] = useState<string | null>(null);
    const [signals, setSignals] = useState<ReadonlyMap<string, SignalMatch>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(
        (mode: 'initial' | 'refresh') => {
            if (mode === 'initial') setLoading(true);
            else setRefreshing(true);
            setError(null);
            fetchOwnedContracts()
                .then(async (result) => {
                    setPositions(result.positions);
                    setUnderlyings(result.underlyings);
                    setGeneratedAt(result.generatedAt);
                    const weeks = [...new Set(result.positions.map((position) => weekStart(position.transactionDate)))];
                    const responses = await Promise.allSettled(weeks.map((week) => fetchWeekSignals(week)));
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
        const quoteSource: 'Live' | 'Cached' =
            rows.length > 0 && rows.every((row) => row.quote.quoteStatus === 'ok') ? 'Live' : 'Cached';
        return {
            total: rows.length,
            live: live.length,
            paper: paper.length,
            collateral,
            credit,
            captured,
            quoteSource,
        };
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
                    <OwnedContractRow
                        key={`${position.isPaper ? 'paper' : 'live'}-${position.id}`}
                        position={position}
                        quoteSource={summary.quoteSource}
                        underlying={underlyings[position.symbol]}
                        signal={signals.get(
                            signalKey(
                                position.transactionDate,
                                position.symbol,
                                position.strikePrice,
                                position.expirationDate,
                            ),
                        )}
                    />
                ))}
            </section>
        </main>
    );
}

function OwnedContractRow({
    position,
    quoteSource,
    underlying: quote,
    signal,
}: {
    position: OwnedOptionPosition;
    quoteSource: 'Live' | 'Cached';
    underlying: UnderlyingQuote | undefined;
    signal: SignalMatch | undefined;
}) {
    const underlying = underlyingSnapshot(position, signal, quote);
    const expirationRisk = expirationRiskText(position);
    return (
        <article className={`owned-contract-row is-${toneFor(position.unrealizedCreditCaptured)}`}>
            <div className="owned-contract-identity">
                <div className="owned-contract-title">
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
                                            {underlying.move}
                                        </span>
                                    </>
                                ) : null}
                                )
                            </span>
                        ) : null}
                    </a>
                    <span
                        className={position.isPaper ? 'owned-contract-source is-paper' : 'owned-contract-source'}
                        title={ownershipLabel(position)}
                    >
                        <SourceIcon position={position} />
                        <span className="sr-only">{ownershipLabel(position)}</span>
                    </span>
                </div>
                <div className="owned-contract-subline">
                    <span>Exp {shortDate(position.expirationDate)}</span>
                    <span>{position.dte === null ? 'n/a' : `${position.dte} DTE`}</span>
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
                        <strong>{position.quote.delta === null ? 'n/a' : position.quote.delta.toFixed(2)}</strong>
                    </div>
                    <span className="owned-quote-status">{quoteSource}</span>
                </div>
            </div>
            <div className="owned-contract-meta">
                <div className="owned-contract-account-details">
                    <span>{position.accountName ?? 'n/a'}</span>
                    <span>Opened {dateText(position.transactionDate)}</span>
                </div>
                {moneynessText(position, signal) ? (
                    <span
                        className={`moneyness ${position.moneyness ?? signal?.trade.moneyness ?? ''} owned-contract-moneyness`}
                    >
                        {moneynessText(position, signal)}
                    </span>
                ) : null}
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
