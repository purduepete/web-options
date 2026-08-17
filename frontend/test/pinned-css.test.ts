import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Nothing here can be caught by rendering: jsdom neither scrolls nor lays out,
 * so a header that stops pinning halfway down the page looks identical to one
 * that works. These read the stylesheets instead.
 */
function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const indexCss = read('../src/index.css');
const signalsCss = read('../src/pages/LiveSignalsPage.css');

describe('pinned headers', () => {
    it('lets the navbar travel the whole page, not just the first screen', () => {
        // `height: 100%` on #root capped the sticky navbar's containing block at
        // one viewport, so the bar scrolled away after a screenful.
        expect(indexCss).toMatch(/#root\s*\{[^}]*min-height:\s*100%/);
        expect(indexCss).not.toMatch(/#root\s*\{[^}]*[^-]height:\s*100%/);
    });

    it('hangs the day names off the measured navbar', () => {
        const rule = /\.signals-page \.day-head\s*\{([^}]*)\}/.exec(signalsCss)?.[1] ?? '';

        expect(rule).toContain('position: sticky');
        expect(rule).toContain('--navbar-height');
    });

    it('leaves the week bar to scroll away', () => {
        expect(signalsCss).not.toMatch(/\.signals-head\s*\{[^}]*position:\s*sticky/);
    });

    it('stops the day card being a scroll container of its own', () => {
        // `overflow: hidden` would leave the head with nothing to stick to.
        expect(signalsCss).toMatch(/\.signals-page \.day-card\s*\{[^}]*overflow:\s*clip/);
    });
});
