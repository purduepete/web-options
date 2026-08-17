import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* The head is plain HTML, outside any component, so it is checked by reading it. */
function read(relative: string): string {
    // The path stays a parameter: Vite rewrites a literal one into an asset URL.
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const html = read('../index.html');

describe('document head', () => {
    it('names the site the way the navbar does', () => {
        expect(html).toContain('<title>Web Options</title>');
    });

    it('points at an icon that is actually shipped', () => {
        expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
        expect(read('../public/favicon.svg')).toContain('<svg');
    });
});
