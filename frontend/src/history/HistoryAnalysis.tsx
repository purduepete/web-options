import type { HistoryResponse } from '@weboptions/shared';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { elapsedTime, money, pacificTime, signedMoney, targetPrice } from './format';

export type TargetChoice = '25' | '50' | '75';

export function HistoryAnalysisTargetControl({
    target,
    onTargetChange,
}: {
    target: TargetChoice;
    onTargetChange: (value: TargetChoice) => void;
}) {
    return (
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
    );
}

export function HistoryAnalysisSummary({ history, target }: { history: HistoryResponse; target: TargetChoice }) {
    const { analysis, entry } = history;
    const selected = analysis?.targets.find((item) => item.percent === Number(target));
    const crossing = selected?.firstCrossing;
    const { best, worst, latest, giveback } = analysis ?? {};
    return !analysis ? (
        <p className="history-coverage">
            {entry && entry.mark <= 0
                ? 'A positive entry credit is required for target and giveback analysis.'
                : 'Entry quote unavailable. Target and giveback analysis unavailable.'}
        </p>
    ) : (
        <details name="history-summary" className="history-summary-details">
            <summary>
                <span className="history-summary-field">
                    <span className="history-summary-label">{target}% target:</span>
                    <strong>{selected ? money(selected.closingMark) : 'Unavailable'}</strong>
                </span>
                <span className="history-summary-field">
                    <span className="history-summary-label">Best:</span>
                    <strong>{best ? `${best.capturedPercent.toFixed(1)}%` : 'Unavailable'}</strong>
                </span>
                <span className="history-summary-field">
                    <span className="history-summary-label">Worst:</span>
                    <strong>{worst ? `${worst.capturedPercent.toFixed(1)}%` : 'Unavailable'}</strong>
                </span>
                <span className="history-summary-field">
                    <span className="history-summary-label">Giveback:</span>
                    <strong>{giveback ? `${giveback.percentagePoints.toFixed(1)} pp` : 'Unavailable'}</strong>
                </span>
            </summary>
            <div className="history-summary-body">
                <h3 className="history-analysis-details-heading">Since signal entry</h3>
                <div className="history-stats">
                    <div>
                        <small>{target}% exit target</small>
                        <strong>{selected ? `${targetPrice(selected.closingMark)} to close` : 'Unavailable'}</strong>
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
            </div>
        </details>
    );
}
