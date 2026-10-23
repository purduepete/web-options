import type { HistoryPoint } from '@weboptions/shared';

export const pacificTime = (value: number | string) =>
    new Date(value).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });
export const money = (value: number | null) => (value === null ? 'Unavailable' : `$${value.toFixed(2)}`);
export const deltaText = (value: number | null) => (value === null ? 'Unavailable' : value.toFixed(3));

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
