/**
 * The palette's matcher. Deliberately small and pure so it can be tested on its
 * own: give it a query and a string, get back a score and the ranges that
 * matched, or `null` when the string is not a candidate at all.
 *
 * Higher scores are better. The tiers are spaced far enough apart that the
 * length tie-breaker can never promote a weaker kind of match over a stronger
 * one — a substring hit always loses to a word-start hit, however short it is.
 */

import type { Command, CommandResult } from './commandModel';

/** Half-open `[start, end)` into the text that was searched. */
export type Range = readonly [number, number];

export interface Match {
    score: number;
    ranges: readonly Range[];
}

/**
 * Tiers are an order of magnitude above the bonuses on purpose. A multi-token
 * query averages its tokens' tiers, which shrinks the gap between them by the
 * token count; the gap still has to stay clear of the 12-point length bonus, and
 * at this spacing it does for any sane query.
 */
const EXACT = 1000;
const PREFIX = 800;
const WORD_START = 600;
const SUBSTRING = 400;
const SUBSEQUENCE = 200;

/** Consecutive characters in a subsequence hit read like a real word. */
const RUN_BONUS = 30;
const MAX_RUN_BONUS = 120;
const BOUNDARY_BONUS = 10;
const MAX_BOUNDARY_BONUS = 40;

/** Shorter strings win ties: "Calendars" beats "Calendars for the whole year". */
function lengthBonus(length: number): number {
    return Math.max(0, 12 - length / 2);
}

/** Anything that is not a letter or a digit starts a new word — including `/` and `-`. */
function isBoundary(text: string, index: number): boolean {
    if (index === 0) return true;
    return !/[a-z0-9]/.test(text.charAt(index - 1));
}

function scoreToken(token: string, text: string): Match | null {
    const index = text.indexOf(token);

    if (index === 0) {
        return { score: token.length === text.length ? EXACT : PREFIX, ranges: [[0, token.length]] };
    }
    if (index > 0) {
        const tier = isBoundary(text, index) ? WORD_START : SUBSTRING;
        return { score: tier, ranges: [[index, index + token.length]] };
    }

    // Fall back to a subsequence: every character in order, gaps allowed.
    const ranges: Range[] = [];
    let runs = 0;
    let boundaries = 0;
    let cursor = 0;
    let previous = -2;

    for (const character of token) {
        const found = text.indexOf(character, cursor);
        if (found === -1) return null;
        if (found === previous + 1) runs += 1;
        if (isBoundary(text, found)) boundaries += 1;
        ranges.push([found, found + 1]);
        previous = found;
        cursor = found + 1;
    }

    const score =
        SUBSEQUENCE +
        Math.min(MAX_RUN_BONUS, runs * RUN_BONUS) +
        Math.min(MAX_BOUNDARY_BONUS, boundaries * BOUNDARY_BONUS);
    return { score, ranges };
}

function mergeRanges(ranges: readonly Range[]): Range[] {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: Range[] = [];

    for (const [start, end] of sorted) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) {
            merged[merged.length - 1] = [last[0], Math.max(last[1], end)];
        } else {
            merged.push([start, end]);
        }
    }
    return merged;
}

/**
 * Every whitespace-separated token has to match somewhere, in any order. The
 * tokens' tiers are averaged so a two-word query is scored on the same scale as
 * a one-word one.
 */
export function fuzzyScore(query: string, text: string): Match | null {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { score: 0, ranges: [] };

    const haystack = text.toLowerCase();
    const ranges: Range[] = [];
    let total = 0;

    for (const token of tokens) {
        const match = scoreToken(token, haystack);
        if (!match) return null;
        total += match.score;
        ranges.push(...match.ranges);
    }

    return { score: total / tokens.length + lengthBonus(text.length), ranges: mergeRanges(ranges) };
}

/** The label is what the user sees, so it outranks the fields they do not. */
const HINT_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.4;
const DEFAULT_LIMIT = 50;

/**
 * Scores every command and returns the survivors, best first. An empty query
 * matches everything and preserves the caller's order, which is how the palette
 * shows favorites and recents before anything is typed.
 */
export function rankCommands(
    query: string,
    commands: readonly Command[],
    limit: number = DEFAULT_LIMIT
): CommandResult[] {
    const results: CommandResult[] = [];

    for (const command of commands) {
        const label = fuzzyScore(query, command.label);
        const hint = command.hint ? fuzzyScore(query, command.hint) : null;
        const keywords = command.keywords ? fuzzyScore(query, command.keywords) : null;

        const labelScore = label?.score ?? -Infinity;
        const hintScore = hint ? hint.score * HINT_WEIGHT : -Infinity;
        const keywordScore = keywords ? keywords.score * KEYWORD_WEIGHT : -Infinity;
        const best = Math.max(labelScore, hintScore, keywordScore);
        if (best === -Infinity) continue;

        results.push({
            command,
            score: best + (command.boost ?? 0),
            labelRanges: label && labelScore >= hintScore && labelScore >= keywordScore ? label.ranges : [],
        });
    }

    // Array.prototype.sort is stable, so equal scores keep the caller's order
    // and the list does not jitter between keystrokes.
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}
