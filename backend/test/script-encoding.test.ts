import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// jimbrownhome runs Windows PowerShell 5.1, which reads a BOM-less file as ANSI.
// One em dash there turns into three bytes of garbage and the script fails to parse.
const scriptsDir = path.resolve(__dirname, '../../scripts');

describe('launcher scripts', () => {
    const scripts = fs.readdirSync(scriptsDir).filter((name) => /\.(ps1|vbs)$/.test(name));

    it('finds the scripts', () => {
        expect(scripts.length).toBeGreaterThan(0);
    });

    it.each(scripts)('%s is pure ASCII', (name) => {
        const text = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
        // eslint-disable-next-line no-control-regex -- the range starts at NUL to match every non-ASCII byte
        const offenders = [...text.matchAll(/[^\x00-\x7F]/g)].map((match) => {
            const line = text.slice(0, match.index).split('\n').length;
            return `line ${line}: ${JSON.stringify(match[0])}`;
        });
        expect(offenders).toEqual([]);
    });
});
