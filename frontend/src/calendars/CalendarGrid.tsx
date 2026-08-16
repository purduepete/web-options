import type { CalendarDay, CalendarTrade } from '@weboptions/shared';
import { groupCalendarTrades } from './calendarGroups';
import { weekdayColumn } from '../signals/grouping';
import {
    formatDayLabel,
    formatDelta,
    formatDte,
    formatMDY,
    formatMoney,
    formatPercent,
    formatStrike,
} from '../signals/format';
import { AlertIcon, CheckIcon } from '../components/icons';
import './CalendarGrid.css';

/**
 * One published week.
 *
 * Four shared rows — head, event, rule, tickets — inherited by every day card
 * with `subgrid`, so Wednesday's long CPI warning does not push its trades
 * below everyone else's. The rows are fixed here rather than computed, because
 * a calendar day always has the same four parts.
 */

const ROWS = { head: 1, event: 2, rule: 3, tickets: 4 } as const;

export function CalendarGrid({ days }: { days: CalendarDay[] }) {
    if (days.length === 0) {
        return <p className="empty-week">This calendar has no days on it.</p>;
    }

    return (
        <div className="calendar-grid" data-testid="calendar-grid">
            {days.map((day) => (
                <CalendarDayCard key={`${day.name}-${day.date}`} day={day} />
            ))}
        </div>
    );
}

function CalendarDayCard({ day }: { day: CalendarDay }) {
    const groups = groupCalendarTrades(day.trades);

    return (
        <section
            className="day-card calendar-day"
            aria-label={`${day.name} ${formatDayLabel(day.date)}`}
            style={{ gridRow: `1 / span 4`, gridColumn: weekdayColumn(day.date) }}
        >
            <h2 className="day-head" style={{ gridRow: ROWS.head }}>
                <span className="day-name">{day.name}</span>
                <span className="day-date">{formatDayLabel(day.date)}</span>
            </h2>

            {day.event && (
                <p className="event-banner" style={{ gridRow: ROWS.event }}>
                    <AlertIcon />
                    <span>{day.event}</span>
                </p>
            )}

            {day.rule && (
                <p className="rule-box" style={{ gridRow: ROWS.rule }}>
                    <CheckIcon />
                    <span>{day.rule}</span>
                </p>
            )}

            <div className="tickets" style={{ gridRow: ROWS.tickets }}>
                {groups.length === 0 ? (
                    <p className="no-trades">No new positions scheduled. Follow the rule above.</p>
                ) : (
                    groups.map((group) => (
                        <div key={group.risk}>
                            <h3 className={`risk-group-heading ${group.risk}`}>{group.label}</h3>
                            {group.trades.map((trade, index) => (
                                <CalendarTicket
                                    key={`${trade.ticker}-${trade.strike}-${trade.expiry}-${index}`}
                                    trade={trade}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}

function CalendarTicket({ trade }: { trade: CalendarTrade }) {
    return (
        <article className={`ticket ${trade.optionRight === 'P' ? 'put' : 'call'}`}>
            <div className="ticket-row1">
                <span className="ticker">
                    {trade.ticker} {formatStrike(trade.strike, trade.optionRight)}
                </span>
            </div>
            <p className="contract">
                Exp <b>{formatMDY(trade.expiry)}</b> ({formatDte(trade.dte)} DTE) &middot; &Delta;{' '}
                <b>{formatDelta(trade.delta)}</b>
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
            {trade.note && <p className="ticket-note">{trade.note}</p>}
        </article>
    );
}
