import { describe, expect, it } from 'vitest';
import {
    formatDayLabel,
    formatDelta,
    formatDte,
    formatMDY,
    formatMoney,
    formatPercent,
    formatStrike,
    formatWeekTitle,
} from '../src/signals/format';

describe('signal formatters', () => {
    it('reads dates as local calendar days, never as UTC instants', () => {
        // `new Date('2025-08-11')` is midnight UTC, which is the 10th in every
        // negative offset. Parsing the parts by hand is the whole point.
        expect(formatDayLabel('2025-08-11')).toBe('Aug 11');
        expect(formatDayLabel('2025-01-01')).toBe('Jan 1');
    });

    it('writes the week title the way the Flask page did', () => {
        expect(formatWeekTitle('2025-08-11', '2025-08-15')).toBe('Week of Aug 11 to Aug 15');
    });

    it('writes expiries month first', () => {
        expect(formatMDY('2025-08-15')).toBe('08/15/2025');
    });

    it('says n/a rather than printing a null', () => {
        expect(formatMDY(null)).toBe('n/a');
        expect(formatPercent(null)).toBe('n/a');
        expect(formatMoney(null)).toBe('n/a');
        expect(formatDelta(null)).toBe('n/a');
        expect(formatDte(null)).toBe('n/a');
    });

    it('gives yields one decimal and a percent sign', () => {
        expect(formatPercent(12.345)).toBe('12.3%');
        expect(formatPercent(0)).toBe('0.0%');
    });

    it('rounds money to whole dollars and groups the thousands', () => {
        expect(formatMoney(1234.56)).toBe('$1,235');
        expect(formatMoney(42)).toBe('$42');
        expect(formatMoney(0)).toBe('$0');
    });

    it('gives delta two decimals', () => {
        expect(formatDelta(-0.257)).toBe('-0.26');
        expect(formatDelta(0.2)).toBe('0.20');
    });

    it('builds the strike label from the strike and the right', () => {
        expect(formatStrike(123.5, 'P')).toBe('$123.5P');
        expect(formatStrike(50, 'C')).toBe('$50C');
        // A missing strike still needs the right, so the ticket is not silent.
        expect(formatStrike(null, 'P')).toBe('P');
    });
});
