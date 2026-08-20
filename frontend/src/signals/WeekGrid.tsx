import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DaySignals, GradeBand, NumberSource, Trade } from '@weboptions/shared';
import { GRADE_BAND_LABELS, hasExpired, hasKeptHalf } from '@weboptions/shared';
import type { ExpiryFilter, GradeFilter, HalfFilter, MoneynessFilter, SignalGroup } from './grouping';
import { groupTrades, ticketGradeBand, weekdayColumn } from './grouping';
import {
    formatCompactMoney,
    formatDayLabel,
    formatDelta,
    formatDte,
    formatMDY,
    formatMoney,
    formatPercent,
    formatSignedPercent,
    formatStrike,
} from './format';
import { premiumDriftPercent, totalCollateral } from './summary';
import { CautionBadge } from '../caution/CautionBadge';
import { useCautionSymbols } from '../caution/CautionProvider';
import { useGradeSettings } from '../grade/GradeSettingsProvider';
import { useVixValue } from '../grade/VixProvider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ChevronDownIcon, FlaskConicalIcon, ZapIcon } from '../components/icons';
import './WeekGrid.css';

/**
 * The five day cards.
 *
 * Every card spans all the grid's rows and inherits them with `subgrid`, so the
 * "Top Picks" heading on Monday sits on the same line as the one on Friday no
 * matter how many tickets are stacked above it. That is the only reason any of
 * this row arithmetic exists.
 */

interface WeekGridProps {
    days: DaySignals[];
    groups: SignalGroup[];
    collapsed: ReadonlySet<string>;
    onToggleGroup: (id: string) => void;
    /** Shown on an emptied day so the reader knows it was the filter, not the week. */
    symbolFilter: string;
    /** The other reason a day can empty out. */
    expiryFilter: ExpiryFilter;
    /** And the third. */
    moneynessFilter: MoneynessFilter;
    /** And the fourth. */
    halfFilter: HalfFilter;
    gradeFilter: readonly GradeFilter[];
    /** Whether the tickets show the captured 7:30am quote or what VADER advertised. */
    numberSource: NumberSource;
    /** Opens the drill-in. Absent on the calendar and the summary, where tickets are static. */
    onOpenTrade?: (trade: Trade) => void;
    /** The week in progress reads newest first on a phone; a finished week does not. */
    currentWeek: boolean;
}

/**
 * Why a day has nothing on it. A filter that empties a card has to own up to it,
 * or the reader reads a quiet day where there was only a narrow question.
 */
function emptyDayReason(
    symbolFilter: string,
    expiryFilter: ExpiryFilter,
    moneynessFilter: MoneynessFilter,
    halfFilter: HalfFilter,
    gradeFilter: readonly GradeFilter[],
): string {
    const typed = symbolFilter.trim();
    const terms = typed
        .split(',')
        .map((term) => term.trim())
        .filter((term) => term !== '');
    if (terms.length > 0 && terms.every((term) => term.startsWith('!'))) {
        return `Nothing here but "${terms.map((term) => term.slice(1).trim()).join(', ')}".`;
    }
    const activeFilters = [
        typed !== '',
        expiryFilter !== 'all',
        moneynessFilter !== 'all',
        halfFilter !== 'all',
        gradeFilter.length > 0,
    ].filter(Boolean).length;
    if (activeFilters > 1) return 'No signals match the active filters.';
    if (typed) return `No matches for "${typed}".`;
    if (expiryFilter === 'active') return 'Every signal this day has expired.';
    if (expiryFilter === 'expired') return 'Nothing this day has expired yet.';
    if (moneynessFilter !== 'all') return `Nothing this day closed ${moneynessFilter.toUpperCase()}.`;
    if (halfFilter === 'yes') return 'Nothing this day has passed half its premium.';
    if (halfFilter === 'no') return 'Nothing this day is short of half its premium.';
    if (gradeFilter.length > 0) return 'No signals have the selected grades.';
    return 'No signals parsed for this day.';
}

