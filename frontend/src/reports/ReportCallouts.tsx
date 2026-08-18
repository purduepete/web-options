import type { ReportCallout } from '@weboptions/shared';
import './ReportCallouts.css';

const KIND_LABELS: Record<string, string> = {
    roll: 'Roll',
    assignment: 'Assignment',
    close: 'Close',
    note: 'Note',
};

export function ReportCallouts({ callouts }: { callouts: ReportCallout[] }) {
    if (callouts.length === 0) {
        return <p className="no-callouts">No notable trade write-ups for this week.</p>;
    }

    return (
        <div className="report-callouts" data-testid="report-callouts">
            {callouts.map((callout, index) => (
                <article className="callout-card" key={`${callout.ticker}-${callout.headline}-${index}`}>
                    <div className="callout-head">
                        <span className="callout-ticker">{callout.ticker}</span>
                        <span className={`callout-kind ${callout.kind}`}>
                            {KIND_LABELS[callout.kind] ?? callout.kind}
                        </span>
                    </div>
                    <p className="callout-headline">{callout.headline}</p>
                    {callout.body && <p className="callout-body">{callout.body}</p>}
                </article>
            ))}
        </div>
    );
}
