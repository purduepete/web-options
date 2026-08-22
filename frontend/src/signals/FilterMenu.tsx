import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChoiceMenu, type ChoiceOption } from '../components/ChoiceMenu';
import {
    AlertIcon,
    CheckIcon,
    ClockIcon,
    TargetIcon,
    TrendingUpIcon,
    ChevronDownIcon,
    ZapIcon,
} from '../components/icons';
import { CAPTURED_FILTERS, CAPTURED_LABELS, type CapturedFilter } from '../owned/filters';
import {
    EXPIRY_FILTERS,
    HALF_FILTERS,
    MONEYNESS_FILTERS,
    OWNED_FILTERS,
    type ExpiryFilter,
    type HalfFilter,
    type MoneynessFilter,
    type OwnedFilter,
    GRADE_FILTERS,
    type GradeFilter,
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

// The floors overlap on purpose: each one asks how far a contract has already
// run, so a row past three quarters is also past a quarter.
const CAPTURED_OPTIONS: Record<CapturedFilter, Omit<ChoiceOption<CapturedFilter>, 'value'>> = {
    all: { label: CAPTURED_LABELS.all, description: 'However far it has got' },
    positive: { label: CAPTURED_LABELS.positive, description: 'Not currently down on the credit' },
    quarter: { label: CAPTURED_LABELS.quarter, description: 'A quarter of the credit taken back' },
    half: { label: CAPTURED_LABELS.half, description: 'Half the credit taken back' },
    most: { label: CAPTURED_LABELS.most, description: 'Three quarters of the credit taken back' },
};

export function CapturedFilterMenu({
    value,
    onChange,
}: {
    value: CapturedFilter;
    onChange: (next: CapturedFilter) => void;
}) {
    return (
        <ChoiceMenu
            name="Captured"
            icon={<TrendingUpIcon width={15} height={15} />}
            options={CAPTURED_FILTERS.map((filter) => ({ value: filter, ...CAPTURED_OPTIONS[filter] }))}
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

const OWNED_OPTIONS: Record<OwnedFilter, Omit<ChoiceOption<OwnedFilter>, 'value'>> = {
    all: { label: 'All', description: 'Every contract' },
    owned: { label: 'Owned', description: 'Live or paper contracts already held' },
};

export function OwnedFilterMenu({ value, onChange }: { value: OwnedFilter; onChange: (next: OwnedFilter) => void }) {
    return (
        <ChoiceMenu
            name="Owned"
            icon={<ZapIcon width={15} height={15} />}
            options={OWNED_FILTERS.map((filter) => ({ value: filter, ...OWNED_OPTIONS[filter] }))}
            value={value}
            neutral="all"
            onChange={onChange}
        />
    );
}

const GRADE_LABELS: Record<GradeFilter, string> = { red: 'Red', yellow: 'Yellow', green: 'Green' };

export function GradeFilterMenu({
    value,
    onChange,
}: {
    value: readonly GradeFilter[];
    onChange: (next: GradeFilter[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const selected = new Set(value);

    useEffect(() => {
        if (!open) return;
        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        function onPointerDown(event: Event) {
            if (!wrapRef.current?.contains(event.target as Node | null)) setOpen(false);
        }
        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.focus();
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll('button') ?? [])];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
    }

    function toggle(filter: GradeFilter) {
        const next = selected.has(filter) ? value.filter((item) => item !== filter) : [...value, filter];
        onChange(next.length === GRADE_FILTERS.length ? [] : next);
    }

    const label = value.length === 0 ? 'Grade' : value.map((filter) => GRADE_LABELS[filter]).join(', ');

    return (
        <div className="choice-menu" ref={wrapRef}>
            <button
                type="button"
                ref={triggerRef}
                className={value.length > 0 ? 'choice-trigger narrowed' : 'choice-trigger'}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Signal grade: ${label}`}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                <AlertIcon width={15} height={15} />
                <span>{label}</span>
                <ChevronDownIcon width={14} height={14} className={open ? 'rotated' : undefined} />
            </button>
            {open && (
                <div
                    className="choice-panel"
                    role="menu"
                    aria-label="Signal grade"
                    ref={menuRef}
                    onKeyDown={onMenuKeyDown}
                >
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={value.length === 0}
                        className={value.length === 0 ? 'choice-item selected' : 'choice-item'}
                        onClick={() => onChange([])}
                    >
                        <span className="choice-mark">
                            {value.length === 0 && <CheckIcon width={14} height={14} />}
                        </span>
                        <span className="choice-text">
                            <span className="choice-label">All</span>
                            <span className="choice-description">Every grade, including ungraded trades</span>
                        </span>
                    </button>
                    {GRADE_FILTERS.map((filter) => {
                        const checked = selected.has(filter);
                        return (
                            <button
                                key={filter}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={checked}
                                className={checked ? 'choice-item selected' : 'choice-item'}
                                onClick={() => toggle(filter)}
                            >
                                <span className="choice-mark">{checked && <CheckIcon width={14} height={14} />}</span>
                                <span className="choice-text">
                                    <span className="choice-label">{GRADE_LABELS[filter]}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
