import { describe, expect, it } from 'vitest';
import { isCautionSymbol, normalizeCautionSymbols, parseCautionSymbols } from '@weboptions/shared';

describe('parseCautionSymbols', () => {
    it('accepts whatever separator was typed', () => {
        expect(parseCautionSymbols('KTOS\nSMCI, PM\n\n  TSLA ')).toEqual(['KTOS', 'SMCI', 'PM', 'TSLA']);
    });

    it('upper-cases and de-duplicates, keeping the order first seen', () => {
        expect(parseCautionSymbols('smci ktos SMCI')).toEqual(['SMCI', 'KTOS']);
    });

    it('reads an empty box as an empty list', () => {
        expect(parseCautionSymbols('   \n\n  ')).toEqual([]);
    });
});

describe('normalizeCautionSymbols', () => {
    it('leaves a symbol with internal punctuation intact', () => {
        expect(normalizeCautionSymbols([' brk.b ', 'bf-b'])).toEqual(['BRK.B', 'BF-B']);
    });
});

describe('isCautionSymbol', () => {
    it.each(['PM', 'BRK.B', 'BF-B', 'SPXW'])('accepts %s', (symbol) => {
        expect(isCautionSymbol(symbol)).toBe(true);
    });

    it.each(['', 'DROP TABLE', '.PM', '-PM', 'ktos', 'A'.repeat(21)])('rejects %s', (symbol) => {
        expect(isCautionSymbol(symbol)).toBe(false);
    });
});
