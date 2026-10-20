import { describe, expect, it } from 'vitest';
import type { SymbolBar } from '@weboptions/shared';
import {
    closeOnOrAfter,
    distancePercent,
    resolveOutcome,
    resolvePastSignals,
    sixMonthSlice,
    sma,
} from '../src/market/metrics';

/** A series of `count` bars, one per day from 2026-01-01, at the given closes. */
function series(closes: number[]): SymbolBar[] {
    const start = Date.UTC(2026, 0, 1);
    return closes.map((close, index) => ({
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        close,
    }));
}

function flat(count: number, close = 100): SymbolBar[] {
    return series(Array.from({ length: count }, () => close));
}

describe('sma', () => {
    it('averages the last n bars, not the whole series', () => {
        expect(sma(series([1, 1, 1, 10, 20, 30]), 3)).toBe(20);
    });

    it('refuses to answer with fewer bars than the window', () => {
        // A 60 bar "200 day average" would hug the price and make every trade look
        // safer than it is. Null is the honest answer.
        expect(sma(flat(199), 200)).toBeNull();
    });

    it('answers on the exact bar the window fills', () => {
        expect(sma(flat(200), 200)).toBe(100);
    });
});

describe('distancePercent', () => {
    it('is positive above the average and negative below it', () => {
        expect(distancePercent(110, 100)).toBeCloseTo(10);
        expect(distancePercent(90, 100)).toBeCloseTo(-10);
    });

    it.each([
        [null, 100],
        [110, null],
        [110, 0],
    ])('has nothing to say about %s against %s', (price, average) => {
        expect(distancePercent(price, average)).toBeNull();
    });
});

describe('sixMonthSlice', () => {
    it('keeps the most recent 126 trading days', () => {
        const bars = flat(400);
        const slice = sixMonthSlice(bars);

        expect(slice).toHaveLength(126);
        expect(slice.at(-1)).toEqual(bars.at(-1));
    });

    it('hands back a short series whole', () => {
        expect(sixMonthSlice(flat(40))).toHaveLength(40);
    });
});

describe('closeOnOrAfter', () => {
    const bars = series([10, 11, 12]);

    it('finds the exact day', () => {
        expect(closeOnOrAfter(bars, '2026-01-02')?.close).toBe(11);
    });

    it('takes the next day when the date was a holiday or a weekend', () => {
        expect(closeOnOrAfter(series([10, 12]).slice(1), '2026-01-01')?.close).toBe(12);
    });

    it('gives up rather than guessing past the end of the series', () => {
        expect(closeOnOrAfter(bars, '2026-06-01')).toBeNull();
    });
});

describe('resolveOutcome', () => {
    const bars = series([10, 11, 12]);

    it('calls a close at or above the strike a win', () => {
        expect(resolveOutcome(bars, 11, '2026-01-03', '2026-02-01')).toEqual({
            outcome: 'expired_otm',
            closeAtExpiration: 12,
        });
    });

    it('counts finishing exactly at the strike as expiring worthless', () => {
        expect(resolveOutcome(bars, 12, '2026-01-03', '2026-02-01').outcome).toBe('expired_otm');
    });

    it('calls a close below the strike an assignment', () => {
        expect(resolveOutcome(bars, 20, '2026-01-03', '2026-02-01')).toEqual({
            outcome: 'expired_itm',
            closeAtExpiration: 12,
        });
    });

    it('leaves a future expiration open, including today', () => {
        expect(resolveOutcome(bars, 11, '2026-03-01', '2026-02-01').outcome).toBe('open');
        expect(resolveOutcome(bars, 11, '2026-02-01', '2026-02-01').outcome).toBe('open');
    });

    it('says unknown, not open, when the series never reached a PAST expiration', () => {
        // The difference matters: this one fell off the back of the two year
        // window, and it has already resolved one way or the other.
        expect(resolveOutcome(series([10]).slice(1), 11, '2020-01-03', '2026-02-01').outcome).toBe('unknown');
    });

    it.each([
        [null, '2026-01-03'],
        [11, null],
    ])('cannot judge a signal missing its strike or expiration (%s, %s)', (strike, expiration) => {
        expect(resolveOutcome(bars, strike, expiration, '2026-02-01').outcome).toBe('unknown');
    });

    it('settles an expiration the cached bars stop short of, using the live close', () => {
        // Bars end 01-02, the put expired 01-03, and the refetched quote has that day.
        expect(
            resolveOutcome(series([10, 11]), 12, '2026-01-03', '2026-02-01', { date: '2026-01-03', close: 9 })
        ).toEqual({ outcome: 'expired_itm', closeAtExpiration: 9 });
    });

    it('will not settle an expiration with a close from a different day', () => {
        expect(
            resolveOutcome(series([10, 11]), 12, '2026-01-03', '2026-02-01', { date: '2026-01-09', close: 9 }).outcome
        ).toBe('unknown');
    });

    it('prefers a real bar over the live close', () => {
        expect(resolveOutcome(bars, 20, '2026-01-03', '2026-02-01', { date: '2026-01-03', close: 99 })).toEqual({
            outcome: 'expired_itm',
            closeAtExpiration: 12,
        });
    });
});

describe('resolvePastSignals', () => {
    it('fills in each signal without disturbing the rest of it', () => {
        const resolved = resolvePastSignals(
            [
                {
                    reportDate: '2026-01-01',
                    strike: 11,
                    expiration: '2026-01-03',
                    annualizedYield: 42,
                    tier: null,
                    isTopPick: false,
                },
            ],
            series([10, 11, 12]),
            '2026-02-01'
        );

        expect(resolved).toEqual([
            {
                reportDate: '2026-01-01',
                strike: 11,
                expiration: '2026-01-03',
                annualizedYield: 42,
                tier: null,
                isTopPick: false,
                outcome: 'expired_otm',
                closeAtExpiration: 12,
            },
        ]);
    });
});
