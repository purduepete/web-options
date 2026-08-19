import { CalendarIcon, ChevronFirstIcon, ChevronLastIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

/**
 * Stepping through weeks.
 *
 * The three arrows are one joined control because they are one motion; the jump
 * stands apart because it is a decision. Both the live signals and the published
 * calendars step this way, so the markup lives here rather than in either page.
 */

interface WeekNavProps {
    onFirst: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onJump: () => void;
    /** `end` puts the jump at the newest week rather than the oldest. */
    jump: { label: string; edge: 'start' | 'end' };
    disabled: { first: boolean; previous: boolean; next: boolean; jump: boolean };
}

export function WeekNav({ onFirst, onPrevious, onNext, onJump, jump, disabled }: WeekNavProps) {
    const JumpIcon = jump.edge === 'end' ? ChevronLastIcon : CalendarIcon;
    return (
        <div className="week-nav">
            <div className="week-steps">
                <button
                    type="button"
                    aria-label="First week"
                    title="First week"
                    onClick={onFirst}
                    disabled={disabled.first}
                >
                    <ChevronFirstIcon />
                </button>
                <button
                    type="button"
                    aria-label="Previous week"
                    title="Previous week"
                    onClick={onPrevious}
                    disabled={disabled.previous}
                >
                    <ChevronLeftIcon />
                </button>
                <button
                    type="button"
                    aria-label="Next week"
                    title="Next week"
                    onClick={onNext}
                    disabled={disabled.next}
                >
                    <ChevronRightIcon />
                </button>
            </div>

            <button type="button" className="week-jump" onClick={onJump} disabled={disabled.jump}>
                <JumpIcon width={15} height={15} />
                {jump.label}
            </button>
        </div>
    );
}
