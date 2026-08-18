import type { ReportMetrics } from '@weboptions/shared';
import { formatMoney, formatPercent } from '../signals/format';
import './ReportSummary.css';

/**
 * Headline metric cards for one week's realized performance and open-position
 * book. A `null` metric (an older or partially-parsed week) renders as "n/a"
 * rather than 0, so a missing number never reads as a real zero.
 */

function formatCount(value: number | null): string {
    return value == null ? 'n/a' : String(value);
}

interface MetricCard {
    label: string;
    value: string;
    detail?: string;
}

function buildCards(m: ReportMetrics): MetricCard[] {
    return [
        { label: 'Net P&L', value: formatMoney(m.netPnl) },
        { label: 'Hit rate', value: formatPercent(m.hitRate) },
        {
            label: 'Closed legs',
            value: formatCount(m.closedLegs),
            detail: `${formatCount(m.winningLegs)} winning, ${formatCount(m.rollLegs)} roll`,
        },
        { label: 'Winners', value: formatMoney(m.winnersAmount), detail: `roll cost ${formatMoney(m.rollCost)}` },
        { label: 'Collateral', value: formatMoney(m.collateral), detail: `${formatPercent(m.returnPct)} return` },
        { label: 'New positions', value: formatCount(m.newPositions), detail: `${formatMoney(m.newPremium)} premium` },
        { label: 'Net cash', value: formatMoney(m.netCash) },
        { label: 'Median days held', value: formatCount(m.medianDaysHeld) },
        {
            label: 'Open positions',
            value: formatCount(m.openPositionsTotal),
            detail: `${formatCount(m.openCalls)} calls, ${formatCount(m.openPuts)} puts`,
        },
        {
            label: 'Open book',
            value: `${formatCount(m.openGreen)} / ${formatCount(m.openYellow)} / ${formatCount(m.openRed)}`,
            detail: 'green / yellow / red',
        },
    ];
}

export function ReportSummary({ metrics }: { metrics: ReportMetrics }) {
    const cards = buildCards(metrics);
    return (
        <div className="report-summary" data-testid="report-summary">
            {cards.map((card) => (
                <div className="metric-card" key={card.label}>
                    <span className="metric-label">{card.label}</span>
                    <span className="metric-value">{card.value}</span>
                    {card.detail && <span className="metric-detail">{card.detail}</span>}
                </div>
            ))}
        </div>
    );
}
