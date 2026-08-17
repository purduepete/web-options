/**
 * The palette is fed a flat list of commands. Building that list is somebody
 * else's job (see `buildCommands`), which keeps the scorer and the component
 * free of any knowledge of routes, themes or the API.
 */

/** Icon names, not components, so this module stays plain TypeScript. */
export type CommandIcon = 'page' | 'action' | 'theme' | 'key' | 'star' | 'clock';

export interface Command {
    /** Stable and unique; also the React key and the DOM id suffix. */
    id: string;
    label: string;
    /** Secondary line. Searched, but ranked below the label. */
    hint?: string;
    /** Never shown. Lets "dark" find the Appearance page. */
    keywords?: string;
    /** Heading the command is listed under. Order of first appearance wins. */
    group: string;
    icon: CommandIcon;
    /** Added to the match score. Favourites and recents ride to the top on this. */
    boost?: number;
    run: () => void;
}

/** A command plus where the query matched it, so the label can be highlighted. */
export interface CommandResult {
    command: Command;
    score: number;
    /** Half-open `[start, end)` ranges into `command.label`. Empty when the hint matched. */
    labelRanges: readonly (readonly [number, number])[];
}
