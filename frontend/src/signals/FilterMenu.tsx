import { ChoiceMenu, type ChoiceOption } from '../components/ChoiceMenu';
import { ClockIcon, TargetIcon, TrendingUpIcon } from '../components/icons';
import {
    EXPIRY_FILTERS,
    HALF_FILTERS,
    MONEYNESS_FILTERS,
    type ExpiryFilter,
    type HalfFilter,
    type MoneynessFilter,
} from './grouping';

/**
 * The menus that narrow what the week shows.
 *
 * `all` is the choice that hides nothing, so each trigger says the filter's
 * name until a real choice is made, and then wears the highlight.
 */

// The menu narrows a week on the signals page and a month on the summary, so
// the descriptions say what a choice keeps rather than where it is keeping it.
const EXPIRY_OPTIONS: Record<ExpiryFilter, Omit<ChoiceOption<ExpiryFilter>, 'value'>> = {
    all: { label: 'All', description: 'Every contract' },
    expired: { label: 'Expired', description: 'Already past its expiry date' },
    active: { label: 'Active', description: 'Not yet at its expiry date' },
};

export function ExpiryFilterMenu({ value, onChange }: { value: ExpiryFilter; onChange: (next: ExpiryFilter) => void }) {
    return (
        <ChoiceMenu
            name="Contracts"
            icon={<ClockIcon width={15} height={15} />}
            options={EXPIRY_FILTERS.map((filter) => ({ value: filter, ...EXPIRY_OPTIONS[filter] }))}
            value={value}
            neutral="all"
            onChange={onChange}
        />
    );
}

const MONEYNESS_OPTIONS: Record<MoneynessFilter, Omit<ChoiceOption<MoneynessFilter>, 'value'>> = {
    all: { label: 'All', description: 'Wherever it closed, or not yet closed' },
    itm: { label: 'ITM', description: 'Last close finished in the money' },
    otm: { label: 'OTM', description: 'Last close finished out of the money' },
};

export function MoneynessFilterMenu({
    value,
    onChange,
}: {
    value: MoneynessFilter;
    onChange: (next: MoneynessFilter) => void;
}) {
    return (
        <ChoiceMenu
            name="Moneyness"
            icon={<TargetIcon width={15} height={15} />}
            options={MONEYNESS_FILTERS.map((filter) => ({ value: filter, ...MONEYNESS_OPTIONS[filter] }))}
            value={value}
            neutral="all"
            onChange={onChange}
        />
    );
}

// A trade the nightly rollup has not reached has no answer either way, so it
// answers neither question rather than being counted as one of the failures.
const HALF_OPTIONS: Record<HalfFilter, Omit<ChoiceOption<HalfFilter>, 'value'>> = {
    all: { label: 'All', description: 'However far it has got' },
    yes: { label: 'Yes', description: 'Has been up over half its premium at a close' },
    no: { label: 'No', description: 'Rolled up, and has not reached half' },
};

export function HalfFilterMenu({ value, onChange }: { value: HalfFilter; onChange: (next: HalfFilter) => void }) {
    return (
        <ChoiceMenu
            name="Over half"
            icon={<TrendingUpIcon width={15} height={15} />}
            options={HALF_FILTERS.map((filter) => ({ value: filter, ...HALF_OPTIONS[filter] }))}
            value={value}
            neutral="all"
            onChange={onChange}
        />
    );
}