export function WeekGrid({
    days,
    groups,
    collapsed,
    onToggleGroup,
    symbolFilter,
    expiryFilter,
    moneynessFilter,
    halfFilter,
    gradeFilter,
    numberSource,
    onOpenTrade,
    currentWeek,
}: WeekGridProps) {
    // Only where the cards are stacked one under another. Across the full week
    // they are columns sharing one set of rows, and folding one of them away
    // would empty a column without shortening the week by a single line.
    const stacked = useMediaQuery('(max-width: 1100px)');

    // A phone reads one card at a time, and today is the card the reader wants
    // first. A week already over has no today, so it keeps Monday at the top.
    const phone = useMediaQuery('(max-width: 640px)');
    const [foldedDays, setFoldedDays] = useState<ReadonlySet<string>>(new Set());

    // Widening the window puts the cards back into columns, where a folded one
    // is just an empty column with no way left to open it.
    useEffect(() => {
        if (!stacked) setFoldedDays(new Set());
    }, [stacked]);

    const toggleDay = useCallback((date: string) => {
        setFoldedDays((current) => {
            const next = new Set(current);
            if (!next.delete(date)) next.add(date);
            return next;
        });
    }, []);

    if (days.length === 0) {
        return <p className="empty-week">No signals landed for this week yet.</p>;
    }

    // One head row, then a heading row and a tickets row per group. At least two
    // rows always, so a day with nothing to show has a row for saying so.
    const totalRows = Math.max(2, 1 + groups.length * 2);

    // Reversing the cards themselves rather than the container, since the column
    // each card asks for is inert once they stack and a reversed flex direction
    // would leave the reading order behind.
    const ordered = phone && currentWeek ? [...days].reverse() : days;

    return (
        <div
            className="week-grid enter"
            style={{ gridTemplateRows: `repeat(${totalRows}, auto)` }}
            data-testid="week-grid"
        >
            {ordered.map((day) => (
                <DayCard
                    key={day.date}
                    day={day}
                    groups={groups}
                    collapsed={collapsed}
                    onToggleGroup={onToggleGroup}
                    symbolFilter={symbolFilter}
                    expiryFilter={expiryFilter}
                    moneynessFilter={moneynessFilter}
                    halfFilter={halfFilter}
                    gradeFilter={gradeFilter}
                    numberSource={numberSource}
                    onOpenTrade={onOpenTrade}
                    totalRows={totalRows}
                    foldable={stacked}
                    folded={foldedDays.has(day.date)}
                    onToggleDay={toggleDay}
                />
            ))}
        </div>
    );
}

interface DayCardProps extends Omit<WeekGridProps, 'days' | 'currentWeek'> {
    day: DaySignals;
    totalRows: number;
    foldable: boolean;
    folded: boolean;
    onToggleDay: (date: string) => void;
}

