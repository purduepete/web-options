import type { GradeBand, GradeResult, Moneyness, SymbolOutcome } from '@weboptions/shared';
import { OUTCOME_LABELS } from '@weboptions/shared';
import './GradeBadge.css';

const BAND_LABELS: Record<GradeBand, string> = {
    green: 'Green',
    yellow: 'Yellow',
    red: 'Red',
    ungraded: 'Not graded',
};

/**
 * This app's own grade, not webportfolio's.
 *
 * It shares that app's threshold names and defaults but not its arithmetic, so the
 * label says whose grade it is rather than letting the colour imply the two agree.
 * The reasons are listed below it: a colour with no explanation is a verdict.
 */
export function GradeBadge({ grade }: { grade: GradeResult }) {
    return (
        <div className="grade">
            <span className={`grade-badge ${grade.band}`}>{BAND_LABELS[grade.band]}</span>
            {grade.band === 'ungraded' ? (
                <p className="grade-note">No annualized yield to grade against.</p>
            ) : grade.reasons.length === 0 ? (
                <p className="grade-note">Nothing flagged against your thresholds.</p>
            ) : (
                <ul className="grade-reasons">
                    {grade.reasons.map((reason) => (
                        <li key={reason.breach}>{reason.detail}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** The same outline recipe, for how a past signal turned out. */
export function OutcomeChip({ outcome }: { outcome: SymbolOutcome }) {
    return <span className={`outcome-chip ${outcome.replace('_', '-')}`}>{OUTCOME_LABELS[outcome]}</span>;
}

const MONEYNESS_LABELS: Record<Moneyness, string> = {
    itm: 'in the money',
    otm: 'out of the money',
    atm: 'at the money',
};

/** Where a strike stands against a price. The `title` says which price. */
export function MoneynessChip({ moneyness, title }: { moneyness: Moneyness | null; title?: string }) {
    if (moneyness === null) return null;
    return (
        <span className={`moneyness-chip ${moneyness}`} title={title}>
            {moneyness.toUpperCase()}
            <span className="sr-only"> ({MONEYNESS_LABELS[moneyness]})</span>
        </span>
    );
}
