import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    WRAPUP_SECTIONS,
    type WeeklyWrapup,
    type WrapupRow,
    type WrapupSectionKey,
    type WrapupSummary,
    type WrapupTable,
} from '@weboptions/shared';
import { describeFailure, fetchWrapup, fetchWrapups, NotFoundError, UnauthorizedError } from '../api';
import { useApiKey } from '../auth/ApiKeyProvider';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { CalendarIcon } from '../components/icons';
import { Loading } from '../components/Loading';
import { useFirstLoadPending } from '../hooks/useFirstLoad';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { formatMDY } from '../signals/format';
import './WeeklyWrapupPage.css';
import { guidanceRowId } from '../signals/weeklyGuidance';

const LABELS: Record<WrapupSectionKey, string> = {
    management: 'Management Plan',
    closed: 'Closed Trades',
    rolls: 'Rolls',
};
const VIEW_KEY = 'weekly_wrapup_view';

function savedView(): WrapupSectionKey {
    try {
        const value = localStorage.getItem(VIEW_KEY);
        return WRAPUP_SECTIONS.find((key) => key === value) ?? 'management';
    } catch {
        return 'management';
    }
}

function cellText(header: string, value: string): string {
    if (!value) return 'Not supplied';
    if (header === 'Exp' || header === 'Opened') return formatMDY(value);
    if (header === 'Old Position' || header === 'New Position') {
        return value.replace(/\d{4}-\d{2}-\d{2}/g, formatMDY);
    }
    return value;
}

function ReportRow({ row, table }: { row: WrapupRow; table: WrapupTable }) {
    const fields = table.headers.map((header, index) => ({ header, value: row.cells[index] ?? '' }));
    const field = (name: string) => fields.find(({ header }) => header === name)?.value;
    const note = field('Management Plan');
    const zone = field('Zone')?.toLowerCase();
    return (
        <article
            className="wrapup-card"
            id={table.kind === 'management' ? guidanceRowId(row.sourceRow) : undefined}
            tabIndex={-1}
        >
            <header className="wrapup-card-head">
                <h3>
                    {row.contract.symbol} <span>${row.contract.strike} put</span>
                </h3>
                {zone && <span className={`wrapup-zone wrapup-zone-${zone}`}>{field('Zone')}</span>}
                {field('This Week') && <strong>{field('This Week')}</strong>}
                <small>Source row {row.sourceRow}</small>
            </header>
            {field('Category') && <p className="wrapup-category">{field('Category')}</p>}
            <dl className="wrapup-fields">
                {fields
                    .filter(
                        ({ header }) =>
                            !['#', 'Ticker', 'Zone', 'This Week', 'Category', 'Management Plan'].includes(header)
                    )
                    .map(({ header, value }) => (
                        <div key={header}>
                            <dt>{header}</dt>
                            <dd>{cellText(header, value)}</dd>
                        </div>
                    ))}
            </dl>
            {note && <p className="wrapup-guidance">{note}</p>}
        </article>
    );
}

