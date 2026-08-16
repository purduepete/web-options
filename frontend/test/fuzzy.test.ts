import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankCommands } from '../src/search/fuzzy';
import type { Command } from '../src/search/commandModel';

function score(query: string, text: string): number {
    const match = fuzzyScore(query, text);
    if (!match) throw new Error(`expected "${query}" to match "${text}"`);
    return match.score;
}

describe('fuzzyScore', () => {
    it('treats an empty query as a match with no highlight', () => {
        const match = fuzzyScore('', 'Live Signals');
        expect(match).toEqual({ score: 0, ranges: [] });
    });

    it('is case and whitespace insensitive', () => {
        expect(fuzzyScore('LIVE', 'Live Signals')).not.toBeNull();
        expect(fuzzyScore('  live  ', 'Live Signals')).not.toBeNull();
    });

    it('returns null when a character is missing', () => {
        expect(fuzzyScore('zebra', 'Live Signals')).toBeNull();
    });

    it('ranks exact over prefix over word-start over substring over subsequence', () => {
        const exact = score('appearance', 'Appearance');
        const prefix = score('appear', 'Appearance and theme');
        const wordStart = score('theme', 'Appearance and theme');
        const substring = score('ppear', 'Appearance');
        const subsequence = score('apnce', 'Appearance');

        expect(exact).toBeGreaterThan(prefix);
        expect(prefix).toBeGreaterThan(wordStart);
        expect(wordStart).toBeGreaterThan(substring);
        expect(substring).toBeGreaterThan(subsequence);
    });

    it('treats a hyphen and a slash as word boundaries', () => {
        expect(score('signals', 'live-signals')).toEqual(score('signals', 'live signals'));
        expect(score('cal', '/calendars')).toEqual(score('cal', ' calendars'));
    });

    it('requires every whitespace-separated token to match', () => {
        expect(fuzzyScore('latest calendar', 'Latest Calendar')).not.toBeNull();
        expect(fuzzyScore('latest zebra', 'Latest Calendar')).toBeNull();
    });

    it('matches tokens in any order', () => {
        expect(fuzzyScore('calendar latest', 'Latest Calendar')).not.toBeNull();
    });

    it('prefers the shorter of two otherwise equal matches', () => {
        expect(score('cal', 'Calendars')).toBeGreaterThan(score('cal', 'Calendars for the whole year'));
    });

    it('rewards consecutive characters in a subsequence match', () => {
        // Both are subsequences; "sign" is contiguous inside the second word.
        expect(score('sign', 'Live Signals')).toBeGreaterThan(score('sgnl', 'Live Signals'));
    });

    it('never lets the length tie-breaker overturn a stronger set of matches', () => {
        // Four tokens. The long string matches every one at a word start; the
        // short string matches three at a word start and the first mid-word.
        // Averaging shrinks the gap between the tiers, and the short string's
        // length bonus must still not be able to close it.
        const allWordStarts = score('be ca do ow', 'ant bee cat dog owl fig');
        const oneMidWord = score('be ca do ow', 'zbe ca do ow');
        expect(allWordStarts).toBeGreaterThan(oneMidWord);
    });

    it('reports the matched ranges so the UI can highlight them', () => {
        expect(fuzzyScore('cal', 'Calendars')?.ranges).toEqual([[0, 3]]);
        expect(fuzzyScore('lc', 'Latest Calendar')?.ranges).toEqual([
            [0, 1],
            [7, 8],
        ]);
    });

    it('merges the ranges of separate tokens', () => {
        expect(fuzzyScore('la cal', 'Latest Calendar')?.ranges).toEqual([
            [0, 2],
            [7, 10],
        ]);
    });
});

function command(id: string, label: string, extra: Partial<Command> = {}): Command {
    return { id, label, group: 'Pages', icon: 'page', run: () => {}, ...extra };
}

describe('rankCommands', () => {
    const commands: readonly Command[] = [
        command('/', 'Live Signals', { hint: 'This week of VADER puts' }),
        command('/calendars', 'All Calendars'),
        command('/calendars/latest', 'Latest Calendar'),
        command('/settings/appearance', 'Appearance', { keywords: 'theme dark light colour' }),
    ];

    it('keeps the given order when the query is empty', () => {
        expect(rankCommands('', commands).map((result) => result.command.id)).toEqual([
            '/',
            '/calendars',
            '/calendars/latest',
            '/settings/appearance',
        ]);
    });

    it('drops commands that do not match', () => {
        expect(rankCommands('zebra', commands)).toEqual([]);
    });

    it('puts the best label match first', () => {
        expect(rankCommands('cal', commands)[0]?.command.id).toBe('/calendars');
    });

    it('matches on the hint but ranks it below a label match', () => {
        const results = rankCommands('vader', commands);
        expect(results.map((result) => result.command.id)).toEqual(['/']);

        const both = rankCommands('a', [command('a', 'Zebra', { hint: 'a' }), command('b', 'Apple')]);
        expect(both[0]?.command.id).toBe('b');
    });

    it('matches on hidden keywords', () => {
        expect(rankCommands('dark', commands)[0]?.command.id).toBe('/settings/appearance');
    });

    it('applies the boost a favourite or recent page carries', () => {
        const plain = command('plain', 'Calendar one');
        const favourite = command('fav', 'Calendar two', { boost: 500 });
        expect(rankCommands('calendar', [plain, favourite])[0]?.command.id).toBe('fav');
    });

    it('returns the label ranges for the winning field only', () => {
        const results = rankCommands('cal', commands);
        expect(results[0]?.labelRanges).toEqual([[4, 7]]);
        expect(results[0]?.command.label).toBe('All Calendars');
    });

    it('leaves labelRanges empty when the hint carried the match', () => {
        expect(rankCommands('vader', commands)[0]?.labelRanges).toEqual([]);
    });

    it('never returns more than the limit', () => {
        const many = Array.from({ length: 50 }, (_, index) => command(`c${index}`, `Calendar ${index}`));
        expect(rankCommands('cal', many, 8)).toHaveLength(8);
    });

    it('breaks ties by the original order, so the list never jitters', () => {
        const a = command('a', 'Calendar');
        const b = command('b', 'Calendar');
        expect(rankCommands('calendar', [a, b]).map((result) => result.command.id)).toEqual(['a', 'b']);
        expect(rankCommands('calendar', [b, a]).map((result) => result.command.id)).toEqual(['b', 'a']);
    });
});
