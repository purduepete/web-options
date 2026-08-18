import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { WeeklyReport, WeeklyReportSummary } from '@weboptions/shared';
import { NotFoundError, UnauthorizedError, describeFailure, fetchReport, fetchReports } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { formatMDY } from '../signals/format';
import { Loading } from '../components/Loading';
import { usePublishedHeight } from '../hooks/usePublishedHeight';
import { useWeekArrows } from '../hooks/useWeekArrows';
import { ReportSummary } from '../reports/ReportSummary';
import { ReportCallouts } from '../reports/ReportCallouts';
import './ReportWeekPage.css';

/**
 * One published weekly results report: the macro read at the top, then the
 * headline metrics, then the notable-trade callouts.
 *
 * Navigation steps to the nearest existing report by publish date, not by a
 * fixed weekly offset - report weeks are hand-ingested and will not always be
 * contiguous, unlike the trade calendar's Monday-Friday weeks.
 */
export function ReportWeekPage() {
    const { publishDate = '' } = useParams();
    const { forget } = useApiKey();
    const navigate = useNavigate();
    const [report, setReport] = useState<WeeklyReport | null>(null);
    const [reports, setReports] = useState<WeeklyReportSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const headRef = useRef<HTMLDivElement>(null);

    usePublishedHeight(headRef, '--report-head-height');

    // The archive index doubles as the map for stepping through it.
    useEffect(() => {
        let cancelled = false;
        fetchReports()
            .then((result) => {
                if (!cancelled) setReports(result.reports);
            })
            .catch((cause: Error) => {
                if (!cancelled && cause instanceof UnauthorizedError) forget();
            });
        return () => {
            cancelled = true;
        };
    }, [forget]);

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        fetchReport(publishDate)
            .then((result) => {
                if (!cancelled) setReport(result);
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                if (cause instanceof UnauthorizedError) {
                    forget();
                    return;
                }
                setError(cause instanceof NotFoundError ? 'No report was ingested for that date.' : describeFailure(cause));
            });
        return () => {
            cancelled = true;
        };
    }, [publishDate, forget]);

    // The index arrives newest first, so the older week is the next one along.
    const position = reports.findIndex((entry) => entry.publishDate === publishDate);
    const current = position >= 0 ? reports[position] : undefined;
    const older = position >= 0 ? reports[position + 1] : undefined;
    const newer = position > 0 ? reports[position - 1] : undefined;
    const earliest = reports[reports.length - 1];
    const latest = reports[0];

    const open = (entry: WeeklyReportSummary | undefined) => {
        if (entry) navigate(`/reports/${entry.publishDate}`);
    };

    useWeekArrows({ onPrevious: () => open(older), onNext: () => open(newer) });

    return (
        <main className="report-week-page">
            <div className="report-head" ref={headRef}>
                <div className="page-head">
                    {/* Empty until the week is known, same reasoning as the calendar page:
                        a name replaced a moment later reads as a page that changed underfoot. */}
                    <h1>{report ? (report.title ?? `Report for ${formatMDY(report.publishDate)}`) : ''}</h1>

                    <div className="week-nav">
                        <button
                            type="button"
                            onClick={() => open(earliest)}
                            disabled={!earliest || earliest === current}
                        >
                            First
                        </button>
                        <button type="button" onClick={() => open(older)} disabled={!older}>
                            Previous
                        </button>
                        <button type="button" onClick={() => open(newer)} disabled={!newer}>
                            Next
                        </button>
                        <button type="button" onClick={() => open(latest)} disabled={!latest || latest === current}>
                            Latest
                        </button>
                    </div>
                </div>

                {report && report.macro.length > 0 && (
                    <section className="report-macro-banner enter">
                        <ul className="report-macro-grid">
                            {report.macro.map((note) => (
                                <li key={note.label} className="report-macro-item">
                                    <b>{note.label}</b>
                                    <span>{note.text}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="report-macro-meta">published {formatMDY(report.publishDate)}</p>
                    </section>
                )}
            </div>

            {error && (
                <p className="signals-error" role="alert">
                    {error}
                </p>
            )}

            {!report && !error && <Loading label="Loading the report" />}

            {report && (
                <div className="report-body">
                    <ReportSummary metrics={report.metrics} />
                    <h2 className="report-section-heading">Notable trades</h2>
                    <ReportCallouts callouts={report.callouts} />
                </div>
            )}
        </main>
    );
}
