import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRecentSignalDay } from '@weboptions/shared';

/** Midday local, so the clock cannot land on the wrong calendar day. */
function today(iso: string): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${iso}T12:00:00`));
}

afterEach(() => {
    vi.useRealTimers();
});

describe('isRecentSignalDay', () => {
    it('takes today', () => {
        today('2026-08-19');
        expect(isRecentSignalDay('2026-08-19')).toBe(true);
    });

    it('takes the day before', () => {
        today('2026-08-19');
        expect(isRecentSignalDay('2026-08-18')).toBe(true);
    });

    it('reaches back over the weekend on a Monday', () => {
        today('2026-08-17');
        expect(isRecentSignalDay('2026-08-14')).toBe(true);
        expect(isRecentSignalDay('2026-08-16')).toBe(false);
    });

    it('refuses anything older', () => {
        today('2026-08-19');
        expect(isRecentSignalDay('2026-08-17')).toBe(false);
    });

    it('refuses a day still to come', () => {
        today('2026-08-19');
        expect(isRecentSignalDay('2026-08-20')).toBe(false);
    });

    it('refuses a missing date', () => {
        today('2026-08-19');
        expect(isRecentSignalDay(null)).toBe(false);
    });
});
