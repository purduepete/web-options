import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    NetworkError,
    NotFoundError,
    ServiceUnavailableError,
    UnauthorizedError,
    describeFailure,
    fetchCalendars,
} from '../src/api';

/*
 * Five failures used to read as one. A blank page could mean the key was
 * revoked, the API was not running, the database was unreachable, its login had
 * been rotated, or the week genuinely had nothing in it. These pin the first
 * four apart; the empty week is a page-level message, tested with its page.
 */

const originalFetch = globalThis.fetch;

function respondWith(init: { status: number; body?: unknown; contentType?: string }) {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: init.status >= 200 && init.status < 300,
        status: init.status,
        headers: new Headers({ 'content-type': init.contentType ?? 'application/json' }),
        json: async () => init.body ?? {},
    }) as unknown as typeof fetch;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe('the shape of a failure', () => {
    it('calls an unanswered request a network problem, not a bad key', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
        await expect(fetchCalendars()).rejects.toBeInstanceOf(NetworkError);
    });

    it('carries the reason through on a 503, so the two outages stay apart', async () => {
        respondWith({ status: 503, body: { code: 'database_login_failed' } });
        await expect(fetchCalendars()).rejects.toMatchObject({
            name: 'ServiceUnavailableError',
            code: 'database_login_failed',
        });
    });

    it('assumes an unreachable database when a 503 arrives with no code', async () => {
        respondWith({ status: 503, body: {} });
        await expect(fetchCalendars()).rejects.toMatchObject({ code: 'database_unreachable' });
    });

    it('keeps 401 and 404 as their own things', async () => {
        respondWith({ status: 401 });
        await expect(fetchCalendars()).rejects.toBeInstanceOf(UnauthorizedError);

        respondWith({ status: 404 });
        await expect(fetchCalendars()).rejects.toBeInstanceOf(NotFoundError);
    });

    it('does not put a bare status line in front of the reader', async () => {
        respondWith({ status: 500 });
        await expect(fetchCalendars()).rejects.toThrow('The server returned 500.');
    });

    it('reads a non-JSON error as the API being down, which is what the dev proxy sends', async () => {
        // Vite answers a refused connection with a 500 of its own making. Taken at
        // face value that reads as a bug in the server rather than a dead one.
        respondWith({ status: 500, contentType: 'text/plain' });
        await expect(fetchCalendars()).rejects.toBeInstanceOf(NetworkError);
    });
});

describe('describeFailure', () => {
    it('points at the server when nothing answered', () => {
        expect(describeFailure(new NetworkError())).toContain('Cannot reach the Web Options server');
    });

    it('says the server is up but the database is not', () => {
        const message = describeFailure(new ServiceUnavailableError('database_unreachable'));
        expect(message).toContain('cannot reach the database');
        expect(message).not.toContain('login');
    });

    it('names a rotated password, which is the fix rather than the symptom', () => {
        const message = describeFailure(new ServiceUnavailableError('database_login_failed'));
        expect(message).toContain('rejected its login');
        expect(message).toContain('rotated');
    });

    it('passes an ordinary error through rather than swallowing it', () => {
        expect(describeFailure(new Error('The server returned 500.'))).toBe('The server returned 500.');
    });

    it('has something to say about a value that is not an error at all', () => {
        expect(describeFailure('boom')).toBe('Something went wrong.');
    });
});
