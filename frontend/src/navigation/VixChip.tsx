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

function formatChange(value: number, previous: number): string | null {
    // Round before reading the sign, so a rounding remainder cannot print "-0.00%".
    const percent = Number((((value - previous) / previous) * 100).toFixed(2));
    if (percent === 0) return null;
    return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

export function VixChip() {
    const vix = useVix();
    const shown = vix?.value ?? PLACEHOLDER_VALUE;
    // A close of zero would be a broken row rather than a quiet day, and it cannot
    // be divided by, so it is treated as no previous close at all.
    const previous = vix?.previousValue || null;
    const rising = previous !== null && vix !== null && vix.value >= previous;
    const actualChange = previous !== null && vix !== null ? formatChange(vix.value, previous) : null;
    const change = actualChange ?? PLACEHOLDER_CHANGE;

    return (
        <span
            className={vix ? 'vix-chip' : 'vix-chip pending'}
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
                <span className={`change${actualChange === null ? ' pending' : ''}`} aria-hidden={vix === null}>
                    {rising ? <TrendingUpIcon width={12} height={12} /> : <TrendingDownIcon width={12} height={12} />}
                    {change}
                </span>
            )}
        </span>
    );
}
