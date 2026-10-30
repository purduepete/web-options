import { ChoiceMenu } from '../components/ChoiceMenu';
import { ArrowDownNarrowWideIcon, ArrowUpDownIcon, ArrowUpNarrowWideIcon } from '../components/icons';
import {
    OWNED_SORTS,
    OWNED_SORT_DESCRIPTIONS,
    OWNED_SORT_LABELS,
    type OwnedSort,
    type OwnedSortState,
    type SortDirection,
} from './sort';
import './SortMenu.css';

/**
 * What the rows are ordered by, and which way round.
 *
 * Two controls rather than eighteen menu entries: the attribute is the question
 * and the direction is a property of the answer. The toggle borrows the menu's
 * own trigger class so the pair measure the same height.
 */

const DIRECTION_LABELS: Record<SortDirection, string> = { asc: 'Asc', desc: 'Desc' };

export function OwnedSortMenu({
    value,
    onChange,
}: {
    value: OwnedSortState;
    onChange: (next: OwnedSortState) => void;
}) {
    const flipped: SortDirection = value.direction === 'asc' ? 'desc' : 'asc';
    return (
        <div className="owned-sort">
            <ChoiceMenu
                name="Sort"
                icon={<ArrowUpDownIcon width={15} height={15} />}
                options={OWNED_SORTS.map((key: OwnedSort) => ({
                    value: key,
                    label: OWNED_SORT_LABELS[key],
                    description: OWNED_SORT_DESCRIPTIONS[key],
                }))}
                value={value.key}
                onChange={(key) => onChange({ ...value, key })}
            />
            <button
                type="button"
                className="choice-trigger owned-sort-direction"
                onClick={() => onChange({ ...value, direction: flipped })}
                aria-label={`Sort direction: ${value.direction === 'asc' ? 'ascending' : 'descending'}`}
                data-tip={`Sort ${flipped === 'asc' ? 'ascending' : 'descending'}`}
            >
                {value.direction === 'asc' ? (
                    <ArrowDownNarrowWideIcon width={15} height={15} />
                ) : (
                    <ArrowUpNarrowWideIcon width={15} height={15} />
                )}
                <span>{DIRECTION_LABELS[value.direction]}</span>
            </button>
        </div>
    );
}
