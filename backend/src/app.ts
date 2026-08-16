import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { AppConfig } from './config';
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

    app.use('/api', createApiRouter(config));

    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'not found' });
    });

    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
        // Never leak connection strings or driver internals to the client.
        console.error('[weboptions]', error.message);
        res.status(500).json({ error: 'internal error' });
    });

    return app;
}
