import { useEffect, useMemo } from 'react';
import type { IsoDate, Moneyness, NumberSource, Trade } from '@weboptions/shared';
import { gradeTrade, RECENT_SIGNAL_WINDOW_DAYS } from '@weboptions/shared';
import { Modal } from '../components/Modal';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    CircleArrowRightIcon,
    FlaskConicalIcon,
    ZapIcon,
} from '../components/icons';
import { SymbolMark } from '../components/SymbolMark';
import { Loading } from '../components/Loading';
import { GradeBadge, MoneynessChip, OutcomeChip, TierPill } from '../grade/GradeBadge';
import { useGradeSettings } from '../grade/GradeSettingsProvider';
import { useVixValue } from '../grade/VixProvider';
import { useCautionSymbols } from '../caution/CautionProvider';
import { PriceChart } from './PriceChart';
import { useSymbolDetail } from './useSymbolDetail';
import { seekingAlphaUrl, tradeContext, tradingViewUrl, withContext } from './researchLinks';
import {
    formatCents,
    formatDayLabel,
    formatDelta,
    formatMDY,
    formatMoney,
    formatPercent,
    formatSignedMoney,
    formatSignedPercent,
    formatStrike,
    shareOf,
} from './format';
import './TradeDetail.css';
import '../components/SiteMarks.css';

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
    /** The morning the trade was signalled, which is what identifies its outcome row. */
    reportDate?: IsoDate | null;
    /** Where this trade sits among its day's signals, e.g. "3 of 21". */
    position?: string | null;
    /** Null at the ends of the day, which is what disables the arrow. */
    onPrevious?: (() => void) | null;
    onNext?: (() => void) | null;
    /** Opens another signal on the same underlying. Omitted, the list is not clickable. */
    onOpenSignal?: (target: SignalTarget) => void;
}

export interface SignalTarget {
    symbol: string;
    reportDate: IsoDate;
    strike: number;
    expiration: IsoDate;
}

/** The option chain rather than the stock summary, because that is where the overlay fires. */
function fidelityUrl(symbol: string, context: string[]): string {
    const base = `https://digital.fidelity.com/ftgw/digital/exp-options-research/?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
    // Fidelity's overlay reads query parameters, and takes the ticker from `symbol`.
    const params = context.filter((part) => !part.startsWith('trade_ticker='));
    return params.length === 0 ? base : `${base}&${params.join('&')}`;
}

/** Null when the contract is not fully named, since this one is per-contract rather than per-symbol. */
function barchartUrl(trade: Trade): string | null {
    if (trade.strike === null || trade.expiration === null) return null;
    const params = new URLSearchParams({
        symbol: trade.symbol,
        expirationDate: trade.expiration,
        strikePrice: trade.strike.toFixed(2),
        symbolType: trade.optionRight,
    });
    return `https://www.barchart.com/options/price-history?${params.toString()}`;
}

const WEB_PORTFOLIO_TRADE_URL = 'https://web-portfolio.jimlertech.com/trading/option-trade';

