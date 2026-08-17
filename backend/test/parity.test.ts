/**
 * Parity gate: the Node API against golden JSON recorded from the Flask server.
 *
 * The fixtures in test/fixtures/golden were captured by scripts/capture-golden.ps1
 * while both stacks were running. They stay in the repo after server/ is deleted,
 * because at that point they are the only record of what the old behaviour was.
 *
 * This suite needs a live backend and a real key, so it is opt-in:
 *
 *   $env:WEBOPTIONS_PARITY = '1'; npm test -- --run parity
 *
 * Optional overrides: WEBOPTIONS_PARITY_URL, WEBOPTIONS_PARITY_KEY.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const GOLDEN_DIR = path.resolve(__dirname, 'fixtures/golden');
const SECRETS_DIR = path.resolve(__dirname, '../../.secrets');
const BASE_URL = process.env.WEBOPTIONS_PARITY_URL ?? 'http://127.0.0.1:5057';
const ENABLED = process.env.WEBOPTIONS_PARITY === '1';

interface Manifest {
    capturedAt: string;
    source: string;
    volatileFields: string[];
    weeks: Record<string, string | null>;
}

function golden<T>(name: string): T {
    return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${name}.json`), 'utf-8')) as T;
}

function apiKey(): string {
    const fromEnv = process.env.WEBOPTIONS_PARITY_KEY;
    if (fromEnv) return fromEnv;
    const keyFile = fs.readdirSync(SECRETS_DIR).find((name) => name.endsWith('.key'));
    if (!keyFile) {
        throw new Error(`No *.key file in ${SECRETS_DIR}. Set WEBOPTIONS_PARITY_KEY instead.`);
    }
    return fs.readFileSync(path.join(SECRETS_DIR, keyFile), 'utf-8').trim();
}

/** Drops fields that legitimately change between two runs, at any depth. */
function stripVolatile(value: unknown, drop: readonly string[]): unknown {
    if (Array.isArray(value)) return value.map((item) => stripVolatile(item, drop));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            if (drop.includes(key)) continue;
            out[key] = stripVolatile(inner, drop);
        }
        return out;
    }
    return value;
}

async function get(pathname: string): Promise<unknown> {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        headers: { 'X-API-Key': apiKey() },
    });
    if (!response.ok) {
        throw new Error(`GET ${pathname} returned ${response.status}`);
    }
    return response.json();
}

describe.skipIf(!ENABLED)('parity with the recorded Flask responses', () => {
    const manifest = golden<Manifest>('manifest');
    const volatile = manifest.volatileFields;

    async function expectMatches(pathname: string, fixture: string): Promise<void> {
        const live = await get(pathname);
        expect(stripVolatile(live, volatile)).toEqual(stripVolatile(golden(fixture), volatile));
    }

    it('reports health the same way', async () => {
        await expectMatches('/api/health', 'health');
    });

    it('finds the same earliest week', async () => {
        await expectMatches('/api/earliest-week', 'earliest-week');
    });

    for (const [fixture, week] of Object.entries(manifest.weeks)) {
        it.skipIf(!week)(`returns identical signals for ${week ?? 'nothing'}`, async () => {
            await expectMatches(`/api/week-signals?week=${week}`, fixture);
        });
    }

    // The one endpoint that is allowed to differ. Flask listed HTML files off
    // disk; the Node route reads ingested rows, so it drops `filename` and adds
    // `title` and `tradeCount`. Only the identity of each week has to survive.
    it('lists the same calendar weeks, in the same order', async () => {
        interface Entry {
            publishDate: string;
            weekStart: string;
            weekEnd: string;
        }
        const identity = (entry: Entry) => ({
            publishDate: entry.publishDate,
            weekStart: entry.weekStart,
            weekEnd: entry.weekEnd,
        });

        const live = (await get('/api/calendars')) as { calendars: Entry[] };
        const recorded = golden<{ calendars: Entry[] }>('calendars');

        expect(live.calendars.map(identity)).toEqual(recorded.calendars.map(identity));
    });
});
