import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { gradeVix } from '@weboptions/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { hashKey } from '../src/auth/key';
import * as authRepository from '../src/auth/repository';
import * as vixRepository from '../src/market/vix';

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

describe('GET /api/vix', () => {
    it('needs a key', async () => {
        const read = vi
            .spyOn(vixRepository, 'readVix')
            .mockResolvedValue({ value: 14.89, asOf: '2026-08-19', previousValue: 15.84 });
        const response = await agent().get('/api/vix');

        expect(response.status).toBe(401);
        expect(read).not.toHaveBeenCalled();
    });

    it('answers with the close, the day it closed and the close before it', async () => {
        vi.spyOn(vixRepository, 'readVix').mockResolvedValue({
            value: 14.89,
            asOf: '2026-08-19',
            previousValue: 15.84,
        });
        const response = await agent().get('/api/vix').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ vix: { value: 14.89, asOf: '2026-08-19', previousValue: 15.84 } });
    });

    it('says null rather than failing when the price job has recorded nothing', async () => {
        vi.spyOn(vixRepository, 'readVix').mockResolvedValue(null);
        const response = await agent().get('/api/vix').set('x-api-key', VALID_KEY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ vix: null });
    });
});

describe('gradeVix', () => {
    it('grades a calm market yellow', () => {
        expect(gradeVix(14.89)).toBe('yellow');
    });

    it('grades a dead market red', () => {
        expect(gradeVix(12.49)).toBe('red');
    });

    it('grades each floor itself the better band', () => {
        expect(gradeVix(12.5)).toBe('yellow');
        expect(gradeVix(15)).toBe('green');
    });

    it('stays green as volatility climbs', () => {
        expect(gradeVix(31.2)).toBe('green');
    });
});
