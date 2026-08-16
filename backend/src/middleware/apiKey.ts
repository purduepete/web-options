import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config';
import { hashKey } from '../auth/key';
import { findActiveKey, type ApiKeyRecord } from '../auth/repository';

declare module 'express-serve-static-core' {
    interface Request {
        apiKey?: ApiKeyRecord;
    }
}

const AUTH_SCHEME = 'ApiKey ';

/**
 * Reads the key from a header only. Never from the query string: morgan writes the
 * full URL to the access log, which would turn a durable credential into a log entry.
 */
export function extractApiKey(req: Request): string | null {
    const header = req.header('x-api-key');
    if (header && header.trim()) return header.trim();

    const auth = req.header('authorization');
    if (auth?.startsWith(AUTH_SCHEME)) {
        const value = auth.slice(AUTH_SCHEME.length).trim();
        if (value) return value;
    }

    return null;
}

export function requireApiKey(config: AppConfig) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const provided = extractApiKey(req);
        if (!provided) {
            res.status(401).json({ error: 'api key required' });
            return;
        }

        try {
            // Deliberately does not record a last-used timestamp. The service login is
            // denied every write, so any such bookkeeping would break every request.
            const record = await findActiveKey(config.db, hashKey(provided));
            if (!record) {
                res.status(401).json({ error: 'invalid api key' });
                return;
            }
            req.apiKey = record;
            next();
        } catch (error) {
            next(error);
        }
    };
}
