import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * jsdom does not lay anything out, so the week grid's one real invariant cannot
 * be caught by rendering it: the day cards share their rows with the container
 * through `subgrid`, and anything that takes those rows away collapses a whole
 * day onto a single track — the head, the rule and the first risk group all
 * paint over each other.
 *
 * That is exactly what a responsive rule did, so these read the stylesheets.
 */

function read(relative: string): string {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const weekGridCss = read('../src/signals/WeekGrid.css');
const calendarGridCss = read('../src/calendars/CalendarGrid.css');
const calendarGridTsx = read('../src/calendars/CalendarGrid.tsx');
const indexCss = read('../src/index.css');
const tradeDetailCss = read('../src/signals/TradeDetail.css').replace(/\r\n/g, '\n');

/** The bodies of every `@media` block in a stylesheet. */
function mediaBlocks(css: string): string[] {
    const blocks: string[] = [];

    for (const match of css.matchAll(/@media[^{]*\{/g)) {
        let depth = 1;
        let index = match.index + match[0].length;
        const start = index;

        while (index < css.length && depth > 0) {
            const char = css.charAt(index);
            if (char === '{') depth += 1;
            else if (char === '}') depth -= 1;
            index += 1;
        }

        blocks.push(css.slice(start, index - 1));
    }

    return blocks;
}

describe('week grid stylesheets', () => {
    it('finds the media blocks it means to inspect', () => {
        expect(mediaBlocks(weekGridCss)).toHaveLength(2);
        expect(mediaBlocks(calendarGridCss)).toHaveLength(2);
    });

    it.each([
        ['WeekGrid.css', weekGridCss, '.day-card'],
        ['CalendarGrid.css', calendarGridCss, '.calendar-day'],
    ])('%s never strands a card in a grid without its rows', (_name, css, card) => {
        const cardRule = new RegExp(`${card.replace('.', '\\.')}\\s*\\{[^}]*display:\\s*flex`);

        for (const block of mediaBlocks(css)) {
            expect(block).not.toMatch(/grid-template-rows/);
            expect(block).not.toMatch(/grid-row/);

            // Narrower than the full week the container stops being a grid,
            // because the cards' inline `grid-column` would otherwise invent
            // tracks whatever the template says. The cards have to leave with
            // it: one that is still a grid item when the rows go collapses its
            // whole contents onto a single track.
            if (/display:\s*flex/.test(block)) expect(block).toMatch(cardRule);
        }
    });

    it('keeps the day cards on subgrid so the rows stay shared', () => {
        expect(weekGridCss).toMatch(/\.day-card\s*\{[^}]*grid-template-rows:\s*subgrid/);
    });

    it('reserves a desktop track for the trade detail tier pill', () => {
        expect(tradeDetailCss).toMatch(
            /\.past-signals li \.past-row\s*\{[^}]*grid-template-columns:\s*6rem\s+1\.75rem\s+2rem\s+minmax\(0,\s*1fr\)\s+3\.5rem\s+8rem/,
        );
    });

    it('gives the calendar the shared card styling before its own overrides', () => {
        const shared = calendarGridTsx.indexOf("import '../signals/WeekGrid.css'");
        const own = calendarGridTsx.indexOf("import './CalendarGrid.css'");

        // Without the first import a calendar opened cold has no card styling at
        // all; with it in the wrong order the shared sheet wins the cascade.
        expect(shared).toBeGreaterThan(-1);
        expect(own).toBeGreaterThan(shared);
    });
});

describe('trade classification colours', () => {
    // Top picks and the three tiers describe the trade, not the chrome, so they
    // must not fall back to the highlight the user picked.
    it.each(['conservative', 'balanced', 'aggressive', 'top-pick'])('every theme defines --%s', (token) => {
        const themes = indexCss.match(/\[data-theme='[a-z]+'\]\s*\{[^}]*\}/g) ?? [];

        expect(themes.length).toBe(3);
        for (const theme of themes) {
            expect(theme).toContain(`--${token}:`);
        }
    });

    it('colours the top-pick heading and badge from that token', () => {
        expect(weekGridCss).toMatch(/\.risk-group-heading\.top-picks\s*\{\s*color:\s*var\(--top-pick\)/);
        expect(weekGridCss).toMatch(/\.top-pick\s*\{[^}]*color:\s*var\(--top-pick\)/);
    });

    // A tier is how the trade was picked and moneyness is how it turned out, and
    // the two badges sit side by side on the ticket. Sharing the green and red
    // reads as agreement between them.
    it('keeps the tiers off the colours the outcome badges own', () => {
        const themes = indexCss.match(/\[data-theme='[a-z]+'\]\s*\{[^}]*\}/g) ?? [];

        expect(themes.length).toBe(3);
        for (const theme of themes) {
            const value = (token: string) => new RegExp(`--${token}:\\s*([^;]+);`).exec(theme)?.[1]?.trim();
            expect(value('conservative')).not.toBe(value('positive'));
            expect(value('aggressive')).not.toBe(value('negative'));
        }
    });
});
