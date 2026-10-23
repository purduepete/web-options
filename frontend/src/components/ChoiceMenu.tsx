import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';
import './ChoiceMenu.css';

/**
 * A named trigger that opens a menu of choices.
 *
 * A menu rather than a row of pills: each choice gets a line of its own to say
 * what it does, and the bar stays the width of the questions rather than the
 * width of every answer.
 */

export interface ChoiceOption<T extends string> {
    value: T;
    label: string;
    description: string;
}

interface ChoiceMenuProps<T extends string> {
    name: string;
    icon: ReactNode;
    options: readonly ChoiceOption<T>[];
    value: T;
    /** The choice that narrows nothing. Omitted when every choice is just a mode. */
    neutral?: T;
    onChange: (next: T) => void;
}

export function ChoiceMenu<T extends string>({ name, icon, options, value, neutral, onChange }: ChoiceMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const close = useCallback((refocus: boolean) => {
        setOpen(false);
        if (refocus) triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!open) return;
        menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();

        function onKeyDown(event: globalThis.KeyboardEvent) {
            if (event.key === 'Escape') close(true);
        }
        function onPointerDown(event: Event) {
            if (!wrapRef.current?.contains(event.target as Node | null)) close(false);
        }
        document.addEventListener('keydown', onKeyDown);
        // pointerdown, not mousedown: a tap on a plain part of the page does not
        // always reach us as a mouse event on iPad.
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open, close]);

    // The arrows walk the menu once it is open, the way a native one does.
    function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Tab') {
            close(false);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll('button') ?? [])];
        if (event.key === 'Home' || event.key === 'End') {
            items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
            return;
        }
        const here = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(here + step + items.length) % items.length]?.focus();
    }

    const chosen = options.find((option) => option.value === value);
    // A narrowed view is a fact about what is on screen, so the trigger has to
    // carry it without being read.
    const narrowed = neutral !== undefined && value !== neutral;

    return (
        <div className="choice-menu" ref={wrapRef}>
            <button
                type="button"
                ref={triggerRef}
                className={narrowed ? 'choice-trigger narrowed' : 'choice-trigger'}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`${name}: ${chosen?.label ?? ''}`}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                {icon}
                <span>{neutral === undefined || narrowed ? chosen?.label : name}</span>
                <ChevronDownIcon width={14} height={14} className={open ? 'rotated' : undefined} />
            </button>

            {open && (
                <div className="choice-panel" role="menu" aria-label={name} ref={menuRef} onKeyDown={onMenuKeyDown}>
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className={selected ? 'choice-item selected' : 'choice-item'}
                                onClick={() => {
                                    onChange(option.value);
                                    close(true);
                                }}
                            >
                                <span className="choice-mark">{selected && <CheckIcon width={14} height={14} />}</span>
                                <span className="choice-text">
                                    <span className="choice-label">{option.label}</span>
                                    <span className="choice-description">{option.description}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
