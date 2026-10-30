import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { SUMMARY_COLUMNS, SUMMARY_COLUMN_LABELS } from '@weboptions/shared';
import type { NumberSource, SummaryCell, SummaryColumn, WeekSummaryRow } from '@weboptions/shared';
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

/** Out of every signal in the cell, including ones the nightly rollup has not reached yet. */
function halfRate(cell: SummaryCell): number | null {
    return cell.signals === 0 ? null : (cell.halfKept / cell.signals) * 100;
}

/* The aggregates are set off by the air around them rather than by a heavier
   line: in a table already ruled throughout, no line at all separates hardest. */
function Gap() {
    return <td className="summary-gap" aria-hidden="true" />;
}

function Cell({ cell, numberSource }: { cell: SummaryCell; numberSource: NumberSource }) {
    if (cell.signals === 0) {
        return <span className="summary-empty">No signals</span>;
    }

    const borrowed = numberSource === 'actual' && cell.captured < cell.signals;
    const figureClass = borrowed ? 'summary-figure value-quoted' : 'summary-figure';
    const figureTitle = borrowed ? FALLBACK_TITLE : undefined;

    return (
        <span className="summary-cell">
            <span className="summary-metric">
                <span className="summary-unit">signals:</span>
                <b className="summary-figure">{cell.signals}</b>
            </span>
            <span className="summary-metric" data-tip={`${cell.otm} of ${cell.priced} with a close`}>
                <span className="summary-unit">OTM:</span>
                <b className="summary-figure">
                    {cell.otm} ({formatPercent(otmRate(cell))})
                </b>
            </span>
            <span className="summary-metric">
                <span className="summary-unit">premium:</span>
                <b className={figureClass} data-tip={figureTitle}>
                    {formatMoney(cell.premium)}
                </b>
            </span>
            <span className="summary-metric">
                <span className="summary-unit">collateral:</span>
                {/* A month's committed capital runs to millions, which no column
                    this narrow can print in full. */}
                <b className="summary-figure" data-tip={formatMoney(cell.collateral)}>
                    {formatCompactMoney(cell.collateral)}
                </b>
            </span>
            <span className="summary-metric" data-tip="Weighted by collateral">
                <span className="summary-unit">yield:</span>
                <b className={figureClass} data-tip={figureTitle}>
                    {formatPercent(cell.annualizedYield)}
                </b>
            </span>
            {/* Left out where the rollup has reached nothing at all rather than
                printed as a zero: the weeks before it have no figure, not a
                figure of none. */}
            {cell.halfRollup > 0 && (
                <span className="summary-metric" data-tip={`${cell.halfKept} of ${cell.signals} signals`}>
                    <span className="summary-unit">over half:</span>
                    <b className="summary-figure">
                        {cell.halfKept} ({formatPercent(halfRate(cell))})
                    </b>
                </span>
            )}
        </span>
    );
}

export function SummaryTable({
    label,
    weeks,
    total,
    numberSource,
}: {
    label: string;
    weeks: readonly WeekSummaryRow[];
    total: Record<SummaryColumn, SummaryCell>;
    numberSource: NumberSource;
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
                                data-tip={column === 'all' ? ALL_TITLE : undefined}
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
                                    <Cell cell={week.cells[column]} numberSource={numberSource} />
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
                                <Cell cell={total[column]} numberSource={numberSource} />
                            </td>
                        </Fragment>
                    ))}
                </tr>
            </tfoot>
        </table>
    );
}
