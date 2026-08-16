import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDaysLiteral, extractPayload, parsePublishedHeading } from '../tools/extract-calendar';

const FIXTURE = path.resolve(__dirname, 'fixtures/weekly-options-calendar-2026-08-10.html');
const html = fs.readFileSync(FIXTURE, 'utf-8');

describe('parsePublishedHeading', () => {
    it('reads the publish date out of the banner heading', () => {
        expect(parsePublishedHeading('Published Aug 10, 2026')).toBe('2026-08-10');
        expect(parsePublishedHeading('Published Sept. 1, 2026')).toBe('2026-09-01');
    });

    it('rejects a heading with no date', () => {
        expect(() => parsePublishedHeading('Weekly Options Calendar')).toThrow();
    });
});

describe('extractDaysLiteral', () => {
    it('stops at the matching bracket, not at a bracket inside a string', () => {
        const source = "var days = [ { note: 'a ] bracket' } ];\nvar other = 1;";
        expect(extractDaysLiteral(source)).toBe("[ { note: 'a ] bracket' } ]");
    });

    it('throws when the literal is missing', () => {
        expect(() => extractDaysLiteral('<html></html>')).toThrow();
    });
});

describe('extractPayload', () => {
    const payload = extractPayload(html);

    it('recovers the publish date', () => {
        expect(payload.publishDate).toBe('2026-08-10');
    });

    it('recovers every macro headline as a label and text pair', () => {
        expect(payload.macro).toHaveLength(3);
        expect(payload.macro![0]!.label).toBe('S&P 500 at a record close');
        expect(payload.macro!.every((item) => item.text.length > 0)).toBe(true);
    });

    it('recovers all five weekdays, including the one with no trades', () => {
        expect(payload.days.map((day) => day.name)).toEqual([
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
        ]);
        expect(payload.days.map((day) => day.trades?.length ?? 0)).toEqual([4, 4, 9, 0, 2]);
    });

    it('keeps the display strings verbatim for the ingest step to normalize', () => {
        const first = payload.days[0]!.trades![0]!;
        expect(first).toMatchObject({
            ticker: 'PM',
            type: 'put',
            strike: '$175P',
            expiry: '2026-09-18',
            dte: 42,
            delta: '-0.19',
            ann: '9.7%',
            premium: '$195',
            collateral: '$17,500',
            risk: 'conservative',
        });
    });

    it('decodes the escaped punctuation in the prose', () => {
        expect(payload.days[0]!.rule).toContain('\u2019');
    });
});
