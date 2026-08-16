import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // The service pins this zone; the suite asserts week math under it, so a
        // green run on a differently-configured machine would be meaningless.
        env: { TZ: 'America/Los_Angeles' },
        projects: [
            {
                resolve: {
                    alias: {
                        '@weboptions/shared': path.resolve(__dirname, 'shared/src/index.ts'),
                    },
                },
                test: {
                    name: 'backend',
                    environment: 'node',
                    include: ['backend/test/**/*.test.ts'],
                },
            },
        ],
    },
});
