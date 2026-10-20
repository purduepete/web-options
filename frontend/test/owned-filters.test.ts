import { describe, expect, it } from 'vitest';
import type { Moneyness, OwnedOptionPosition, Trade } from '@weboptions/shared';
import { deltaBand, filterOwnedPositions, ownedMoneyness, readCapturedFilter } from '../src/owned/filters';
import { signalKey, type SignalMatch } from '../src/owned/types';

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

function signalsFor(target: OwnedOptionPosition, moneyness: Moneyness): Map<string, SignalMatch> {
    const key = signalKey(target.transactionDate, target.symbol, target.strikePrice, target.expirationDate);
    return new Map([[key, { trade: { moneyness } as Trade, reportDate: target.transactionDate }]]);
}

describe('deltaBand', () => {
    it('keeps 0.40 and 0.60 themselves inside the warning band', () => {
        expect(deltaBand(-0.39)).toBe('good');
        expect(deltaBand(-0.4)).toBe('warn');
        expect(deltaBand(-0.5)).toBe('warn');
        expect(deltaBand(-0.6)).toBe('warn');
        expect(deltaBand(-0.61)).toBe('bad');
    });

    it('reads a call the same as a put, because it bands the magnitude', () => {
        expect(deltaBand(0.3)).toBe('good');
        expect(deltaBand(0.5)).toBe('warn');
        expect(deltaBand(0.8)).toBe('bad');
    });

    it('gives an unquoted delta no tone rather than a flattering one', () => {
        expect(deltaBand(null)).toBeNull();
        expect(deltaBand(Number.NaN)).toBeNull();
    });
});

describe('ownedMoneyness', () => {
    it('prefers the position and falls back to the signal it was opened from', () => {
        const own = position({ moneyness: 'otm' });
        expect(ownedMoneyness(own, { trade: { moneyness: 'itm' } as Trade, reportDate: '2026-08-11' })).toBe('otm');
        expect(ownedMoneyness(position(), { trade: { moneyness: 'itm' } as Trade, reportDate: '2026-08-11' })).toBe(
            'itm'
        );
        expect(ownedMoneyness(position(), undefined)).toBeNull();
    });
});

describe('filterOwnedPositions', () => {
    const empty = new Map<string, SignalMatch>();
    const rows = [
        position({ id: 1, symbol: 'PLTR', moneyness: 'otm' }),
        position({ id: 2, symbol: 'UAL', moneyness: 'itm' }),
        position({ id: 3, symbol: 'CNC', moneyness: 'atm' }),
        position({ id: 4, symbol: 'PLUG', moneyness: null }),
    ];

    it('keeps everything when nothing is asked for', () => {
        expect(filterOwnedPositions(rows, empty, { symbol: '', moneyness: 'all' })).toHaveLength(4);
    });

    it('matches symbols on a substring, so PL finds both PLTR and PLUG', () => {
        const found = filterOwnedPositions(rows, empty, { symbol: 'PL', moneyness: 'all' });
        expect(found.map((row) => row.symbol)).toEqual(['PLTR', 'PLUG']);
    });

    it('takes comma-separated terms and a bang to exclude', () => {
        expect(
            filterOwnedPositions(rows, empty, { symbol: 'PLTR, UAL', moneyness: 'all' }).map((row) => row.symbol)
        ).toEqual(['PLTR', 'UAL']);
        expect(filterOwnedPositions(rows, empty, { symbol: '!PL', moneyness: 'all' }).map((row) => row.symbol)).toEqual(
            ['UAL', 'CNC']
        );
    });

    it('drops atm and unknown moneyness once a moneyness is asked for', () => {
        expect(filterOwnedPositions(rows, empty, { symbol: '', moneyness: 'otm' }).map((row) => row.symbol)).toEqual([
            'PLTR',
        ]);
        expect(filterOwnedPositions(rows, empty, { symbol: '', moneyness: 'itm' }).map((row) => row.symbol)).toEqual([
            'UAL',
        ]);
    });

    it('reads moneyness off the signal when the position has none', () => {
        const bare = position({ id: 5, symbol: 'SOFI', moneyness: null });
        expect(filterOwnedPositions([bare], signalsFor(bare, 'itm'), { symbol: '', moneyness: 'itm' })).toHaveLength(1);
        expect(filterOwnedPositions([bare], signalsFor(bare, 'otm'), { symbol: '', moneyness: 'itm' })).toHaveLength(0);
    });

    it('applies the symbol and the moneyness together', () => {
        expect(filterOwnedPositions(rows, empty, { symbol: 'PL', moneyness: 'otm' }).map((row) => row.symbol)).toEqual([
            'PLTR',
        ]);
    });
});

describe('captured filter', () => {
    const empty = new Map<string, SignalMatch>();
    const rows = [
        position({ id: 1, symbol: 'DOWN', unrealizedCreditCapturedPct: -12 }),
        position({ id: 2, symbol: 'FLAT', unrealizedCreditCapturedPct: 0 }),
        position({ id: 3, symbol: 'QTR', unrealizedCreditCapturedPct: 25 }),
        position({ id: 4, symbol: 'HALF', unrealizedCreditCapturedPct: 50 }),
        position({ id: 5, symbol: 'MOST', unrealizedCreditCapturedPct: 80 }),
        position({ id: 6, symbol: 'NONE', unrealizedCreditCapturedPct: null }),
    ];

    function kept(captured: Parameters<typeof readCapturedFilter>[0]) {
        return filterOwnedPositions(rows, empty, {
            symbol: '',
            moneyness: 'all',
            captured: readCapturedFilter(captured),
        }).map((row) => row.symbol);
    }

    it('falls back to all for anything it does not recognise', () => {
        expect(readCapturedFilter(null)).toBe('all');
        expect(readCapturedFilter('threequarters')).toBe('all');
        expect(readCapturedFilter('quarter')).toBe('quarter');
    });

    it('keeps each floor and the rows above it', () => {
        expect(kept('all')).toEqual(['DOWN', 'FLAT', 'QTR', 'HALF', 'MOST', 'NONE']);
        expect(kept('positive')).toEqual(['FLAT', 'QTR', 'HALF', 'MOST']);
        expect(kept('quarter')).toEqual(['QTR', 'HALF', 'MOST']);
        expect(kept('half')).toEqual(['HALF', 'MOST']);
        expect(kept('most')).toEqual(['MOST']);
    });
});
