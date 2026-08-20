import { useMemo } from 'react';
import type { SymbolBar } from '@weboptions/shared';
import './PriceChart.css';

/**
 * Six months of closes with the two moving averages and the strike, drawn as inline
 * SVG. No charting library: one chart does not justify a dependency the rest of the
 * app would carry, and this one needs four polylines and two labels.
 *
 * The averages are handed in already computed over the FULL two years, so the 200
 * day line is a real 200 day average rather than one taken over what fits on screen.
 */

export interface PriceChartProps {
    bars: readonly SymbolBar[];
    sma50: number | null;
    sma200: number | null;
    strike: number | null;
    symbol: string;
}

// A unitless viewBox with preserveAspectRatio="none": the CSS decides the shape
// and the geometry stretches to fill it, so there is no aspect ratio to keep in
// two places.
const W = 1000;
const H = 400;
const PAD = 4;

function toPolyline(values: readonly number[], min: number, max: number): string {
    const span = max - min || 1;
    const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
    return values
        .map((value, index) => {
            const x = PAD + index * step;
            const y = PAD + (1 - (value - min) / span) * (H - PAD * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
}

function level(value: number, min: number, max: number): number {
    const span = max - min || 1;
    return PAD + (1 - (value - min) / span) * (H - PAD * 2);
}

function formatPrice(value: number): string {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatMonth(date: string): string {
    // Split rather than parsed: `new Date('2026-08-10')` is UTC midnight, and
    // reading it back locally west of Greenwich names the previous month's end.
    const [year, month] = date.split('-');
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

export function PriceChart({ bars, sma50, sma200, strike, symbol }: PriceChartProps) {
    const geometry = useMemo(() => {
        if (bars.length < 2) return null;
        const closes = bars.map((bar) => bar.close);

        // The averages and the strike are inside the scale, not clipped by it: a
        // strike drawn off the top of the chart is worse than a squashed line.
        const marks = [sma50, sma200, strike].filter((value): value is number => value !== null);
        const min = Math.min(...closes, ...marks);
        const max = Math.max(...closes, ...marks);

        return { closes, min, max };
    }, [bars, sma50, sma200, strike]);

    if (!geometry) return null;
    const { closes, min, max } = geometry;

    // The lowest close on screen, taking the LAST one on a tie so a flat floor is
    // marked where the series left it rather than where it first arrived.
    const lowIndex = closes.reduce((best, value, index) => (value <= closes[best]! ? index : best), 0);
    const low = closes[lowIndex]!;

    // Every month's last bar, so a reader can place the shape in the year.
    const monthTicks = bars
        .map((bar, index) => ({ bar, index }))
        .filter(({ bar, index }) => index === 0 || bar.date.slice(0, 7) !== bars[index - 1]!.date.slice(0, 7));

    const step = (W - PAD * 2) / (bars.length - 1);

    return (
        <figure className="price-chart enter">
            <div className="chart-plot">
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${symbol} six month price`}
                >
                    {sma200 !== null && (
                        <line
                            className="chart-sma200"
                            x1={PAD}
                            x2={W - PAD}
                            y1={level(sma200, min, max)}
                            y2={level(sma200, min, max)}
                        />
                    )}
                    {sma50 !== null && (
                        <line
                            className="chart-sma50"
                            x1={PAD}
                            x2={W - PAD}
                            y1={level(sma50, min, max)}
                            y2={level(sma50, min, max)}
                        />
                    )}
                    {strike !== null && (
                        <line
                            className="chart-strike"
                            x1={PAD}
                            x2={W - PAD}
                            y1={level(strike, min, max)}
                            y2={level(strike, min, max)}
                        />
                    )}
                    <polyline className="chart-close" points={toPolyline(closes, min, max)} />
                </svg>

                {/* An HTML dot, not an SVG circle: preserveAspectRatio="none" stretches
                    the viewBox, and a circle in it would come out an ellipse. */}
                <span
                    className="chart-low"
                    aria-hidden="true"
                    style={{
                        left: `${((PAD + lowIndex * step) / W) * 100}%`,
                        top: `${(level(low, min, max) / H) * 100}%`,
                    }}
                />
            </div>

            {/* The two ends only. A label per month crowded the axis without telling a
                reader anything the shape did not; the span is what they need. */}
            <div className="chart-axis" aria-hidden="true">
                <span className="start">{formatMonth(bars[0]!.date)}</span>
                <span className="end">{formatMonth(bars[bars.length - 1]!.date)}</span>
            </div>

            <figcaption className="chart-legend">
                <span className="chart-key low">Low {formatPrice(low)}</span>
                {sma50 !== null && <span className="chart-key sma50">50 DMA {formatPrice(sma50)}</span>}
                {sma200 !== null && <span className="chart-key sma200">200 DMA {formatPrice(sma200)}</span>}
                {strike !== null && <span className="chart-key strike">Strike {formatPrice(strike)}</span>}
            </figcaption>

            {/* A line has nothing for a screen reader to read, so the same shape is
                offered as month-end closes. Hidden visually, not from the a11y tree.

                The clip is on a wrapping div, not the table: a table treats `height`
                as a minimum and ignores `overflow`, so `.sr-only` on the table itself
                leaves 250px of absolutely positioned rows spilling down the dialog
                and making it scroll for content nobody can see. */}
            <div className="sr-only">
                <table>
                    <caption>{symbol} month-end closes</caption>
                    <thead>
                        <tr>
                            <th scope="col">Month</th>
                            <th scope="col">Close</th>
                        </tr>
                    </thead>
                    <tbody>
                        {monthTicks.map(({ bar }) => (
                            <tr key={bar.date}>
                                <th scope="row">{bar.date}</th>
                                <td>{formatPrice(bar.close)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </figure>
    );
}
