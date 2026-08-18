import { Router } from 'express';
import type {
    CalendarsIndexResponse,
    EarliestWeekResponse,
    HealthResponse,
    MeResponse,
    ReportsIndexResponse,
    WeekSignalsResponse,
} from '@weboptions/shared';
import { isIsoDate } from '@weboptions/shared';
import type { AppConfig } from '../config';
import { fetchCalendar, listCalendars } from '../calendars/repository';
import { requireApiKey } from '../middleware/apiKey';
import { fetchReport, listReports } from '../reports/repository';
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

    router.get('/calendars', async (_req, res, next) => {
        try {
            const body: CalendarsIndexResponse = { calendars: await listCalendars(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/calendars/:publishDate', async (req, res, next) => {
        const { publishDate } = req.params;
        if (!isIsoDate(publishDate)) {
            res.status(400).json({ error: 'publishDate must be YYYY-MM-DD' });
            return;
        }
        try {
            const calendar = await fetchCalendar(config.db, publishDate);
            if (!calendar) {
                res.status(404).json({ error: 'no calendar for that date' });
                return;
            }
            res.json(calendar);
        } catch (error) {
            next(error);
        }
    });

    router.get('/reports', async (_req, res, next) => {
        try {
            const body: ReportsIndexResponse = { reports: await listReports(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/reports/:publishDate', async (req, res, next) => {
        const { publishDate } = req.params;
        if (!isIsoDate(publishDate)) {
            res.status(400).json({ error: 'publishDate must be YYYY-MM-DD' });
            return;
        }
        try {
            const report = await fetchReport(config.db, publishDate);
            if (!report) {
                res.status(404).json({ error: 'no report for that date' });
                return;
            }
            res.json(report);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
