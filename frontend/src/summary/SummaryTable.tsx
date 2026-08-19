import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { SUMMARY_COLUMNS, SUMMARY_COLUMN_LABELS } from '@weboptions/shared';
import type { SummaryCell, SummaryColumn, WeekSummaryRow } from '@weboptions/shared';
import { formatCompactMoney, formatMoney, formatPercent, formatWeekTitle } from '../signals/format';
import './SummaryTable.css';

/**
 * One month of weeks against the risk groups.
 *
 * Every group gets a column whether or not the month filled it, unlike the week
 * grid: a table that changed its columns from month to month could not be read
 * down, which is the only reason to put weeks in rows in the first place. The
 * colgroup holds those columns to the same widths from one month to the next.
 */

const FALLBACK_TITLE = 'Includes contracts with no captured quote, counted at the numbers VADER advertised';

const ALL_TITLE =
    'Every signal of the week. The other columns will not add up to it: a top pick is counted only ' +
    'under Top Picks and not again under its tier, and a signal with an unrecognised tier appears here alone.';

/** Out of the contracts that have a close, not out of every signal. */
function otmRate(cell: SummaryCell): number | null {
    return cell.priced === 0 ? null : (cell.otm / cell.priced) * 100;
}

/* The aggregates are set off by the air around them rather than by a heavier
   line: in a table already ruled throughout, no line at all separates hardest. */
function Gap() {
    return <td className="summary-gap" aria-hidden="true" />;
}

function Cell({ cell }: { cell: SummaryCell }) {
    if (cell.signals === 0) {
        return <span className="summary-empty">No signals</span>;
    }

    const borrowed = cell.captured < cell.signals;
    const figureClass = borrowed ? 'summary-figure value-quoted' : 'summary-figure';
    const figureTitle = borrowed ? FALLBACK_TITLE : undefined;

    return (
        <span className="summary-cell">
            <span className="summary-metric">
                <b className="summary-figure">{cell.signals}</b>
                <span className="summary-unit">signals</span>
            </span>
            <span className="summary-metric" title={`${cell.otm} of ${cell.priced} with a close`}>
                <b className="summary-figure">{formatPercent(otmRate(cell))}</b>
                <span className="summary-unit">OTM</span>
            </span>
            <span className="summary-metric">
                <b className={figureClass} title={figureTitle}>
                    {formatMoney(cell.premium)}
                </b>
                <span className="summary-unit">premium</span>
            </span>
            <span className="summary-metric">
                {/* A month's committed capital runs to millions, which no column
                    this narrow can print in full. */}
                <b className="summary-figure" title={formatMoney(cell.collateral)}>
                    {formatCompactMoney(cell.collateral)}
                </b>
                <span className="summary-unit">collateral</span>
            </span>
            <span className="summary-metric" title="Weighted by collateral">
                <b className={figureClass} title={figureTitle}>
                    {formatPercent(cell.annualizedYield)}
                </b>
                <span className="summary-unit">yield</span>
            </span>
        </span>
    );
}

export function SummaryTable({
    label,
    weeks,
    total,
}: {
    label: string;
    weeks: readonly WeekSummaryRow[];
    total: Record<SummaryColumn, SummaryCell>;
}) {
    return (
        <table className="summary-table enter">
            {/* Every month draws the same headings, so the month itself is the
                only thing naming one table apart from the next. */}
            <caption className="sr-only">{label}</caption>
            <colgroup>
                <col className="summary-col-week" />
                {SUMMARY_COLUMNS.map((column) => (
                    <Fragment key={column}>
                        {column === 'all' ? <col className="summary-col-gap" /> : null}
                        <col className="summary-col-group" />
                    </Fragment>
                ))}
            </colgroup>
            <thead>
                <tr>
                    <th scope="col">Week</th>
                    {SUMMARY_COLUMNS.map((column) => (
                        <Fragment key={column}>
                            {column === 'all' ? <Gap /> : null}
                            <th
                                scope="col"
                                className={`summary-column-${column}`}
                                title={column === 'all' ? ALL_TITLE : undefined}
                            >
                                {SUMMARY_COLUMN_LABELS[column]}
                            </th>
                        </Fragment>
                    ))}
                </tr>
            </thead>
            <tbody>
                {weeks.map((week) => (
                    <tr key={week.weekStart}>
                        <th scope="row" data-label="Week">
                            {/* Straight into the grid for the week just read. */}
                            <Link to={`/?week=${week.weekStart}`}>{formatWeekTitle(week.weekStart, week.weekEnd)}</Link>
                        </th>
                        {SUMMARY_COLUMNS.map((column) => (
                            <Fragment key={column}>
                                {column === 'all' ? <Gap /> : null}
                                <td className={`summary-column-${column}`} data-label={SUMMARY_COLUMN_LABELS[column]}>
                                    <Cell cell={week.cells[column]} />
                                </td>
                            </Fragment>
                        ))}
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr className="summary-gap-row" aria-hidden="true">
                    <td colSpan={SUMMARY_COLUMNS.length + 2} />
                </tr>
                <tr className="summary-total">
                    <th scope="row" data-label="Week">
                        {label}
                    </th>
                    {SUMMARY_COLUMNS.map((column) => (
                        <Fragment key={column}>
                            {column === 'all' ? <Gap /> : null}
                            <td className={`summary-column-${column}`} data-label={SUMMARY_COLUMN_LABELS[column]}>
                                <Cell cell={total[column]} />
                            </td>
                        </Fragment>
                    ))}
                </tr>
            </tfoot>
        </table>
    );
}
