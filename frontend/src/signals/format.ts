import type { OptionRight } from '@weboptions/shared';

/**
 * Every formatter here takes an ISO calendar date (YYYY-MM-DD) or a number and
 * returns a string. Nothing constructs a Date from an ISO string directly:
 * `new Date('2025-08-11')` is midnight UTC, which lands on the 10th anywhere
 * west of Greenwich, and these are calendar days rather than instants.
 */

const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT_MONEY = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 0 });
const THOUSANDS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PADDED_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });

/** What every figure in the app prints when it has no value. */
export const EMPTY = '–';

function toLocalDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** `2025-08-11` becomes `Aug 11`. */
export function formatDayLabel(iso: string): string {
    return toLocalDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Zero-padded, so the title keeps one width as the weeks step past. */
export function formatWeekTitle(weekStart: string, weekEnd: string): string {
    return `Week of ${PADDED_DAY.format(toLocalDate(weekStart))} – ${PADDED_DAY.format(toLocalDate(weekEnd))}`;
}

/** A whole title's worth of room, held open while the real week is still loading. */
export const WEEK_TITLE_SPACER = formatWeekTitle('2026-08-17', '2026-08-21');

/** Expiries are read at a glance, so they keep the US month-first shape. */
export function formatMDY(iso: string | null): string {
    if (!iso) return EMPTY;
    const [year, month, day] = iso.split('-');
    return `${month}/${day}/${year}`;
}

export function formatPercent(value: number | null): string {
    return value == null ? EMPTY : `${value.toFixed(1)}%`;
}

/** A whole-number share, for counts small enough that a decimal would imply precision it lacks. */
export function shareOf(part: number, whole: number): string {
    return whole === 0 ? EMPTY : `${Math.round((part / whole) * 100)}%`;
}

/** Always carries its sign, so `+3.2%` reads as clearly above as `-3.2%` reads below. */
export function formatSignedPercent(value: number | null): string {
    if (value == null) return EMPTY;
    // Round before reading the sign, so a rounding remainder cannot print "-0.0%".
    const rounded = Number(value.toFixed(1));
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

export function formatMoney(value: number | null): string {
    return value == null ? EMPTY : `$${MONEY.format(value)}`;
}

/** A profit and a loss have to be told apart at a glance, so the sign leads the figure. */
export function formatSignedMoney(value: number | null): string {
    if (value == null) return EMPTY;
    // Rounded before the sign is read, so a stray cent cannot print "-$0".
    const rounded = Math.round(value);
    return `${rounded < 0 ? '-' : rounded > 0 ? '+' : ''}$${MONEY.format(Math.abs(rounded))}`;
}

/**
 * The drill-in's figure. A ticket rounds to the dollar to stay scannable across a
 * whole week, but a breakeven of $168.55 shown as $169 is a worse number rather
 * than a tidier one, and a price is compared against a strike to the cent.
 */
export function formatCents(value: number | null): string {
    return value == null ? EMPTY : `$${CENTS.format(value)}`;
}

/** `142300` becomes `$142K`. Rounds hard, so the exact figure belongs in a title beside it. */
export function formatCompactMoney(value: number | null): string {
    return value == null ? EMPTY : `$${COMPACT_MONEY.format(value)}`;
}

/** `37545` becomes `$37.5K`, while `500` stays `$500`. */
export function formatThousandsMoney(value: number | null): string {
    if (value == null) return EMPTY;
    return value < 1000 ? formatMoney(value) : `$${THOUSANDS.format(value / 1000)}K`;
}

export function formatDelta(value: number | null): string {
    return value == null ? EMPTY : value.toFixed(3);
}

export function formatDte(value: number | null): string {
    return value == null ? EMPTY : String(value);
}

export function formatStrike(strike: number | null, right: OptionRight): string {
    return `${strike == null ? '' : `$${strike}`}${right}`;
}
