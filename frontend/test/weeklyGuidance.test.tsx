import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { guidanceReport } from './fixtures/guidanceReport';
import { guidanceLink, indexWeeklyGuidance, weeklyGuidanceFor as lookup } from '../src/signals/weeklyGuidance';
import { WeeklyGuidanceDetail, WeeklyGuidanceSummary } from '../src/signals/GuidanceBadges';
import { TooltipLayer } from '../src/components/Tooltip';

const target = { symbol: 'AAPL', optionRight: 'P' as const, strike: 100, expiration: '2025-08-15', isTopPick: true };
const weeklyGuidanceFor = (
    index: Parameters<typeof lookup>[0],
    trade: Parameters<typeof lookup>[1],
    reportDate: string | null = '2025-08-15',
    now = new Date('2025-08-18T12:00:00')
) => lookup(index, trade, reportDate, now);

describe('weekly guidance matching', () => {
    it('requires a prior-week Top Pick, independently of contract expiration', () => {
        const index = indexWeeklyGuidance(guidanceReport());
        expect(weeklyGuidanceFor(index, { ...target, isTopPick: false })).toEqual([]);
        expect(weeklyGuidanceFor(index, target, null)).toEqual([]);
        expect(weeklyGuidanceFor(index, target, '2025-08-18')).toEqual([]);
        expect(weeklyGuidanceFor(index, target, '2025-08-20')).toEqual([]);
        expect(weeklyGuidanceFor(index, target, '2025-08-25')).toEqual([]);
        expect(weeklyGuidanceFor(index, target, '2025-08-17')).toHaveLength(3);
        expect(weeklyGuidanceFor(index, target, '2025-08-11', new Date('2025-08-17T23:59:59'))).toEqual([]);
        expect(weeklyGuidanceFor(index, target, '2025-08-10', new Date('2025-08-17T23:59:59'))).toHaveLength(3);
        const report = guidanceReport();
        report.sections.management.tables[0]!.rows.forEach((row) => {
            row.contract.expiration = '2026-01-16';
        });
        expect(weeklyGuidanceFor(indexWeeklyGuidance(report), { ...target, expiration: '2026-01-16' })).toHaveLength(3);
    });
    it('shows one card badge while retaining conflicting zone colors and collapsing repeated labels', () => {
        const matches = weeklyGuidanceFor(indexWeeklyGuidance(guidanceReport()), target);
        const { container } = render(<WeeklyGuidanceSummary matches={[...matches, matches[0]!]} />);
        expect(container.querySelectorAll('.weekly-guidance-badge')).toHaveLength(1);
        expect(container.querySelectorAll('.guidance-red')).toHaveLength(1);
        expect(container.querySelectorAll('.guidance-yellow')).toHaveLength(1);
        expect(container.querySelectorAll('.guidance-green')).toHaveLength(1);
        expect(screen.queryByText('08/11/2025 - 08/15/2025')).toBeNull();
        expect(container.textContent).toBe('Red - HoldYellow - HoldGreen - Hold');
    });
    it('uses title case on the card and shows only the guidance summary and dates on hover and keyboard focus', async () => {
        const report = guidanceReport();
        report.sections.management.tables[0]!.rows[0]!.cells[1] = 'TAKE SHARES';
        const matches = weeklyGuidanceFor(indexWeeklyGuidance(report), target);
        const { container } = render(
            <>
                <WeeklyGuidanceSummary matches={matches} />
                <TooltipLayer />
            </>
        );
        const badge = container.querySelector<HTMLElement>('.weekly-guidance-summary')!;
        expect(screen.getByText('Red - Take Shares')).toBeTruthy();
        expect(badge.textContent).not.toContain('Weekly guidance');
        expect(badge.textContent).not.toContain('08/11');
        expect(badge.hasAttribute('title')).toBe(false);
        fireEvent.pointerOver(badge);
        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip.textContent).toBe(
            'Weekly Guidance\nRed - Take Shares\nYellow - Hold\nGreen - Hold\n08/11/2025 - 08/15/2025'
        );
        expect(badge.getAttribute('aria-describedby')).toBe(tooltip.id);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.focusIn(badge);
        expect(await screen.findByRole('tooltip')).toBeTruthy();
    });
    it('matches exact put contracts and preserves separate source rows and zones', () => {
        const index = indexWeeklyGuidance(guidanceReport());
        const matches = weeklyGuidanceFor(index, target);
        expect(matches.map((item) => item.sourceRow)).toEqual([4, 5, 6]);
        expect(matches.map((item) => item.zone)).toEqual(['red', 'yellow', 'green']);
        expect(weeklyGuidanceFor(index, { ...target, symbol: ' aapl ' })).toEqual(matches);
        expect(weeklyGuidanceFor(index, { ...target, symbol: 'MSFT' })).toEqual([]);
        expect(weeklyGuidanceFor(index, { ...target, optionRight: 'C' })).toEqual([]);
        expect(weeklyGuidanceFor(index, { ...target, strike: 101 })).toEqual([]);
        expect(weeklyGuidanceFor(index, { ...target, expiration: '2025-08-22' })).toEqual([]);
        expect(weeklyGuidanceFor(index, { ...target, expiration: null })).toEqual([]);
        expect(weeklyGuidanceFor(index, { ...target, strike: null })).toEqual([]);
        expect(weeklyGuidanceFor(undefined, target)).toEqual([]);
        expect(indexWeeklyGuidance(null).size).toBe(0);
    });
    it('does not assign a status color to an unknown zone', () => {
        const index = indexWeeklyGuidance(guidanceReport());
        expect(weeklyGuidanceFor(index, { ...target, symbol: 'AMD' })[0]?.zone).toBe('unclassified');
    });
    it('shows dated contract-level guidance and links every preserved row to its source', () => {
        const matches = weeklyGuidanceFor(indexWeeklyGuidance(guidanceReport()), target);
        const { container } = render(
            <MemoryRouter>
                <WeeklyGuidanceDetail matches={matches} />
            </MemoryRouter>
        );
        expect(screen.getAllByRole('article')).toHaveLength(3);
        expect(container.querySelector('.guidance-red')).toBeTruthy();
        expect(container.querySelector('.guidance-yellow')).toBeTruthy();
        expect(container.querySelector('.guidance-green')).toBeTruthy();
        expect(screen.getAllByText('08/11/2025 - 08/15/2025')).toHaveLength(3);
        expect(screen.getAllByText('Source quotes: 08/08/2025')).toHaveLength(3);
        expect(screen.getByText(/not by signal entry date/)).toBeTruthy();
        for (const match of matches) {
            expect(
                screen.getByRole('link', { name: `View Management Plan row ${match.sourceRow}` }).getAttribute('href')
            ).toBe(guidanceLink(match));
        }
        expect(container.querySelector('[title]')).toBeNull();
    });
    it('does not render a guidance section for unmatched contracts', () => {
        const { container } = render(<WeeklyGuidanceDetail matches={[]} />);
        expect(container.firstChild).toBeNull();
    });
});
