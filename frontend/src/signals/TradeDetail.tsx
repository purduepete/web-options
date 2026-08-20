import { useEffect, useMemo } from 'react';
import type { Moneyness, NumberSource, SymbolDetail, Trade } from '@weboptions/shared';
import { gradeTrade } from '@weboptions/shared';
import { Modal } from '../components/Modal';
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { SymbolMark } from '../components/SymbolMark';
import { Loading } from '../components/Loading';
import { GradeBadge, MoneynessChip, OutcomeChip } from '../grade/GradeBadge';
import { useGradeSettings } from '../grade/GradeSettingsProvider';
import { useVixValue } from '../grade/VixProvider';
import { useCautionSymbols } from '../caution/CautionProvider';
import { PriceChart } from './PriceChart';
import { useSymbolDetail } from './useSymbolDetail';
import {
    formatCents,
    formatDelta,
    formatMDY,
    formatMoney,
    formatPercent,
    formatSignedPercent,
    formatStrike,
} from './format';
import './TradeDetail.css';

/**
 * The drill-in behind a live signals ticket.
 *
 * Two arrival times, deliberately kept apart. The RECAP is everything the ticket
 * already knew, so it renders on the first frame — the modal never opens empty.
 * Everything that needs the market (price, the two averages, the grade, the chart,
 * the past signals) lives in one region that reserves its height and fades in once.
 */

export interface TradeDetailProps {
    trade: Trade | null;
    numberSource: NumberSource;
    onClose: () => void;
    /** Where this trade sits among its day's signals, e.g. "3 of 21". */
    position?: string | null;
    /** Null at the ends of the day, which is what disables the arrow. */
    onPrevious?: (() => void) | null;
    onNext?: (() => void) | null;
}

/** Yahoo has no bearing on these; they are only ever links. */
function seekingAlphaUrl(symbol: string): string {
    return `https://seekingalpha.com/symbol/${encodeURIComponent(symbol)}`;
}

function fidelityUrl(symbol: string): string {
    return `https://digital.fidelity.com/prgw/digital/research/quote/dashboard/summary?symbol=${encodeURIComponent(symbol)}`;
}

function distance(price: number | null, average: number | null): number | null {
    if (price === null || average === null || average === 0) return null;
    return ((price - average) / average) * 100;
}

/**
 * Where a put's strike stands against a price. A settled contract is judged by its
 * expiration close; one still open is judged by where the underlying is TODAY,
 * because the close it will be judged on does not exist yet.
 */
function moneynessAgainst(strike: number | null, reference: number | null): Moneyness | null {
    if (strike === null || reference === null) return null;
    if (reference < strike) return 'itm';
    if (reference > strike) return 'otm';
    return 'atm';
}

