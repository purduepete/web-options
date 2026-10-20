import type { OwnedOptionPosition } from '@weboptions/shared';
import type { OwnedSortState } from './sort';

/**
 * How the row list is broken into bands, mirroring webportfolio's CashSecuredPuts
 * position groups (delta / gain bands). A preference like sort and price source,
 * not a filter, so it lives in local storage rather than the URL.
 */

export const OWNED_GROUPS = ['none', 'delta', 'captured'] as const;

export type OwnedGroup = (typeof OWNED_GROUPS)[number];

export const DEFAULT_OWNED_GROUP: OwnedGroup = 'none';

export const OWNED_GROUP_LABELS: Record<OwnedGroup, string> = {
    none: 'None',
    delta: 'Delta',
    captured: 'Captured',
};

export const OWNED_GROUP_DESCRIPTIONS: Record<OwnedGroup, string> = {
    none: 'One list, in sort order',
    delta: 'By assignment risk, on magnitude',
    captured: 'By share of the entry credit taken back',
};

/** The order a bucket implies, or null where the sort menu's own choice stands. */
export const OWNED_GROUP_SORTS: Record<OwnedGroup, OwnedSortState | null> = {
    none: null,
    delta: { key: 'delta', direction: 'desc' },
    captured: { key: 'captured', direction: 'desc' },
};

export interface OwnedGroupBucket {
    /** Empty for the ungrouped bucket, so the caller knows not to render a heading. */
    label: string;
    positions: OwnedOptionPosition[];
}

interface Bucket {
    label: string;
    order: number;
}

function deltaOf(position: OwnedOptionPosition): number | null {
    // Matches deltaBand's own reading (the row's quoted delta, not the entry-time
    // one), so a bucket never claims a number the row itself does not show.
    const delta = position.quote.delta;
    return delta === null || !Number.isFinite(delta) ? null : Math.abs(delta);
}

function deltaBucket(position: OwnedOptionPosition): Bucket {
    const delta = deltaOf(position);
    if (delta === null) return { label: 'No delta', order: 3 };
    if (delta > 0.4) return { label: '|\u0394| > 0.40', order: 0 };
    if (delta >= 0.25) return { label: '0.25 \u2013 0.40', order: 1 };
    return { label: '|\u0394| < 0.25', order: 2 };
}

function capturedBucket(position: OwnedOptionPosition): Bucket {
    // The raw rollup figure, the one the Captured column prints and the sort reads,
    // so a bucket never claims a number the row itself does not show.
    const captured = position.unrealizedCreditCapturedPct;
    if (captured === null) return { label: 'No captured figure', order: 3 };
    if (captured > 50) return { label: '> 50% captured', order: 0 };
    // >= 0, not > 0: an exactly-flat position is not yet a loss.
    if (captured >= 0) return { label: '0 \u2013 50% captured', order: 1 };
    return { label: 'Loss (< 0%)', order: 2 };
}

const BUCKETS: Record<Exclude<OwnedGroup, 'none'>, (position: OwnedOptionPosition) => Bucket> = {
    delta: deltaBucket,
    captured: capturedBucket,
};

/** Buckets the rows client-side, in the same order the sort left them within a bucket. */
export function groupOwnedPositions(positions: readonly OwnedOptionPosition[], mode: OwnedGroup): OwnedGroupBucket[] {
    if (mode === 'none') return positions.length === 0 ? [] : [{ label: '', positions: [...positions] }];
    const bucket = BUCKETS[mode];
    const groups = new Map<string, { label: string; order: number; positions: OwnedOptionPosition[] }>();
    for (const position of positions) {
        const { label, order } = bucket(position);
        if (!groups.has(label)) groups.set(label, { label, order, positions: [] });
        groups.get(label)!.positions.push(position);
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
}

export function readOwnedGroupMode(value: unknown): OwnedGroup {
    return OWNED_GROUPS.includes(value as OwnedGroup) ? (value as OwnedGroup) : DEFAULT_OWNED_GROUP;
}

/** Bumping the v1 suffix drops any stored choice when the shape changes. */
const KEY = 'weboptions.owned-group.v1';

export function readOwnedGroup(): OwnedGroup {
    let raw: string | null;
    try {
        raw = localStorage.getItem(KEY);
    } catch {
        return DEFAULT_OWNED_GROUP;
    }
    return readOwnedGroupMode(raw);
}

export function writeOwnedGroup(mode: OwnedGroup): void {
    try {
        localStorage.setItem(KEY, mode);
    } catch {
        // A blocked or full store only costs the choice its life beyond the tab.
    }
}
