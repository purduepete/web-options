import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Consume the shared contracts as source so `npm run dev` needs no build step.
            '@weboptions/shared': path.resolve(__dirname, '../shared/src/index.ts'),
        },
    },
    server: {
        // Reachable from the phone on the LAN, not just localhost.
        host: true,
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5057',
                changeOrigin: false,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
