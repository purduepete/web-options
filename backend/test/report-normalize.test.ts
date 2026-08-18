import { describe, expect, it, vi } from 'vitest';
import { checkInvariants, normalizePayload, type ReportPayload } from '../src/reports/payload';

const basePayload: ReportPayload = {
    publishDate: '2026-08-17',
    sourceUrl: 'https://themultiplier.substack.com/p/6853-in-weekly-options-income-from',
    macro: [{ label: 'VIX', text: 'Opened 15.46 Monday, closed 14.25 Friday, the week\u2019s low.' }],
    metrics: {
        netPnl: 6853,
        closedLegs: 38,
        winningLegs: 35,
        rollLegs: 3,
        hitRate: '92.1%',
        winnersAmount: '$6,911',
        rollCost: '$58',
        collateral: '$455,150',
        returnPct: '1.51%',
        newPositions: 38,
        newPremium: '$12,853',
        netCash: '$8,748',
        medianDaysHeld: 10,
        openPositionsTotal: 87,
        openCalls: 55,
        openPuts: 32,
        openGreen: 23,
        openYellow: 24,
        openRed: 40,
    },
    callouts: [
        { ticker: 'alb', kind: 'roll', headline: 'Roll chain closed keeping ~97% of premium', body: 'Walked the strike from $135 to $116 over two months.' },
        { ticker: 'hood', kind: 'roll', headline: 'Defensive roll after delta passed 0.60', body: null },
        { ticker: 'orcl', kind: 'assignment', headline: 'Shares called away at $135', body: 'ORCL closed at $150.52.' },
        { ticker: 'alb', kind: 'unknownkind', headline: 'Second ALB put headed for assignment', body: null },
    ],
};

describe('normalizePayload', () => {
    it('normalizes money and percent display strings into numbers, percentage points not fractions', () => {
        const week = normalizePayload(basePayload);
        expect(week.metrics.hitRate).toBe(92.1);
        expect(week.metrics.returnPct).toBe(1.51);
        expect(week.metrics.winnersAmount).toBe(6911);
        expect(week.metrics.collateral).toBe(455150);
    });

    it('accepts metrics already given as plain numbers', () => {
        const week = normalizePayload(basePayload);
        expect(week.metrics.netPnl).toBe(6853);
        expect(week.metrics.closedLegs).toBe(38);
        expect(week.metrics.medianDaysHeld).toBe(10);
    });

    it('uppercases tickers and lowercases kind', () => {
        const week = normalizePayload(basePayload);
        expect(week.callouts[0]!.ticker).toBe('ALB');
    });

    it('falls an unrecognized callout kind back to "note" rather than rejecting it', () => {
        const week = normalizePayload(basePayload);
        expect(week.callouts[3]!.kind).toBe('note');
    });

    it('keeps a callout with no body', () => {
        const week = normalizePayload(basePayload);
        expect(week.callouts[1]!.body).toBeNull();
    });

    it('carries the source URL and macro notes through unchanged', () => {
        const week = normalizePayload(basePayload);
        expect(week.sourceUrl).toBe(basePayload.sourceUrl);
        expect(week.macro).toHaveLength(1);
    });

    it('refuses an impossible publish date', () => {
        expect(() => normalizePayload({ ...basePayload, publishDate: '2026-02-31' })).toThrow();
    });

    it('tolerates an empty callouts array', () => {
        const week = normalizePayload({ ...basePayload, callouts: [] });
        expect(week.callouts).toEqual([]);
    });
});

describe('checkInvariants', () => {
    const metrics = normalizePayload(basePayload).metrics;

    it('finds nothing wrong with a consistent week', () => {
        expect(checkInvariants('2026-08-17', metrics)).toEqual([]);
    });

    it('flags open calls + puts not summing to the total', () => {
        const warnings = checkInvariants('2026-08-17', { ...metrics, openCalls: 50 });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/openCalls \+ openPuts/);
    });

    it('flags open green/yellow/red not summing to the total', () => {
        const warnings = checkInvariants('2026-08-17', { ...metrics, openGreen: 20 });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/openGreen \+ openYellow \+ openRed/);
    });

    it('flags winning + roll legs not summing to closed legs', () => {
        const warnings = checkInvariants('2026-08-17', { ...metrics, winningLegs: 30 });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/winningLegs \+ rollLegs/);
    });

    it('skips a check when one of its inputs is missing, rather than false-flagging it', () => {
        expect(checkInvariants('2026-08-17', { ...metrics, openCalls: null })).toEqual([]);
    });

    it('logs invariant warnings during normalize rather than throwing', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        normalizePayload({
            ...basePayload,
            metrics: { ...basePayload.metrics, openCalls: 999 },
        });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
