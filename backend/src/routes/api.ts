import { Router } from 'express';
import type {
    CalendarsIndexResponse,
    CautionSymbolsResponse,
    EarliestWeekResponse,
    HealthResponse,
    MeResponse,
    WeekSignalsResponse,
} from '@weboptions/shared';
import {
    CAUTION_SYMBOL_LIMIT,
    CAUTION_SYMBOL_MAX_LENGTH,
    isCautionSymbol,
    isIsoDate,
    normalizeCautionSymbols,
} from '@weboptions/shared';
import type { AppConfig } from '../config';
import { fetchCalendar, listCalendars } from '../calendars/repository';
import { listCautionSymbols, replaceCautionSymbols } from '../caution/repository';
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

    router.get('/caution-symbols', async (_req, res, next) => {
        try {
            const body: CautionSymbolsResponse = { symbols: await listCautionSymbols(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    // The only write in the app. Validated strictly rather than stored as sent:
    // this is the one route where a bad request leaves something behind.
    router.put('/caution-symbols', async (req, res, next) => {
        const sent = (req.body as { symbols?: unknown } | undefined)?.symbols;
        if (!Array.isArray(sent) || sent.some((value) => typeof value !== 'string')) {
            res.status(400).json({ error: 'symbols must be an array of strings' });
            return;
        }

        const symbols = normalizeCautionSymbols(sent as string[]);
        if (symbols.length > CAUTION_SYMBOL_LIMIT) {
            res.status(400).json({ error: `no more than ${CAUTION_SYMBOL_LIMIT} symbols` });
            return;
        }
        const rejected = symbols.find((symbol) => !isCautionSymbol(symbol));
        if (rejected !== undefined) {
            // Echoed back so the reader can see which entry to fix, clipped so an
            // over-long one cannot be quoted at its full length.
            res.status(400).json({ error: `"${rejected.slice(0, CAUTION_SYMBOL_MAX_LENGTH)}" is not a ticker` });
            return;
        }

        try {
            const body: CautionSymbolsResponse = { symbols: await replaceCautionSymbols(config.db, symbols) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
