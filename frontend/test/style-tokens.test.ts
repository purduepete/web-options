import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The house style, enforced on the sheets the trade drill-in added. jsdom lays
 * nothing out, so these read the stylesheets as text the way the responsive and
 * motion rules do.
 *
 * Scoped to the new sheets ON PURPOSE. Three older ones predate the style — the
 * palette rounds its own corners, the theme control draws its own outline — and
 * widening this test would either fail on them or need a list of excuses that
 * would slowly become the rule.
 */

function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
}

/** Comments describe the rules; they must not be mistaken for them. */
function withoutComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const NEW_SHEETS = [
    'components/Modal.css',
    'components/SymbolMark.css',
    'grade/GradeBadge.css',
    'signals/PriceChart.css',
    'signals/TradeDetail.css',
    'pages/GradingPage.css',
] as const;

const sheets = NEW_SHEETS.map((name) => ({ name, css: withoutComments(read(`../src/${name}`)) }));

const modalCss = sheets.find((sheet) => sheet.name === 'components/Modal.css')!.css;
const indexCss = withoutComments(read('../src/index.css'));

describe('the drill-in follows the house style', () => {
    it.each(sheets)('$name names no colour of its own', ({ css }) => {
        // A literal here is a colour that cannot follow the theme, so it survives
        // into dark mode as whatever it looked like in light. Shadows are checked
        // separately below: a shadow is depth rather than colour.
        const withoutShadows = css.replace(/box-shadow:[^;]+;/g, '');
        const literals = withoutShadows.match(/#[0-9a-fA-F]{3,8}\b|(?<!-)\brgba?\(\s*\d/g) ?? [];

        expect(literals).toEqual([]);
    });

    it.each(sheets)('$name draws no shadow but plain black, which every theme shares', ({ css }) => {
        // The one carve-out: `rgb(0 0 0 / n%)`. It is the same black under every
        // theme, and a token for it would only be that.
        for (const shadow of css.match(/box-shadow:[^;]+;/g) ?? []) {
            expect(shadow).not.toMatch(/#[0-9a-fA-F]{3,8}/);
            expect(shadow).not.toMatch(/rgba?\(\s*(?!0\s+0\s+0)\d/);
        }
    });

    it.each(sheets)('$name rounds nothing, because --radius is 0 app-wide', ({ css }) => {
        expect(css).not.toContain('border-radius');
    });

    it.each(sheets)('$name times every transition from the one token', ({ css }) => {
        for (const declaration of css.match(/transition:[^;]+;/g) ?? []) {
            expect(declaration).toContain('var(--transition)');
        }
    });

    it.each(sheets)('$name leaves the focus ring to index.css', ({ css }) => {
        // The ring is a global box-shadow with `outline: none`. A local outline
        // would draw a second, squarer ring beside it.
        expect(css).not.toMatch(/(^|[\s;{])outline\s*:/);
    });

    it('holds --radius at 0, which is what makes the rule above safe', () => {
        expect(indexCss).toMatch(/--radius:\s*0/);
    });
});

describe('what sits in front of what', () => {
    it('puts the modal over the navbar and under the palette', () => {
        // 20 navbar, 50 modal, 60 palette, 70 shortcuts. A modal that opened from
        // the palette must not be painted behind it.
        expect(modalCss).toMatch(/z-index:\s*50/);
    });

    it('gives the backdrop and the dialog one stacking context, so neither can pass the other', () => {
        expect(modalCss).toMatch(/\.modal-root\s*\{[^}]*z-index:\s*50/);
    });
});

describe('the modal on a phone', () => {
    it('opens full-bleed, because a 46rem dialog centred on a phone is just a page', () => {
        expect(modalCss).toMatch(/\.modal-dialog\s*\{[^}]*inset:\s*0/);
    });

    it('keeps the close button clear of the notch and the home bar', () => {
        expect(modalCss).toContain('env(safe-area-inset-');
    });

    it('yields to a narrow screen at every width it caps itself at', () => {
        for (const [, value] of modalCss.matchAll(/width:\s*(min\([^;]+)\);/g)) {
            expect(value).toContain('100vw');
        }
    });
});
