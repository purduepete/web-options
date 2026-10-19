import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';

vi.mock('../src/db', () => ({
    classifyDbError: vi.fn(),
    pingDatabase: vi.fn(() => { throw new Error('Database access is forbidden in this test'); }),
    getPool: vi.fn(() => { throw new Error('Database access is forbidden in this test'); }),
}));

const app = createApp({
    db: { server: 'unused', database: 'unused', user: 'unused', password: 'unused' },
    webportfolio: { apiUrl: null, serviceKey: null },
    port: 5057, host: '127.0.0.1', nodeEnv: 'test', webRoot: null,
} satisfies AppConfig);

describe('SiteDock frame allowlist', () => {
    it.each(['/healthz', '/api/nope'])('keeps exact old and new origins on %s', async (path) => {
        const response = await request(app).get(path);
        expect(response.headers['x-frame-options']).toBeUndefined();
        expect(response.headers['content-security-policy']).toBe(
            "frame-ancestors 'self' https://jimbrownhome.tail8ad282.ts.net:9443 https://jimbrownlaptop.tail8ad282.ts.net https://site-dock.jimlertech.com",
        );
    });
});
