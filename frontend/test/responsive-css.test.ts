import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The responsive contract in .github/copilot-instructions.md, enforced. jsdom
 * lays nothing out, so none of this can be caught by rendering a component: the
 * stylesheets are read as text, the same way the subgrid and safe-area rules
 * are. Every sheet under src is scanned, so a new one is covered the day it is
 * added rather than the day someone remembers to list it here.
 */

/** The path stays a parameter: Vite rewrites a literal one into an asset URL. */
function resolve(relative: string): string {
    return fileURLToPath(new URL(relative, import.meta.url));
}

const srcDir = resolve('../src');
const pagesDir = resolve('../src/pages');

function cssFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return cssFiles(path);
        return entry.name.endsWith('.css') ? [path] : [];
    });
}

/** Comments describe the rules; they must not be mistaken for them. */
function withoutComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const sheets = cssFiles(srcDir).map((path) => ({
    name: path.slice(srcDir.length + 1).replace(/\\/g, '/'),
    css: withoutComments(readFileSync(path, 'utf8')),
}));

const pages = readdirSync(pagesDir)
    .filter((name) => name.endsWith('Page.tsx'))
    .map((name) => ({ name, source: readFileSync(join(pagesDir, name), 'utf8') }));

const indexHtml = readFileSync(resolve('../index.html'), 'utf8');
const indexCss = sheets.find((sheet) => sheet.name === 'index.css')?.css ?? '';
const liveSignalsCss = sheets.find((sheet) => sheet.name === 'pages/LiveSignalsPage.css')?.css ?? '';
const contractHistoryCss = sheets.find((sheet) => sheet.name === 'pages/ContractHistoryPage.css')?.css ?? '';
const choiceMenuCss = sheets.find((sheet) => sheet.name === 'components/ChoiceMenu.css')?.css ?? '';
const navbarCss = sheets.find((sheet) => sheet.name === 'navigation/Navbar.css')?.css ?? '';

/** Anything this size is an icon, a spinner or a swatch, not a layout. */
const DECORATION_LIMIT_PX = 48;

function isDecoration(value: string): boolean {
    const match = /^([\d.]+)(px|rem|em)$/.exec(value);
    if (!match) return false;

    const size = Number(match[1]);
    return match[2] === 'px' ? size <= DECORATION_LIMIT_PX : size * 16 <= DECORATION_LIMIT_PX;
}

function declarations(css: string, property: string): { value: string; context: string }[] {
    const found: { value: string; context: string }[] = [];

    for (const match of css.matchAll(new RegExp(`(^|[;{\\s])${property}:\\s*([^;}]+)`, 'g'))) {
        found.push({ value: (match[2] ?? '').trim(), context: match[0].trim() });
    }

    return found;
}

