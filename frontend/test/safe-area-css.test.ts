import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * jsdom has no notch, no rounded corners and no home indicator, so none of this
 * can be caught by rendering. The stylesheets are read instead, the same way the
 * pinned-header rules are checked.
 */
function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const indexHtml = read('../index.html');
const indexCss = read('../src/index.css');
const navbarCss = read('../src/navigation/Navbar.css');
const toastCss = read('../src/components/Toasts.css');

describe('safe areas', () => {
    it('asks for the whole screen, or every inset reads as zero', () => {
        // Without viewport-fit=cover the browser letterboxes the page away from
        // the notch itself and env() resolves to 0px, so the rules below would
        // all be dead code.
        expect(indexHtml).toMatch(/viewport-fit=cover/);
    });

    it('keeps page text clear of the rounded corners and the home indicator', () => {
        const rule = /(?:^|\n)main\s*\{([^}]*)\}/.exec(indexCss)?.[1] ?? '';

        expect(rule).toContain('env(safe-area-inset-left)');
        expect(rule).toContain('env(safe-area-inset-right)');
        expect(rule).toContain('env(safe-area-inset-bottom)');
    });

    it('never lets an inset shrink the padding below the design value', () => {
        // `padding-left: env(...)` alone is a regression on a device with no
        // inset: it would drop 1.5rem of gutter to nothing.
        expect(indexCss).toMatch(/padding-left:\s*max\(1\.5rem,\s*env\(safe-area-inset-left\)\)/);
        expect(indexCss).toMatch(/padding-right:\s*max\(1\.5rem,\s*env\(safe-area-inset-right\)\)/);
    });

    it('drops the navbar below the notch when there is no browser chrome above it', () => {
        const rule = /\.navbar\s*\{([^}]*)\}/.exec(navbarCss)?.[1] ?? '';

        expect(rule).toContain('env(safe-area-inset-top)');
    });

    it('keeps the navbar controls off the landscape corners', () => {
        const rule = /\.navbar-bar\s*\{([^}]*)\}/.exec(navbarCss)?.[1] ?? '';

        expect(rule).toContain('env(safe-area-inset-left)');
        expect(rule).toContain('env(safe-area-inset-right)');
    });

    it('lifts toasts above the home indicator, where a swipe would eat the tap', () => {
        const rule = /\.toasts\s*\{([^}]*)\}/.exec(toastCss)?.[1] ?? '';

        expect(rule).toContain('env(safe-area-inset-bottom)');
    });
});
