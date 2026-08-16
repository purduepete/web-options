import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const sharedAlias = {
    '@weboptions/shared': path.resolve(__dirname, 'shared/src/index.ts'),
};

export default defineConfig({
    test: {
        // The service pins this zone; the suite asserts week math under it, so a
        // green run on a differently-configured machine would be meaningless.
        env: { TZ: 'America/Los_Angeles' },
        projects: [
            {
                resolve: { alias: sharedAlias },
                test: {
                    name: 'backend',
                    environment: 'node',
                    include: ['backend/test/**/*.test.ts'],
                },
            },
            {
                plugins: [react()],
                resolve: { alias: sharedAlias },
                test: {
                    name: 'frontend',
                    environment: 'jsdom',
                    globals: true,
                    include: ['frontend/test/**/*.test.{ts,tsx}'],
                    setupFiles: [path.resolve(__dirname, 'frontend/test/setup.ts')],
                },
            },
        ],
    },
});
