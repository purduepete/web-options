import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { WRAPUP_HEADERS, type WeeklyWrapup } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import * as authRepository from '../src/auth/repository';
import { validateWrapup } from '../src/wrapups/repository';

let directory: string;
let rootDirectory: string;
function report(): WeeklyWrapup {
    return {
        version: 1,
        id: '2026-11-06',
        sourceUrl: 'https://example.com/report',
        sourceHash: 'a'.repeat(64),
        importedAt: '2026-11-09T17:00:00-08:00',
        sections: {
            management: {
                name: 'Management Plan',
                start: '2026-11-09',
                end: '2026-11-13',
                quoteDate: '2026-11-06',
                tables: [{ kind: 'management', headers: [...WRAPUP_HEADERS.management], rows: [] }],
                audit: { calls: [3], notes: [1] },
                headerRows: [2],
                sourceRows: 3,
            },
            closed: {
                name: 'Closed Trades',
                start: '2026-11-02',
                end: '2026-11-06',
                quoteDate: null,
                tables: [{ kind: 'closed', headers: [...WRAPUP_HEADERS.closed], rows: [] }],
                audit: { calls: [], notes: [1] },
                headerRows: [2],
                sourceRows: 2,
            },
            rolls: {
                name: 'Rolls',
                start: '2026-11-02',
                end: '2026-11-06',
                quoteDate: null,
                tables: [{ kind: 'rolls', headers: [...WRAPUP_HEADERS.rolls], rows: [] }],
                audit: { calls: [], notes: [1] },
                headerRows: [2],
                sourceRows: 2,
            },
        },
    };
}
function app(access = true) {
    const config: AppConfig = {
        wrapupDirectory: directory,
        db: { server: 'unused', database: 'unused', user: 'unused', password: 'unused' },
        auth: { mode: access ? 'access' : 'api-key', allowedOrigins: ['https://example.com'] },
        webportfolio: { apiUrl: null, serviceKey: null },
        port: 5057,
        host: '127.0.0.1',
        nodeEnv: 'test',
        webRoot: null,
    };
    return createApp(config);
}
beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'wrapup-test-'));
    rootDirectory = directory;
});
afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDirectory, { recursive: true, force: true });
});

describe('read-only weekly wrap-up API', () => {
    it('requires authentication in key mode before reading files', async () => {
        vi.spyOn(authRepository, 'findActiveKey').mockResolvedValue(null);
        expect((await request(app(false)).get('/api/weekly-wrapups')).status).toBe(401);
    });
    it('lists and reads persisted reports after a new app instance', async () => {
        await writeFile(path.join(directory, '2026-11-06.json'), JSON.stringify(report()));
        const index = await request(app()).get('/api/weekly-wrapups');
        expect(index.body.reports).toEqual([{ id: '2026-11-06', start: '2026-11-02', end: '2026-11-06' }]);
        const result = await request(app()).get('/api/weekly-wrapups/2026-11-06');
        expect(result.body).toEqual(report());
        expect(await readFile(path.join(directory, '2026-11-06.json'), 'utf8')).toBe(JSON.stringify(report()));
    });
    it('returns an empty index for a not-yet-created import directory', async () => {
        directory = path.join(directory, 'missing');
        expect((await request(app()).get('/api/weekly-wrapups')).body).toEqual({ reports: [] });
        await mkdir(directory);
    });
    it('returns 400 for malformed ids and 404 for absent reports', async () => {
        expect((await request(app()).get('/api/weekly-wrapups/latest')).status).toBe(400);
        expect((await request(app()).get('/api/weekly-wrapups/2026-11-06')).status).toBe(404);
    });
    it('surfaces corruption as a failure rather than an empty success', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await writeFile(path.join(directory, '2026-11-06.json'), '{"version":1}');
        expect((await request(app()).get('/api/weekly-wrapups')).status).toBe(500);
    });
    it('rejects calls, unknown tables, and incomplete row accounting in persisted data', () => {
        const value = report();
        value.sections.rolls.tables[0]!.rows.push({
            sourceRow: 3,
            cells: Array(8).fill('test'),
            contract: { symbol: 'TEST', strike: 100, optionRight: 'P', expiration: '2026-11-20' },
            newContract: { symbol: 'TEST', strike: 95, optionRight: 'P', expiration: '2026-12-24' },
        });
        value.sections.rolls.sourceRows++;
        expect(() => validateWrapup(value)).not.toThrow();
        expect(() =>
            validateWrapup(JSON.parse(JSON.stringify(value).replaceAll('"optionRight":"P"', '"optionRight":"C"')))
        ).toThrow();
        value.sections.rolls.sourceRows++;
        expect(() => validateWrapup(value)).toThrow();
    });
    it('does not expose an upload or write endpoint', async () => {
        expect((await request(app()).post('/api/weekly-wrapups').set('origin', 'https://example.com')).status).toBe(
            404
        );
    });
});
