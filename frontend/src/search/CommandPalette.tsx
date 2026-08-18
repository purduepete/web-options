import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, ReactElement, SVGProps } from 'react';
import { createPortal } from 'react-dom';
import type { Command, CommandIcon, CommandResult } from './commandModel';
import type { Range } from './fuzzy';
import { rankCommands } from './fuzzy';
import { ClockIcon, KeyIcon, PageIcon, SearchIcon, SlidersIcon, StarIcon, SunIcon } from '../components/icons';
import './CommandPalette.css';

const ICONS: Record<CommandIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
    page: PageIcon,
    action: SlidersIcon,
    theme: SunIcon,
    key: KeyIcon,
    star: () => <StarIcon filled />,
    clock: ClockIcon,
};

export interface CommandPaletteProps {
    open: boolean;
    commands: readonly Command[];
    onClose: () => void;
}

/**
 * A modal combobox over a flat command list. It owns the query and the active
 * index and nothing else: the commands are handed to it already built, so the
 * whole thing can be rendered in a test without a router or a network.
 */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [announcement, setAnnouncement] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const restoreFocusTo = useRef<Element | null>(null);
    const closeSource = useRef<'pointer' | 'keyboard' | 'tab' | null>(null);
    const baseId = useId();

    const results = useMemo(() => rankCommands(query, commands), [query, commands]);

    // Reset on CLOSE, not on open: resetting on open would paint one frame of
    // the previous search before the state caught up.
    useEffect(() => {
        if (open) return;
        setQuery('');
        setActive(0);
        setAnnouncement('');
    }, [open]);

    useEffect(() => {
        if (!open) return;
        restoreFocusTo.current = document.activeElement;
        closeSource.current = null;
        inputRef.current?.focus();

        return () => {
            const previous = restoreFocusTo.current;
            const source = closeSource.current;
            closeSource.current = null;
            // Handing focus back after a click would paint a focus ring on the
            // trigger, because a restore out of a text field reads as keyboard
            // intent. Tab means the user is deliberately leaving, so let them.
            if (source === 'pointer' || source === 'tab') return;
            // Only take focus back if nothing else claimed it — a command that
            // navigates may well have moved focus somewhere more useful.
            if (document.activeElement !== document.body) return;
            if (previous instanceof HTMLElement && document.body.contains(previous)) previous.focus();
        };
    }, [open]);

    useEffect(() => setActive(0), [query]);

    // The live region is rendered empty first and filled here, a frame later:
    // a region that appears with its text already in it is not announced.
    useEffect(() => {
        if (!open) return;
        setAnnouncement(
            results.length === 0 ? 'No matches' : `${results.length} result${results.length === 1 ? '' : 's'}`,
        );
    }, [open, results.length]);

    // The page behind a modal must not scroll with it.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    // Keep the active option in view without tracking scroll ourselves.
    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active, open, results.length]);

    if (!open) return null;

    function move(delta: number) {
        if (results.length === 0) return;
        setActive((current) => (current + delta + results.length) % results.length);
    }

    function choose(result: CommandResult | undefined, source: 'pointer' | 'keyboard') {
        if (!result) return;
        closeSource.current = source;
        result.command.run();
        onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                closeSource.current = 'keyboard';
                onClose();
                return;
            case 'ArrowDown':
                event.preventDefault();
                move(1);
                return;
            case 'ArrowUp':
                event.preventDefault();
                move(-1);
                return;
            case 'Home':
                event.preventDefault();
                setActive(0);
                return;
            case 'End':
                event.preventDefault();
                setActive(Math.max(0, results.length - 1));
                return;
            case 'Enter':
                event.preventDefault();
                choose(results[active], 'keyboard');
                return;
            case 'Tab':
                // The palette is a search box, not a form. Tabbing means the
                // user is done with it, so let focus leave and close behind it.
                closeSource.current = 'tab';
                onClose();
                return;
            default:
        }
    }

    const listId = `${baseId}-list`;
    const optionId = (index: number) => `${baseId}-option-${index}`;
    const groupId = (name: string) => `${baseId}-group-${name.replace(/[^a-zA-Z0-9]+/g, '-')}`;
    const groups = groupResults(results);

    return createPortal(
        <div className="palette-root" onKeyDown={onKeyDown}>
            <div
                className="palette-backdrop"
                data-testid="palette-backdrop"
                onClick={() => {
                    closeSource.current = 'pointer';
                    onClose();
                }}
            />

            <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
                <div className="palette-input">
                    <SearchIcon />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-label="Search pages and actions"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
                        placeholder="Search pages, calendars and actions…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd>esc</kbd>
                </div>

                <ul className="palette-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
                    {groups.map((group) => (
                        <li key={group.name} role="presentation">
                            <p className="palette-group" id={groupId(group.name)} aria-hidden="true">
                                {group.name}
                            </p>
                            <ul role="group" aria-labelledby={groupId(group.name)}>
                                {group.results.map(({ result, index }) => (
                                    <Option
                                        key={result.command.id}
                                        id={optionId(index)}
                                        result={result}
                                        selected={index === active}
                                        onHover={() => setActive(index)}
                                        onChoose={() => choose(result, 'pointer')}
                                    />
                                ))}
                            </ul>
                        </li>
                    ))}
                </ul>

                <p className="palette-status" role="status">
                    {announcement}
                </p>

                <p className="palette-footer" aria-hidden="true">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close
                </p>
            </div>
        </div>,
        document.body,
    );
}

function Option({
    id,
    result,
    selected,
    onHover,
    onChoose,
}: {
    id: string;
    result: CommandResult;
    selected: boolean;
    onHover: () => void;
    onChoose: () => void;
}) {
    const Icon = ICONS[result.command.icon];

    return (
        <li
            id={id}
            role="option"
            aria-selected={selected}
            className={selected ? 'palette-option selected' : 'palette-option'}
            onMouseMove={onHover}
            onClick={onChoose}
        >
            <Icon />
            <span className="palette-label">
                <Highlight text={result.command.label} ranges={result.labelRanges} />
            </span>
            {result.command.hint && <span className="palette-hint">{result.command.hint}</span>}
        </li>
    );
}

/** Wraps the matched slices in `<mark>` and leaves the rest alone. */
function Highlight({ text, ranges }: { text: string; ranges: readonly Range[] }) {
    if (ranges.length === 0) return <>{text}</>;

    const parts: ReactElement[] = [];
    let cursor = 0;

    ranges.forEach(([start, end], index) => {
        if (start > cursor) parts.push(<span key={`t${index}`}>{text.slice(cursor, start)}</span>);
        parts.push(<mark key={`m${index}`}>{text.slice(start, end)}</mark>);
        cursor = end;
    });
    if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

    return <>{parts}</>;
}

interface Group {
    name: string;
    results: { result: CommandResult; index: number }[];
}

/**
 * Groups by heading while keeping the flat ranking order, so the arrow keys walk
 * the list exactly as it is drawn.
 */
function groupResults(results: readonly CommandResult[]): Group[] {
    const groups: Group[] = [];

    results.forEach((result, index) => {
        const name = result.command.group;
        const existing = groups.find((group) => group.name === name);
        if (existing) {
            existing.results.push({ result, index });
        } else {
            groups.push({ name, results: [{ result, index }] });
        }
    });

    return groups;
}
