export interface HistoryContract {
    key: string;
    symbol: string;
    expiration: string;
    strike: number;
    /**
     * Signal date (`yyyy-mm-dd`) this row lists the contract under, or when it was first seen.
     * Search returns one row per signal date; a single-contract lookup gives the first one.
     */
    added: string | null;
    /** Lower-case VADER tier on that date; its group in the picker. */
    tier: string | null;
    /** Distinct lower-case VADER tiers on that date. */
    tiers: string[];
    /** VADER named it a top pick on that date. */
    topPick: boolean;
    /** Underlying price on the latest captured quote, up to expiration; null before any capture. */
    underlyingPrice: number | null;
    /** ISO time of that quote. */
    underlyingAt: string | null;
}

export interface ContractSearchResponse {
    items: HistoryContract[];
    hasMore: boolean;
    unmappedContracts: number;
}

export interface HistoryPoint {
    time: number;
    sessionDate: string;
    kind: string;
    mark: number | null;
    delta: number | null;
    underlyingPrice: number | null;
    priceTime: string | null;
    deltaTime: string | null;
    priceReceivedAt: string | null;
    deltaReceivedAt: string | null;
    flags: string[];
    reason: string | null;
}

export interface HistoryEntry {
    signalDate: string;
    mark: number;
    delta: number | null;
    capturedAt: string | null;
}

export interface HistoryResponse {
    contract: HistoryContract;
    from: string;
    to: string;
    signalDate: string | null;
    /** Captured market entry for this signal, never an advertised premium fallback. */
    entry: HistoryEntry | null;
    points: HistoryPoint[];
    coverage: {
        observations: number;
        validPrices: number;
        validDeltas: number;
        knownExpected: number;
        knownPriceGaps: number;
        knownDeltaGaps: number;
        unknownSlots: number;
    };
    warnings: string[];
}
