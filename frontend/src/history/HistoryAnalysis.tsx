import type { HistoryResponse } from '@weboptions/shared';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { elapsedTime, money, pacificTime, sessionLabel, signedMoney, targetPrice } from './format';

export type TargetChoice = '25' | '50' | '75';

export function HistoryAnalysis({
    history,
    target,
    onTargetChange,
}: {
    history: HistoryResponse;
    target: TargetChoice;
    onTargetChange: (value: TargetChoice) => void;
}) {
    const { analysis, entry } = history;
    const selected = analysis?.targets.find((item) => item.percent === Number(target));
    const crossing = selected?.firstCrossing;
    const { best, worst, latest, giveback } = analysis ?? {};
    return (
        <section className="history-analysis" aria-label="Exit targets and observed results">
            <div className="history-chart-head">
                <h3>Since signal entry</h3>
                <ChoiceMenu
                    name="Exit target"
                    icon={null}
                    value={target}
                    onChange={onTargetChange}
                    options={(['25', '50', '75'] as const).map((value) => ({
                        value,
                        label: `${value}%`,
                        description: 'Premium captured',
                    }))}
                />
            </div>
            <p className="history-coverage">
                All collected history since{' '}
                {history.signalDate ? sessionLabel(history.signalDate) : 'the selected signal'}, independent of chart
                dates. Sampled marks, hypothetical dollars per standard 100-share contract. Fees and actual fills
                excluded.
            </p>
            {!analysis ? (
                <p className="history-coverage">
                    {entry && entry.mark <= 0
                        ? 'A positive entry credit is required for target and giveback analysis.'
                        : 'Entry quote unavailable. Target and giveback analysis unavailable.'}
                </p>
            ) : (
                <>
                    <div className="history-stats">
                        <div>
                            <small>{target}% exit target</small>
                            <strong>
                                {selected ? `${targetPrice(selected.closingMark)} to close` : 'Unavailable'}
                            </strong>
                            <small>Mark at or below this price per share</small>
                            {entry && <span>{money(entry.mark * Number(target))} target credit retained</span>}
                            {crossing ? (
                                <>
                                    <span>First observed crossing {pacificTime(crossing.time)}</span>
                                    <span>
                                        {crossing.capturedPercent.toFixed(1)}% · {signedMoney(crossing.dollars)}
                                    </span>
                                    <small>{elapsedTime(entry?.capturedAt ?? null, crossing.time)}</small>
                                </>
                            ) : (
                                <span>
                                    {analysis.validMarks
                                        ? 'Not observed in collected history'
                                        : 'No valid post-entry marks'}
                                </span>
                            )}
                        </div>
                        <div>
                            <small>Best observed</small>
                            <strong>{best ? `${best.capturedPercent.toFixed(1)}%` : 'Unavailable'}</strong>
                            {best && (
                                <>
                                    <span>
                                        {signedMoney(best.dollars)} · Mark {money(best.mark)}
                                    </span>
                                    <small>{pacificTime(best.time)}</small>
                                </>
                            )}
                        </div>
                        <div>
                            <small>Worst observed</small>
                            <strong>{worst ? `${worst.capturedPercent.toFixed(1)}%` : 'Unavailable'}</strong>
                            {worst && (
                                <>
                                    <span>
                                        {signedMoney(worst.dollars)} · Mark {money(worst.mark)}
                                    </span>
                                    <small>{pacificTime(worst.time)}</small>
                                </>
                            )}
                        </div>
                        <div>
                            <small>Giveback from best</small>
                            <strong>{giveback ? `${giveback.percentagePoints.toFixed(1)} pp` : 'Unavailable'}</strong>
                            {giveback && latest && (
                                <>
                                    <span>{money(giveback.dollars)} decline from best to latest</span>
                                    <span>
                                        Latest {latest.capturedPercent.toFixed(1)}% · {signedMoney(latest.dollars)}
                                    </span>
                                    <small>{pacificTime(latest.time)}</small>
                                </>
                            )}
                        </div>
                    </div>
                    <p className="history-coverage">
                        {analysis.validMarks} valid marks; {analysis.recordedGaps} recorded captures without a valid
                        mark.
                        {analysis.firstObservedAt !== null && (
                            <> Observed from {pacificTime(analysis.firstObservedAt)}.</>
                        )}
                        {analysis.through !== null && <> Captures through {pacificTime(analysis.through)}.</>}{' '}
                        Unrecorded periods and moves between samples are unknown. A crossing does not establish an
                        executable fill. Elapsed time includes nights and weekends.
                    </p>
                </>
            )}
        </section>
    );
}
