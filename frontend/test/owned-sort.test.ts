import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedOptionPosition, Trade } from '@weboptions/shared';
import {
    DEFAULT_OWNED_SORT,
    OWNED_SORTS,
    OWNED_SORT_DESCRIPTIONS,
    OWNED_SORT_LABELS,
    readOwnedSort,
    readOwnedSortKey,
    readSortDirection,
    sortOwnedPositions,
    writeOwnedSort,
} from '../src/owned/sort';
import { signalKey, type SignalMap, type SignalMatch } from '../src/owned/types';

const KEY = 'weboptions.owned-sort.v1';

function position(overrides: Partial<OwnedOptionPosition> = {}): OwnedOptionPosition {
    return {
        symbol: 'PLTR',
        expirationDate: '2026-09-18',
        transactionDate: '2026-08-11',
        strikePrice: 150,
        delta: null,
        collateralAtStrike: 15_000,
        entryCredit: 250,
        unrealizedCreditCaptured: null,
        unrealizedCreditCapturedPct: null,
        percentFromStrike: null,
        quote: { delta: null },
        ...overrides,
    } as OwnedOptionPosition;
}

const NO_SIGNALS: SignalMap = new Map();

function symbols(rows: readonly OwnedOptionPosition[]): string[] {
    return rows.map((row) => row.symbol);
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('sort catalogue', () => {
    it('gives every choice a label and a description', () => {
        OWNED_SORTS.forEach((key) => {
            expect(OWNED_SORT_LABELS[key]).toBeTruthy();
            expect(OWNED_SORT_DESCRIPTIONS[key]).toBeTruthy();
        });
    });
});

describe('sortOwnedPositions', () => {
    it('leaves the input alone', () => {
        const rows = [position({ symbol: 'B' }), position({ symbol: 'A' })];
        sortOwnedPositions(rows, NO_SIGNALS, { key: 'symbol', direction: 'asc' });
        expect(symbols(rows)).toEqual(['B', 'A']);
    });

    it('orders symbols both ways', () => {
        const rows = [position({ symbol: 'PLTR' }), position({ symbol: 'AMD' }), position({ symbol: 'NVDA' })];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'symbol', direction: 'asc' }))).toEqual([
            'AMD',
            'NVDA',
            'PLTR',
        ]);
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'symbol', direction: 'desc' }))).toEqual([
            'PLTR',
            'NVDA',
            'AMD',
        ]);
    });

    it('orders expirations by date rather than by the day of the month', () => {
        const rows = [
            position({ symbol: 'LATE', expirationDate: '2026-10-02' }),
            position({ symbol: 'SOON', expirationDate: '2026-09-30' }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'expiration', direction: 'asc' }))).toEqual([
            'SOON',
            'LATE',
        ]);
    });

    it('orders the money columns numerically', () => {
        const rows = [
            position({ symbol: 'SMALL', unrealizedCreditCaptured: 12 }),
            position({ symbol: 'BIG', unrealizedCreditCaptured: 900 }),
            position({ symbol: 'LOSS', unrealizedCreditCaptured: -40 }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'pl', direction: 'desc' }))).toEqual([
            'BIG',
            'SMALL',
            'LOSS',
        ]);
    });

    it('reads the delta on magnitude, so a call ranks with the put beside it', () => {
        const rows = [
            position({ symbol: 'CALM', quote: { delta: 0.12 } as OwnedOptionPosition['quote'] }),
            position({ symbol: 'RISKY', quote: { delta: -0.71 } as OwnedOptionPosition['quote'] }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'delta', direction: 'desc' }))).toEqual([
            'RISKY',
            'CALM',
        ]);
    });

    it('falls back to the position delta when the quote carries none', () => {
        const rows = [
            position({ symbol: 'QUOTED', quote: { delta: -0.2 } as OwnedOptionPosition['quote'] }),
            position({ symbol: 'ENTRY', delta: -0.55 }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'delta', direction: 'desc' }))).toEqual([
            'ENTRY',
            'QUOTED',
        ]);
    });

    it('rates the annualized return over the whole holding period, not the credit alone', () => {
        const rows = [
            position({ symbol: 'SLOW', entryCredit: 300, collateralAtStrike: 15_000, expirationDate: '2026-11-20' }),
            position({ symbol: 'QUICK', entryCredit: 200, collateralAtStrike: 15_000, expirationDate: '2026-08-21' }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'annualized', direction: 'desc' }))).toEqual([
            'QUICK',
            'SLOW',
        ]);
    });

    it('has no annualized return to rank when nothing is tied up', () => {
        const rows = [
            position({ symbol: 'NOCOLLATERAL', collateralAtStrike: 0 }),
            position({ symbol: 'REAL', entryCredit: 100 }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'annualized', direction: 'desc' }))).toEqual([
            'REAL',
            'NOCOLLATERAL',
        ]);
    });

    it('takes the cushion from the signal when the position has none', () => {
        const withSignal = position({ symbol: 'FROMSIGNAL', percentFromStrike: null });
        const signals: SignalMap = new Map<string, SignalMatch>([
            [
                signalKey(
                    withSignal.transactionDate,
                    withSignal.symbol,
                    withSignal.strikePrice,
                    withSignal.expirationDate
                ),
                { trade: { percentFromStrike: 30 } as Trade, reportDate: withSignal.transactionDate },
            ],
        ]);
        const rows = [position({ symbol: 'THIN', percentFromStrike: 4 }), withSignal];
        expect(symbols(sortOwnedPositions(rows, signals, { key: 'cushion', direction: 'asc' }))).toEqual([
            'THIN',
            'FROMSIGNAL',
        ]);
    });

    it('sinks a row with no figure to the bottom whichever way round it is', () => {
        const rows = [
            position({ symbol: 'NONE', unrealizedCreditCapturedPct: null }),
            position({ symbol: 'LOW', unrealizedCreditCapturedPct: 10 }),
            position({ symbol: 'HIGH', unrealizedCreditCapturedPct: 80 }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'captured', direction: 'asc' }))).toEqual([
            'LOW',
            'HIGH',
            'NONE',
        ]);
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'captured', direction: 'desc' }))).toEqual([
            'HIGH',
            'LOW',
            'NONE',
        ]);
    });

    it('keeps ties in the order they arrived', () => {
        const rows = [
            position({ symbol: 'FIRST', entryCredit: 100 }),
            position({ symbol: 'SECOND', entryCredit: 100 }),
            position({ symbol: 'THIRD', entryCredit: 100 }),
        ];
        expect(symbols(sortOwnedPositions(rows, NO_SIGNALS, { key: 'credit', direction: 'desc' }))).toEqual([
            'FIRST',
            'SECOND',
            'THIRD',
        ]);
    });
});