export function WeeklyWrapupPage() {
    const [params, setParams] = useSearchParams();
    const requested = params.get('report');
    const { forget } = useApiKey();
    const [reports, setReports] = useState<WrapupSummary[]>([]);
    const [report, setReport] = useState<WeeklyWrapup | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [storedView, setStoredView] = useState(savedView);
    const view = WRAPUP_SECTIONS.find((key) => key === params.get('view')) ?? storedView;
    const [shownView, setShownView] = useState(view);
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    useFirstLoadPending(loading && !report, error !== null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const index = await fetchWrapups();
                const id = requested ?? index.reports[0]?.id;
                const next = id ? await fetchWrapup(id) : null;
                if (!cancelled) {
                    setReports(index.reports);
                    setReport(next);
                }
            } catch (cause) {
                if (!cancelled) {
                    if (cause instanceof UnauthorizedError) forget();
                    else
                        setError(
                            cause instanceof NotFoundError
                                ? 'That weekly report is not available.'
                                : describeFailure(cause)
                        );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [requested, retry, forget]);

    useEffect(() => {
        if (shownView === view) return;
        if (reducedMotion) {
            setShownView(view);
            return;
        }
        const timer = setTimeout(() => setShownView(view), 250);
        return () => clearTimeout(timer);
    }, [view, shownView, reducedMotion]);

    const requestedRow = params.get('row');
    useEffect(() => {
        if (
            !report ||
            loading ||
            view !== 'management' ||
            shownView !== view ||
            !requestedRow ||
            !/^[1-9]\d{0,4}$/.test(requestedRow)
        )
            return;
        const element = document.getElementById(guidanceRowId(Number(requestedRow)));
        element?.scrollIntoView({ block: 'center', behavior: 'instant' });
        element?.focus({ preventScroll: true });
    }, [report, loading, view, shownView, requestedRow]);

    const section = report?.sections[shownView];
    const rowCount = section?.tables.reduce((count, table) => count + table.rows.length, 0) ?? 0;
    return (
        <main className="weekly-wrapup-page">
            <div className="page-head">
                <h1>Weekly Wrap-up</h1>
                {report && (
                    <ChoiceMenu
                        name="Report"
                        icon={<CalendarIcon width={14} height={14} />}
                        value={report.id}
                        options={reports.map((item) => ({
                            value: item.id,
                            label: `${formatMDY(item.start)} - ${formatMDY(item.end)}`,
                            description: 'Publisher report, puts only',
                        }))}
                        onChange={(id) => {
                            const next = new URLSearchParams(params);
                            next.set('report', id);
                            next.delete('row');
                            setParams(next);
                        }}
                    />
                )}
            </div>
            {error && (
                <div className="signals-error" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={() => setRetry((value) => value + 1)}>
                        Retry
                    </button>
                </div>
            )}
            {loading && !report && <Loading page label="Loading the weekly wrap-up" />}
            {!loading && !error && !report && (
                <section className="wrapup-empty enter">
                    <h2>No weekly reports imported</h2>
                    <p>
                        Import a workbook with the operator tool to see put management plans, closed trades, and rolls
                        here.
                    </p>
                </section>
            )}
            {report && section && (
                <div className="enter">
                    <p className="wrapup-source">
                        <strong>Puts only</strong>
                        <span>Publisher examples, not your holdings or returns.</span>
                        <a href={report.sourceUrl} target="_blank" rel="noreferrer">
                            Source report
                        </a>
                    </p>
                    <div
                        className="wrapup-switch"
                        role="group"
                        aria-label="Weekly report view"
                        style={{ '--view-index': WRAPUP_SECTIONS.indexOf(view) } as React.CSSProperties}
                    >
                        {WRAPUP_SECTIONS.map((key) => (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={view === key}
                                onClick={() => {
                                    setStoredView(key);
                                    const next = new URLSearchParams(params);
                                    next.set('view', key);
                                    next.delete('row');
                                    setParams(next);
                                    try {
                                        localStorage.setItem(VIEW_KEY, key);
                                    } catch {
                                        /* Session selection still works. */
                                    }
                                }}
                            >
                                {LABELS[key]}
                            </button>
                        ))}
                    </div>
                    <div
                        className="wrapup-content"
                        data-leaving={(!reducedMotion && view !== shownView) || undefined}
                        aria-busy={loading}
                    >
                        <section aria-label={section.name}>
                            <div className="wrapup-section-head">
                                <h2>{section.name}</h2>
                                <p>
                                    {shownView === 'management' ? 'Guidance' : 'Reporting period'}:{' '}
                                    {formatMDY(section.start)} - {formatMDY(section.end)}
                                    {section.quoteDate && <> · Quotes: {formatMDY(section.quoteDate)}</>}
                                </p>
                                <p className="muted">
                                    {rowCount} put {rowCount === 1 ? 'row' : 'rows'} · {section.audit.calls.length} call
                                    rows excluded · {section.audit.notes.length} metadata and summary rows excluded
                                </p>
                            </div>
                            {section.tables.map((table) => (
                                <section
                                    key={table.kind}
                                    className="wrapup-table"
                                    aria-label={
                                        table.kind === 'controlled' ? 'Controlled exits' : section.name + ' rows'
                                    }
                                >
                                    {table.kind === 'controlled' && <h3>Controlled exits (roll close-legs)</h3>}
                                    {table.kind === 'rolls' && (
                                        <p className="muted">
                                            Close-leg P&amp;L is realized. Roll transaction net is a separate cash flow;
                                            it is not additional realized profit.
                                        </p>
                                    )}
                                    {table.rows.length === 0 ? (
                                        <p>No put rows in this table.</p>
                                    ) : (
                                        table.rows.map((row) => (
                                            <ReportRow key={row.sourceRow} row={row} table={table} />
                                        ))
                                    )}
                                </section>
                            ))}
                        </section>
                    </div>
                </div>
            )}
        </main>
    );
}
