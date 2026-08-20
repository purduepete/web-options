import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SymbolDetail, Trade } from '@weboptions/shared';
import { GRADE_DEFAULTS } from '@weboptions/shared';

const fetchSymbolDetail = vi.fn();
const fetchGradeSettings = vi.fn();
const fetchCautionSymbols = vi.fn();

vi.mock('../src/api', async () => {
    const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
    return {
        ...actual,
        fetchSymbolDetail: (symbol: string, contract: unknown) => fetchSymbolDetail(symbol, contract),
        fetchGradeSettings: () => fetchGradeSettings(),
        fetchCautionSymbols: () => fetchCautionSymbols(),
    };
});

const { TradeDetail } = await import('../src/signals/TradeDetail');
const { GradeSettingsProvider } = await import('../src/grade/GradeSettingsProvider');
const { CautionProvider } = await import('../src/caution/CautionProvider');

function trade(extra: Partial<Trade> = {}): Trade {
    return {
        symbol: 'VST',
        sector: 'Utilities',
        optionRight: 'P',
        strike: 170,
        expiration: '2026-08-21',
        dte: 3,
        delta: -0.18,
        annualizedYield: 62,
        premium: 145,
        collateral: 17000,
        tier: 'Conservative',
        isTopPick: false,
        actualDelta: -0.31,
        actualPremium: 160,
        actualAnnualizedYield: 20,
        actualIlliquid: false,
        actualIv: 0.284,
        actualUnderlying: 182.35,
        closeDate: null,
        closeUnderlying: null,
        moneyness: null,
        percentFromStrike: null,
        ...extra,
    };
}

function detail(extra: Partial<SymbolDetail> = {}): SymbolDetail {
    return {
        symbol: 'VST',
        longName: 'Vistra Corp.',
        exchange: 'NYSE',
        currency: 'USD',
        price: 182.35,
        priceDate: '2026-08-18',
        stale: false,
        sma50: 170,
        sma200: 150,
        bars: [
            { date: '2026-08-17', close: 180.1 },
            { date: '2026-08-18', close: 182.35 },
        ],
        pastSignals: [],
        ...extra,
    };
}

function renderDetail(props: Partial<Parameters<typeof TradeDetail>[0]> = {}) {
    const onClose = vi.fn();
    const result = render(
        <CautionProvider>
            <GradeSettingsProvider>
                <TradeDetail trade={trade()} numberSource="quoted" onClose={onClose} {...props} />
            </GradeSettingsProvider>
        </CautionProvider>,
    );
    return { ...result, onClose };
}

beforeEach(() => {
    vi.clearAllMocks();
    fetchSymbolDetail.mockResolvedValue(detail());
    fetchGradeSettings.mockResolvedValue({ settings: GRADE_DEFAULTS });
    fetchCautionSymbols.mockResolvedValue({ symbols: [] });
});

