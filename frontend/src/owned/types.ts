import type { OwnedOptionPosition, Trade } from '@weboptions/shared';

/** A signal the owned position was opened from, matched on report date + contract. */
export interface SignalMatch {
    trade: Trade;
    reportDate: string;
}

export type SignalMap = ReadonlyMap<string, SignalMatch>;

export function signalKey(reportDate: string, symbol: string, strike: number, expiration: string): string {
    return `${reportDate}|${symbol}|${strike}|${expiration}`;
}

export function signalFor(signals: SignalMap, position: OwnedOptionPosition): SignalMatch | undefined {
    return signals.get(
        signalKey(position.transactionDate, position.symbol, position.strikePrice, position.expirationDate),
    );
}
