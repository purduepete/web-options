import { Router } from 'express';
import { isIsoDate } from '@weboptions/shared';
import type { AppConfig } from '../config';
import { withHistory } from './db';
import { fetchHistory, historyDates, HistoryRangeError, MAX_DATES, searchContracts } from './repository';

/** The contract picker lists every match at once, grouped by date added, so it needs no paging. */
const MAX_SEARCH = 1000;

export function createHistoryRouter(config: AppConfig): Router {
    const router = Router();
    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    router.get('/readiness', async (_req, res) => {
        try {
            await withHistory(config, async (db) => {
                await db.query('SELECT contract_key FROM public.broker_contract LIMIT 1');
            });
            res.json({ status: 'ok' });
        } catch {
            console.error('[history] readiness unavailable');
            res.status(503).json({ error: 'Contract history is unavailable.', code: 'history_unavailable' });
        }
    });
    router.get('/contracts', async (req, res, next) => {
        const q = req.query.q ?? '';
        const offset = Number(req.query.offset ?? 0);
        const limit = Number(req.query.limit ?? MAX_SEARCH);
        if (
            Object.keys(req.query).some((name) => !['q', 'offset', 'limit'].includes(name)) ||
            (req.query.offset !== undefined && typeof req.query.offset !== 'string') ||
            (req.query.limit !== undefined && typeof req.query.limit !== 'string') ||
            typeof q !== 'string' ||
            !/^[A-Za-z0-9.-]{0,12}$/.test(q) ||
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset > 100000 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > MAX_SEARCH
        ) {
            res.status(400).json({ error: 'Invalid contract search or pagination.' });
            return;
        }
        try {
            res.json(await searchContracts(config, q.toUpperCase(), offset, limit));
        } catch (error) {
            next(error);
        }
    });
    router.use('/:key', (req, res, next) => {
        if (!/^[A-Z0-9. -]{6}\d{6}P\d{8}$/.test(req.params.key)) {
            res.status(400).json({ error: 'Invalid put contract key.' });
            return;
        }
        next();
    });
    router.get('/:key/dates', async (req, res, next) => {
        try {
            const dates = await historyDates(config, req.params.key);
            if (!dates) res.status(404).json({ error: 'VADER contract not found.' });
            else res.json({ dates });
        } catch (error) {
            next(error);
        }
    });
    router.get('/:key', async (req, res, next) => {
        const { from, to } = req.query;
        const realDate = (value: string) =>
            isIsoDate(value) &&
            Number.isFinite(Date.parse(value)) &&
            new Date(value).toISOString().slice(0, 10) === value;
        if (
            typeof from !== 'string' ||
            typeof to !== 'string' ||
            !realDate(from) ||
            !realDate(to) ||
            to < from ||
            (Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_DATES
        ) {
            res.status(400).json({
                error: 'Choose a valid range of 1 to 93 calendar dates.',
                code: 'history_range_too_large',
            });
            return;
        }
        try {
            const history = await fetchHistory(config, req.params.key, from, to);
            if (!history) res.status(404).json({ error: 'VADER contract not found.' });
            else res.json(history);
        } catch (error) {
            next(error);
        }
    });
    router.use(
        (
            error: unknown,
            _req: import('express').Request,
            res: import('express').Response,
            _next: import('express').NextFunction
        ) => {
            if (error instanceof HistoryRangeError) {
                res.status(400).json({
                    error: 'Range exceeds 10,000 timeline points. Choose fewer dates.',
                    code: 'history_range_too_large',
                });
                return;
            }
            console.error('[history] request failed:', error instanceof Error ? error.name : 'unknown');
            res.status(503).json({
                error: 'Contract history is unavailable. Retry after checking the history service.',
                code: 'history_unavailable',
            });
        }
    );
    return router;
}
