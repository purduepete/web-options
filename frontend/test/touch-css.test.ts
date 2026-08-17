import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * jsdom has no hit testing and no touch, so the reason the navbar's icon buttons
 * were dead on an iPad cannot be caught by rendering them: the tap landed on the
 * svg inside the button rather than the button, and Safari never ran the
 * handler. Both guards below are stylesheet-only, so they are read.
 */
function read(relative: string): string {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const indexCss = read('../src/index.css');

/** The body of the rule for a selector, with whitespace squashed. */
function rule(selector: string): string {
    const start = indexCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const open = indexCss.indexOf('{', start);
    const close = indexCss.indexOf('}', open);
    return indexCss.slice(open + 1, close).replace(/\s+/g, ' ').trim();
}

describe('touch targets', () => {
    it('keeps icons out of the way of the button they sit in', () => {
        expect(rule('button svg')).toContain('pointer-events: none');
    });

    it('does not make a tap wait to see whether it is a double tap', () => {
        expect(rule('button')).toContain('touch-action: manipulation');
    });
});
