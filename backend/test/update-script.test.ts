import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
};
const updateScript = fs.readFileSync(path.join(root, 'scripts/update.ps1'), 'utf8');

describe('production update command', () => {
    it('is exposed through npm', () => {
        expect(packageJson.scripts.update).toBe('pwsh -NoProfile -File scripts/update.ps1');
    });

    it('pulls without merging and refuses migration changes', () => {
        expect(updateScript).toContain('git pull --ff-only');
        expect(updateScript).toContain("$changed -match '^database/migrations/'");
        expect(updateScript).toContain('Set-Content -Path $PendingMigrationFile');
        expect(updateScript).toContain('-not $MigrationsApplied');
    });

    it('builds before stopping the current listener', () => {
        expect(updateScript.indexOf('& npm.cmd run build')).toBeGreaterThan(-1);
        expect(updateScript.indexOf('& npm.cmd run build')).toBeLessThan(updateScript.indexOf('Stop-Process -Id'));
    });

    it('checks database readiness after starting the task', () => {
        expect(updateScript).toContain("$result.database -eq 'ok'");
        expect(updateScript.indexOf('Start-ScheduledTask')).toBeLessThan(
            updateScript.indexOf('if (-not (Wait-Ready))')
        );
    });
});
