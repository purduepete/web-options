import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Dragging across a heading used to paint it blue and put an I-beam over it, as
 * though a day name were something you might want to copy. jsdom does not do
 * selection or cursors, so the rules are read rather than exercised. The point
 * of the split below is that only one of the two groups gets a cursor: the other
 * is full of things that already have one worth keeping.
 */
function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    // Line endings are normalised because the rules below are matched by line.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
}

const indexCss = read('../src/index.css');

/** The selector list and body of the rule containing `needle` as a selector. */
function ruleContaining(needle: string): { selectors: string; body: string } {
    const at = indexCss.indexOf(`\n${needle},\n`);
    expect(at, `no rule lists ${needle}`).toBeGreaterThan(-1);
    const open = indexCss.indexOf('{', at);
    // Back up to whatever ended last, so a comment above the rule is not read
    // as part of its selector list.
    const before = indexCss.slice(0, at);
    const start = Math.max(before.lastIndexOf('}'), before.lastIndexOf('*/')) + 2;
    return {
        selectors: indexCss.slice(start, open).replace(/\s+/g, ' ').trim(),
        body: indexCss.slice(open + 1, indexCss.indexOf('}', open)),
    };
}

const chrome = ruleContaining('.palette-group');
const pressable = ruleContaining('.nav-link');

describe('unselectable chrome', () => {
    it('covers the text that labels the app rather than reports on it', () => {
        for (const selector of ['h1', 'h2', 'h3', 'h4', '.badge', '.no-trades', '.shortcuts-dialog', 'kbd']) {
            expect(chrome.selectors).toContain(selector);
        }
        expect(chrome.body).toContain('user-select: none');
        expect(chrome.body).toContain('cursor: default');
    });

    it('spells out the prefix Safari still needs', () => {
        expect(chrome.body).toContain('-webkit-user-select: none');
        expect(pressable.body).toContain('-webkit-user-select: none');
    });

    it('leaves the cursor alone on anything that is pressed', () => {
        for (const selector of ['button', 'a', 'label', '.nav-link', '.palette-option']) {
            expect(pressable.selectors).toContain(selector);
        }
        expect(pressable.body).toContain('user-select: none');
        expect(pressable.body).not.toContain('cursor');
    });

    it('keeps a trade copyable, because that is the part worth copying', () => {
        for (const selector of [
            '.ticket',
            '.ticker',
            '.tier-badge',
            '.moneyness',
            '.contract',
            '.event-banner',
            '.rule-box',
        ]) {
            expect(chrome.selectors).not.toContain(selector);
            expect(pressable.selectors).not.toContain(selector);
        }
    });

    it('does not blunt the pointer on an icon that is its own button', () => {
        // A cursor set on a child beats one inherited from a parent, so a bare
        // `svg` here would quietly undo `cursor: pointer` on every icon button.
        expect(chrome.selectors).not.toContain('svg');
    });
});