function DayCard({
    day,
    groups,
    collapsed,
    onToggleGroup,
    symbolFilter,
    expiryFilter,
    moneynessFilter,
    halfFilter,
    gradeFilter,
    numberSource,
    onOpenTrade,
    totalRows,
    foldable,
    folded,
    onToggleDay,
}: DayCardProps) {
    const collateral = totalCollateral(day.trades);
    const heading = (
        <>
            <span className="day-name">{day.name}</span>
            <span className="day-date">
                {formatDayLabel(day.date)} ({day.trades.length})
                {collateral !== null && (
                    <span
                        className="day-collateral"
                        title={`${formatMoney(collateral)} to secure every contract on this day.`}
                    >
                        {formatCompactMoney(collateral)}
                        <span className="sr-only"> collateral</span>
                    </span>
                )}
            </span>
        </>
    );

    return (
        <section
            className={`day-card${folded ? ' is-folded' : ''}`}
            aria-label={`${day.name} ${formatDayLabel(day.date)}`}
            style={{ gridRow: `1 / span ${totalRows}`, gridColumn: weekdayColumn(day.date) }}
        >
            <h2 className="day-head" style={{ gridRow: 1 }}>
                {foldable ? (
                    <button
                        type="button"
                        className="day-fold"
                        aria-expanded={!folded}
                        onClick={() => onToggleDay(day.date)}
                    >
                        {heading}
                        <ChevronDownIcon width={16} height={16} className={folded ? 'is-folded' : ''} />
                    </button>
                ) : (
                    heading
                )}
            </h2>

            {/* Folded away rather than hidden in place: the card's contents are
                grid items placed on named rows, and every way of hiding them
                that leaves them in the layout leaves their rows behind too. */}
            {folded ? null : day.trades.length === 0 ? (
                <p className="no-trades" style={{ gridRow: 2 }}>
                    {emptyDayReason(symbolFilter, expiryFilter, moneynessFilter, halfFilter, gradeFilter)}
                </p>
            ) : (
                groups.map((group, index) => {
                    const trades = groupTrades(group, day.trades, numberSource);
                    if (trades.length === 0) return null;
                    const isCollapsed = collapsed.has(group.id);
                    return (
                        <RiskGroup
                            key={group.id}
                            group={group}
                            trades={trades}
                            collapsed={isCollapsed}
                            onToggle={() => onToggleGroup(group.id)}
                            headingRow={2 + index * 2}
                            ticketsRow={3 + index * 2}
                            dayDate={day.date}
                            numberSource={numberSource}
                            onOpenTrade={onOpenTrade}
                        />
                    );
                })
            )}
        </section>
    );
}

interface RiskGroupProps {
    group: SignalGroup;
    trades: Trade[];
    collapsed: boolean;
    onToggle: () => void;
    headingRow: number;
    ticketsRow: number;
    dayDate: string;
    numberSource: NumberSource;
    onOpenTrade?: (trade: Trade) => void;
}

function RiskGroup({
    group,
    trades,
    collapsed,
    onToggle,
    headingRow,
    ticketsRow,
    dayDate,
    numberSource,
    onOpenTrade,
}: RiskGroupProps) {
    const listId = `tickets-${group.id}-${dayDate}`;
    const priced = trades.filter((trade) => trade.moneyness !== null);
    const otm = priced.filter((trade) => trade.moneyness === 'otm').length;
    return (
        <>
            {/* A heading as well as a button: the groups are how the card is
                navigated, so they belong in the document outline under the day. */}
            <h3 className="risk-group" style={{ gridRow: headingRow }}>
                <button
                    type="button"
                    className={`risk-group-heading ${group.id}${collapsed ? ' collapsed' : ''}`}
                    onClick={onToggle}
                    aria-expanded={!collapsed}
                    aria-controls={listId}
                >
                    <ChevronDownIcon />
                    {group.label} ({trades.length})
                    {/* Counted against the contracts that have a close, not the whole
                        group, so a day with partial coverage still reads truthfully. */}
                    {priced.length > 0 && (
                        <span
                            className={`otm-score${otm === priced.length ? ' clean' : ''}`}
                            title={`${otm} of ${priced.length} closed out of the money`}
                        >
                            {otm}/{priced.length}
                            <span className="sr-only"> out of the money</span>
                        </span>
                    )}
                </button>
            </h3>
            <div className="tickets" id={listId} style={{ gridRow: ticketsRow }} hidden={collapsed}>
                {!collapsed &&
                    trades.map((trade, index) => (
                        <Ticket
                            key={`${trade.symbol}-${trade.strike}-${trade.expiration}-${index}`}
                            trade={trade}
                            dayDate={dayDate}
                            showTierBadge={group.showTierBadge}
                            numberSource={numberSource}
                            onOpen={onOpenTrade}
                        />
                    ))}
            </div>
        </>
    );
}

