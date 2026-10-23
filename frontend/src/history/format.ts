import type { HistoryPoint } from '@weboptions/shared';

const PACIFIC_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
});

function pacificParts(value: number | string) {
    const parts = Object.fromEntries(
        PACIFIC_PARTS.formatToParts(new Date(value)).map((part) => [part.type, part.value])
    );
    return {
        date: `${parts.month}/${parts.day}`,
        year: parts.year,
        time: `${parts.hour}:${parts.minute}`,
        zone: parts.timeZoneName,
    };
}

/** `10/23/2026 06:35 PDT`. */
export const pacificTime = (value: number | string) => {
    const parts = pacificParts(value);
    return `${parts.date}/${parts.year} ${parts.time} ${parts.zone}`;
};
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
