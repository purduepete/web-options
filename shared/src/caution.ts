/**
 * The global caution list: underlyings to flag on every signal and calendar
 * ticket. Parsing and normalising live here rather than in either app, so the
 * server validates exactly what the textarea promised the reader.
 */

/** Matches the VARCHAR(20) that stores it. */
export const CAUTION_SYMBOL_MAX_LENGTH = 20;

/** Far more than anyone will type, low enough that one save stays one round trip. */
export const CAUTION_SYMBOL_LIMIT = 200;

/** Tickers, including the dotted and hyphenated share classes (BRK.B, BF-B). */
const CAUTION_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]*$/;

export function isCautionSymbol(value: string): boolean {
    return value.length <= CAUTION_SYMBOL_MAX_LENGTH && CAUTION_SYMBOL_RE.test(value);
}

/** Upper-cases, drops blanks and dedupes, keeping the order first seen. */
export function normalizeCautionSymbols(values: readonly string[]): string[] {
    const seen = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const symbol = value.trim().toUpperCase();
        if (symbol) seen.add(symbol);
    }
    return [...seen];
}

/** One per line, or separated by spaces or commas. */
export function parseCautionSymbols(text: string): string[] {
    return normalizeCautionSymbols(text.split(/[\s,]+/));
}

export interface CautionSymbolsResponse {
    symbols: string[];
}

export interface SaveCautionSymbolsRequest {
    symbols: string[];
}