/**
 * Which number a ticket shows, and whether it had to borrow VADER's.
 *
 * Fallback is per value rather than per ticket: a quote can carry a delta and a
 * mark independently, and a week before capture began (2026-07-17) has neither.
 * `fallback` stays false when there is nothing to fall back to, so an "n/a" is
 * never dressed up as an estimate.
 */
interface Displayed {
    value: number | null;
    fallback: boolean;
}

function displayed(source: NumberSource, actual: number | null, quoted: number | null): Displayed {
    if (source === 'quoted' || actual !== null) {
        return { value: source === 'quoted' ? quoted : actual, fallback: false };
    }
    return { value: quoted, fallback: quoted !== null };
}

const FALLBACK_TITLE = 'No 7:30am quote was captured — showing the number VADER advertised.';

/**
 * The band behind a ticket's dot, or null for no dot at all.
 *
 * It grades the numbers ON the card, so the Actual/VADER toggle moves it and it
 * can never disagree with the figures beside it. The cushion is measured against
 * the underlying's latest close, which is only still the market on the newest
 * days — hence the recency gate rather than a dot down the whole week. Ungraded
 * shows nothing: a missing yield is not a verdict.
 */
function useTicketGrade(trade: Trade, dayDate: string, numberSource: NumberSource): GradeBand | null {
    const settings = useGradeSettings();
    const cautionSymbols = useCautionSymbols();
    const vix = useVixValue();
    return useMemo(() => {
        return ticketGradeBand(trade, dayDate, numberSource, settings, [...cautionSymbols], vix);
    }, [trade, dayDate, numberSource, cautionSymbols, settings, vix]);
}

function Figure({ shown, format }: { shown: Displayed; format: (value: number | null) => string }) {
    if (!shown.fallback) return <b>{format(shown.value)}</b>;
    return (
        <b className="value-quoted" title={FALLBACK_TITLE}>
            {format(shown.value)}
            <span className="sr-only"> (VADER estimate)</span>
        </b>
    );
}

/**
 * How far the captured number landed from the advertised one, signed against
 * VADER: a minus sign means the market was worse than the signal promised.
 * Only meaningful while the captured numbers are the ones on screen.
 */
function absoluteDiff(source: NumberSource, actual: number | null, quoted: number | null): number | null {
    if (source !== 'actual' || actual === null || quoted === null) return null;
    return actual - quoted;
}

function percentDiff(source: NumberSource, actual: number | null, quoted: number | null): number | null {
    return source === 'actual' ? premiumDriftPercent(actual, quoted) : null;
}

function formatMagnitude(value: number, places: number, suffix: string): string {
    return `(${Math.abs(value).toFixed(places)}${suffix})`;
}

const DELTA_DIFF_TITLE = "Captured delta minus VADER's.";
const PREMIUM_DIFF_TITLE = "Captured premium against VADER's, as a percentage.";

/**
 * Colour always reads the raw sign. The arrow usually agrees, but delta passes
 * invertArrow because puts run negative: a more negative delta is MORE delta,
 * so the arrow points up while the colour stays red.
 */
function DiffArrow({ up }: { up: boolean }) {
    return (
        <svg
            className="diff-arrow"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {up ? <path d="M12 19V5m-7 7 7-7 7 7" /> : <path d="M12 5v14m7-7-7 7-7-7" />}
        </svg>
    );
}

function Difference({
    value,
    places,
    suffix,
    title,
    invertArrow = false,
}: {
    value: number;
    places: number;
    suffix: string;
    title: string;
    invertArrow?: boolean;
}) {
    // Round before reading the sign, so a rounding remainder cannot print "-0.00".
    const rounded = Number(value.toFixed(places));
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    const arrowUp = invertArrow ? direction === 'down' : direction === 'up';

    return (
        <span className={`value-diff diff-${direction}`} title={title}>
            {direction !== 'flat' && (
                <>
                    <DiffArrow up={arrowUp} />
                    <span className="sr-only">{arrowUp ? 'up ' : 'down '}</span>
                </>
            )}
            {formatMagnitude(rounded, places, suffix)}
        </span>
    );
}

