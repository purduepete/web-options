import type { SymbolBar } from '@weboptions/shared';

/**
 * The backend's only outbound HTTP call.
 *
 * Yahoo's chart endpoint needs no key and no account, which is why it was chosen,
 * but it is also undocumented and unsupported: it can change shape or start
 * refusing us without notice. Every failure here is therefore SOFT — callers get
 * null and show the trade without the market data, rather than failing the modal.
 */

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Tickers, including the dotted and hyphenated share classes. */
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

const TIMEOUT_MS = 8_000;

// Yahoo answers a bare fetch with 429 more often than not.
const USER_AGENT = 'Mozilla/5.0 (compatible; WebOptions/1.0)';

export interface SymbolQuote {
    longName: string | null;
    exchange: string | null;
    currency: string | null;
    price: number | null;
    previousClose: number | null;
    priceDate: string | null;
}

interface ChartMeta {
    longName?: unknown;
    shortName?: unknown;
    fullExchangeName?: unknown;
    exchangeName?: unknown;
    currency?: unknown;
    regularMarketPrice?: unknown;
    chartPreviousClose?: unknown;
    previousClose?: unknown;
    regularMarketTime?: unknown;
}

interface ChartResult {
    meta?: ChartMeta;
    timestamp?: unknown;
    indicators?: { quote?: { close?: unknown }[] };
}

/**
 * Yahoo spells class shares `BRK-B` where the signal feed says `BRK.B`. The swap
 * happens on the wire ONLY: the cache key and everything the reader sees keep the
 * feed's spelling, or the same company would occupy two cache rows.
 */
function toWireSymbol(symbol: string): string {
    return symbol.replace(/\./g, '-');
}

/** Uppercases and validates. Returns null for anything that is not a ticker. */
export function normalizeSymbol(value: string): string | null {
    const symbol = value.trim().toUpperCase();
    return SYMBOL_RE.test(symbol) ? symbol : null;
}

function toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Epoch seconds to `YYYY-MM-DD` in UTC, matching the IsoDate rule in shared. */
function toIsoDate(epochSeconds: number): string {
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchChart(symbol: string, range: string): Promise<ChartResult | null> {
    const validated = normalizeSymbol(symbol);
    if (!validated) return null;

    // Validated against the pattern above, then encoded anyway: the guard is what
    // keeps a symbol out of the path, the encoding is what makes that belt and braces.
    const url = `${BASE}/${encodeURIComponent(toWireSymbol(validated))}?range=${range}&interval=1d`;

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { chart?: { result?: ChartResult[] } };
        return body?.chart?.result?.[0] ?? null;
    } catch {
        // Timeout, DNS, refusal, malformed JSON. All the same to the caller.
        return null;
    }
}

function readQuote(result: ChartResult): SymbolQuote {
    const meta = result.meta ?? {};
    const time = toNumber(meta.regularMarketTime);
    return {
        longName: toText(meta.longName) ?? toText(meta.shortName),
        exchange: toText(meta.fullExchangeName) ?? toText(meta.exchangeName),
        currency: toText(meta.currency),
        price: toNumber(meta.regularMarketPrice),
        // `previousClose` is the prior session; `chartPreviousClose` is the close before
        // the requested range, which for a 1d range is the same day.
        previousClose: toNumber(meta.previousClose) ?? toNumber(meta.chartPreviousClose),
        priceDate: time === null ? null : toIsoDate(time),
    };
}

/** The lightweight call behind every modal open. */
export async function fetchQuote(symbol: string): Promise<SymbolQuote | null> {
    const result = await fetchChart(symbol, '1d');
    return result ? readQuote(result) : null;
}

export interface DailyBars {
    quote: SymbolQuote;
    bars: SymbolBar[];
}

/**
 * Two years, not one. A single year is ~252 trading days, so a 200 day average
 * would exist for only the last ~52 of them and would cover barely two months of
 * the six month chart.
 *
 * Days Yahoo returns with a null close (halts, or the not-yet-closed current day
 * on some series) are dropped, so `bars.length` is always a count of real closes.
 */
export async function fetchDailyBars(symbol: string): Promise<DailyBars | null> {
    const result = await fetchChart(symbol, '2y');
    if (!result) return null;

    const stamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = result.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return null;

    const bars: SymbolBar[] = [];
    for (let index = 0; index < stamps.length; index += 1) {
        const stamp = toNumber(stamps[index]);
        const close = toNumber(closes[index]);
        if (stamp === null || close === null) continue;
        bars.push({ date: toIsoDate(stamp), close });
    }

    bars.sort((a, b) => a.date.localeCompare(b.date));
    return { quote: readQuote(result), bars };
}
