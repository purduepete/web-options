import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canonical sibling repository discovery', () => {
    it('finds the operator config in web-portfolio beside this checkout', () => {
        const script = fs.readFileSync(path.resolve('scripts/weboptions.ps1'), 'utf8');
        expect(script).toContain(
            "$OperatorConfig = Join-Path (Split-Path -Parent $Root) 'web-portfolio\\config\\config.ini'"
        );
        expect(script).not.toMatch(/C:\\Files\\Dev\\main\\webportfolio\\/);
    });
});
