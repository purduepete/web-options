import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CAUTION_SYMBOL_LIMIT } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as cautionRepository from '../src/caution/repository';

const VALID_KEY = 'woak_' + 'a'.repeat(48);
const VALID_HASH = hashKey(VALID_KEY);

const config: AppConfig = {
    db: { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' },
    port: 5057,
    host: '0.0.0.0',
    nodeEnv: 'test',
    webRoot: null,
};

function agent() {
    vi.spyOn(authRepository, 'findActiveKey').mockImplementation(async (_db, keyHash) =>
        keyHash === VALID_HASH ? { label: 'Test key', prefix: 'woak_aaaaaaa', expiresAt: null } : null
    );
    return request(createApp(config));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /api/caution-symbols', () => {
    it('needs a key', async () => {
        const list = vi.spyOn(cautionRepository, 'listCautionSymbols').mockResolvedValue([]);
        const response = await agent().get('/api/caution-symbols');
        expect(response.status).toBe(401);
        expect(list).not.toHaveBeenCalled();
    });

    it('returns the list', async () => {
        vi.spyOn(cautionRepository, 'listCautionSymbols').mockResolvedValue(['KTOS', 'SMCI']);
        const response = await agent().get('/api/caution-symbols').set('x-api-key', VALID_KEY);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ symbols: ['KTOS', 'SMCI'] });
    });
});

describe('PUT /api/caution-symbols', () => {
    it('needs a key', async () => {
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols').mockResolvedValue([]);
        const response = await agent()
            .put('/api/caution-symbols')
            .send({ symbols: ['KTOS'] });
        expect(response.status).toBe(401);
        expect(replace).not.toHaveBeenCalled();
    });

    it('stores the normalized list and answers with what was stored', async () => {
        const replace = vi
            .spyOn(cautionRepository, 'replaceCautionSymbols')
            .mockImplementation(async (_db, symbols) => [...symbols].sort());
        const response = await agent()
            .put('/api/caution-symbols')
            .set('x-api-key', VALID_KEY)
            .send({ symbols: ['smci', ' ktos ', 'SMCI'] });
        expect(response.status).toBe(200);
        expect(replace.mock.calls[0]?.[1]).toEqual(['SMCI', 'KTOS']);
        expect(response.body).toEqual({ symbols: ['KTOS', 'SMCI'] });
    });

    it('accepts an empty list, which clears the table', async () => {
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols').mockResolvedValue([]);
        const response = await agent().put('/api/caution-symbols').set('x-api-key', VALID_KEY).send({ symbols: [] });
        expect(response.status).toBe(200);
        expect(replace.mock.calls[0]?.[1]).toEqual([]);
    });

    it.each([
        ['a missing field', {}],
        ['a bare string', { symbols: 'KTOS' }],
        ['a non-string member', { symbols: ['KTOS', 7] }],
    ])('rejects %s without touching the database', async (_label, body) => {
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols');
        const response = await agent().put('/api/caution-symbols').set('x-api-key', VALID_KEY).send(body);
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('symbols must be an array of strings');
        expect(replace).not.toHaveBeenCalled();
    });

    it('rejects something that is not a ticker, naming it', async () => {
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols');
        const response = await agent()
            .put('/api/caution-symbols')
            .set('x-api-key', VALID_KEY)
            .send({ symbols: ['KTOS', 'drop table'] });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('DROP');
        expect(replace).not.toHaveBeenCalled();
    });

    it('rejects a list longer than the limit', async () => {
        const replace = vi.spyOn(cautionRepository, 'replaceCautionSymbols');
        const symbols = Array.from({ length: CAUTION_SYMBOL_LIMIT + 1 }, (_, index) => `SYM${index}`);
        const response = await agent().put('/api/caution-symbols').set('x-api-key', VALID_KEY).send({ symbols });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain(String(CAUTION_SYMBOL_LIMIT));
        expect(replace).not.toHaveBeenCalled();
    });

    it('reports a malformed body as a bad request rather than a server fault', async () => {
        const response = await agent()
            .put('/api/caution-symbols')
            .set('x-api-key', VALID_KEY)
            .set('content-type', 'application/json')
            .send('{"symbols": [');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'malformed request body' });
    });
});