const MONEYNESS_LABELS = {
    itm: 'in the money',
    otm: 'out of the money',
    atm: 'at the money',
} as const;

/**
 * Where the underlying last closed against the strike. This is an outcome rather
 * than a competing quote, so unlike every Figure on the ticket it is not gated by
 * the Actual/VADER toggle. Nothing renders until that contract has a close.
 */
function MoneynessBadge({ trade }: { trade: Trade }) {
    if (trade.moneyness === null) return null;
    // Cents, not formatMoney: rounded to the dollar these two stop reconciling
    // with the percentage beside them.
    const dollars = (value: number | null) => (value == null ? 'n/a' : `$${value.toFixed(2)}`);
    const title =
        `${trade.symbol} closed at ${dollars(trade.closeUnderlying)}` +
        ` on ${formatMDY(trade.closeDate)}, against a ${dollars(trade.strike)} strike.`;
    return (
        <span className={`moneyness ${trade.moneyness}`} title={title}>
            {trade.moneyness.toUpperCase()}
            <span className="sr-only"> ({MONEYNESS_LABELS[trade.moneyness]})</span>{' '}
            {formatSignedPercent(trade.percentFromStrike)}
        </span>
    );
}

/**
 * Half the premium is where a put is usually bought back, so a trade that has
 * reached it at any close has already made its case. That outranks the grade
 * corner: the grade is a guess at how a trade should go, and this is how one went.
 */
function TicketCorner({ trade, band }: { trade: Trade; band: GradeBand | null }) {
    if (hasKeptHalf(trade)) {
        return (
            <span
                className="grade-corner green"
                title={`Has been up ${formatPercent((trade.bestPremiumKept ?? 0) * 100)} of the premium at a close. Open the ticket for when.`}
            >
                <span className="sr-only">up over half the premium at a close</span>
            </span>
        );
    }
    if (!band) return null;
    return (
        <span
            className={`grade-corner ${band}`}
            title={`${GRADE_BAND_LABELS[band]} against your grading thresholds. Open the ticket for why.`}
        >
            <span className="sr-only">{GRADE_BAND_LABELS[band]} grade</span>
        </span>
    );
}

/**
 * A ticket opens its drill-in when there is one to open.
 *
 * The whole card is the control rather than a stretched-link overlay: an overlay
 * sits on top of the text and makes the numbers unselectable, and these numbers
 * get copied. A `role="button"` on the article costs nothing and leaves the text
 * where it is — with one catch, handled in `activate` below.
 */
