import type { DaySignals, Trade } from '@weboptions/shared';
import type { SignalGroup } from './grouping';
import { groupTrades, weekdayColumn } from './grouping';
import {
    formatDayLabel,
    formatDelta,
    formatDte,
    formatMDY,
    formatMoney,
    formatPercent,
    formatStrike,
} from './format';
import { ChevronDownIcon } from '../components/icons';
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
}

export function WeekGrid({ days, groups, collapsed, onToggleGroup, symbolFilter }: WeekGridProps) {
    if (days.length === 0) {
        return <p className="empty-week">No signals landed for this week yet.</p>;
    }

    // One head row, then a heading row and a tickets row per group. At least two
    // rows always, so a day with nothing to show has a row for saying so.
    const totalRows = Math.max(2, 1 + groups.length * 2);

    return (
        <div
            className="week-grid"
            style={{ gridTemplateRows: `repeat(${totalRows}, auto)` }}
            data-testid="week-grid"
        >
            {days.map((day) => (
                <DayCard
                    key={day.date}
                    day={day}
                    groups={groups}
                    collapsed={collapsed}
                    onToggleGroup={onToggleGroup}
                    symbolFilter={symbolFilter}
                    totalRows={totalRows}
                />
            ))}
        </div>
    );
}

interface DayCardProps extends Omit<WeekGridProps, 'days'> {
    day: DaySignals;
    totalRows: number;
}

function DayCard({ day, groups, collapsed, onToggleGroup, symbolFilter, totalRows }: DayCardProps) {
    return (
        <section
            className="day-card"
            aria-label={`${day.name} ${formatDayLabel(day.date)}`}
            style={{ gridRow: `1 / span ${totalRows}`, gridColumn: weekdayColumn(day.date) }}
        >
            <h2 className="day-head" style={{ gridRow: 1 }}>
                <span className="day-name">{day.name}</span>
                <span className="day-date">
                    {formatDayLabel(day.date)} ({day.trades.length})
                </span>
            </h2>

            {day.trades.length === 0 ? (
                <p className="no-trades" style={{ gridRow: 2 }}>
                    {symbolFilter ? `No matches for "${symbolFilter}".` : 'No signals parsed for this day.'}
                </p>
            ) : (
                groups.map((group, index) => {
                    const trades = groupTrades(group, day.trades);
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
}

function RiskGroup({ group, trades, collapsed, onToggle, headingRow, ticketsRow, dayDate }: RiskGroupProps) {
    const listId = `tickets-${group.id}-${dayDate}`;
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
                </button>
            </h3>
            <div className="tickets" id={listId} style={{ gridRow: ticketsRow }} hidden={collapsed}>
                {!collapsed &&
                    trades.map((trade, index) => (
                        <Ticket
                            key={`${trade.symbol}-${trade.strike}-${trade.expiration}-${index}`}
                            trade={trade}
                            showTierBadge={group.showTierBadge}
                        />
                    ))}
            </div>
        </>
    );
}

function Ticket({ trade, showTierBadge }: { trade: Trade; showTierBadge: boolean }) {
    return (
        <article className={`ticket ${trade.optionRight === 'P' ? 'put' : 'call'}`}>
            <div className="ticket-row1">
                <span className="ticker">
                    {trade.symbol} {formatStrike(trade.strike, trade.optionRight)}
                </span>
                {showTierBadge ? (
                    <span className={`tier-badge ${(trade.tier ?? '').toLowerCase()}`}>
                        {trade.tier ?? 'Unclassified'}
                    </span>
                ) : (
                    trade.isTopPick && <span className="top-pick">Top pick</span>
                )}
            </div>
            <p className="contract">
                Exp <b>{formatMDY(trade.expiration)}</b> ({formatDte(trade.dte)} DTE)
            </p>
            <p className="delta-line">
                &Delta; <b>{formatDelta(trade.delta)}</b>
            </p>
            <p className="stats">
                <span>
                    <b>{formatPercent(trade.annualizedYield)}</b> ann.
                </span>
                <span>
                    <b>{formatMoney(trade.premium)}</b> premium
                </span>
                <span>
                    <b>{formatMoney(trade.collateral)}</b> collateral
                </span>
            </p>
        </article>
    );
}