function webPortfolioTradeUrl(trade: Trade, numberSource: NumberSource): string {
    const premium = numberSource === 'actual' ? (trade.actualPremium ?? trade.premium) : trade.premium;
    const delta = numberSource === 'actual' ? (trade.actualDelta ?? trade.delta) : trade.delta;
    const params = new URLSearchParams({
        action: 'sell_to_open',
        symbol: trade.symbol,
        strategy: 'Substack - The Multiplier',
    });

    if (trade.strike !== null) params.set('strike', String(trade.strike));
    if (trade.expiration !== null) params.set('expiry', trade.expiration);
    if (premium !== null) params.set('optionPrice', (premium / 100).toFixed(2));
    if (delta !== null) params.set('delta', (-Math.abs(delta)).toFixed(4));

    return `${WEB_PORTFOLIO_TRADE_URL}?${params.toString()}`;
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

/** The rollup keeps its shares of the premium as fractions; the run reads in percent. */
function asPercent(fraction: number | null): number | null {
    return fraction === null ? null : fraction * 100;
}

/**
 * The rollup quotes the option per SHARE, the way a chain does. The recap above it
 * quotes the premium per contract, and so does the profit, so leaving these two in
 * the chain's units would invite a reader to compare $3.53 with $352.50 and conclude
 * something had gone wrong.
 */
function perContract(perShare: number | null): number | null {
    return perShare === null ? null : perShare * 100;
}

export function TradeDetail({
    trade,
    numberSource,
    onClose,
    reportDate = null,
    position,
    onPrevious,
    onNext,
    onOpenSignal,
}: TradeDetailProps) {
    const onOpen = onOpenSignal;
    const { detail, loading, error } = useSymbolDetail(trade, reportDate);
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
            settings
        );
    }, [trade, shownYield, shownDelta, detail?.price, cautionSymbols, settings, vix]);

    if (!trade) return null;

    const price = detail?.price ?? null;
    // Divided by PRICE, not by strike. `trade.percentFromStrike` uses the strike as
    // its denominator, so reusing it here would disagree with the grade's own test.
    const cushion =
        price !== null && price > 0 && trade.strike !== null ? ((price - trade.strike) / price) * 100 : null;
    const priceDate = detail?.priceDate ?? null;
    const prevClose =
        (priceDate !== null ? detail?.bars.filter((b) => b.date < priceDate).pop() : detail?.bars.at(-1))?.close ??
        null;
    const dayChangePct = distance(price, prevClose);

    // The premium is per CONTRACT, so it is 100 shares' worth of a per-share strike.
    const shownPremium = numberSource === 'actual' ? (trade.actualPremium ?? trade.premium) : trade.premium;
    const breakeven = trade.strike !== null && shownPremium !== null ? trade.strike - shownPremium / 100 : null;
    const barchart = barchartUrl(trade);
    const context = tradeContext({
        symbol: trade.symbol,
        strike: trade.strike,
        expiration: trade.expiration,
        delta: shownDelta,
        premium: shownPremium,
        underlyingPrice: price,
        underlyingChangePct: dayChangePct,
    });

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
                    <div className="research-links">
                        {/* The anchor carries the name, so the mark is decorative. */}
                        <a
                            className="pill link-icon"
                            href={withContext(seekingAlphaUrl(trade.symbol), context)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Seeking Alpha"
                            title="Seeking Alpha"
                        >
                            <span className="site-mark site-seekingalpha" aria-hidden="true" />
                        </a>
                        <a
                            className="pill link-icon"
                            href={fidelityUrl(trade.symbol, context)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Fidelity"
                            title="Fidelity option chain"
                        >
                            <span className="site-mark site-fidelity" aria-hidden="true" />
                        </a>
                        {barchart && (
                            <a
                                className="pill link-icon"
                                href={withContext(barchart, context)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Barchart option price history"
                                title="Barchart option price history"
                            >
                                <span className="site-mark site-barchart" aria-hidden="true" />
                            </a>
                        )}
                        <a
                            className="pill link-icon"
                            href={withContext(tradingViewUrl(trade.symbol), context)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="TradingView"
                            title="TradingView chart"
                        >
                            <span className="site-mark site-tradingview" aria-hidden="true" />
                        </a>
                    </div>
                    <a
                        className="pill link-icon purchase-link"
                        href={webPortfolioTradeUrl(trade, numberSource)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Trade in Web Portfolio"
                        title="Execute Option Trade"
                    >
                        <CircleArrowRightIcon />
                    </a>
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
                </div>
            </header>

            {/* THE RECAP. Everything here came in with the ticket, so it is on screen
                before the network is asked for anything. */}
            <section className="detail-section">
                <h3>
                    The contract
                    {detail?.ownedContracts !== null &&
                        detail?.ownedContracts !== undefined &&
                        detail.ownedContracts > 0 && (
                            <span
                                className="detail-tag"
                                title={`${detail.ownedContracts} open contract${detail.ownedContracts === 1 ? '' : 's'}`}
                            >
                                Owned
                            </span>
                        )}
                </h3>
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
                        <dd>{trade.actualIv === null ? '–' : formatPercent(trade.actualIv * 100)}</dd>
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
                                    <dd>
                                        {formatCents(detail.price)}
                                        {dayChangePct !== null && (
                                            <span className={dayChangePct >= 0 ? 'day-change-up' : 'day-change-down'}>
                                                {' '}
                                                ({formatSignedPercent(dayChangePct)})
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Cushion to strike</dt>
                                    <dd>
                                        {cushion === null
                                            ? '–'
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

                        {detail.outcome && (
                            <section className="detail-section outcome-section">
                                <h3>
                                    Since the signal
                                    <span
                                        className="detail-tag"
                                        title={
                                            detail.outcome.settled
                                                ? 'The contract has expired, so none of these move again.'
                                                : 'Closing marks only. Nothing here has moved since last night.'
                                        }
                                    >
                                        {detail.outcome.settled ? 'settled' : 'end of day'}
                                    </span>
                                </h3>
                                <dl className="stat-run">
                                    <div>
                                        <dt>Sold for</dt>
                                        <dd>{formatCents(perContract(detail.outcome.entryPremium))}</dd>
                                    </div>
                                    <div>
                                        <dt>Last close</dt>
                                        <dd>
                                            {formatCents(perContract(detail.outcome.mark))}
                                            {detail.outcome.asOf && (
                                                <span className="stat-aside">
                                                    {' '}
                                                    ({formatDayLabel(detail.outcome.asOf)})
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Premium kept</dt>
                                        <dd>
                                            {formatSignedPercent(asPercent(detail.outcome.premiumKept))}
                                            {detail.outcome.profit !== null && (
                                                <span className="stat-aside">
                                                    {' '}
                                                    ({formatSignedMoney(detail.outcome.profit)})
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt title="Webportfolio calls this Max Cap: the largest share of the premium that could have been bought back at any close.">
                                            Best it has been
                                        </dt>
                                        <dd>
                                            {formatSignedPercent(asPercent(detail.outcome.bestPremiumKept))}
                                            {detail.outcome.bestProfit !== null && (
                                                <span className="stat-aside">
                                                    {' '}
                                                    ({formatSignedMoney(detail.outcome.bestProfit)}
                                                    {detail.outcome.bestOn &&
                                                        `, ${formatDayLabel(detail.outcome.bestOn)}`}
                                                    )
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Worst it has been</dt>
                                        <dd>
                                            {formatSignedPercent(asPercent(detail.outcome.worstPremiumKept))}
                                            {detail.outcome.worstProfit !== null && (
                                                <span className="stat-aside">
                                                    {' '}
                                                    ({formatSignedMoney(detail.outcome.worstProfit)})
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Days held</dt>
                                        <dd>
                                            {detail.outcome.daysHeld ?? '–'}
                                            {detail.outcome.daysToHalf !== null && (
                                                <span className="stat-aside">
                                                    {' '}
                                                    (half the premium by {detail.outcome.daysToHalf})
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                    {detail.outcome.settled && (
                                        <div>
                                            <dt>Finished</dt>
                                            <dd>
                                                <MoneynessChip
                                                    moneyness={detail.outcome.moneynessAtExpiration}
                                                    title="Where the underlying closed against the strike at expiration."
                                                />
                                            </dd>
                                        </div>
                                    )}
                                </dl>
                            </section>
                        )}

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
                            <h3>
                                Other signals on {trade.symbol}
                                {detail.recentSignals !== null && detail.recentSignals.total > 0 && (
                                    <span
                                        className="past-stats"
                                        title={`Over the last ${RECENT_SIGNAL_WINDOW_DAYS} trading days: ${detail.recentSignals.inTheMoney} of ${detail.recentSignals.total} in the money, ${detail.recentSignals.assigned} of ${detail.recentSignals.total} assigned.`}
                                    >
                                        <span>
                                            {detail.recentSignals.total} in {RECENT_SIGNAL_WINDOW_DAYS} days
                                        </span>
                                        <span>
                                            {shareOf(detail.recentSignals.inTheMoney, detail.recentSignals.total)} ITM
                                        </span>
                                        <span>
                                            {shareOf(detail.recentSignals.assigned, detail.recentSignals.total)}{' '}
                                            assigned
                                        </span>
                                    </span>
                                )}
                            </h3>
                            {detail.pastSignals.length === 0 ? (
                                <p className="detail-empty">No other signals on this underlying.</p>
                            ) : (
                                <ul className="past-signals">
                                    {[...detail.pastSignals]
                                        .sort(
                                            (a, b) =>
                                                Number(b.ownedLiveContracts > 0 || b.ownedPaperContracts > 0) -
                                                Number(a.ownedLiveContracts > 0 || a.ownedPaperContracts > 0)
                                        )
                                        .map((signal) => {
                                            const settled = signal.closeAtExpiration !== null;
                                            const reference = signal.closeAtExpiration ?? detail.price;
                                            const owned =
                                                signal.ownedLiveContracts > 0 || signal.ownedPaperContracts > 0;
                                            // Copied out so the null checks still hold inside the click
                                            // handler, which they would not on the mutable prop.
                                            const { strike, expiration } = signal;
                                            const openRow =
                                                onOpen && strike !== null && expiration !== null
                                                    ? () =>
                                                          onOpen({
                                                              symbol: trade.symbol,
                                                              reportDate: signal.reportDate,
                                                              strike,
                                                              expiration,
                                                          })
                                                    : null;
                                            const body = (
                                                <>
                                                    <span className="past-date">{formatMDY(signal.reportDate)}</span>
                                                    <span className="past-ownership">
                                                        {signal.ownedLiveContracts > 0 && (
                                                            <span
                                                                className="ownership-icon live"
                                                                title={`${signal.ownedLiveContracts} live-owned contract${signal.ownedLiveContracts === 1 ? '' : 's'}`}
                                                            >
                                                                <ZapIcon width={14} height={14} />
                                                                <span className="sr-only">Live owned</span>
                                                            </span>
                                                        )}
                                                        {signal.ownedPaperContracts > 0 && (
                                                            <span
                                                                className="ownership-icon paper"
                                                                title={`${signal.ownedPaperContracts} paper-owned contract${signal.ownedPaperContracts === 1 ? '' : 's'}`}
                                                            >
                                                                <FlaskConicalIcon width={14} height={14} />
                                                                <span className="sr-only">Paper owned</span>
                                                            </span>
                                                        )}
                                                        {!owned && <span aria-hidden="true" />}
                                                    </span>
                                                    <TierPill tier={signal.tier} isTopPick={signal.isTopPick} />
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
                                                </>
                                            );
                                            return (
                                                <li key={`${signal.reportDate}-${signal.strike}-${signal.expiration}`}>
                                                    {openRow ? (
                                                        <button
                                                            type="button"
                                                            className="past-row"
                                                            onClick={openRow}
                                                            title={`Open ${trade.symbol} ${formatCents(signal.strike)}P from ${formatMDY(signal.reportDate)}`}
                                                        >
                                                            {body}
                                                        </button>
                                                    ) : (
                                                        <div className="past-row">{body}</div>
                                                    )}
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
