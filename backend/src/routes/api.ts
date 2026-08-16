import { Router } from 'express';
import type { EarliestWeekResponse, HealthResponse, MeResponse, WeekSignalsResponse } from '@weboptions/shared';
import type { AppConfig } from '../config';
import { requireApiKey } from '../middleware/apiKey';
import { earliestWeekMonday, fetchWeek, weekHasData } from '../signals/repository';
import { sqlDateToIso } from '../signals/shape';
import { addDays, currentWeekMonday, parseWeekParam, toIsoDate } from '../weeks';

/** Matches Python's `datetime.now().isoformat(timespec="seconds")`: local, no offset. */
function localTimestamp(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${toIsoDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function createApiRouter(config: AppConfig): Router {
    const router = Router();

    // Everything below needs a key. The unauthenticated liveness probe is /healthz,
    // which lives outside this router precisely so it can stay open.
    router.use(requireApiKey(config));

    router.get('/health', (_req, res) => {
        const body: HealthResponse = { status: 'ok' };
        res.json(body);
    });

    router.get('/me', (req, res) => {
        const key = req.apiKey!;
        const body: MeResponse = {
            label: key.label,
            prefix: key.prefix,
            expiresAt: key.expiresAt ? sqlDateToIso(key.expiresAt) : null,
        };
        res.json(body);
    });

    router.get('/week-signals', async (req, res, next) => {
        const weekParam = req.query.week;
        if (weekParam !== undefined && typeof weekParam !== 'string') {
            res.status(400).json({ error: 'week must be YYYY-MM-DD' });
            return;
        }

        const currentMonday = currentWeekMonday();
        let monday: Date;
        if (weekParam) {
            try {
                monday = parseWeekParam(weekParam);
            } catch {
                res.status(400).json({ error: 'week must be YYYY-MM-DD' });
                return;
            }
        } else {
            monday = currentMonday;
        }

        try {
            const days = await fetchWeek(config.db, monday);
            const hasPriorWeekData = await weekHasData(config.db, addDays(monday, -7));
            // A future week is never navigable, even if it somehow had rows.
            const hasNextWeekData = monday >= currentMonday ? false : await weekHasData(config.db, addDays(monday, 7));

            const body: WeekSignalsResponse = {
                weekStart: toIsoDate(monday),
                weekEnd: toIsoDate(addDays(monday, 4)),
                generatedAt: localTimestamp(),
                isCurrentWeek: toIsoDate(monday) === toIsoDate(currentMonday),
                hasPriorWeekData,
                hasNextWeekData,
                days,
            };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/earliest-week', async (_req, res, next) => {
        try {
            const body: EarliestWeekResponse = { weekStart: await earliestWeekMonday(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
