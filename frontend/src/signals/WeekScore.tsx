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
export function WeekScore({ days, numberSource }: { days: DaySignals[]; numberSource: NumberSource }) {
    const { signals, priced, otm, premiumDrift, driftSamples } = summarizeWeek(days, numberSource);
    if (signals === 0) return null;

    const unpriced = signals - priced;

    return (
        <p className="week-score">
            <span>
                <b>{signals}</b> {signals === 1 ? 'signal' : 'signals'}
            </span>

            {priced > 0 && (
                <span title={unpriced > 0 ? `${unpriced} have no close of their own yet.` : undefined}>
                    <b className={otm === priced ? 'clean' : undefined}>
                        {otm} of {priced}
                    </b>{' '}
                    closed OTM ({formatPercent((otm / priced) * 100)})
                </span>
            )}

            {premiumDrift !== null && <Drift value={premiumDrift} samples={driftSamples} />}
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