function Ticket({
    trade,
    dayDate,
    showTierBadge,
    numberSource,
    onOpen,
}: {
    trade: Trade;
    dayDate: string;
    showTierBadge: boolean;
    numberSource: NumberSource;
    onOpen?: (trade: Trade) => void;
}) {
    const delta = displayed(numberSource, trade.actualDelta, trade.delta);
    const premium = displayed(numberSource, trade.actualPremium, trade.premium);
    const annualized = displayed(numberSource, trade.actualAnnualizedYield, trade.annualizedYield);
    const band = useTicketGrade(trade, dayDate, numberSource);
    const illiquid = trade.actualIlliquid && !premium.fallback && numberSource === 'actual';
    const deltaDiff = absoluteDiff(numberSource, trade.actualDelta, trade.delta);
    const premiumDiff = percentDiff(numberSource, trade.actualPremium, trade.premium);
    const expired = hasExpired(trade.expiration);
    const ownership = (
        <span className="ownership-badges">
            {trade.ownedLiveContracts > 0 && (
                <span
                    className="ownership-icon live"
                    title={`${trade.ownedLiveContracts} live-owned contract${trade.ownedLiveContracts === 1 ? '' : 's'}`}
                >
                    <ZapIcon width={14} height={14} />
                    <span className="sr-only">
                        Live owned: {trade.ownedLiveContracts} contract{trade.ownedLiveContracts === 1 ? '' : 's'}
                    </span>
                </span>
            )}
            {trade.ownedPaperContracts > 0 && (
                <span
                    className="ownership-icon paper"
                    title={`${trade.ownedPaperContracts} paper-owned contract${trade.ownedPaperContracts === 1 ? '' : 's'}`}
                >
                    <FlaskConicalIcon width={14} height={14} />
                    <span className="sr-only">
                        Paper owned: {trade.ownedPaperContracts} contract{trade.ownedPaperContracts === 1 ? '' : 's'}
                    </span>
                </span>
            )}
        </span>
    );

    function activate() {
        // Finishing a drag that selected some of the ticket's own text is not a
        // click on the ticket, however much the browser insists it is.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        onOpen?.(trade);
    }

    // Space scrolls the page on keydown, and Enter and Space fire at different
    // moments on a native button, so both are matched here rather than lumped in.
    const interactive = onOpen
        ? ({
              role: 'button',
              tabIndex: 0,
              'aria-label': `${trade.symbol} ${formatStrike(trade.strike, trade.optionRight)}, open details`,
              onClick: activate,
              onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                  if (event.repeat) return;
                  if (event.key === 'Enter') {
                      event.preventDefault();
                      activate();
                  } else if (event.key === ' ') {
                      event.preventDefault();
                  }
              },
              onKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => {
                  if (event.key === ' ') {
                      event.preventDefault();
                      activate();
                  }
              },
          } as const)
        : {};

    return (
        <article
            className={`ticket ${trade.optionRight === 'P' ? 'put' : 'call'}${expired ? ' is-expired' : ''}${
                onOpen ? ' is-interactive' : ''
            }`}
            {...interactive}
        >
            <div className="ticket-row1">
                <span className="ticker">
                    {ownership}
                    {trade.symbol} {formatStrike(trade.strike, trade.optionRight)}
                    <CautionBadge symbol={trade.symbol} />
                </span>
                <span className={showTierBadge ? 'ticket-badges stacked' : 'ticket-badges'}>
                    <MoneynessBadge trade={trade} />
                    {showTierBadge ? (
                        <span className={`tier-badge ${(trade.tier ?? '').toLowerCase()}`}>
                            {trade.tier ?? 'Unclassified'}
                        </span>
                    ) : (
                        trade.isTopPick && <span className="top-pick">Top pick</span>
                    )}
                </span>
            </div>
            <p className="contract">
                Exp <b>{formatMDY(trade.expiration)}</b> ({formatDte(trade.dte)} DTE)
                {/* DTE is as of the day the signal was published, so on an old week it
                    never counts down to zero on its own. */}
                {expired && (
                    <span className="expired" title="This contract has already expired.">
                        Expired
                    </span>
                )}
            </p>
            <p className="delta-line">
                &Delta; <Figure shown={delta} format={formatDelta} />
                {deltaDiff !== null && (
                    <Difference value={deltaDiff} places={2} suffix="" title={DELTA_DIFF_TITLE} invertArrow />
                )}
            </p>
            <p className="stats">
                <span>
                    <Figure shown={annualized} format={formatPercent} /> ann.
                </span>
                <span>
                    <Figure shown={premium} format={formatMoney} />
                    {premiumDiff !== null && (
                        <Difference value={premiumDiff} places={1} suffix="%" title={PREMIUM_DIFF_TITLE} />
                    )}{' '}
                    premium
                    {illiquid && (
                        <span className="illiquid" title="Wide bid/ask spread when this quote was captured.">
                            !<span className="sr-only"> wide spread</span>
                        </span>
                    )}
                </span>
                <span>
                    <b>{formatMoney(trade.collateral)}</b> collateral
                </span>
            </p>
            <TicketCorner trade={trade} band={band} />
        </article>
    );
}
