import { useId, useState } from 'react';
import {
    CartesianGrid,
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
import type { HistoryPoint, HistoryResponse } from '@weboptions/shared';
import { ChoiceMenu } from '../components/ChoiceMenu';
import { axisTime, deltaText, evenTicks, fitDomain, money, pacificTime, premiumCaptured } from './format';
import { HistoryAnalysis, type TargetChoice } from './HistoryAnalysis';

interface ChartPoint extends HistoryPoint {
    captured: number | null;
    slot: number;
}

export function HistoryCharts({ history }: { history: HistoryResponse }) {
    const [metric, setMetric] = useState<'price' | 'captured'>('price');
    const [target, setTarget] = useState<TargetChoice>('50');
    const syncId = useId();
    const percentage = metric === 'captured';
    const points: ChartPoint[] = history.points
        .filter((point) => point.kind !== 'session_boundary')
        .map((point, slot) => ({
            ...point,
            slot,
            captured: premiumCaptured(history.entry, point),
        }));
    const values = points.map((point) => (percentage ? point.captured : point.mark));
    const domainValues = [...values, ...(percentage ? [] : [history.entry?.mark ?? null])];
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
    const deltaDomain = fitDomain(
        points.map((point) => point.delta),
        0.02,
        [-1, 1]
    );
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
            <HistoryAnalysis history={history} target={target} onTargetChange={setTarget} />
            <div className="history-chart-head">
                <h3>Option price and delta</h3>
                <ChoiceMenu
                    name="Chart"
                    icon={null}
                    value={metric}
                    onChange={setMetric}
                    options={[
                        { value: 'price', label: 'Price', description: 'Mark dollars per share' },
                        { value: 'captured', label: 'Captured %', description: 'Entry credit captured, mark-based' },
                    ]}
                />
            </div>
            {percentage && !history.entry && (
                <p className="history-coverage">Entry quote unavailable. Captured percentages cannot be calculated.</p>
            )}
            <div
                className="history-chart"
                role="img"
                aria-label={`Signed delta on the left axis, ${percentage ? 'premium captured percent' : 'mark price'} on the right.`}
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
                            width={48}
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
                            width={48}
                            domain={deltaDomain}
                            ticks={evenTicks(deltaDomain)}
                            interval={0}
                            tick={tick}
                            tickFormatter={(value: number) => value.toFixed(3)}
                        />
                        {!percentage && history.entry && (
                            <ReferenceLine
                                yAxisId="price"
                                y={history.entry.mark}
                                stroke="var(--text-muted)"
                                strokeDasharray="4 4"
                                label={{
                                    value: `Entry ${money(history.entry.mark)}`,
                                    fill: 'var(--text-muted)',
                                    fontSize: 11,
                                    position: 'insideTopLeft',
                                }}
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
                                label={{ value: 'Best', fill: 'var(--positive)', fontSize: 11, position: 'top' }}
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
                                            {point.captured === null ? 'Unavailable' : `${point.captured.toFixed(1)}%`}
                                        </span>
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
                        <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                        <Line
                            yAxisId="price"
                            name={percentage ? 'Premium captured (%)' : 'Mark ($ / share)'}
                            type="linear"
                            dataKey={percentage ? 'captured' : 'mark'}
                            stroke="var(--highlight)"
                            strokeWidth={2}
                            dot={{ r: 2 }}
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
                            dot={{ r: 2 }}
                            connectNulls={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <div className="history-chart-head">
                <h3>{history.contract.symbol} stock versus strike</h3>
                <span>
                    Strike {money(history.contract.strike)}
                    {hasStock && !strikeInScale
                        ? ` ${history.contract.strike < stockDomain[0] ? 'below' : 'above'} chart range`
                        : ''}
                    {' · Shaded below strike = ITM'}
                </span>
            </div>
            {!hasStock ? (
                <p className="history-coverage">Underlying history unavailable for this range.</p>
            ) : (
                <div
                    className="history-chart history-stock-chart"
                    role="img"
                    aria-label="Underlying price history with strike line and shaded put ITM region"
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
                                width={48}
                                domain={stockDomain}
                                ticks={evenTicks(stockDomain)}
                                interval={0}
                                tick={tick}
                                tickFormatter={(value: number) => `$${value.toFixed(2)}`}
                            />
                            <YAxis
                                yAxisId="spacer"
                                orientation="right"
                                width={48}
                                tick={false}
                                axisLine={false}
                                tickLine={false}
                            />
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
                                dot={{ r: 2 }}
                                activeDot={{ r: 3 }}
                                connectNulls={false}
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </>
    );
}