/** The bodies of every `@media` block, with the condition that opened them. */
function mediaBlocks(css: string): { condition: string; body: string }[] {
    const blocks: { condition: string; body: string }[] = [];

    for (const match of css.matchAll(/@media([^{]*)\{/g)) {
        let depth = 1;
        let index = match.index + match[0].length;
        const start = index;

        while (index < css.length && depth > 0) {
            const char = css.charAt(index);
            if (char === '{') depth += 1;
            else if (char === '}') depth -= 1;
            index += 1;
        }

        blocks.push({ condition: (match[1] ?? '').trim(), body: css.slice(start, index - 1) });
    }

    return blocks;
}

/** The sheet as a phone reads it: the blocks a narrow screen never enters, gone. */
function phoneReachable(css: string): string {
    let reachable = css;

    for (const { condition, body } of mediaBlocks(css)) {
        const min = /min-width:\s*(\d+)px/.exec(condition);
        if (!min || Number(min[1]) < 640) continue;
        reachable = reachable.replace(body, '');
    }

    return reachable;
}

describe('the page can always be as narrow as the phone', () => {
    it.each(pages)('$name uses the shared responsive page root', ({ source }) => {
        expect(source).toMatch(/<main(?:\s|>)/);
    });

    it('scans every stylesheet under src', () => {
        // A guard on the guard: an empty list would pass everything below.
        expect(sheets.length).toBeGreaterThanOrEqual(9);
        expect(sheets.map((sheet) => sheet.name)).toContain('index.css');
    });

    it('lets the page be the width of the device', () => {
        expect(indexHtml).toMatch(/name="viewport"[^>]*width=device-width/);
    });

    it.each(sheets)('$name sizes nothing but decoration in fixed units', ({ css }) => {
        for (const { value, context } of [...declarations(css, 'width'), ...declarations(css, 'min-width')]) {
            // `min()`, `clamp()`, `%` and `auto` all shrink; a bare length does
            // not, and one wider than the screen scrolls the whole page.
            const fluid = /^(auto|100%|fit-content|max-content)$/.test(value) || /(min|max|clamp|calc)\(|%/.test(value);

            expect(fluid || isDecoration(value), `${context} is a fixed layout width`).toBe(true);
        }
    });

    it.each(sheets)('$name keeps every capped element inside the viewport', ({ css }) => {
        // `width: min(680px, ...)` is only fluid if the other argument tracks the
        // viewport. `min(680px, 40rem)` is just 680px with extra steps.
        for (const { value, context } of declarations(css, 'width')) {
            if (!value.startsWith('min(')) continue;
            expect(value, `${context} never yields to a narrow screen`).toContain('100vw');
        }
    });

    it.each(sheets)('$name collapses its fixed-count grids on a narrow screen', ({ css }) => {
        // A counted grid a phone never reaches has already answered for itself.
        const fixedCount = declarations(phoneReachable(css), 'grid-template-columns').some(({ value }) =>
            /repeat\(\s*\d/.test(value)
        );
        if (!fixedCount) return;

        // `auto-fit` reflows on its own; a counted `repeat()` has to be told.
        const narrow = mediaBlocks(css).find(({ condition }) => /max-width:\s*640px/.test(condition));

        // Either the tracks come down to one, or the children leave the grid
        // altogether and stack. The week grid does the second: its cards carry
        // an inline `grid-column`, which invents tracks of its own however
        // narrow the template is told to be.
        expect(narrow?.body ?? '').toMatch(/grid-template-columns:\s*1fr|flex-basis:\s*100%/);
    });

    it('breaks a symbol or a link rather than widening the column it sits in', () => {
        const body = /(?:^|})\s*body\s*\{([^}]*)\}/.exec(indexCss)?.[1] ?? '';
        expect(body).toContain('overflow-wrap: break-word');
    });

    it.each([
        ['.page-head', indexCss],
        ['.week-nav', indexCss],
        ['.pills', navbarCss],
    ])('%s wraps instead of running off the screen', (selector, css) => {
        const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

        expect(rule).toContain('flex-wrap: wrap');
    });

    it('lets the symbol filter shrink with the head it sits in', () => {
        const rule = /\.symbol-filter input\s*\{([^}]*)\}/.exec(liveSignalsCss)?.[1] ?? '';

        expect(rule).toContain('width: 100%');
    });

    it('keeps the owned filter in the phone filter reflow', () => {
        expect(liveSignalsCss).toContain('.filter-section-owned');
        const phoneBlocks = mediaBlocks(liveSignalsCss).filter(({ condition }) => /max-width:\s*640px/.test(condition));
        expect(phoneBlocks.some(({ body }) => body.includes('.filter-section-owned'))).toBe(true);
    });

    it('keeps choice-menu rows touch-sized on phones', () => {
        const phone = mediaBlocks(choiceMenuCss).find(({ condition }) => /max-width:\s*640px/.test(condition));
        expect(phone?.body ?? '').toMatch(/\.choice-item\s*\{[^}]*min-height:\s*44px/);
    });
});

describe('a large tablet is not a desktop', () => {
    it('gives grid pages 5 percent tablet gutters', () => {
        const tablet = mediaBlocks(indexCss).find(({ condition }) => /min-width:\s*641px/.test(condition));

        expect(tablet?.body ?? '').toContain('padding-left: max(5%, env(safe-area-inset-left))');
        expect(tablet?.body ?? '').toContain('padding-right: max(5%, env(safe-area-inset-right))');
    });

    it.each(sheets)('$name never decides on width alone above 1100px', ({ css }) => {
        for (const { condition } of mediaBlocks(css)) {
            const min = /min-width:\s*(\d+)px/.exec(condition);
            if (!min || Number(min[1]) <= 1100) continue;

            // A 13 inch iPad is 1366 CSS px in landscape and answers
            // `pointer: fine` only when a mouse is attached, so the pointer is
            // the one signal that separates it from a laptop.
            expect(condition, 'a desktop-only rule must test the pointer').toMatch(/pointer:\s*fine|hover:\s*hover/);
        }
    });
});

describe('contract history overlays and summaries', () => {
    it('floats the contract picker below the sticky navbar on tablets as well as desktops', () => {
        const overlay = mediaBlocks(contractHistoryCss).find(({ condition }) =>
            /^\(min-width:\s*641px\)$/.test(condition.trim())
        );
        const picker =
            /\.history-page:has\(\.history-result\) \.history-contracts\s*\{([^}]*)\}/.exec(overlay?.body ?? '')?.[1] ??
            '';
        const body =
            /\.history-page:has\(\.history-result\) \.history-contracts-body\s*\{([^}]*)\}/.exec(
                overlay?.body ?? ''
            )?.[1] ?? '';
        const navbar = /\.navbar\s*\{([^}]*)\}/.exec(navbarCss)?.[1] ?? '';

        expect(picker).toContain('z-index: 18');
        expect(body).toContain('position: absolute');
        expect(overlay?.body ?? '').toMatch(/\.history-summary-details > :not\(summary\)\s*\{[^}]*position: absolute/);
        expect(navbar).toContain('z-index: 20');
    });

    it('lets the chart fill the remaining height on tablets as well as desktops', () => {
        const fill = mediaBlocks(contractHistoryCss).find(
            ({ condition }) => /min-width:\s*641px/.test(condition) && /min-height:\s*600px/.test(condition)
        );

        expect(fill?.condition ?? '').not.toContain('pointer');
        expect(fill?.body ?? '').toMatch(/\.history-page:has\(\.history-result\)\s*\{[^}]*100dvh/);
        expect(fill?.body ?? '').toMatch(/\.history-chart\s*\{[^}]*flex: 1 1 0/);
    });

    it('hides overnight changes on touch devices', () => {
        const touch = mediaBlocks(contractHistoryCss).filter(
            ({ condition }) => condition.trim() === '(pointer: coarse)'
        );

        expect(touch.some(({ body }) => /\.history-session-changes\s*\{[^}]*display: none/.test(body))).toBe(true);
    });

    it('gives summary labels room at narrower desktop widths and keeps them on one line', () => {
        const narrowDesktop = mediaBlocks(contractHistoryCss).find(
            ({ condition }) => /min-width:\s*1101px/.test(condition) && /max-width:\s*1280px/.test(condition)
        );
        const midDesktop = mediaBlocks(contractHistoryCss).find(
            ({ condition }) => /min-width:\s*1281px/.test(condition) && /max-width:\s*1600px/.test(condition)
        );
        const label = /\.history-summary-label\s*\{([^}]*)\}/.exec(contractHistoryCss)?.[1] ?? '';

        expect(narrowDesktop?.body ?? '').toMatch(/padding-right:\s*15%/);
        expect(midDesktop?.body ?? '').toMatch(/padding-right:\s*30%/);
        expect(label).toContain('white-space: nowrap');
    });
});
