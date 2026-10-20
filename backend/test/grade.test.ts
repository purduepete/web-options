import { describe, expect, it } from 'vitest';
import {
    GRADE_DEFAULTS,
    type GradeInput,
    type GradeSettings,
    gradeSettingsError,
    gradeTrade,
    parseGradeSettings,
} from '@weboptions/shared';

/*
 * The grade lives in shared/, and shared/ has no vitest project of its own, so its
 * tests run here under the node environment. Every comparison in gradeTrade is one
 * an inverted sign would silently reverse, which is the whole reason for this file.
 */

/** A trade that breaches nothing and yields well: green, with no reasons. */
function clean(overrides: Partial<GradeInput> = {}): GradeInput {
    return {
        symbol: 'VST',
        annualizedYield: 60,
        delta: -0.18,
        strike: 80,
        price: 100,
        cautionSymbols: [],
        ...overrides,
    };
}

describe('gradeTrade', () => {
    it('grades an untroubled, well-paying trade green', () => {
        expect(gradeTrade(clean())).toEqual({ band: 'green', reasons: [] });
    });

    describe('the delta flag', () => {
        it('fires on a delta MORE negative than the threshold', () => {
            const result = gradeTrade(clean({ delta: -0.31 }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['delta']);
            expect(result.band).toBe('yellow');
        });

        it('does not fire on a delta closer to zero, however large its magnitude looks', () => {
            // The trap: |-0.19| < |-0.25| is true, but -0.19 > -0.25, so this is the
            // SAFER trade. A magnitude comparison here would flag it.
            expect(gradeTrade(clean({ delta: -0.19 })).reasons).toEqual([]);
        });

        it('does not fire exactly on the threshold', () => {
            expect(gradeTrade(clean({ delta: -0.25 })).reasons).toEqual([]);
        });

        it('grades red once the delta passes the red threshold', () => {
            const result = gradeTrade(clean({ delta: -0.41 }));

            expect(result.reasons.map((reason) => reason.band)).toEqual(['red']);
            expect(result.reasons[0]?.detail).toContain('-0.40');
            expect(result.band).toBe('red');
        });

        it('is still only yellow sitting on the red threshold', () => {
            const result = gradeTrade(clean({ delta: -0.4 }));

            expect(result.reasons.map((reason) => reason.band)).toEqual(['yellow']);
            expect(result.reasons[0]?.detail).toContain('-0.25');
        });

        it('cannot fire without a delta', () => {
            expect(gradeTrade(clean({ delta: null })).reasons).toEqual([]);
        });
    });

    describe('the cushion flag', () => {
        it('measures the gap against the PRICE, not the strike', () => {
            // 92 under 100 is an 8% cushion by price and 8.7% by strike. Only the
            // first is under the 10% default, so dividing by strike would pass it.
            const result = gradeTrade(clean({ strike: 92, price: 100 }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['otm']);
            expect(result.reasons[0]?.detail).toContain('8.0%');
            expect(result.band).toBe('yellow');
        });

        it('leaves a comfortable cushion alone', () => {
            expect(gradeTrade(clean({ strike: 85, price: 100 })).reasons).toEqual([]);
        });

        it('says so plainly when the strike is already in the money', () => {
            const result = gradeTrade(clean({ strike: 110, price: 100 }));

            expect(result.reasons[0]?.detail).toContain('in the money');
        });

        it('cannot fire without a price', () => {
            expect(gradeTrade(clean({ price: null })).reasons).toEqual([]);
        });
    });

    describe('the caution flag', () => {
        it('fires on a listed symbol whatever case or spacing it arrives in', () => {
            const result = gradeTrade(clean({ symbol: ' vst ', cautionSymbols: ['vst'] }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['caution']);
            expect(result.reasons[0]?.detail).toBe('VST is on the caution list.');
        });

        it('reds the trade on its own, whatever the numbers say', () => {
            expect(gradeTrade(clean({ cautionSymbols: ['VST'] })).band).toBe('red');
        });

        it('leaves an unlisted symbol alone', () => {
            expect(gradeTrade(clean({ cautionSymbols: ['NVDA'] })).reasons).toEqual([]);
        });
    });

    describe('the VIX', () => {
        it('yellows an otherwise clean trade when the market is calm', () => {
            const result = gradeTrade(clean({ vix: 14.89 }));

            expect(result.band).toBe('yellow');
            expect(result.reasons.map((reason) => reason.breach)).toEqual(['vix']);
            expect(result.reasons[0]?.detail).toBe('VIX closed at 14.89, below 15; premium is thin across the market.');
        });

        it('reds it once the premium has gone altogether', () => {
            const result = gradeTrade(clean({ vix: 11.2 }));

            expect(result.band).toBe('red');
            expect(result.reasons[0]?.detail).toBe(
                'VIX closed at 11.20, below 12.5; premium is thin across the market.'
            );
        });

        it('leaves each floor itself alone', () => {
            expect(gradeTrade(clean({ vix: 15 })).reasons).toEqual([]);
            expect(gradeTrade(clean({ vix: 12.5 })).band).toBe('yellow');
        });

        it('cannot cost a trade a band a worse flag already took', () => {
            expect(gradeTrade(clean({ vix: 14, cautionSymbols: ['VST'] })).band).toBe('red');
        });

        it('drops the criterion when there is no VIX to read', () => {
            expect(gradeTrade(clean({ vix: null })).reasons).toEqual([]);
            expect(gradeTrade(clean()).reasons).toEqual([]);
        });
    });

    describe('the band', () => {
        it.each([
            [10, 'red'],
            [24.9, 'red'],
            [25, 'yellow'],
            [34.9, 'yellow'],
            [35, 'green'],
            [200, 'green'],
        ])('reads %s%% as %s', (annualizedYield, band) => {
            expect(gradeTrade(clean({ annualizedYield })).band).toBe(band);
        });

        it('says so when the yield is what cost the trade its band', () => {
            const result = gradeTrade(clean({ annualizedYield: 30 }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['yield']);
            expect(result.reasons[0]?.detail).toContain('30.0%');
        });

        it('is ungraded without a yield, but still lists what it found', () => {
            const result = gradeTrade(clean({ annualizedYield: null, delta: -0.4 }));

            expect(result.band).toBe('ungraded');
            expect(result.reasons.map((reason) => reason.breach)).toEqual(['delta']);
        });
    });

    describe('taking the worst criterion', () => {
        it('stays yellow however many yellows fired', () => {
            const result = gradeTrade(clean({ delta: -0.31, strike: 99 }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['delta', 'otm']);
            expect(result.reasons.every((reason) => reason.band === 'yellow')).toBe(true);
            expect(result.band).toBe('yellow');
        });

        it('stays yellow when a yellow yield meets a yellow flag', () => {
            const result = gradeTrade(clean({ annualizedYield: 30, strike: 99 }));

            expect(result.reasons.map((reason) => reason.breach)).toEqual(['yield', 'otm']);
            expect(result.band).toBe('yellow');
        });

        it('takes the red when a red meets a yellow', () => {
            const result = gradeTrade(clean({ annualizedYield: 5, strike: 99 }));

            expect(result.reasons.map((reason) => reason.band)).toEqual(['red', 'yellow']);
            expect(result.band).toBe('red');
        });
    });

    it('takes the thresholds it is given', () => {
        const strict: GradeSettings = {
            deltaThreshold: -0.1,
            deltaRedThreshold: -0.4,
            otmPercentThreshold: 25,
            annualizedRedBelow: 80,
            annualizedYellowBelow: 90,
        };

        expect(gradeTrade(clean(), strict).band).toBe('red');
    });
});

describe('gradeSettingsError', () => {
    it('passes the defaults', () => {
        expect(gradeSettingsError(GRADE_DEFAULTS)).toBeNull();
    });

    it.each([
        ['deltaThreshold', 0.25],
        ['deltaThreshold', -2],
        ['otmPercentThreshold', -1],
        ['annualizedRedBelow', Number.NaN],
        ['annualizedYellowBelow', 5000],
    ])('rejects %s = %s', (key, value) => {
        expect(gradeSettingsError({ ...GRADE_DEFAULTS, [key]: value })).toContain(key);
    });

    it('rejects a red threshold above the yellow one, which nothing could grade yellow', () => {
        expect(gradeSettingsError({ ...GRADE_DEFAULTS, annualizedRedBelow: 40 })).toContain('yellow');
    });

    it('allows the two yield thresholds to meet', () => {
        expect(gradeSettingsError({ ...GRADE_DEFAULTS, annualizedRedBelow: 35 })).toBeNull();
    });

    it('rejects a red delta closer to zero than the yellow one, which no delta could grade yellow', () => {
        expect(gradeSettingsError({ ...GRADE_DEFAULTS, deltaRedThreshold: -0.2 })).toContain('yellow');
    });
});

describe('parseGradeSettings', () => {
    it('reads stored text', () => {
        expect(parseGradeSettings({ deltaThreshold: '-0.4', annualizedRedBelow: '30' })).toEqual({
            ...GRADE_DEFAULTS,
            deltaThreshold: -0.4,
            annualizedRedBelow: 30,
        });
    });

    it('falls back to the default for anything missing or unusable', () => {
        expect(parseGradeSettings({ deltaThreshold: 'nonsense', otmPercentThreshold: '-3' })).toEqual(GRADE_DEFAULTS);
    });
});
