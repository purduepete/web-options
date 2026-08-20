import { Router } from 'express';
import type {
    CalendarsIndexResponse,
    CautionSymbolsResponse,
    EarliestWeekResponse,
    GradeSettings,
    GradeSettingsResponse,
    HealthResponse,
    MeResponse,
    SignalMonthsResponse,
    SignalSummaryResponse,
    VixResponse,
    WeekSignalsResponse,
} from '@weboptions/shared';
import {
    CAUTION_SYMBOL_LIMIT,
    CAUTION_SYMBOL_MAX_LENGTH,
    GRADE_SETTING_KEYS,
    gradeSettingsError,
    isCautionSymbol,
    isIsoDate,
    normalizeCautionSymbols,
    parseExpiryFilter,
    parseSymbolList,
} from '@weboptions/shared';
import type { AppConfig } from '../config';
import { fetchCalendar, listCalendars } from '../calendars/repository';
import { listCautionSymbols, replaceCautionSymbols } from '../caution/repository';
import { getSymbolDetail } from '../market/service';
import { readVix } from '../market/vix';
import { requireApiKey } from '../middleware/apiKey';
import { readGradeSettings, replaceGradeSettings } from '../settings/repository';
import { earliestWeekMonday, fetchRange, fetchWeek, signalDates, weekHasData } from '../signals/repository';
import { sqlDateToIso } from '../signals/shape';
import { monthsFrom, spanOf, summarizeRange } from '../signals/summary';
import { addDays, currentWeekMonday, fromIsoDate, parseWeekParam, toIsoDate } from '../weeks';

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

    router.get('/signal-months', async (_req, res, next) => {
        try {
            const body: SignalMonthsResponse = { months: monthsFrom(await signalDates(config.db)) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/signal-summary', async (req, res, next) => {
        const month = req.query.month;
        // A `YYYY-MM` shape alone would accept 2026-13, so the month has to survive
        // being parsed as a real date and formatted back.
        if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
            res.status(400).json({ error: 'month must be YYYY-MM' });
            return;
        }
        try {
            if (toIsoDate(fromIsoDate(`${month}-01`)).slice(0, 7) !== month) throw new RangeError(month);
        } catch {
            res.status(400).json({ error: 'month must be YYYY-MM' });
            return;
        }

        const symbols = parseSymbolList(req.query.symbols);
        const expiry = parseExpiryFilter(req.query.expiry);

        try {
            const found = monthsFrom(await signalDates(config.db)).find((entry) => entry.month === month);
            if (!found) {
                res.status(404).json({ error: 'no signals for that month' });
                return;
            }
            const span = spanOf(found);
            const rows = await fetchRange(config.db, span.from, span.to);
            const { weeks, total } = summarizeRange(rows, found.weekStarts, symbols, expiry);
            const body: SignalSummaryResponse = {
                month,
                symbols,
                expiry,
                weeks,
                total,
            };
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

    // Validated strictly rather than stored as sent: a write route is where a bad
    // request leaves something behind.
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

    /**
     * Everything the drill-in modal needs about one underlying. The only route that
     * reaches outside the database, so it is also the only one that can be slow;
     * `getSymbolDetail` soft-fails each piece rather than failing the whole answer.
     *
     * `strike` and `expiration` are optional and identify the contract being viewed,
     * so it is kept out of its own list of past signals. Add `reportDate` and the
     * three together name one signal, which is the grain of the end-of-day rollup.
     */
    router.get('/symbols/:symbol', async (req, res, next) => {
        const { symbol } = req.params;
        const strikeParam = req.query.strike;
        const expirationParam = req.query.expiration;
        const reportDateParam = req.query.reportDate;

        const strike = typeof strikeParam === 'string' ? Number(strikeParam) : null;
        if (strike !== null && !Number.isFinite(strike)) {
            res.status(400).json({ error: 'strike must be a number' });
            return;
        }
        if (expirationParam !== undefined && (typeof expirationParam !== 'string' || !isIsoDate(expirationParam))) {
            res.status(400).json({ error: 'expiration must be YYYY-MM-DD' });
            return;
        }
        if (reportDateParam !== undefined && (typeof reportDateParam !== 'string' || !isIsoDate(reportDateParam))) {
            res.status(400).json({ error: 'reportDate must be YYYY-MM-DD' });
            return;
        }

        try {
            const detail = await getSymbolDetail(config.db, symbol, {
                exclude: { strike, expiration: expirationParam ?? null },
                reportDate: reportDateParam ?? null,
            });
            // Null means the symbol was never a ticker, not that the fetch failed.
            if (!detail) {
                res.status(400).json({ error: 'symbol must be a ticker' });
                return;
            }
            res.json(detail);
        } catch (error) {
            next(error);
        }
    });

    router.get('/vix', async (_req, res, next) => {
        try {
            const body: VixResponse = { vix: await readVix(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/grade-settings', async (_req, res, next) => {
        try {
            const body: GradeSettingsResponse = { settings: await readGradeSettings(config.db) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    /**
     * The four thresholds, all of them, every time. A partial save would leave the
     * page showing numbers the server never agreed to.
     */
    router.put('/grade-settings', async (req, res, next) => {
        const sent = (req.body as { settings?: unknown } | undefined)?.settings;
        if (typeof sent !== 'object' || sent === null || Array.isArray(sent)) {
            res.status(400).json({ error: 'settings must be an object' });
            return;
        }

        const received = sent as Record<string, unknown>;
        const unknownKey = Object.keys(received).find((key) => !(GRADE_SETTING_KEYS as string[]).includes(key));
        if (unknownKey !== undefined) {
            res.status(400).json({ error: `"${unknownKey.slice(0, 64)}" is not a grading setting` });
            return;
        }

        const settings = {} as GradeSettings;
        for (const key of GRADE_SETTING_KEYS) {
            const value = received[key];
            if (typeof value !== 'number') {
                res.status(400).json({ error: `${key} must be a number` });
                return;
            }
            settings[key] = value;
        }

        const invalid = gradeSettingsError(settings);
        if (invalid) {
            res.status(400).json({ error: invalid });
            return;
        }

        try {
            const body: GradeSettingsResponse = { settings: await replaceGradeSettings(config.db, settings) };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
