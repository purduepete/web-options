import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* jsdom runs no animations, so the entrance can only be checked by reading it. */
function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const indexCss = read('../src/index.css');

/** The body of the first `@media` block whose condition matches. */
function mediaBlock(condition: string): string {
    const start = indexCss.indexOf(`@media ${condition}`);
    expect(start).toBeGreaterThan(-1);

    let depth = 0;
    let index = indexCss.indexOf('{', start);
    const open = index;

    for (; index < indexCss.length; index += 1) {
        if (indexCss[index] === '{') depth += 1;
        if (indexCss[index] === '}') depth -= 1;
        if (depth === 0) break;
    }

    return indexCss.slice(open + 1, index);
}

describe('page entrance', () => {
    it('fades the shell in once and rises each page in on arrival', () => {
        expect(indexCss).toMatch(/#root\s*\{[^}]*animation:\s*shell-in/);
        expect(indexCss).toMatch(/main\s*\{[^}]*animation:\s*page-in/);
        expect(indexCss).toContain('@keyframes shell-in');
        expect(indexCss).toContain('@keyframes page-in');
    });

    it('holds still for anyone who asked motion to stop', () => {
        const reduced = mediaBlock('(prefers-reduced-motion: reduce)');

        expect(reduced).toMatch(/#root,\s*main\s*\{[^}]*animation:\s*none/);
    });
});
