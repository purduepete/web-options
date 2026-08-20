import { useEffect, useState } from 'react';
import type { IsoDate, SymbolDetail, Trade } from '@weboptions/shared';
import { UnauthorizedError, describeFailure, fetchSymbolDetail } from '../api';

/**
 * The market data behind one open modal.
 *
 * No client cache on purpose. The price is the reason this call exists, and a
 * cached price answers a question the reader did not ask. The server collapses
 * concurrent calls for the same symbol, which is the only sharing that helps here.
 */

export interface SymbolDetailState {
    detail: SymbolDetail | null;
    loading: boolean;
    error: string | null;
}

export function useSymbolDetail(trade: Trade | null, reportDate: IsoDate | null = null): SymbolDetailState {
    const [state, setState] = useState<SymbolDetailState>({ detail: null, loading: false, error: null });

    const symbol = trade?.symbol ?? null;
    const strike = trade?.strike ?? null;
    const expiration = trade?.expiration ?? null;

    useEffect(() => {
        if (!symbol) {
            setState({ detail: null, loading: false, error: null });
            return;
        }

        let cancelled = false;
        setState({ detail: null, loading: true, error: null });

        fetchSymbolDetail(symbol, { strike, expiration, reportDate })
            .then((detail) => {
                if (!cancelled) setState({ detail, loading: false, error: null });
            })
            .catch((cause: Error) => {
                if (cancelled) return;
                // A revoked key is the app's problem; ApiKeyProvider handles it.
                const error = cause instanceof UnauthorizedError ? null : describeFailure(cause);
                setState({ detail: null, loading: false, error });
            });

        return () => {
            cancelled = true;
        };
    }, [symbol, strike, expiration, reportDate]);

    return state;
}