describe('sort choice parsing', () => {
    it('falls back on anything it does not recognise', () => {
        expect(readOwnedSortKey('cushion')).toBe('cushion');
        expect(readOwnedSortKey('sideways')).toBe(DEFAULT_OWNED_SORT.key);
        expect(readOwnedSortKey(undefined)).toBe(DEFAULT_OWNED_SORT.key);
        expect(readSortDirection('desc')).toBe('desc');
        expect(readSortDirection('downwards')).toBe(DEFAULT_OWNED_SORT.direction);
    });
});

describe('stored sort', () => {
    it('opens on the default when nothing has been chosen', () => {
        expect(readOwnedSort()).toEqual(DEFAULT_OWNED_SORT);
    });

    it('round-trips a choice', () => {
        writeOwnedSort({ key: 'delta', direction: 'desc' });
        expect(readOwnedSort()).toEqual({ key: 'delta', direction: 'desc' });
    });

    it('ignores a malformed entry rather than throwing', () => {
        localStorage.setItem(KEY, 'not json');
        expect(readOwnedSort()).toEqual(DEFAULT_OWNED_SORT);
        localStorage.setItem(KEY, '"expiration"');
        expect(readOwnedSort()).toEqual(DEFAULT_OWNED_SORT);
    });

    it('repairs half an entry', () => {
        localStorage.setItem(KEY, JSON.stringify({ key: 'symbol', direction: 'nowhere' }));
        expect(readOwnedSort()).toEqual({ key: 'symbol', direction: DEFAULT_OWNED_SORT.direction });
    });

    it('survives a store that refuses to answer', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readOwnedSort()).toEqual(DEFAULT_OWNED_SORT);
        expect(() => writeOwnedSort({ key: 'symbol', direction: 'desc' })).not.toThrow();
    });
});
