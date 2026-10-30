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
 * label says whose grade it is rather than letting the color imply the two agree.
 * The reasons are listed below it: a color with no explanation is a verdict.
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

/** Where a strike stands against a price. The tooltip says which price. */
export function MoneynessChip({ moneyness, tooltip }: { moneyness: Moneyness | null; tooltip?: string }) {
    if (moneyness === null) return null;
    return (
        <span className={`moneyness-chip ${moneyness}`} data-tip={tooltip}>
            {moneyness.toUpperCase()}
            <span className="sr-only"> ({MONEYNESS_LABELS[moneyness]})</span>
        </span>
    );
}

const TIER_PILL_LABELS = {
    conservative: 'Conservative',
    balanced: 'Balanced',
    aggressive: 'Aggressive',
} as const;

export function TierPill({ tier, isTopPick }: { tier: string | null; isTopPick: boolean }) {
    if (isTopPick) {
        return (
            <span className="tier-pill tp" data-tip="Top pick">
                TP
                <span className="sr-only"> (Top pick)</span>
            </span>
        );
    }

    const normalized = tier?.toLowerCase();
    if (normalized !== 'conservative' && normalized !== 'balanced' && normalized !== 'aggressive') return null;

    return (
        <span className={`tier-pill ${normalized}`} data-tip={TIER_PILL_LABELS[normalized]}>
            {normalized.charAt(0).toUpperCase()}
            <span className="sr-only"> ({TIER_PILL_LABELS[normalized]})</span>
        </span>
    );
}
