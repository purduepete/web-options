import { describe, expect, it } from 'vitest';
import type { OwnedOptionPosition } from '@weboptions/shared';
import { groupOwnedPositions, readOwnedGroupMode } from '../src/owned/group';

function position(overrides: Partial<OwnedOptionPosition> = {}): OwnedOptionPosition {
    return {
        id: 1,
        authenticatedUserId: 1,
        accountId: 1,
        accountName: 'Main',
        strategyId: null,
        strategyName: null,
        symbol: 'PLTR',
        action: 'SELL_TO_OPEN',
        putCall: 'P',
        expirationDate: '2026-09-18',
        strikePrice: 150,
        delta: null,
        contracts: 1,
        optionPrice: 2.5,
        commission: 0,
        transactionDate: '2026-08-11',
        status: 'open',
        isPaper: false,
        collateralAtStrike: 15_000,
        entryCredit: 250,
        estimatedBuybackCost: null,
        unrealizedCreditCaptured: null,
        unrealizedCreditCapturedPct: null,
        dte: 28,
        expirationBucket: 'later',
        underlyingPrice: 170,
        underlyingChange: null,
        percentFromStrike: 13.3,
        moneyness: null,
        cachedPrice: { mark: null, mid: null, bid: null, ask: null, prevClose: null, delta: null, priceDate: null },
        quote: {
            bid: null,
            ask: null,
            midPrice: null,
            markPrice: null,
            delta: null,
            impliedVolatility: null,
            quoteStatus: 'ok',
            quotedAt: null,
        },
        ...overrides,
    } as OwnedOptionPosition;
}

describe('groupOwnedPositions', () => {
    it('leaves the rows as one unlabeled bucket when grouping is off', () => {
        const rows = [position({ id: 1 }), position({ id: 2 })];
        expect(groupOwnedPositions(rows, 'none')).toEqual([{ label: '', positions: rows }]);
    });

    it('drops the bucket entirely rather than rendering an empty heading', () => {
        expect(groupOwnedPositions([], 'none')).toEqual([]);
        expect(groupOwnedPositions([], 'delta')).toEqual([]);
    });

    it('bands delta on magnitude, reading only the quoted delta a row actually shows', () => {
        const high = position({ id: 1, quote: { ...position().quote, delta: -0.55 } });
        const mid = position({ id: 2, quote: { ...position().quote, delta: 0.35 } });
        const low = position({ id: 3, quote: { ...position().quote, delta: -0.1 } });
        // The entry-time delta is ignored: the row itself only shows the quote.
        const unquoted = position({ id: 4, delta: 0.9, quote: { ...position().quote, delta: null } });

        const groups = groupOwnedPositions([high, mid, low, unquoted], 'delta');
        expect(groups.map((g) => g.label)).toEqual([
            '|\u0394| > 0.40',
            '0.25 \u2013 0.40',
            '|\u0394| < 0.25',
            'No delta',
        ]);
        expect(groups[0]?.positions).toEqual([high]);
        expect(groups[1]?.positions).toEqual([mid]);
        expect(groups[2]?.positions).toEqual([low]);
        expect(groups[3]?.positions).toEqual([unquoted]);
    });

    it('keeps the delta boundaries themselves inside the middle band', () => {
        const atLow = position({ id: 1, quote: { ...position().quote, delta: 0.25 } });
        const atHigh = position({ id: 2, quote: { ...position().quote, delta: -0.4 } });
        const justOver = position({ id: 3, quote: { ...position().quote, delta: 0.401 } });

        const groups = groupOwnedPositions([atLow, atHigh, justOver], 'delta');
        expect(groups.map((g) => g.label)).toEqual(['|\u0394| > 0.40', '0.25 \u2013 0.40']);
        expect(groups[0]?.positions).toEqual([justOver]);
        expect(groups[1]?.positions).toEqual([atLow, atHigh]);
    });

    it('bands captured percent into loss, 0-50%, and above 50%', () => {
        const most = position({ id: 1, unrealizedCreditCapturedPct: 62 });
        const some = position({ id: 2, unrealizedCreditCapturedPct: 25 });
        const zero = position({ id: 3, unrealizedCreditCapturedPct: 0 });
        const loss = position({ id: 4, unrealizedCreditCapturedPct: -15 });
        const unknown = position({ id: 5, unrealizedCreditCapturedPct: null, estimatedBuybackCost: null });

        const groups = groupOwnedPositions([most, some, zero, loss, unknown], 'captured');
        expect(groups.map((g) => g.label)).toEqual([
            '> 50% captured',
            '0 \u2013 50% captured',
            'Loss (< 0%)',
            'No captured figure',
        ]);
        expect(groups[0]?.positions).toEqual([most]);
        expect(groups[1]?.positions).toEqual([some, zero]);
        expect(groups[2]?.positions).toEqual([loss]);
        expect(groups[3]?.positions).toEqual([unknown]);
    });
});

describe('readOwnedGroupMode', () => {
    it('falls back to none for anything unrecognized', () => {
        expect(readOwnedGroupMode('delta')).toBe('delta');
        expect(readOwnedGroupMode('captured')).toBe('captured');
        expect(readOwnedGroupMode('bogus')).toBe('none');
        expect(readOwnedGroupMode(null)).toBe('none');
    });
});
