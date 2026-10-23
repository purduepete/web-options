export interface HistoryContract {
    key: string;
    symbol: string;
    expiration: string;
    strike: number;
    /** First VADER signal date (`yyyy-mm-dd`), or when the contract was first seen. */
    added: string | null;
    /** Lower-case VADER tier on the contract's first signal; its group in the picker. */
    tier: string | null;
    /** Distinct lower-case VADER tiers across this contract's signals. */
    tiers: string[];
    /** VADER named it a top pick on its first signal date. */
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
    priceTime: string | null;
    deltaTime: string | null;
    priceReceivedAt: string | null;
    deltaReceivedAt: string | null;
    flags: string[];
    reason: string | null;
}

export interface HistoryResponse {
    contract: HistoryContract;
    from: string;
    to: string;
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
