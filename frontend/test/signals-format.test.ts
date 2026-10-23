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
        expect(formatDayLabel('2025-08-11')).toBe('08/11');
        expect(formatDayLabel('2025-01-01')).toBe('01/01');
    });

    it('writes the week title the way the Flask page did', () => {
        expect(formatWeekTitle('2025-08-11', '2025-08-15')).toBe('Week of 08/11 – 08/15');
    });

    it('pads the days in the week title, so its width never changes', () => {
        expect(formatWeekTitle('2025-08-04', '2025-08-08')).toBe('Week of 08/04 – 08/08');
    });

    it('writes expiries month first', () => {
        expect(formatMDY('2025-08-15')).toBe('08/15/2025');
    });

    it('prints a dash rather than a null', () => {
        expect(formatMDY(null)).toBe('–');
        expect(formatPercent(null)).toBe('–');
        expect(formatMoney(null)).toBe('–');
        expect(formatDelta(null)).toBe('–');
        expect(formatDte(null)).toBe('–');
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

    it('gives delta three decimals', () => {
        expect(formatDelta(-0.257)).toBe('-0.257');
        expect(formatDelta(0.2)).toBe('0.200');
    });

    it('builds the strike label from the strike and the right', () => {
        expect(formatStrike(123.5, 'P')).toBe('$123.5P');
        expect(formatStrike(50, 'C')).toBe('$50C');
        // A missing strike still needs the right, so the ticket is not silent.
        expect(formatStrike(null, 'P')).toBe('P');
    });
});
