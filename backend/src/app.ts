import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { AppConfig } from './config';
import { classifyDbError, pingDatabase } from './db';
import { createApiRouter } from './routes/api';

export function createApp(config: AppConfig): Express {
    const app = express();

    app.disable('x-powered-by');
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, allowedHeaders: ['X-API-Key', 'Content-Type'] }));
    if (config.nodeEnv !== 'test') {
        app.use(morgan('tiny'));
    }

    // Unauthenticated liveness probe. Deliberately outside /api so a service
    // manager can check the process without holding a key.
    app.get('/healthz', (_req, res) => {
        res.json({ status: 'ok' });
    });

    // Liveness says the process answers; this says it can actually do its job.
    app.get('/readyz', (_req, res) => {
        void pingDatabase(config.db).then(
            () => res.json({ status: 'ok', database: 'ok' }),
            (error: unknown) => {
                const failure = classifyDbError(error) ?? 'database_unreachable';
                console.error('[weboptions] not ready:', failure);
                res.status(503).json({ status: 'degraded', database: failure });
            },
        );
    });

    app.use('/api', createApiRouter(config));

    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'not found' });
    });

    if (config.webRoot) {
        const webRoot = config.webRoot;
        app.use(express.static(webRoot, { index: false }));
        // Deep links like /calendars/2026-08-10 are client-side routes, so no file
        // matches them and the app shell has to answer instead of a 404.
        app.use((req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                next();
                return;
            }
            res.sendFile(path.join(webRoot, 'index.html'));
        });
    }

    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
        // Never leak connection strings or driver internals to the client.
        const failure = classifyDbError(error);
        console.error('[weboptions]', failure ?? 'internal error:', error.message);
        if (failure) {
            res.status(503).json({ error: 'database unavailable', code: failure });
            return;
        }
        res.status(500).json({ error: 'internal error', code: 'internal' });
    });

    return app;
}
