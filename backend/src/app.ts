import express, { type Express, type NextFunction, type Request, type Response } from 'express';
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
