import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiKeyProvider, useApiKey } from '../src/auth/ApiKeyProvider';
import { ApiKeyPage } from '../src/pages/ApiKeyPage';
import { fetchMe } from '../src/api';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relative: string): string {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function Harness() {
    const { status, identity, forget } = useApiKey();
    return (
        <>
            <p>{status}</p>
            <p>{identity?.label}</p>
            <button onClick={forget}>Forget</button>
            <ApiKeyPage />
        </>
    );
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('access frontend build', () => {
    it('provides an explicit Access deployment build profile', () => {
        const profile = read('../.env.access');
        const manifest = JSON.parse(read('../../package.json'));
        expect(profile.trim()).toBe('VITE_AUTH_MODE=access');
        expect(manifest.scripts['build:frontend:access']).toBe(
            'npm run build --workspace @weboptions/frontend -- --mode access'
        );
    });

    it('opens without a key, reports platform identity and stays open after forget', async () => {
        vi.stubEnv('VITE_AUTH_MODE', 'access');
        const fetch = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ authMode: 'access', label: 'Deployment platform access' }))
            );
        vi.stubGlobal('fetch', fetch);
        render(
            <ApiKeyProvider>
                <Harness />
            </ApiKeyProvider>
        );
        expect(screen.getByText('unlocked')).toBeTruthy();
        await waitFor(() => expect(screen.getByText('Deployment platform access')).toBeTruthy());
        expect(screen.queryByText('Forget key on this device')).toBeNull();
        fireEvent.click(screen.getByText('Forget'));
        expect(screen.getByText('unlocked')).toBeTruthy();
        expect(fetch.mock.calls[0]?.[1].headers['X-API-Key']).toBeUndefined();
    });

    it('never forwards a stale stored key or candidate key in access mode', async () => {
        vi.stubEnv('VITE_AUTH_MODE', 'access');
        localStorage.setItem('weboptions_api_key', 'stale-key');
        const fetch = vi.fn().mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        await fetchMe('candidate-key');
        expect(fetch.mock.calls[0]?.[1].headers['X-API-Key']).toBeUndefined();
    });

    it('keeps the default key prompt when access was not explicitly selected', () => {
        vi.stubEnv('VITE_AUTH_MODE', '');
        render(
            <ApiKeyProvider>
                <Harness />
            </ApiKeyProvider>
        );
        expect(screen.getByText('locked')).toBeTruthy();
        expect(screen.getByText('Forget key on this device')).toBeTruthy();
    });
});
