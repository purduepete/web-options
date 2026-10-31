import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    CartesianGrid,
    Dot,
    Legend,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { DotItemDotProps } from 'recharts';
import type { HistoryPoint, HistoryResponse } from '@weboptions/shared';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { InfoIcon } from '../components/icons';
import {
    axisTime,
    chartPoints,
    deltaText,
    evenTicks,
    fitDomain,
    historyCaptureDotRadius,
    money,
    pacificTime,
    sessionLabel,
    signedDelta,
    signedMoney,
} from './format';
import type { TargetChoice } from './HistoryAnalysis';

type ChartPoint = ReturnType<typeof chartPoints>[number];

const Y_AXIS_WIDTH = 56;
const AXIS_TAG_WIDTH = 46;

type ChangeField = 'mark' | 'delta' | 'underlyingPrice';

interface ValueChange {
    value: number;
    percent: number | null;
}

interface SessionChange {
    sessionDate: string;
    slot: number;
    mark: ValueChange | null;
    delta: ValueChange | null;
    underlying: ValueChange | null;
}

function valueOf(point: HistoryPoint, field: ChangeField): number | null {
    if ((field === 'mark' || field === 'delta') && point.overrides?.some((override) => override.field === field)) {
        return null;
    }
    const value = point[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function changeBetween(previous: HistoryPoint[], current: HistoryPoint[], field: ChangeField): ValueChange | null {
    const before = [...previous].reverse().find((point) => valueOf(point, field) !== null);
    const after = current.find((point) => valueOf(point, field) !== null);
    if (!before || !after) return null;
    const beforeValue = valueOf(before, field)!;
    const change = valueOf(after, field)! - beforeValue;
    return {
        value: change,
        percent: beforeValue === 0 ? null : (change / beforeValue) * 100,
    };
}

function buildSessionChanges(points: ChartPoint[]): SessionChange[] {
    const sessions: { sessionDate: string; points: ChartPoint[] }[] = [];
    for (const point of points) {
        const latest = sessions.at(-1);
        if (latest?.sessionDate === point.sessionDate) latest.points.push(point);
        else sessions.push({ sessionDate: point.sessionDate, points: [point] });
    }
    return sessions.slice(1).map((current, index) => {
        const previous = sessions[index]!;
        return {
            sessionDate: current.sessionDate,
            slot: current.points[0]!.slot - 0.5,
            mark: changeBetween(previous.points, current.points, 'mark'),
            delta: changeBetween(previous.points, current.points, 'delta'),
            underlying: changeBetween(previous.points, current.points, 'underlyingPrice'),
        };
    });
}

function formatPercentChange(change: ValueChange) {
    return `${change.percent === null ? '' : ` (${change.percent >= 0 ? '+' : ''}${change.percent.toFixed(1)}%)`}`;
}

function sessionChangeLabel(change: SessionChange) {
    return [
        `Mark ${change.mark ? `${signedMoney(change.mark.value)}${formatPercentChange(change.mark)}` : 'Unavailable'}`,
        `Delta ${change.delta ? signedDelta(change.delta.value) : 'Unavailable'}`,
        `Stock ${
            change.underlying
                ? `${signedMoney(change.underlying.value)}${formatPercentChange(change.underlying)}`
                : 'Unavailable'
        }`,
    ].join(' · ');
}

export function HistoryCoverageInfo({ history }: { history: HistoryResponse }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const hovered = useRef(false);
    const focused = useRef(false);
    const suppressFocusOpen = useRef(false);
    const tooltipId = useId();
    const points = history.points.filter((point) => point.kind !== 'session_boundary');
    const overrides = points.filter((point) => point.overrides?.length).length;
    const flagCounts = new Map<string, number>();
    for (const point of points) {
        for (const flag of new Set(point.flags)) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
    const qualitySlots = points.filter(
        (point) => point.reason || point.flags.length > 0 || (point.overrides?.length ?? 0) > 0
    ).length;
    const coverage = history.coverage;

    useLayoutEffect(() => {
        if (!open) return;
        const positionTooltip = () => {
            const trigger = triggerRef.current;
            const tooltip = tooltipRef.current;
            if (!trigger || !tooltip) return;
            const triggerRect = trigger.getBoundingClientRect();
            const gutter = 8;
            const below = triggerRect.bottom + gutter;
            const belowSpace = window.innerHeight - gutter - below;
            const aboveSpace = triggerRect.top - gutter * 2;
            const useBelow = belowSpace >= Math.min(200, tooltip.scrollHeight) || belowSpace >= aboveSpace;
            const availableSpace = Math.max(0, useBelow ? belowSpace : aboveSpace);
            const maxHeight = Math.min(384, window.innerHeight * 0.65, availableSpace);
            tooltip.style.maxHeight = `${maxHeight}px`;
            const tooltipRect = tooltip.getBoundingClientRect();
            const left = Math.max(gutter, Math.min(triggerRect.left, window.innerWidth - tooltipRect.width - gutter));
            const top = useBelow ? below : Math.max(gutter, triggerRect.top - tooltipRect.height - gutter);
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        };
        positionTooltip();
        window.addEventListener('resize', positionTooltip);
        window.addEventListener('scroll', positionTooltip, true);
        return () => {
            window.removeEventListener('resize', positionTooltip);
            window.removeEventListener('scroll', positionTooltip, true);
        };
    }, [history, open]);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            suppressFocusOpen.current = true;
            triggerRef.current?.focus();
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <span
            ref={rootRef}
            className="history-coverage-info"
            onMouseEnter={() => {
                hovered.current = true;
                setOpen(true);
            }}
            onMouseLeave={() => {
                hovered.current = false;
                if (!focused.current) setOpen(false);
            }}
        >
            <button
                ref={triggerRef}
                className="history-coverage-trigger"
                type="button"
                aria-label="Coverage and data quality"
                aria-describedby={tooltipId}
                aria-controls={tooltipId}
                aria-expanded={open}
                onFocus={() => {
                    focused.current = true;
                    if (!suppressFocusOpen.current) setOpen(true);
                }}
                onBlur={(event) => {
                    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
                    focused.current = false;
                    suppressFocusOpen.current = false;
                    if (!hovered.current) setOpen(false);
                }}
                onClick={() => setOpen(true)}
            >
                <InfoIcon width={15} height={15} />
            </button>
            <div ref={tooltipRef} id={tooltipId} className="history-coverage-tooltip" data-open={open} role="tooltip">
                <strong>Coverage and data quality</strong>
                <div className="history-coverage-counts">
                    <span>{coverage.observations} observations</span>
                    <span>{coverage.validPrices} valid prices</span>
                    <span>{coverage.validDeltas} valid deltas</span>
                    <span>{coverage.knownExpected} known expected</span>
                    <span>{coverage.knownPriceGaps} price gaps</span>
                    <span>{coverage.knownDeltaGaps} delta gaps</span>
                    <span>{coverage.unknownSlots} unknown slots</span>
                    <span>{overrides} overridden captures</span>
                    {[...flagCounts.entries()].map(([flag, count]) => (
                        <span key={flag}>
                            {flag.replaceAll('_', ' ')}: {count}
                        </span>
                    ))}
                    {flagCounts.size === 0 && <span>No flagged captures</span>}
                </div>
                <div className="history-coverage-notes">
                    <span>{qualitySlots} chart positions marked for gaps, flags or overrides</span>
                    {history.warnings.length > 0 && (
                        <ul>
                            {history.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </span>
    );
}

function HistorySessionChanges({
    changes,
    onSessionSelect,
}: {
    changes: SessionChange[];
    onSessionSelect: (date: string) => void;
}) {
    if (changes.length === 0) return null;
    return (
        <section className="history-session-changes" aria-label="Overnight changes">
            <strong>Overnight changes</strong>
            <div>
                {changes.map((change) => (
                    <button
                        key={change.sessionDate}
                        type="button"
                        aria-label={`Open ${sessionLabel(change.sessionDate)} in intraday view. ${sessionChangeLabel(change)}`}
                        onClick={() => onSessionSelect(change.sessionDate)}
                    >
                        <span>{sessionLabel(change.sessionDate)}</span>
                        <span>{sessionChangeLabel(change)}</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

// Labels an entry line on its own axis: a small tag over the tick column, plus
// "Entry" just inside the plot so the line explains itself.
function EntryAxisTag({
    viewBox,
    side,
    text,
    color,
}: {
    viewBox?: { x?: number; y?: number; width?: number };
    side: 'left' | 'right';
    text: string;
    color: string;
}) {
    if (!viewBox || viewBox.y === undefined || viewBox.x === undefined) return null;
    const plotLeft = viewBox.x;
    const plotRight = viewBox.x + (viewBox.width ?? 0);
    const tagX = side === 'right' ? plotRight + 1 : plotLeft - AXIS_TAG_WIDTH - 1;
    const y = viewBox.y;
    return (
        <g className="history-entry-tag" pointerEvents="none">
            <rect
                x={tagX}
                y={y - 8}
                width={AXIS_TAG_WIDTH}
                height={16}
                fill="var(--surface)"
                stroke={color}
                strokeOpacity={0.6}
            />
            <text x={tagX + AXIS_TAG_WIDTH / 2} y={y} dy="0.35em" textAnchor="middle" fill={color} fontSize={10.5}>
                {text}
            </text>
            <text
                x={side === 'right' ? plotRight - 4 : plotLeft + 4}
                y={y - 4}
                textAnchor={side === 'right' ? 'end' : 'start'}
                fill={color}
                fillOpacity={0.8}
                fontSize={10.5}
            >
                Entry
            </text>
        </g>
    );
}

export type ChartView = 'option' | 'stock';
export type ChartMetric = 'price' | 'captured';
const VIEW_KEY = 'history_chart_view';

export function HistoryViewSwitch({ view, setView }: { view: ChartView; setView: (next: ChartView) => void }) {
    return (
        <div className="history-chart-switch" data-view={view} role="group" aria-label="Chart view">
            {(['stock', 'option'] as const).map((choice) => (
                <button
                    key={choice}
                    type="button"
                    aria-pressed={view === choice}
                    onClick={() => {
                        setView(choice);
                        try {
                            localStorage.setItem(VIEW_KEY, choice);
                        } catch {
                            console.warn('Chart view could not be saved. It will apply for this visit.');
                        }
                    }}
                >
                    {choice === 'option' ? 'Option' : 'Stock'}
                </button>
            ))}
        </div>
    );
}

export function HistoryChartControls({
    history,
    metric,
    setMetric,
    view,
}: {
    history: HistoryResponse;
    metric: ChartMetric;
    setMetric: (next: ChartMetric) => void;
    view: ChartView;
}) {
    const stockValues = history.points
        .filter((point) => point.kind !== 'session_boundary')
        .map((point) => point.underlyingPrice);
    const hasStock = stockValues.some((value) => value !== null);
    const stockDomain = fitDomain(stockValues, 0.1, [0, Number.POSITIVE_INFINITY]);
    const strikeInScale = history.contract.strike >= stockDomain[0] && history.contract.strike <= stockDomain[1];
    return (
        <div className="history-chart-context">
            {view === 'option' ? (
                <ChoiceMenu
                    name="Chart"
                    icon={null}
                    value={metric}
                    onChange={setMetric}
                    options={[
                        { value: 'price', label: 'Price', description: 'Mark dollars per share' },
                        {
                            value: 'captured',
                            label: 'Captured %',
                            description: 'Entry credit captured, mark-based',
                        },
                    ]}
                />
            ) : (
                <span>
                    Strike {money(history.contract.strike)}
                    {hasStock && !strikeInScale
                        ? ` ${history.contract.strike < stockDomain[0] ? 'below' : 'above'} chart range`
                        : ''}
                    {' · Shaded below strike = ITM'}
                </span>
            )}
        </div>
    );
}

const PANES = ['option', 'stock'] as const;

function HistoryCaptureDot({ cx, cy, fill, stroke, strokeWidth, payload }: DotItemDotProps) {
    return (
        <Dot
            cx={cx}
            cy={cy}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            r={historyCaptureDotRadius(payload.kind)}
        />
    );
}

function OverrideNotes({ point }: { point: HistoryPoint }) {
    if (!point.overrides?.length) return null;
    return (
        <>
            {point.overrides.map((item) => (
                <small key={item.field} className="history-tooltip-override">
                    {item.field === 'mark' ? 'Mark' : 'Delta'} held from {pacificTime(item.sourceTime).slice(-5)};
                    captured {item.field === 'mark' ? money(item.original) : deltaText(item.original)}
                    <br />
                    {item.reason}
                </small>
            ))}
        </>
    );
}

/**
 * Building a chart blocks the page for a few hundred milliseconds, so the
 * Option/Stock switch never builds one on click. Each pane stays mounted once
 * built, the other one is built shortly after the first paints, and the
 * switch only crossfades them.
 */
export function HistoryCharts({
    history,
    metric,
    target,
    view,
    onSessionSelect,
}: {
    history: HistoryResponse;
    metric: ChartMetric;
    target: TargetChoice;
    view: ChartView;
    onSessionSelect: (date: string) => void;
}) {
    const [built, setBuilt] = useState<ReadonlySet<ChartView>>(() => new Set([view]));
    const ready = built.has(view);
    // Until the chosen pane exists, keep showing the one that does.
    const active = ready ? view : (PANES.find((pane) => built.has(pane)) ?? view);
    // Build the other pane soon after the first one paints. Safari has no
    // requestIdleCallback, so it falls back to a short timer.
    useEffect(() => {
        const buildAll = () => setBuilt(new Set(PANES));
        if (typeof requestIdleCallback === 'function') {
            const id = requestIdleCallback(buildAll, { timeout: 400 });
            return () => cancelIdleCallback(id);
        }
        const id = setTimeout(buildAll, 200);
        return () => clearTimeout(id);
    }, []);
    // A click that beats the prebuild lets the switch repaint first, then builds.
    useEffect(() => {
        if (ready) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const frame = requestAnimationFrame(() => {
            timer = setTimeout(() => setBuilt((current) => new Set([...current, view])), 0);
        });
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
        };
    }, [ready, view]);
    const points = useMemo(() => chartPoints(history, metric), [history, metric]);
    const sessionChanges = useMemo(() => buildSessionChanges(points), [points]);
    return (
        <>
            <div className="history-chart-stack">
                {PANES.filter((pane) => built.has(pane)).map((pane) => (
                    <div
                        key={pane}
                        className="history-chart-pane"
                        data-active={pane === active}
                        aria-hidden={pane === active ? undefined : true}
                        inert={pane !== active}
                    >
                        <ChartPane
                            history={history}
                            metric={metric}
                            target={target}
                            view={pane}
                            sessionChanges={sessionChanges}
                        />
                    </div>
                ))}
            </div>
            <HistorySessionChanges changes={sessionChanges} onSessionSelect={onSessionSelect} />
        </>
    );
}

// Drawing a chart takes about 150ms, so the page's own re-renders (a contract
// click, the loading flag, the view switch) must not redraw it with the same data.
const ChartPane = memo(function ChartPane({
    history,
    metric,
    target,
    view,
    sessionChanges,
}: {
    history: HistoryResponse;
    metric: ChartMetric;
    target: TargetChoice;
    view: ChartView;
    sessionChanges: SessionChange[];
}) {
    const syncId = useId();
    const percentage = metric === 'captured';
    const points = useMemo(() => chartPoints(history, metric), [history, metric]);
    const values = points.map((point) => (percentage ? point.captured : point.mark));
    const entryPrice = !percentage && history.entry ? history.entry.mark : null;
    const entryDelta = history.entry?.delta ?? null;
    const domainValues = [...values, entryPrice];
    const priceDomain = fitDomain(
        domainValues,
        percentage ? 2 : 0.1,
        domainValues.some((value) => value !== null && Number.isFinite(value))
            ? percentage
                ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
                : [0, Number.POSITIVE_INFINITY]
            : percentage
              ? [-1, 1]
              : [0, 1]
    );
    const deltaDomain = fitDomain([...points.map((point) => point.delta), entryDelta], 0.02, [-1, 1]);
    const stockValues = points.map((point) => point.underlyingPrice);
    const hasStock = stockValues.some((value) => value !== null);
    const stockDomain = fitDomain(stockValues, 0.1, [0, Number.POSITIVE_INFINITY]);
    const strikeInScale = history.contract.strike >= stockDomain[0] && history.contract.strike <= stockDomain[1];
    const start = points[0]?.time;
    const end = points.at(-1)?.time;
    const exitTarget = history.analysis?.targets.find((item) => item.percent === Number(target));
    const targetValue = exitTarget ? (percentage ? exitTarget.percent : exitTarget.closingMark) : null;
    const targetInScale = targetValue !== null && targetValue >= priceDomain[0] && targetValue <= priceDomain[1];
    const inView = (time: number) => start !== undefined && end !== undefined && time >= start && time <= end;
    const heldSlots = points.filter((point) => (point.overrides?.length ?? 0) > 0).map((point) => point.slot);
    const qualitySlots = points
        .filter((point) => point.reason || point.flags.length > 0 || (point.overrides?.length ?? 0) > 0)
        .map((point) => point.slot);
    const firstCrossing = exitTarget?.firstCrossing;
    const best = history.analysis?.best;
    const tick = { fill: 'var(--text-muted)', fontSize: 11 };
    // Charts plot by sample position, so overnight, weekend and holiday gaps take no width.
    const slotOf = (time: number) => {
        let index = -1;
        for (let i = 0; i < points.length && points[i]!.time <= time; i++) index = i;
        if (index < 0) return 0;
        const next = points[index + 1];
        if (!next) return index;
        return index + (time - points[index]!.time) / (next.time - points[index]!.time);
    };
    const lastSlot = Math.max(points.length - 1, 0);
    const tickCount = Math.min(points.length, 6);
    const slotTicks = Array.from({ length: tickCount }, (_, i) =>
        tickCount > 1 ? (i * lastSlot) / (tickCount - 1) : 0
    );
    const xAxis = (
        <XAxis
            type="number"
            dataKey="slot"
            domain={[0, lastSlot]}
            ticks={slotTicks}
            interval={0}
            height={42}
            tick={({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value: number } }) => {
                const point = payload ? points[Math.round(payload.value)] : undefined;
                const label = point ? axisTime(point.time, history.from !== history.to).split(' ') : [];
                return (
                    <text x={x} y={Number(y) + 9} textAnchor="middle" fill={tick.fill} fontSize={tick.fontSize}>
                        {label.map((part, i) => (
                            <tspan key={i} x={x} dy={i === 0 ? 0 : 13}>
                                {part}
                            </tspan>
                        ))}
                    </text>
                );
            }}
        />
    );

    return (
        <>
            {view === 'option' ? (
                <>
                    {percentage && !history.entry && (
                        <p className="history-coverage">
                            Entry quote unavailable. Captured percentages cannot be calculated.
                        </p>
                    )}
                    <div
                        className="history-chart"
                        role="img"
                        aria-label={`Signed delta on the left axis, ${percentage ? 'premium captured percent' : 'mark price'} on the right. Solid vertical lines mark session changes; amber ticks mark gaps, flags or overrides.`}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                data={points}
                                syncId={syncId}
                                syncMethod="value"
                                margin={{ top: 12, right: 0, bottom: 16, left: 0 }}
                            >
                                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                                {xAxis}
                                <YAxis
                                    yAxisId="price"
                                    orientation="right"
                                    width={Y_AXIS_WIDTH}
                                    domain={priceDomain}
                                    ticks={evenTicks(priceDomain)}
                                    interval={0}
                                    tick={tick}
                                    tickFormatter={(value: number) =>
                                        percentage ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`
                                    }
                                />
                                <YAxis
                                    yAxisId="delta"
                                    orientation="left"
                                    width={Y_AXIS_WIDTH}
                                    domain={deltaDomain}
                                    ticks={evenTicks(deltaDomain)}
                                    interval={0}
                                    tick={tick}
                                    tickFormatter={(value: number) => value.toFixed(3)}
                                />
                                {sessionChanges.map((change) => (
                                    <ReferenceLine
                                        key={`session-${change.sessionDate}`}
                                        x={change.slot}
                                        yAxisId="price"
                                        className="history-session-divider"
                                        stroke="var(--text-muted)"
                                        strokeOpacity={0.4}
                                    />
                                ))}
                                {qualitySlots.map((slot) => (
                                    <ReferenceLine
                                        key={`quality-${slot}`}
                                        x={slot}
                                        yAxisId="price"
                                        className="history-quality-marker"
                                        stroke="var(--warning)"
                                        strokeOpacity={0.3}
                                        strokeDasharray="1 3"
                                    />
                                ))}
                                {heldSlots.map((slot) => (
                                    <ReferenceArea
                                        key={`held-${slot}`}
                                        className="history-held-band"
                                        yAxisId="delta"
                                        x1={Math.max(0, slot - 0.4)}
                                        x2={Math.min(lastSlot, slot + 0.4)}
                                        fill="var(--warning)"
                                        fillOpacity={0.12}
                                        stroke="none"
                                    />
                                ))}
                                {entryPrice !== null && (
                                    <ReferenceLine
                                        yAxisId="price"
                                        y={entryPrice}
                                        className="history-entry-line"
                                        stroke="var(--highlight)"
                                        strokeOpacity={0.45}
                                        strokeDasharray="2 4"
                                        label={(props: { viewBox?: { x?: number; y?: number; width?: number } }) => (
                                            <EntryAxisTag
                                                viewBox={props.viewBox}
                                                side="right"
                                                color="var(--highlight)"
                                                text={money(entryPrice)}
                                            />
                                        )}
                                    />
                                )}
                                {entryDelta !== null && (
                                    <ReferenceLine
                                        yAxisId="delta"
                                        y={entryDelta}
                                        className="history-entry-line"
                                        stroke="var(--history-delta)"
                                        strokeOpacity={0.45}
                                        strokeDasharray="2 4"
                                        label={(props: { viewBox?: { x?: number; y?: number; width?: number } }) => (
                                            <EntryAxisTag
                                                viewBox={props.viewBox}
                                                side="left"
                                                color="var(--history-delta)"
                                                text={entryDelta.toFixed(3)}
                                            />
                                        )}
                                    />
                                )}
                                {targetInScale && targetValue !== null && (
                                    <ReferenceLine
                                        yAxisId="price"
                                        y={targetValue}
                                        stroke="var(--positive)"
                                        strokeDasharray="6 4"
                                        label={{
                                            value: `${target}% target`,
                                            fill: 'var(--positive)',
                                            fontSize: 11,
                                            position: 'insideTopLeft',
                                        }}
                                    />
                                )}
                                {firstCrossing && inView(firstCrossing.time) && (
                                    <ReferenceLine
                                        yAxisId="price"
                                        x={slotOf(firstCrossing.time)}
                                        stroke="var(--positive)"
                                        strokeDasharray="6 4"
                                        label={{
                                            value: `First ${target}%`,
                                            fill: 'var(--positive)',
                                            fontSize: 11,
                                            position: 'insideTopRight',
                                        }}
                                    />
                                )}
                                {best && inView(best.time) && (
                                    <ReferenceDot
                                        yAxisId="price"
                                        x={slotOf(best.time)}
                                        y={percentage ? best.capturedPercent : best.mark}
                                        r={4}
                                        fill="var(--surface)"
                                        stroke="var(--positive)"
                                        strokeWidth={2}
                                        label={{
                                            value: 'Best',
                                            fill: 'var(--positive)',
                                            fontSize: 11,
                                            position: 'top',
                                        }}
                                    />
                                )}
                                <Tooltip
                                    content={({ active, payload }) => {
                                        const point = payload?.[0]?.payload as ChartPoint | undefined;
                                        return active && point ? (
                                            <div className="history-tooltip">
                                                <strong>{pacificTime(point.time)}</strong>
                                                <span>Mark {money(point.mark)}</span>
                                                <span>Delta {deltaText(point.delta)}</span>
                                                <span>
                                                    Captured{' '}
                                                    {point.captured === null
                                                        ? 'Unavailable'
                                                        : `${point.captured.toFixed(1)}%`}
                                                </span>
                                                <OverrideNotes point={point} />
                                                {(point.reason || point.flags.length > 0) && (
                                                    <small>
                                                        {[point.reason, ...point.flags]
                                                            .filter(Boolean)
                                                            .join('; ')
                                                            .replaceAll('_', ' ')}
                                                    </small>
                                                )}
                                            </div>
                                        ) : null;
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: '0.72rem' }} itemSorter={null} />
                                <Line
                                    yAxisId="price"
                                    name={percentage ? 'Premium captured (%)' : 'Mark ($ / share)'}
                                    type="linear"
                                    dataKey={percentage ? 'captured' : 'mark'}
                                    stroke="var(--highlight)"
                                    strokeWidth={2}
                                    dot={HistoryCaptureDot}
                                    activeDot={{ r: 3 }}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                />
                                <Line
                                    yAxisId="delta"
                                    name="Signed delta"
                                    type="linear"
                                    dataKey="delta"
                                    stroke="var(--history-delta)"
                                    strokeWidth={2}
                                    strokeDasharray="5 3"
                                    dot={HistoryCaptureDot}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </>
            ) : (
                <>
                    {!hasStock ? (
                        <p className="history-coverage">Underlying history unavailable for this range.</p>
                    ) : (
                        <div
                            className="history-chart"
                            role="img"
                            aria-label="Underlying price history with strike line, shaded put ITM region and session dividers"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                    data={points}
                                    syncId={syncId}
                                    syncMethod="value"
                                    margin={{ top: 12, right: 0, bottom: 16, left: 0 }}
                                >
                                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                                    {xAxis}
                                    <YAxis
                                        yAxisId="stock"
                                        width={Y_AXIS_WIDTH}
                                        domain={stockDomain}
                                        ticks={evenTicks(stockDomain)}
                                        interval={0}
                                        tick={tick}
                                        tickFormatter={(value: number) => `$${value.toFixed(2)}`}
                                    />
                                    <YAxis
                                        yAxisId="spacer"
                                        orientation="right"
                                        width={Y_AXIS_WIDTH}
                                        tick={false}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    {sessionChanges.map((change) => (
                                        <ReferenceLine
                                            key={`session-${change.sessionDate}`}
                                            x={change.slot}
                                            yAxisId="stock"
                                            className="history-session-divider"
                                            stroke="var(--text-muted)"
                                            strokeOpacity={0.4}
                                        />
                                    ))}
                                    {qualitySlots.map((slot) => (
                                        <ReferenceLine
                                            key={`quality-${slot}`}
                                            x={slot}
                                            yAxisId="stock"
                                            className="history-quality-marker"
                                            stroke="var(--warning)"
                                            strokeOpacity={0.3}
                                            strokeDasharray="1 3"
                                        />
                                    ))}
                                    {history.contract.strike > stockDomain[0] && (
                                        <ReferenceArea
                                            yAxisId="stock"
                                            y1={stockDomain[0]}
                                            y2={Math.min(history.contract.strike, stockDomain[1])}
                                            fill="var(--danger)"
                                            fillOpacity={0.07}
                                            strokeOpacity={0}
                                        />
                                    )}
                                    {strikeInScale && (
                                        <ReferenceLine
                                            yAxisId="stock"
                                            y={history.contract.strike}
                                            stroke="var(--text-muted)"
                                            strokeDasharray="4 4"
                                            label={{
                                                value: `Strike ${money(history.contract.strike)}`,
                                                fill: 'var(--text-muted)',
                                                fontSize: 11,
                                                position: 'insideTopLeft',
                                            }}
                                        />
                                    )}
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            const point = payload?.[0]?.payload as ChartPoint | undefined;
                                            if (!active || !point) return null;
                                            const distance =
                                                point.underlyingPrice === null || history.contract.strike <= 0
                                                    ? null
                                                    : ((point.underlyingPrice - history.contract.strike) /
                                                          history.contract.strike) *
                                                      100;
                                            return (
                                                <div className="history-tooltip">
                                                    <strong>{pacificTime(point.time)}</strong>
                                                    <span>Stock {money(point.underlyingPrice)}</span>
                                                    <span>Strike {money(history.contract.strike)}</span>
                                                    <span>
                                                        {distance === null
                                                            ? 'Distance unavailable'
                                                            : distance === 0
                                                              ? 'At strike'
                                                              : `${Math.abs(distance).toFixed(1)}% ${distance < 0 ? 'below strike · ITM' : 'above strike · OTM'}`}
                                                    </span>
                                                    {point.reason && <small>{point.reason}</small>}
                                                </div>
                                            );
                                        }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                    <Line
                                        yAxisId="stock"
                                        type="linear"
                                        dataKey="underlyingPrice"
                                        name="Stock ($ / share)"
                                        stroke="var(--highlight)"
                                        strokeWidth={2}
                                        dot={HistoryCaptureDot}
                                        activeDot={{ r: 3 }}
                                        connectNulls={false}
                                        isAnimationActive={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}
        </>
    );
});
