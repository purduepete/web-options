import './SymbolMark.css';

/**
 * A monogram tile, not a logo.
 *
 * Every logo source is a third party this app would have to call on every open,
 * and a broken image where a brand should be reads worse than no brand at all.
 * One or two letters drawn from the ticker is always available and always right.
 */
export function SymbolMark({ symbol }: { symbol: string }) {
    // Two letters, unless the ticker is a single character.
    const monogram = symbol.slice(0, 2).toUpperCase();

    return (
        <svg className="symbol-mark" viewBox="0 0 40 40" role="img" aria-label={symbol} focusable="false">
            <rect x="0" y="0" width="40" height="40" />
            <text x="20" y="21" textAnchor="middle" dominantBaseline="central">
                {monogram}
            </text>
        </svg>
    );
}
