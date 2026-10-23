import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayButton, DayPicker } from 'react-day-picker';
import type { DayButtonProps } from 'react-day-picker';
import { sessionLabel } from '../history/format';
import { ChevronDownIcon } from './icons';
import './SignalDatePicker.css';

interface SignalDate {
    added: string;
    count: number;
}

interface Props {
    value: string;
    dates: readonly SignalDate[];
    onChange: (date: string) => void;
}

const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDate = (value: string) => new Date(`${value}T12:00:00`);

export function SignalDatePicker({ value, dates, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0, visibility: 'hidden' as 'hidden' | 'visible' });
    const trigger = useRef<HTMLButtonElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const id = useId();
    const available = useMemo(
        () => new Map(dates.filter((date) => date.added).map((date) => [date.added, date.count])),
        [dates]
    );
    const keys = [...available.keys()].sort();
    const first = keys[0];
    const last = keys.at(-1);
    const selected = value ? localDate(value) : undefined;

    const components = useMemo(
        () => ({
            DayButton: function SignalDay(props: DayButtonProps) {
                const count = available.get(dateKey(props.day.date));
                return (
                    <DayButton {...props}>
                        <span>{props.day.date.getDate()}</span>
                        <small aria-hidden="true">{count ?? '\u00a0'}</small>
                    </DayButton>
                );
            },
        }),
        [available]
    );

    function close(refocus: boolean) {
        setOpen(false);
        if (refocus) trigger.current?.focus();
    }

    useLayoutEffect(() => {
        if (!open) return;
        function place() {
            const anchor = trigger.current?.getBoundingClientRect();
            const panel = popup.current?.getBoundingClientRect();
            if (!anchor || !panel) return;
            const viewport = window.visualViewport;
            const left = viewport?.offsetLeft ?? 0;
            const top = viewport?.offsetTop ?? 0;
            const width = viewport?.width ?? window.innerWidth;
            const height = viewport?.height ?? window.innerHeight;
            setPosition({
                left: Math.max(left + 2, Math.min(anchor.left, left + width - panel.width - 2)),
                top: Math.max(top + 2, Math.min(anchor.bottom + 4, top + height - panel.height - 2)),
                visibility: 'visible',
            });
        }
        place();
        const observer = new ResizeObserver(place);
        if (popup.current) observer.observe(popup.current);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        window.visualViewport?.addEventListener('resize', place);
        window.visualViewport?.addEventListener('scroll', place);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            window.visualViewport?.removeEventListener('resize', place);
            window.visualViewport?.removeEventListener('scroll', place);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function outside(event: Event) {
            if (
                !popup.current?.contains(event.target as Node | null) &&
                !trigger.current?.contains(event.target as Node | null)
            ) {
                setOpen(false);
            }
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
        };
    }, [open]);

    return (
        <>
            <button
                ref={trigger}
                type="button"
                className="choice-trigger signal-date-trigger"
                aria-label={`Signal date: ${value ? sessionLabel(value) : 'Unknown'}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => setOpen(!open)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                {value ? sessionLabel(value) : 'Unknown'}
                <ChevronDownIcon />
            </button>
            {open &&
                createPortal(
                    <div
                        ref={popup}
                        id={id}
                        className="signal-date-popup"
                        role="dialog"
                        aria-label="Choose signal date"
                        style={position}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                close(true);
                            } else if (event.key === 'Tab') {
                                const controls = [
                                    ...document.querySelectorAll<HTMLElement>(
                                        'button, a[href], input, textarea, select, [tabindex]'
                                    ),
                                ].filter(
                                    (element) =>
                                        element.tabIndex >= 0 &&
                                        !element.matches(':disabled') &&
                                        !element.closest('[hidden]') &&
                                        element.checkVisibility?.() !== false &&
                                        !popup.current?.contains(element)
                                );
                                const index = controls.findIndex((element) => element === trigger.current);
                                const next = controls[index + (event.shiftKey ? -1 : 1)];
                                close(true);
                                if (next) {
                                    event.preventDefault();
                                    next.focus();
                                }
                            }
                        }}
                    >
                        <DayPicker
                            mode="single"
                            selected={selected}
                            defaultMonth={selected ?? (last ? localDate(last) : undefined)}
                            startMonth={first ? localDate(first) : undefined}
                            endMonth={last ? localDate(last) : undefined}
                            autoFocus
                            showOutsideDays
                            fixedWeeks
                            navLayout="around"
                            disabled={(date) => !available.has(dateKey(date))}
                            components={components}
                            formatters={{
                                formatCaption: (date) =>
                                    `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`,
                            }}
                            labels={{
                                labelDayButton: (date) => {
                                    const count = available.get(dateKey(date));
                                    return `${sessionLabel(dateKey(date))}${count ? `, ${count} contract${count === 1 ? '' : 's'}` : ', no signals'}`;
                                },
                            }}
                            onSelect={(date) => {
                                if (!date) return;
                                onChange(dateKey(date));
                                close(true);
                            }}
                        />
                        {dates.some((date) => !date.added) && (
                            <button
                                type="button"
                                onClick={() => {
                                    onChange('');
                                    close(true);
                                }}
                            >
                                Date unknown
                            </button>
                        )}
                    </div>,
                    document.body
                )}
        </>
    );
}
