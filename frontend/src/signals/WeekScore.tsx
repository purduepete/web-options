import type { DaySignals, NumberSource } from '@weboptions/shared';
import { formatMoney, formatPercent } from './format';
import { summarizeWeek } from './summary';
import { AppliedFilters, type AppliedFilter } from './AppliedFilters';
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
    appliedFilters?: readonly AppliedFilter[];
}) {
    const { signals, priced, otm, premiumDrift, driftSamples, totalPremium, premiumUsesFallback, totalCollateral } =
        summarizeWeek(days, numberSource);
    const unpriced = signals - priced;

    return (
        <p className="week-score">
            <span>
                <b>{signals}</b> {signals === 1 ? 'signal' : 'signals'}
            </span>

            {totalPremium !== null && (
                <span>
                    Premium:{' '}
                    <b
                        className={premiumUsesFallback ? 'value-quoted' : undefined}
                        data-tip={
                            premiumUsesFallback
                                ? 'Includes contracts with no captured quote, counted at their recommended values'
                                : undefined
                        }
                    >
                        {formatMoney(totalPremium)}
                    </b>
                </span>
            )}

            {totalCollateral !== null && (
                <span>
                    Collateral: <b>{formatMoney(totalCollateral)}</b>
                </span>
            )}

            {priced > 0 && (
                <span
                    className="score-otm"
                    data-tip={unpriced > 0 ? `${unpriced} have no close of their own yet.` : undefined}
                >
                    <b className={otm === priced ? 'clean' : undefined}>
                        {otm} of {priced}
                    </b>{' '}
                    closed OTM ({formatPercent((otm / priced) * 100)})
                </span>
            )}

            {premiumDrift !== null && <Drift value={premiumDrift} samples={driftSamples} />}

            <AppliedFilters filters={appliedFilters} className="score-filters" />
        </p>
    );
}

function Drift({ value, samples }: { value: number; samples: number }) {
    // Round before reading the sign, so a rounding remainder cannot print "0.0% under".
    const rounded = Number(value.toFixed(1));
    const title = `Averaged over the ${samples} contracts quoted on the morning they were signalled.`;

    if (rounded === 0) {
        return <span data-tip={title}>Actual premium matched VADER</span>;
    }

    return (
        <span className={`score-drift ${rounded < 0 ? 'under' : 'over'}`} data-tip={title}>
            Actual premium <b>{Math.abs(rounded).toFixed(1)}%</b> {rounded < 0 ? 'under' : 'over'} VADER
        </span>
    );
}
