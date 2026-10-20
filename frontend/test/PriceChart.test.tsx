import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SymbolBar } from '@weboptions/shared';
import { PriceChart } from '../src/signals/PriceChart';

/*
 * There is no charting library, so the geometry is the app's own and every number
 * in the `points` attribute is one a sign error would quietly invert. The y axis
 * runs DOWN the screen and UP in price, which is the trap these tests exist for.
 */

/** One bar per day from 2026-03-02, at the closes given. */
function bars(closes: number[]): SymbolBar[] {
    const start = Date.UTC(2026, 2, 2);
    return closes.map((close, index) => ({
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        close,
    }));
}

function points(container: HTMLElement): [number, number][] {
    const raw = container.querySelector('polyline')?.getAttribute('points') ?? '';
    return raw.split(' ').map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return [x!, y!];
    });
}

function lineY(container: HTMLElement, className: string): number {
    return Number(container.querySelector(`.${className}`)?.getAttribute('y1'));
}

describe('PriceChart', () => {
    const props = { sma50: null, sma200: null, strike: null, symbol: 'VST' };

    describe('the low marker', () => {
        it('sits on the lowest close, at the same place the line reaches it', () => {
            const { container } = render(<PriceChart {...props} bars={bars([120, 100, 140])} />);
            const dot = container.querySelector<HTMLElement>('.chart-low')!;
            const [, lowest] = points(container);

            // Percentages of the 1000 x 400 viewBox, so they map straight back.
            expect(Number.parseFloat(dot.style.left)).toBeCloseTo((lowest![0] / 1000) * 100, 3);
            expect(Number.parseFloat(dot.style.top)).toBeCloseTo((lowest![1] / 400) * 100, 3);
        });

        it('takes the LAST of a tie, so a flat floor is marked where the series left it', () => {
            const { container } = render(<PriceChart {...props} bars={bars([100, 140, 100])} />);
            const dot = container.querySelector<HTMLElement>('.chart-low')!;

            // Three bars: x is 4, 500, 996. The later hundred is the one marked.
            expect(Number.parseFloat(dot.style.left)).toBeCloseTo(99.6, 3);
        });

        it('names the low in the legend, where the other lines name themselves', () => {
            render(<PriceChart {...props} bars={bars([120, 100, 140])} />);

            expect(screen.getByText('Low $100')).toBeTruthy();
        });

        it('is drawn in HTML, not as a circle the stretched viewBox would flatten', () => {
            const { container } = render(<PriceChart {...props} bars={bars([120, 100, 140])} />);

            expect(container.querySelector('svg circle')).toBeNull();
            expect(container.querySelector('.chart-plot > .chart-low')).toBeTruthy();
        });
    });

    it('draws nothing at all from a single bar, which has no shape', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100])} />);

        expect(container.firstChild).toBeNull();
    });

    it('puts the highest close at the TOP, where the y axis is smallest', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 200])} />);
        const [low, high] = points(container);

        // Inverted, this reads as a stock that fell while its number rose.
        expect(high![1]).toBeLessThan(low![1]);
    });

    it('spans the full width, oldest on the left', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 110, 120])} />);
        const drawn = points(container);

        expect(drawn[0]![0]).toBeLessThan(drawn[1]![0]);
        expect(drawn.at(-1)![0]).toBeGreaterThan(drawn[0]![0]);
        expect(drawn).toHaveLength(3);
    });

    it('draws a flat series without dividing by zero', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 100, 100])} />);

        for (const [, y] of points(container)) expect(Number.isFinite(y)).toBe(true);
    });

    it('keeps a strike far below the range on the chart rather than off it', () => {
        // The whole point of the drill-in chart is the gap between price and strike.
        // Scaling to the closes alone would draw the strike past the bottom edge.
        const { container } = render(<PriceChart {...props} bars={bars([180, 190])} strike={100} />);
        const strikeY = lineY(container, 'chart-strike');
        const lowest = Math.max(...points(container).map(([, y]) => y));

        expect(strikeY).toBeGreaterThan(lowest);
        expect(strikeY).toBeLessThanOrEqual(400);
    });

    it('places the two averages by price, not by order', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 200])} sma50={180} sma200={120} />);

        // The 50 is higher in price, so it must be higher on screen: smaller y.
        expect(lineY(container, 'chart-sma50')).toBeLessThan(lineY(container, 'chart-sma200'));
    });

    it('omits a line it was given no value for', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 200])} />);

        expect(container.querySelector('.chart-sma50')).toBeNull();
        expect(container.querySelector('.chart-sma200')).toBeNull();
        expect(container.querySelector('.chart-strike')).toBeNull();
    });

    it('names each line and its level in the legend', () => {
        render(<PriceChart {...props} bars={bars([100, 200])} sma50={180} sma200={120} strike={150} />);

        expect(screen.getByText('50 DMA $180')).toBeTruthy();
        expect(screen.getByText('200 DMA $120')).toBeTruthy();
        expect(screen.getByText('Strike $150')).toBeTruthy();
    });

    it('labels the two ends of the range, and nothing between them', () => {
        // 70 days from 2026-03-02 crosses April on its way to May.
        const { container } = render(<PriceChart {...props} bars={bars(Array.from({ length: 70 }, () => 100))} />);

        expect([...container.querySelectorAll('.chart-axis span')].map((tick) => tick.textContent)).toEqual([
            'Mar',
            'May',
        ]);
    });

    it('names the month the date is in, not the one a UTC parse would land on', () => {
        // `new Date('2026-04-01')` read back west of Greenwich is March 31.
        const { container } = render(
            <PriceChart
                {...props}
                bars={[
                    { date: '2026-03-31', close: 100 },
                    { date: '2026-04-01', close: 110 },
                ]}
            />
        );

        expect([...container.querySelectorAll('.chart-axis span')].map((tick) => tick.textContent)).toEqual([
            'Mar',
            'Apr',
        ]);
    });

    it('offers the same shape as a table, because a line reads as nothing', () => {
        render(<PriceChart {...props} bars={bars([100, 110])} />);

        expect(screen.getByRole('img', { name: 'VST six month price' })).toBeTruthy();
        expect(screen.getByRole('table', { name: /VST month-end closes/ })).toBeTruthy();
    });

    it('clips that table through a wrapper, since a table ignores the clip itself', () => {
        // .sr-only on the table leaves it at its full height — a table treats height
        // as a minimum and ignores overflow — and the rows spill down the dialog,
        // making it scroll for content nobody can see.
        const { container } = render(<PriceChart {...props} bars={bars([100, 110])} />);

        expect(container.querySelector('table.sr-only')).toBeNull();
        expect(container.querySelector('.sr-only > table')).toBeTruthy();
    });

    it('hides the axis from the reader who is already getting the table', () => {
        const { container } = render(<PriceChart {...props} bars={bars([100, 110])} />);

        expect(container.querySelector('.chart-axis')?.getAttribute('aria-hidden')).toBe('true');
    });
});
