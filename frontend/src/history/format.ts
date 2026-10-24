import type { HistoryEntry, HistoryPoint } from '@weboptions/shared';

const PACIFIC_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

function pacificParts(value: number | string) {
    const parts = Object.fromEntries(
        PACIFIC_PARTS.formatToParts(new Date(value)).map((part) => [part.type, part.value])
    );
    return {
        date: `${parts.month}/${parts.day}`,
        year: parts.year,
        time: `${parts.hour}:${parts.minute}`,
    };
}

/** `10/23/2026 06:35`. Times here are always Pacific, so the zone is left off. */
export const pacificTime = (value: number | string) => {
    const parts = pacificParts(value);
    return `${parts.date}/${parts.year} ${parts.time}`;
};

/**
 * An axis range that fits the data, padded 10% each side, so a 40-cent move on
 * a $2 mark fills the chart. `minSpan` keeps a near-flat series from being
 * stretched until rounding noise looks like a trend.
 */
export function fitDomain(
    values: readonly (number | null)[],
    minSpan: number,
    [floor, ceiling]: readonly [number, number]
): [number, number] {
    const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (valid.length === 0) return [floor, ceiling];
    let low = Math.min(...valid);
    let high = Math.max(...valid);
    if (high - low < minSpan) {
        const middle = (low + high) / 2;
        low = middle - minSpan / 2;
        high = middle + minSpan / 2;
    }
    const pad = (high - low) * 0.1;
    return [Math.max(floor, low - pad), Math.min(ceiling, high + pad)];
}
/** `count` ticks at equal steps from the bottom of a domain to its top. */
export function evenTicks([low, high]: readonly [number, number], count = 5): number[] {
    if (!Number.isFinite(low) || !Number.isFinite(high) || count < 2) return [];
    return Array.from({ length: count }, (_, index) => low + ((high - low) * index) / (count - 1));
}
/** `06:35` for one session, `10/23 06:35` across several. */
export const axisTime = (value: number, withDate: boolean) => {
    const parts = pacificParts(value);
    return withDate ? `${parts.date} ${parts.time}` : parts.time;
};
/** A collected session date, `2026-10-23` in, `10/23/2026` out. */
export const sessionLabel = (date: string) => {
    const [year, month, day] = date.split('-');
    return year && month && day ? `${month}/${day}/${year}` : date;
};
export const signedMoney = (value: number | null) =>
    value === null ? 'Unavailable' : `${value < 0 ? '-' : '+'}$${Math.abs(value).toFixed(2)}`;
export const signedDelta = (value: number | null) =>
    value === null ? 'Unavailable' : `${value < 0 ? '' : '+'}${value.toFixed(3)}`;
export const money = (value: number | null) => (value === null ? 'Unavailable' : `$${value.toFixed(2)}`);
export const targetPrice = (value: number) =>
    value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 10,
    });
export const deltaText = (value: number | null) => (value === null ? 'Unavailable' : value.toFixed(3));

export function premiumCaptured(entry: HistoryEntry | null, point: HistoryPoint): number | null {
    if (!entry || entry.mark <= 0 || point.mark === null || point.sessionDate < entry.signalDate) return null;
    if (entry.capturedAt && point.time < Date.parse(entry.capturedAt)) return null;
    return ((entry.mark - point.mark) / entry.mark) * 100;
}

export function elapsedTime(from: string | null, to: number): string {
    if (!from) return 'Entry capture time unavailable';
    const minutes = Math.floor((to - Date.parse(from)) / 60000);
    if (!Number.isFinite(minutes) || minutes < 0) return 'Elapsed time unavailable';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days ? `${days}d ` : ''}${hours}h ${minutes % 60}m elapsed`;
}

export function changeSummary(points: HistoryPoint[], component: 'mark' | 'delta') {
    const valid = points.filter((point) => point[component] !== null);
    const first = valid[0];
    const last = valid.at(-1);
    const start = first?.[component] ?? null;
    const end = last?.[component] ?? null;
    return {
        first,
        last,
        value: end,
        change: start !== null && end !== null && valid.length > 1 ? end - start : null,
        percent:
            component === 'mark' && start !== null && start !== 0 && end !== null && valid.length > 1
                ? ((end - start) / start) * 100
                : null,
    };
}
