import { Link } from 'react-router-dom';
import { formatMDY } from './format';
import { guidanceLink, type WeeklyGuidance } from './weeklyGuidance';
import './WeeklyGuidance.css';

const ZONE_LABELS = { red: 'Red', yellow: 'Yellow', green: 'Green', unclassified: 'Unclassified' };

function guidanceLabel(guidance: WeeklyGuidance): string {
    const action = guidance.action
        .trim()
        .toLowerCase()
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return `${ZONE_LABELS[guidance.zone]}${action ? ` - ${action}` : ''}`;
}

export function WeeklyGuidanceSummary({ matches }: { matches: readonly WeeklyGuidance[] }) {
    const first = matches[0];
    if (!first) return null;
    const labels = [...new Map(matches.map((item) => [JSON.stringify([item.zone, item.action]), item])).values()];
    const zones = new Set(matches.map((item) => item.zone));
    const details = [
        'Weekly Guidance',
        ...labels.map(guidanceLabel),
        `${formatMDY(first.start)} - ${formatMDY(first.end)}`,
    ].join('\n');
    return (
        <span
            className={`weekly-guidance-badge weekly-guidance-summary${zones.size === 1 ? ` guidance-${first.zone}` : ''}`}
            data-tip={details}
            tabIndex={0}
        >
            {labels.map((item) => (
                <span key={JSON.stringify([item.zone, item.action])} className={`guidance-${item.zone}`}>
                    {guidanceLabel(item)}
                </span>
            ))}
        </span>
    );
}

export function WeeklyGuidanceBadge({ guidance }: { guidance: WeeklyGuidance }) {
    return (
        <span className={`weekly-guidance-badge guidance-${guidance.zone}`} data-tip={guidance.note}>
            Weekly guidance · {guidanceLabel(guidance)}
            <span className="weekly-guidance-date">
                {formatMDY(guidance.start)} - {formatMDY(guidance.end)}
            </span>
        </span>
    );
}

export function WeeklyGuidanceDetail({ matches }: { matches: readonly WeeklyGuidance[] }) {
    if (!matches.length) return null;
    return (
        <section className="detail-section weekly-guidance-detail" aria-label="Weekly management guidance">
            <h3>Weekly management guidance</h3>
            <p className="muted">
                Publisher examples matched by put contract, not by signal entry date. Separate source rows can reflect
                different entries in the same contract.
            </p>
            {matches.map((guidance) => (
                <article key={`${guidance.reportId}-${guidance.sourceRow}`} className="weekly-guidance-entry">
                    <WeeklyGuidanceBadge guidance={guidance} />
                    {guidance.quoteDate && <p className="muted">Source quotes: {formatMDY(guidance.quoteDate)}</p>}
                    {guidance.category && <p>{guidance.category}</p>}
                    <p className="weekly-guidance-note">{guidance.note || 'No management note supplied.'}</p>
                    <Link to={guidanceLink(guidance)}>View Management Plan row {guidance.sourceRow}</Link>
                </article>
            ))}
        </section>
    );
}
