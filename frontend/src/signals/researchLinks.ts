/** Trade context consumed by the research overlays, matching Web Portfolio's key order and precision. */
export function tradeContext(input: {
    symbol: string;
    strike: number | null;
    expiration: string | null;
    delta: number | null;
    premium: number | null;
    underlyingPrice: number | null;
    underlyingChangePct: number | null;
}): string[] {
    const { strike, expiration, underlyingPrice: underlying } = input;
    if (strike === null || expiration === null) return [];

    const parts = [
        `trade_ticker=${encodeURIComponent(input.symbol)}`,
        `trade_strike=${strike.toFixed(2)}`,
        `trade_expiration=${expiration}`,
    ];
    if (input.delta !== null) parts.push(`trade_delta=${(-Math.abs(input.delta)).toFixed(4)}`);
    if (input.premium !== null) parts.push(`trade_optionPrice=${(input.premium / 100).toFixed(2)}`);
    if (underlying !== null) parts.push(`trade_underlyingPrice=${underlying.toFixed(2)}`);
    if (input.underlyingChangePct !== null) {
        parts.push(`trade_underlyingChange=${input.underlyingChangePct.toFixed(2)}`);
    }
    if (underlying !== null && strike > 0) {
        parts.push(`trade_strikePct=${(((underlying - strike) / strike) * 100).toFixed(2)}`);
    }
    return parts;
}

/** A fragment keeps the option context local to the browser's research overlay. */
export function withContext(url: string, context: string[]): string {
    return context.length === 0 ? url : `${url}#${context.join('&')}`;
}

export function seekingAlphaUrl(symbol: string): string {
    return `https://seekingalpha.com/symbol/${encodeURIComponent(symbol.toUpperCase())}`;
}

export function tradingViewUrl(symbol: string): string {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
}
