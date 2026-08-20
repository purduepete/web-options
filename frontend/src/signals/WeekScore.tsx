import type { DaySignals, NumberSource } from '@weboptions/shared';
import { formatPercent } from './format';
import { summarizeWeek } from './summary';
import './WeekScore.css';

/**
 * How the week went, in one line.
 *
 * It scores the days the grid is drawing, filters and all, so narrowing to a
 * single symbol asks the same question of that symbol alone.
 */
export function WeekScore({
    days,
    numberSource,
    appliedFilters = [],
}: {
    days: DaySignals[];
    numberSource: NumberSource;
    appliedFilters?: readonly string[];
}) {
    const { signals, priced, otm, premiumDrift, driftSamples } = summarizeWeek(days, numberSource);
    const unpriced = signals - priced;

    return (
        <p className="week-score">
            <span>
                <b>{signals}</b> {signals === 1 ? 'signal' : 'signals'}
            </span>

            {priced > 0 && (
                <span
                    className="score-otm"
                    title={unpriced > 0 ? `${unpriced} have no close of their own yet.` : undefined}
                >
                    <b className={otm === priced ? 'clean' : undefined}>
                        {otm} of {priced}
                    </b>{' '}
                    closed OTM ({formatPercent((otm / priced) * 100)})
                </span>
            )}

            {premiumDrift !== null && <Drift value={premiumDrift} samples={driftSamples} />}

            {appliedFilters.length > 0 && (
                <span className="score-filters" aria-label="Applied filters">
                    {appliedFilters.map((filter) => (
                        <span key={filter} className="score-filter">
                            {filter}
                        </span>
                    ))}
                </span>
            )}
        </p>
    );
}

function Drift({ value, samples }: { value: number; samples: number }) {
    // Round before reading the sign, so a rounding remainder cannot print "0.0% under".
    const rounded = Number(value.toFixed(1));
    const title = `Averaged over the ${samples} contracts quoted on the morning they were signalled.`;

    if (rounded === 0) {
        return <span title={title}>Premium landed on VADER&rsquo;s number</span>;
    }

    return (
        <span className={`score-drift ${rounded < 0 ? 'under' : 'over'}`} title={title}>
            Premium <b>{Math.abs(rounded).toFixed(1)}%</b> {rounded < 0 ? 'under' : 'over'} VADER
        </span>
    );
}
