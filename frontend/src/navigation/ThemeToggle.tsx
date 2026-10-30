import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ThemePreference } from '@weboptions/shared';
import { PaletteIcon } from '../components/icons';
import { useTheme } from '../theme/ThemeProvider';
import './ThemeToggle.css';

const THEME_OPTIONS: {
    value: ThemePreference;
    label: string;
}[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'midnight', label: 'Midnight' },
    { value: 'system', label: 'System' },
];

export function ThemeToggle() {
    const { preference, setPreference } = useTheme();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const pressingTrigger = useRef(false);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const selectedIndex = THEME_OPTIONS.findIndex((option) => option.value === preference);
    const selectedLabel = THEME_OPTIONS[selectedIndex]?.label ?? 'Theme';

    useEffect(() => {
        if (!open) return;

        function onPointerDown(event: PointerEvent) {
            if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
                setOpen(false);
            }
        }

        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    useEffect(() => {
        if (open) optionRefs.current[selectedIndex]?.focus();
    }, [open, selectedIndex]);

    function close(restoreFocus = false) {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }

    function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const activeIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
            return;
        }

        let nextIndex: number | undefined;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (activeIndex + 1) % THEME_OPTIONS.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (activeIndex - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = THEME_OPTIONS.length - 1;
        }

        if (nextIndex === undefined) return;
        event.preventDefault();
        const nextOption = THEME_OPTIONS[nextIndex];
        if (!nextOption) return;
        setPreference(nextOption.value);
        optionRefs.current[nextIndex]?.focus();
    }

    return (
        <div
            className="theme-picker-anchor"
            ref={containerRef}
            onBlur={(event) => {
                // Safari does not focus a tapped button, so a press on the icon blurs
                // the open picker with no relatedTarget. The icon's click decides instead.
                if (pressingTrigger.current) return;
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setOpen(false);
                }
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                className="theme-toggle"
                aria-label={`Theme: ${selectedLabel}`}
                data-tip="Appearance settings"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="theme-picker-popover"
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    pressingTrigger.current = true;
                    event.preventDefault();
                }}
                onPointerCancel={() => {
                    pressingTrigger.current = false;
                }}
                onClick={() => {
                    pressingTrigger.current = false;
                    setOpen((isOpen) => !isOpen);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <PaletteIcon />
            </button>
            <div
                className="theme-picker-popover"
                id="theme-picker-popover"
                role="dialog"
                aria-label="Appearance settings"
                hidden={!open}
                onKeyDown={handlePickerKeyDown}
            >
                <span className="theme-popover-label">Theme</span>
                <div className="theme-picker-options" role="radiogroup" aria-label="Theme">
                    <span
                        className="theme-selection"
                        aria-hidden="true"
                        style={{ '--theme-index': selectedIndex } as CSSProperties}
                    />
                    {THEME_OPTIONS.map(({ value, label }, index) => (
                        <button
                            key={value}
                            ref={(element) => {
                                optionRefs.current[index] = element;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={preference === value}
                            tabIndex={preference === value ? 0 : -1}
                            onClick={() => setPreference(value)}
                        >
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
