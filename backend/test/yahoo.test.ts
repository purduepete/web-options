import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDailyBars, fetchQuote, normalizeSymbol } from '../src/market/yahoo';

/*
 * Yahoo's chart endpoint is undocumented and unsupported, so what is pinned here is
 * OUR half of the contract: what we send, and that anything unexpected coming back
 * turns into null rather than an exception. Nothing here reaches the network.
 */

function chartBody(overrides: Record<string, unknown> = {}) {
    return {
        chart: {
            result: [
                {
                    meta: {
                        longName: 'Vistra Corp.',
                        fullExchangeName: 'NYSE',
                        currency: 'USD',
                        regularMarketPrice: 182.35,
                        previousClose: 180.1,
                        // 2026-08-18T20:00:00Z
                        regularMarketTime: 1_787_083_200,
                    },
                    timestamp: [1_786_996_800, 1_787_083_200],
                    indicators: { quote: [{ close: [180.1, 182.35] }] },
                    ...overrides,
                },
            ],
        },
    };
}

/** Installs a fetch stub and hands back the calls it recorded. */
function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): { urls: string[] } {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
        urls.push(url);
        return Promise.resolve({ ok: true, ...response } as Response);
    });
    return { urls };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('normalizeSymbol', () => {
    it.each(['vst', ' VST ', 'brk.b', 'BF-B', 'A'])('accepts %s', (value) => {
        expect(normalizeSymbol(value)).toBe(value.trim().toUpperCase());
    });

    it.each(['', '.VST', 'VST;DROP', 'VST VST', 'A'.repeat(21), '../../etc/passwd'])('refuses %s', (value) => {
        expect(normalizeSymbol(value)).toBeNull();
    });
});

describe('fetchQuote', () => {
    it('reads the meta block', async () => {
        stubFetch({ json: () => Promise.resolve(chartBody()) });

        expect(await fetchQuote('vst')).toEqual({
            longName: 'Vistra Corp.',
            exchange: 'NYSE',
            currency: 'USD',
            price: 182.35,
            previousClose: 180.1,
            priceDate: '2026-08-18',
        });
    });

    it('takes the range close when the meta has no prior close', async () => {
        stubFetch({
            json: () =>
                Promise.resolve(
                    chartBody({
                        meta: { regularMarketPrice: 182.35, chartPreviousClose: 179.5 },
                    })
                ),
        });

        expect((await fetchQuote('VST'))?.previousClose).toBe(179.5);
    });

    it('asks for a single day', async () => {
        const { urls } = stubFetch({ json: () => Promise.resolve(chartBody()) });
        await fetchQuote('VST');

        expect(urls[0]).toContain('range=1d');
        expect(urls[0]).toContain('interval=1d');
    });

    it('spells a dotted class share Yahoo-style on the wire', async () => {
        const { urls } = stubFetch({ json: () => Promise.resolve(chartBody()) });
        await fetchQuote('BRK.B');

        // The hyphen is Yahoo's spelling. Everything else in the app — the cache
        // key, the heading, the research links — keeps the feed's `BRK.B`.
        expect(urls[0]).toContain('/BRK-B?');
    });

    it('falls back to the short name and the short exchange', async () => {
        stubFetch({
            json: () => Promise.resolve(chartBody({ meta: { shortName: 'Vistra', exchangeName: 'NYQ' } })),
        });
        const quote = await fetchQuote('VST');

        expect(quote?.longName).toBe('Vistra');
        expect(quote?.exchange).toBe('NYQ');
    });

    it('never calls out for a symbol that is not a ticker', async () => {
        const { urls } = stubFetch({ json: () => Promise.resolve(chartBody()) });

        expect(await fetchQuote('DROP TABLE')).toBeNull();
        expect(urls).toEqual([]);
    });

    it.each([
        ['a refusal', { ok: false, json: () => Promise.resolve(chartBody()) }],
        ['an empty result list', { json: () => Promise.resolve({ chart: { result: [] } }) }],
        ['a body that is not the shape we expect', { json: () => Promise.resolve({ finance: { error: 'nope' } }) }],
        ['unparseable JSON', { json: () => Promise.reject(new Error('Unexpected token')) }],
    ])('softens %s into null', async (_label, response) => {
        stubFetch(response);

        expect(await fetchQuote('VST')).toBeNull();
    });

    it('softens a network failure into null', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

        expect(await fetchQuote('VST')).toBeNull();
    });
});

describe('fetchDailyBars', () => {
    it('asks for two years, so the 200 day average covers the whole chart', async () => {
        const { urls } = stubFetch({ json: () => Promise.resolve(chartBody()) });
        await fetchDailyBars('VST');

        expect(urls[0]).toContain('range=2y');
    });

    it('pairs each stamp with its close and dates them in UTC', async () => {
        stubFetch({ json: () => Promise.resolve(chartBody()) });
        const daily = await fetchDailyBars('VST');

        expect(daily?.bars).toEqual([
            { date: '2026-08-17', close: 180.1 },
            { date: '2026-08-18', close: 182.35 },
        ]);
        expect(daily?.quote.price).toBe(182.35);
    });

    it('drops a day with no close rather than carrying a hole', async () => {
        stubFetch({
            json: () =>
                Promise.resolve(
                    chartBody({
                        timestamp: [1_786_996_800, 1_787_083_200],
                        indicators: { quote: [{ close: [180.1, null] }] },
                    })
                ),
        });
        const daily = await fetchDailyBars('VST');

        expect(daily?.bars).toEqual([{ date: '2026-08-17', close: 180.1 }]);
    });

    it('sorts oldest first, whatever order it was handed', async () => {
        stubFetch({
            json: () =>
                Promise.resolve(
                    chartBody({
                        timestamp: [1_787_083_200, 1_786_996_800],
                        indicators: { quote: [{ close: [182.35, 180.1] }] },
                    })
                ),
        });
        const daily = await fetchDailyBars('VST');

        expect(daily?.bars.map((bar) => bar.date)).toEqual(['2026-08-17', '2026-08-18']);
    });

    it('returns null when the closes are missing entirely', async () => {
        stubFetch({ json: () => Promise.resolve(chartBody({ indicators: {} })) });

        expect(await fetchDailyBars('VST')).toBeNull();
    });
});
