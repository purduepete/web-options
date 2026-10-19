import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { validateAccessConfig, type AppConfig } from './config';
import { classifyDbError, pingDatabase } from './db';
import { createApiRouter } from './routes/api';

export function createApp(config: AppConfig): Express {
    validateAccessConfig(config);
    const app = express();
    const accessMode = config.auth?.mode === 'access';
    const allowedOrigins = config.auth?.allowedOrigins ?? [];

    app.disable('x-powered-by');
    app.use(
        helmet({
            xFrameOptions: false,
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
                    frameAncestors: ["'self'", 'https://jimbrownlaptop.tail8ad282.ts.net', 'https://site-dock.jimlertech.com', 'https://jimbrownhome1.tail8ad282.ts.net:8790'],
                },
            },
        }),
    );
    app.use((req, res, next) => {
        if (accessMode && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
            !allowedOrigins.includes(req.get('origin') ?? '')) {
            res.status(403).json({ error: 'allowed origin required' });
            return;
        }
        next();
    });
    app.use(cors({
        origin: accessMode ? allowedOrigins : true,
        allowedHeaders: ['X-API-Key', 'Content-Type'],
    }));
    // Only the caution list has a body, and it is a few hundred tickers at most.
    app.use(express.json({ limit: '32kb' }));
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
        // SiteDock runs on another origin and shows these as the site's icon, so the two
        // root-level icon files opt out of helmet's same-origin resource policy. Nothing else does.
        const icons = new Set(['favicon.svg', 'apple-touch-icon.png'].map((name) => path.join(webRoot, name)));
        app.use(
            express.static(webRoot, {
                index: false,
                setHeaders: (res, file) => {
                    if (icons.has(path.resolve(file))) {
                        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
                        res.setHeader('Cache-Control', 'public, max-age=86400');
                    }
                },
            }),
        );
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
        // A body express.json could not read, or one over the limit. Those are the
        // caller's fault, and letting them fall through would report them as a bug
        // in the server and a 500.
        const status = (error as { status?: unknown }).status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
            res.status(status).json({ error: 'malformed request body' });
            return;
        }

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
