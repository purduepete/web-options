import { describe, expect, it } from 'vitest';
import { classifyDbError } from '../src/db';

/**
 * The point of this is a browser that can say which thing broke. A rejected
 * login and an unreachable server are both "the page is blank" without it.
 */
describe('classifyDbError', () => {
    it('names a refused login, which is what a rotated password looks like', () => {
        expect(classifyDbError({ code: 'ELOGIN' })).toBe('database_login_failed');
    });

    it.each(['ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINSTLOOKUP', 'ENOTFOUND'])(
        'treats %s as the database being out of reach',
        (code) => {
            expect(classifyDbError({ code })).toBe('database_unreachable');
        }
    );

    it('leaves an ordinary bug alone rather than blaming the database', () => {
        expect(classifyDbError(new TypeError('cannot read properties of undefined'))).toBeNull();
    });

    it('survives whatever it is handed', () => {
        expect(classifyDbError(null)).toBeNull();
        expect(classifyDbError(undefined)).toBeNull();
        expect(classifyDbError('ELOGIN')).toBeNull();
        expect(classifyDbError({ code: 500 })).toBeNull();
    });
});