describe('TradeDetail', () => {
    it('renders nothing at all without a trade', () => {
        const { container } = renderDetail({ trade: null });

        expect(container.textContent).toBe('');
        expect(fetchSymbolDetail).not.toHaveBeenCalled();
    });

    it('opens as a labelled modal dialog', async () => {
        renderDetail();

        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'VST $170P' })).toBeTruthy();
        await waitFor(() => expect(fetchSymbolDetail).toHaveBeenCalled());
    });

    it('shows the recap on the FIRST frame, before the market answers', () => {
        // Nothing awaited: the ticket already knew all of this, so opening on a
        // spinner would be hiding data it had in hand.
        renderDetail();

        expect(screen.getByText('The contract')).toBeTruthy();
        expect(screen.getByText('$170.00')).toBeTruthy();
        expect(screen.getByText('3 DTE', { exact: false })).toBeTruthy();
    });

    it('asks for the market data by contract, so it is kept out of its own history', async () => {
        renderDetail();

        await waitFor(() =>
            expect(fetchSymbolDetail).toHaveBeenCalledWith('VST', { strike: 170, expiration: '2026-08-21' }),
        );
    });

    it('fades the market data in once it arrives', async () => {
        renderDetail();

        await screen.findByText('Where it trades');
        expect(screen.getByText('$182.35')).toBeTruthy();
        // (182.35 - 170) / 182.35. Dividing by the STRIKE would print 7.3%.
        expect(screen.getByText('6.8% below')).toBeTruthy();
    });

    it('says so when the price is the last one cached', async () => {
        fetchSymbolDetail.mockResolvedValue(detail({ stale: true }));
        renderDetail();

        expect(await screen.findByText('cached')).toBeTruthy();
    });

    it('reports a failure without losing the recap', async () => {
        fetchSymbolDetail.mockRejectedValue(new Error('database_unreachable'));
        renderDetail();

        expect(await screen.findByText(/Could not load market data/)).toBeTruthy();
        expect(screen.getByText('The contract')).toBeTruthy();
    });

    describe('the grade', () => {
        it('follows VADER’s advertised numbers in quoted mode', async () => {
            renderDetail({ numberSource: 'quoted' });

            // 62% annualized, delta -0.18, 6.7% cushion: the cushion flag alone.
            await screen.findByText('Yellow');
        });

        it('follows the captured numbers in actual mode, so it cannot contradict the figure beside it', async () => {
            renderDetail({ numberSource: 'actual' });

            // 20% annualized is red before anything else is considered.
            expect(await screen.findByText('Red')).toBeTruthy();
        });

        it('names the caution list when the symbol is on it', async () => {
            fetchCautionSymbols.mockResolvedValue({ symbols: ['VST'] });
            renderDetail();

            expect(await screen.findByText('VST is on the caution list.')).toBeTruthy();
        });
    });

    describe('the research links', () => {
        it('opens Seeking Alpha and Fidelity for the symbol', async () => {
            renderDetail();

            const alpha = screen.getByRole<HTMLAnchorElement>('link', { name: 'Seeking Alpha' });
            const fidelity = screen.getByRole<HTMLAnchorElement>('link', { name: 'Fidelity' });

            expect(alpha.href).toBe('https://seekingalpha.com/symbol/VST');
            expect(fidelity.href).toContain('symbol=VST');
        });

        it('names neither the reader nor their page to the site it opens', () => {
            renderDetail();

            for (const name of ['Seeking Alpha', 'Fidelity']) {
                const link = screen.getByRole('link', { name });
                expect(link.getAttribute('rel')).toBe('noopener noreferrer');
                expect(link.getAttribute('target')).toBe('_blank');
            }
        });
    });

    describe('earlier signals', () => {
        it('says plainly when there are none', async () => {
            expect(await (renderDetail(), screen.findByText('No other signals on this underlying.'))).toBeTruthy();
        });

        it('lists each with how it resolved', async () => {
            fetchSymbolDetail.mockResolvedValue(
                detail({
                    pastSignals: [
                        {
                            reportDate: '2026-07-14',
                            strike: 150,
                            expiration: '2026-07-18',
                            annualizedYield: 41,
                            outcome: 'expired_otm',
                            closeAtExpiration: 161.2,
                        },
                        {
                            reportDate: '2026-06-02',
                            strike: 175,
                            expiration: '2026-06-06',
                            annualizedYield: 55,
                            outcome: 'expired_itm',
                            closeAtExpiration: 168.4,
                        },
                    ],
                }),
            );
            renderDetail();

            expect(await screen.findByText('Expired worthless')).toBeTruthy();
            expect(screen.getByText('Assigned')).toBeTruthy();
            // The close is on the chip's title, not spelled out in the row.
            expect(screen.queryByText('closed $161.20')).toBeNull();
        });

        it('marks a settled signal against its expiration close', async () => {
            fetchSymbolDetail.mockResolvedValue(
                detail({
                    pastSignals: [
                        {
                            reportDate: '2026-07-14',
                            strike: 150,
                            expiration: '2026-07-18',
                            annualizedYield: 41,
                            outcome: 'expired_otm',
                            closeAtExpiration: 161.2,
                        },
                        {
                            reportDate: '2026-06-02',
                            strike: 175,
                            expiration: '2026-06-06',
                            annualizedYield: 55,
                            outcome: 'expired_itm',
                            closeAtExpiration: 168.4,
                        },
                    ],
                }),
            );
            renderDetail();

            await screen.findByText('Expired worthless');
            const chips = [...screen.getByRole('dialog').querySelectorAll('.moneyness-chip')];
            // 161.20 finished above a $150 strike; 168.40 finished below a $175 one.
            expect(chips.map((chip) => chip.className)).toEqual(['moneyness-chip otm', 'moneyness-chip itm']);
            expect(chips[0]!.getAttribute('title')).toBe('Closed $161.20 at expiration, against a $150.00 strike.');
        });

        it('marks a signal still open against where the underlying is today', async () => {
            fetchSymbolDetail.mockResolvedValue(
                detail({
                    pastSignals: [
                        {
                            reportDate: '2026-08-11',
                            strike: 190,
                            expiration: '2026-08-29',
                            annualizedYield: 48,
                            outcome: 'open',
                            closeAtExpiration: null,
                        },
                    ],
                }),
            );
            renderDetail();

            await screen.findByText('Still open');
            // No close to judge it by, so today's $182.35 does: below a $190 strike.
            const chip = screen.getByRole('dialog').querySelector('.moneyness-chip')!;
            expect(chip.className).toBe('moneyness-chip itm');
            expect(chip.getAttribute('title')).toBe('Still open: VST is at $182.35 today, against a $190.00 strike.');
        });
    });

    describe('the day arrows', () => {
        it('stays out of the way when the trade has no day around it', () => {
            renderDetail();

            expect(screen.getByRole('dialog').querySelector('.detail-nav')).toBeNull();
        });

        it('names the place in the day and steps either way', () => {
            const onPrevious = vi.fn();
            const onNext = vi.fn();
            renderDetail({ position: '3 of 21', onPrevious, onNext });

            expect(screen.getByText('3 of 21')).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Earlier signal this day' }));
            fireEvent.click(screen.getByRole('button', { name: 'Later signal this day' }));

            expect(onPrevious).toHaveBeenCalledTimes(1);
            expect(onNext).toHaveBeenCalledTimes(1);
        });

        it('holds its width at the ends of the day rather than dropping an arrow', () => {
            renderDetail({ position: '1 of 21', onPrevious: null, onNext: vi.fn() });

            expect(screen.getByRole('button', { name: 'Earlier signal this day' }).hasAttribute('disabled')).toBe(true);
            expect(screen.getByRole('button', { name: 'Later signal this day' }).hasAttribute('disabled')).toBe(false);
        });

        it('takes the same step from the arrow keys', () => {
            const onPrevious = vi.fn();
            const onNext = vi.fn();
            renderDetail({ position: '3 of 21', onPrevious, onNext });

            fireEvent.keyDown(window, { key: 'ArrowLeft' });
            fireEvent.keyDown(window, { key: 'ArrowRight' });

            expect(onPrevious).toHaveBeenCalledTimes(1);
            expect(onNext).toHaveBeenCalledTimes(1);
        });

        it('leaves the arrow keys alone at the end they cannot pass', () => {
            const onNext = vi.fn();
            renderDetail({ position: '1 of 21', onPrevious: null, onNext });

            fireEvent.keyDown(window, { key: 'ArrowLeft' });

            expect(onNext).not.toHaveBeenCalled();
        });
    });

    describe('closing', () => {
        it('closes on the close button', async () => {
            const { onClose } = renderDetail();
            fireEvent.click(screen.getByRole('button', { name: 'Close' }));

            expect(onClose).toHaveBeenCalled();
        });

        it('closes on the backdrop', () => {
            const { onClose } = renderDetail();
            fireEvent.click(screen.getByTestId('modal-backdrop'));

            expect(onClose).toHaveBeenCalled();
        });

        it('closes on Escape, and keeps the key to itself', () => {
            const pageEscape = vi.fn();
            document.addEventListener('keydown', pageEscape);
            const { onClose } = renderDetail();

            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

            expect(onClose).toHaveBeenCalled();
            // Stopped at the dialog: a page-level Escape must not also fire and undo
            // a second thing the reader never asked about.
            expect(pageEscape).not.toHaveBeenCalled();
            document.removeEventListener('keydown', pageEscape);
        });
    });

    describe('focus', () => {
        it('starts on the close button, so Escape and Tab both have somewhere to go', () => {
            renderDetail();

            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
        });

        it('keeps Tab inside the dialog', () => {
            renderDetail();
            const dialog = screen.getByRole('dialog');
            const focusable = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
            const last = focusable[focusable.length - 1]!;

            last.focus();
            fireEvent.keyDown(dialog, { key: 'Tab' });

            expect(document.activeElement).toBe(focusable[0]);
        });

        it('wraps backwards too', () => {
            renderDetail();
            const dialog = screen.getByRole('dialog');
            const focusable = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');

            focusable[0]!.focus();
            fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

            expect(document.activeElement).toBe(focusable[focusable.length - 1]);
        });

        it('gives focus back to whatever opened it', async () => {
            const opener = document.createElement('button');
            document.body.append(opener);
            opener.focus();

            const { unmount } = renderDetail();
            expect(document.activeElement).not.toBe(opener);

            await act(async () => {
                unmount();
            });

            expect(document.activeElement).toBe(opener);
            opener.remove();
        });
    });

    it('stops the page behind it scrolling, and lets it again on close', async () => {
        const { unmount } = renderDetail();
        expect(document.body.style.overflow).toBe('hidden');

        await act(async () => {
            unmount();
        });

        expect(document.body.style.overflow).toBe('');
    });
});