export function TradeDetail({ trade, numberSource, onClose, position, onPrevious, onNext }: TradeDetailProps) {
    const { detail, loading, error } = useSymbolDetail(trade);
    const settings = useGradeSettings();
    const cautionSymbols = useCautionSymbols();
    const vix = useVixValue();

    // The arrows are the visible control; these are the same move by keyboard.
    useEffect(() => {
        if (!trade) return;
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'ArrowLeft' && onPrevious) onPrevious();
            else if (event.key === 'ArrowRight' && onNext) onNext();
            else return;
            event.preventDefault();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [trade, onPrevious, onNext]);

    // Follows the card's own toggle, so the badge can never contradict the figure
    // sitting beside it.
    const shownYield =
        trade === null
            ? null
            : numberSource === 'actual'
              ? (trade.actualAnnualizedYield ?? trade.annualizedYield)
              : trade.annualizedYield;
    const shownDelta =
        trade === null ? null : numberSource === 'actual' ? (trade.actualDelta ?? trade.delta) : trade.delta;

    const grade = useMemo(() => {
        if (!trade) return null;
        return gradeTrade(
            {
                symbol: trade.symbol,
                annualizedYield: shownYield,
                delta: shownDelta,
                strike: trade.strike,
                price: detail?.price ?? null,
                cautionSymbols: [...cautionSymbols],
                vix,
            },
            settings,
        );
    }, [trade, shownYield, shownDelta, detail?.price, cautionSymbols, settings, vix]);

    if (!trade) return null;

    const price = detail?.price ?? null;
    // Divided by PRICE, not by strike. `trade.percentFromStrike` uses the strike as
    // its denominator, so reusing it here would disagree with the grade's own test.
    const cushion =
        price !== null && price > 0 && trade.strike !== null ? ((price - trade.strike) / price) * 100 : null;

    // The premium is per CONTRACT, so it is 100 shares' worth of a per-share strike.
    const shownPremium = numberSource === 'actual' ? (trade.actualPremium ?? trade.premium) : trade.premium;
    const breakeven = trade.strike !== null && shownPremium !== null ? trade.strike - shownPremium / 100 : null;

    return (
        <Modal
            open
            title={`${trade.symbol} ${formatStrike(trade.strike, trade.optionRight)}`}
            onClose={onClose}
            className="trade-detail"
        >
            <header className="detail-head">
                <SymbolMark symbol={trade.symbol} />
                <div className="detail-identity">
                    <p className="detail-name">{detail?.longName ?? trade.symbol}</p>
                    <p className="detail-meta">
                        {[detail?.exchange, trade.sector].filter(Boolean).join(' · ') || 'Underlying'}
                    </p>
                </div>
                <div className="detail-links">
                    {position && (
                        <div className="detail-nav">
                            <button
                                type="button"
                                className="pill nav-step"
                                onClick={onPrevious ?? undefined}
                                disabled={!onPrevious}
                                aria-label="Earlier signal this day"
                            >
                                <ChevronLeftIcon />
                            </button>
                            <span className="detail-position">{position}</span>
                            <button
                                type="button"
                                className="pill nav-step"
                                onClick={onNext ?? undefined}
                                disabled={!onNext}
                                aria-label="Later signal this day"
                            >
                                <ChevronRightIcon />
                            </button>
                        </div>
                    )}
                    {/* noreferrer as well as noopener: these are research sites, and
                        the referrer would name the reader's own page to them. */}
                    <a className="pill" href={seekingAlphaUrl(trade.symbol)} target="_blank" rel="noopener noreferrer">
                        Seeking Alpha
                    </a>
                    <a className="pill" href={fidelityUrl(trade.symbol)} target="_blank" rel="noopener noreferrer">
                        Fidelity
                    </a>
                </div>
            </header>

            {/* THE RECAP. Everything here came in with the ticket, so it is on screen
                before the network is asked for anything. */}
            <section className="detail-section">
                <h3>The contract</h3>
                <dl className="stat-run">
                    <div>
                        <dt>Strike</dt>
                        <dd>{formatCents(trade.strike)}</dd>
                    </div>
                    <div>
                        <dt>Expiration</dt>
                        <dd>
                            {formatMDY(trade.expiration)}
                            {trade.dte !== null && <span className="stat-aside"> ({trade.dte} DTE)</span>}
                        </dd>
                    </div>
                    <div>
                        <dt>Premium</dt>
                        <dd>{formatCents(shownPremium)}</dd>
                    </div>
                    <div>
                        <dt>Delta</dt>
                        <dd>{formatDelta(shownDelta)}</dd>
                    </div>
                    <div>
                        <dt>Annualized return</dt>
                        <dd>{formatPercent(shownYield)}</dd>
                    </div>
                    <div>
                        <dt>Breakeven</dt>
                        <dd>{formatCents(breakeven)}</dd>
                    </div>
                    <div>
                        <dt>Implied volatility</dt>
                        <dd>{trade.actualIv === null ? 'n/a' : formatPercent(trade.actualIv * 100)}</dd>
                    </div>
                    <div>
                        <dt>Collateral</dt>
                        <dd>{formatMoney(trade.collateral)}</dd>
                    </div>
                </dl>
            </section>

            {/* THE MARKET. One reserved region, one spinner, one fade. */}
            <div className="detail-market">
                {loading && <Loading label={`Loading ${trade.symbol}`} />}

                {error && !loading && <p className="detail-error">Could not load market data: {error}</p>}

                {detail && !loading && (
                    <div className="enter">
                        <section className="detail-section trades-section">
                            <h3>
                                Where it trades
                                {detail.stale && (
                                    <span
                                        className="detail-stale"
                                        title="The live quote failed; this is the last one cached."
                                    >
                                        cached
                                    </span>
                                )}
                            </h3>
                            <dl className="stat-run">
                                <div>
                                    <dt>Price</dt>
                                    <dd>{formatCents(detail.price)}</dd>
                                </div>
                                <div>
                                    <dt>Cushion to strike</dt>
                                    <dd>
                                        {cushion === null
                                            ? 'n/a'
                                            : cushion < 0
                                              ? `in the money by ${Math.abs(cushion).toFixed(1)}%`
                                              : `${cushion.toFixed(1)}% below`}
                                    </dd>
                                </div>
                                <div>
                                    <dt>vs 50 DMA</dt>
                                    <dd>{formatSignedPercent(distance(detail.price, detail.sma50))}</dd>
                                </div>
                                <div>
                                    <dt>vs 200 DMA</dt>
                                    <dd>{formatSignedPercent(distance(detail.price, detail.sma200))}</dd>
                                </div>
                            </dl>
                        </section>

                        {grade && (
                            <section className="detail-section grade-section">
                                <h3>Web Options grade</h3>
                                <GradeBadge grade={grade} />
                            </section>
                        )}

                        {detail.bars.length > 1 && (
                            <section className="detail-section chart-section">
                                <h3>Six months</h3>
                                <PriceChart
                                    bars={detail.bars}
                                    sma50={detail.sma50}
                                    sma200={detail.sma200}
                                    strike={trade.strike}
                                    symbol={trade.symbol}
                                />
                            </section>
                        )}

                        <section className="detail-section past-section">
                            <h3>Earlier signals on {trade.symbol}</h3>
                            {detail.pastSignals.length === 0 ? (
                                <p className="detail-empty">No other signals on this underlying.</p>
                            ) : (
                                <ul className="past-signals">
                                    {detail.pastSignals.map((signal) => {
                                        const settled = signal.closeAtExpiration !== null;
                                        const reference = signal.closeAtExpiration ?? detail.price;
                                        return (
                                            <li key={`${signal.reportDate}-${signal.strike}-${signal.expiration}`}>
                                                <span className="past-date">{formatMDY(signal.reportDate)}</span>
                                                <span className="past-strike">
                                                    {formatCents(signal.strike)}P ·{' '}
                                                    {formatPercent(signal.annualizedYield)}
                                                </span>
                                                <MoneynessChip
                                                    moneyness={moneynessAgainst(signal.strike, reference)}
                                                    title={
                                                        settled
                                                            ? `Closed ${formatCents(signal.closeAtExpiration)} at expiration, against a ${formatCents(signal.strike)} strike.`
                                                            : `Still open: ${trade.symbol} is at ${formatCents(detail.price)} today, against a ${formatCents(signal.strike)} strike.`
                                                    }
                                                />
                                                <OutcomeChip outcome={signal.outcome} />
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </Modal>
    );
}
