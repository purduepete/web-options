import { VIX_CALM_BELOW, VIX_DEAD_BELOW } from '@weboptions/shared';
import { TrendingDownIcon, TrendingUpIcon } from '../components/icons';
import { useVix } from '../grade/VixProvider';
import { formatDayLabel } from '../signals/format';
import './VixChip.css';

/**
 * The volatility index on the bar, graded the way a put seller reads it: calm is
 * the bad news, because a quiet market pays too little for the risk. The same
 * figure caps every grade on the board at yellow.
 *
 * It is rendered from the first frame and merely hidden until the figure lands, so
 * the search and theme buttons beside it never move. Two digits either side of the
 * point is the width the VIX has kept for its whole recorded history, and
 * `tabular-nums` in the stylesheet makes every one of them measure the same. The
 * day change holds its own width the same way, since a first-ever close has none.
 */
const PLACEHOLDER_VALUE = 88.88;

/** Held open only while the whole chip is loading. */
const PLACEHOLDER_CHANGE = '+8.88%';

function sessionChange(value: number, previous: number): number {
    // Round before reading the sign, so a rounding remainder cannot print "-0.00%".
    return Number((((value - previous) / previous) * 100).toFixed(2));
}

function formatChange(percent: number): string {
    return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function borderClass(value: number, now: Date = new Date()): string {
    const day = now.getDay();
    if (day === 0 || day === 6) return '';
    if (value > 15) return ' level-high';
    if (value > 12) return ' level-medium';
    return ' level-low';
}

export function VixChip() {
    const vix = useVix();
    const shown = vix?.value ?? PLACEHOLDER_VALUE;
    // A close of zero would be a broken row rather than a quiet day, and it cannot
    // be divided by, so it is treated as no previous close at all.
    const previous = vix?.previousValue || null;
    const changePercent = previous !== null && vix !== null ? sessionChange(vix.value, previous) : null;
    const actualChange = changePercent === null ? null : formatChange(changePercent);
    const change = actualChange ?? PLACEHOLDER_CHANGE;
    const changeClass =
        changePercent === null ? ' pending' : changePercent > 0 ? ' rising' : changePercent < 0 ? ' falling' : '';

    return (
        <span
            className={vix ? `vix-chip${borderClass(vix.value)}` : 'vix-chip pending'}
            aria-hidden={vix ? undefined : true}
            title={
                vix
                    ? `VIX closed at ${vix.value.toFixed(2)} on ${formatDayLabel(vix.asOf)}` +
                      `${actualChange === null ? '' : `, ${actualChange} on the session before`}. ` +
                      `Below ${VIX_CALM_BELOW} grades yellow and below ${VIX_DEAD_BELOW} red: premium is thin.`
                    : undefined
            }
        >
            VIX <b>{shown.toFixed(2)}</b>
            {(actualChange !== null || vix === null) && (
                <span className={`change${changeClass}`} aria-hidden={vix === null}>
                    {changePercent !== null && changePercent > 0 && <TrendingUpIcon width={12} height={12} />}
                    {changePercent !== null && changePercent < 0 && <TrendingDownIcon width={12} height={12} />}
                    {change}
                </span>
            )}
        </span>
    );
}
