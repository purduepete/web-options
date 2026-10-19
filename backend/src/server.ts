import os from 'node:os';
import { createApp } from './app';
import { loadConfig } from './config';
import { closePool } from './db';

function lanAddress(): string {
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal) return entry.address;
        }
    }
    return '127.0.0.1';
}

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, config.host, () => {
    const address = config.host === '0.0.0.0' ? lanAddress() : config.host;
    console.log(`weboptions api listening on http://${address.includes(':') ? `[${address}]` : address}:${config.port}`);
    console.log(`timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
});

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
        void closePool().finally(() => process.exit(0));
    });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
