import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ThemePreference } from '@weboptions/shared';
import { MonitorIcon, MoonIcon, MoonStarIcon, PaletteIcon, SunIcon } from '../components/icons';
import { useTheme } from '../theme/ThemeProvider';
import './ThemeToggle.css';

const THEME_OPTIONS: {
    value: ThemePreference;
    label: string;
    icon: typeof SunIcon;
}[] = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'midnight', label: 'Midnight', icon: MoonStarIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon },
];

export function ThemeToggle() {
    const { preference, setPreference } = useTheme();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
                title="Appearance settings"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="theme-picker-popover"
                onPointerDown={(event) => {
                    // Keep Safari from dismissing on blur before the toggle click.
                    if (event.button === 0) event.preventDefault();
                }}
                onClick={() => setOpen((isOpen) => !isOpen)}
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
                    {THEME_OPTIONS.map(({ value, label, icon: Icon }, index) => (
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
                            <Icon width={15} height={15} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
