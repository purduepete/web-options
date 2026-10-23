export interface HistoryContract {
    key: string;
    symbol: string;
    expiration: string;
    strike: number;
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
