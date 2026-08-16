import type { OptionRight } from '@weboptions/shared';

/**
 * Every formatter here takes an ISO calendar date (YYYY-MM-DD) or a number and
 * returns a string. Nothing constructs a Date from an ISO string directly:
 * `new Date('2025-08-11')` is midnight UTC, which lands on the 10th anywhere
 * west of Greenwich, and these are calendar days rather than instants.
 */

const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function toLocalDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** `2025-08-11` becomes `Aug 11`. */
export function formatDayLabel(iso: string): string {
    return toLocalDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatWeekTitle(weekStart: string, weekEnd: string): string {
    return `Week of ${formatDayLabel(weekStart)} to ${formatDayLabel(weekEnd)}`;
}

/** Expiries are read at a glance, so they keep the US month-first shape. */
export function formatMDY(iso: string | null): string {
    if (!iso) return 'n/a';
    const [year, month, day] = iso.split('-');
    return `${month}/${day}/${year}`;
}

export function formatPercent(value: number | null): string {
    return value == null ? 'n/a' : `${value.toFixed(1)}%`;
}

export function formatMoney(value: number | null): string {
    return value == null ? 'n/a' : `$${MONEY.format(value)}`;
}

export function formatDelta(value: number | null): string {
    return value == null ? 'n/a' : value.toFixed(2);
}

export function formatDte(value: number | null): string {
    return value == null ? 'n/a' : String(value);
}

export function formatStrike(strike: number | null, right: OptionRight): string {
    return `${strike == null ? '' : `$${strike}`}${right}`;
}
