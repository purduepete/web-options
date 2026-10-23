import { Router } from 'express';
import type {
    CalendarsIndexResponse,
    CautionSymbolsResponse,
    EarliestWeekResponse,
    GradeSettings,
    GradeSettingsResponse,
    HealthResponse,
    MeResponse,
    OwnedOptionPosition,
    OwnedOptionsResponse,
    SignalMonthsResponse,
    SignalSummaryResponse,
    UnderlyingQuote,
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
    parseHalfFilter,
    parseMoneynessFilter,
    parseNumberSource,
    parseOwnedFilter,
    parseSymbolList,
} from '@weboptions/shared';
import type { AppConfig } from '../config';
import { createHistoryRouter } from '../history/routes';
import { fetchCalendar, listCalendars } from '../calendars/repository';
import { listCautionSymbols, replaceCautionSymbols } from '../caution/repository';
import { getSymbolDetail } from '../market/service';
import { readVix } from '../market/vix';
import { fetchQuote } from '../market/yahoo';
import { requireApiKey } from '../middleware/apiKey';
import { readGradeSettings, replaceGradeSettings } from '../settings/repository';
import {
    earliestWeekMonday,
    fetchRange,
    fetchSignal,
    fetchWeek,
    signalDates,
    weekHasData,
} from '../signals/repository';
import { sqlDateToIso } from '../signals/shape';
import { monthsFrom, spanOf, summarizeRange } from '../signals/summary';
import { addDays, currentWeekMonday, fromIsoDate, parseWeekParam, toIsoDate } from '../weeks';

/** Matches Python's `datetime.now().isoformat(timespec="seconds")`: local, no offset. */
function localTimestamp(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${toIsoDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * The signal feed carries the underlying only as of the day the signal was issued,
 * so today's move has to come from the quote source. A symbol whose quote fails is
 * left out and the page falls back to the signal-day price without a percentage,
 * which is better than showing a stale move as if it were today's.
 */
async function liveUnderlyings(positions: OwnedOptionPosition[]): Promise<Record<string, UnderlyingQuote>> {
    const symbols = [...new Set(positions.map((position) => position.symbol))];
    const quotes = await Promise.all(symbols.map(async (symbol) => [symbol, await fetchQuote(symbol)] as const));

    const underlyings: Record<string, UnderlyingQuote> = {};
    for (const [symbol, quote] of quotes) {
        if (!quote || quote.price === null) continue;
        const previous = quote.previousClose;
        underlyings[symbol] = {
            price: quote.price,
            changePct: previous !== null && previous > 0 ? ((quote.price - previous) / previous) * 100 : null,
        };
    }
    return underlyings;
}

export function createApiRouter(config: AppConfig): Router {
    const router = Router();

    // Access mode trusts the external Cloudflare Access / Tailscale boundary.
    if (config.auth?.mode !== 'access') router.use(requireApiKey(config));
    router.use('/contract-history', createHistoryRouter(config));

    router.get('/health', (_req, res) => {
        const body: HealthResponse = { status: 'ok' };
        res.json(body);
    });

    router.get('/me', (req, res) => {
        if (config.auth?.mode === 'access') {
            const body: MeResponse = { authMode: 'access', label: 'Deployment platform access' };
            res.json(body);
            return;
        }
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
            const weekStart = toIsoDate(monday);
            const [signalDays, hasPriorWeekData, hasNextWeekData] = await Promise.all([
                fetchWeek(config.db, monday),
                weekHasData(config.db, addDays(monday, -7)),
                // A future week is never navigable, even if it somehow had rows.
                monday >= currentMonday ? Promise.resolve(false) : weekHasData(config.db, addDays(monday, 7)),
            ]);

            const body: WeekSignalsResponse = {
                weekStart,
                weekEnd: toIsoDate(addDays(monday, 4)),
                generatedAt: localTimestamp(),
                isCurrentWeek: toIsoDate(monday) === toIsoDate(currentMonday),
                hasPriorWeekData,
                hasNextWeekData,
                days: signalDays,
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
        const moneyness = parseMoneynessFilter(req.query.moneyness);
        const half = parseHalfFilter(req.query.half);
        const owned = parseOwnedFilter(req.query.owned);
        const numberSource = parseNumberSource(req.query.numberSource);

        try {
            const found = monthsFrom(await signalDates(config.db)).find((entry) => entry.month === month);
            if (!found) {
                res.status(404).json({ error: 'no signals for that month' });
                return;
            }
            const span = spanOf(found);
            const rows = await fetchRange(config.db, span.from, span.to);
            const { weeks, total } = summarizeRange(rows, found.weekStarts, {
                symbols,
                expiry,
                moneyness,
                half,
                owned,
                numberSource,
            });
            const body: SignalSummaryResponse = {
                month,
                symbols,
                expiry,
                moneyness,
                half,
                owned,
                numberSource,
                weeks,
                total,
            };
            res.json(body);
        } catch (error) {
            next(error);
        }
    });

    router.get('/owned-contracts', async (req, res) => {
        const refresh = req.query.refresh;
        if (refresh !== undefined && refresh !== 'true') {
            res.status(400).json({ error: 'refresh must be true when provided' });
            return;
        }
        const { apiUrl, serviceKey } = config.webportfolio;
        if (!apiUrl || !serviceKey) {
            res.status(503).json({ error: 'webportfolio API is not configured', code: 'webportfolio_not_configured' });
            return;
        }

        const url = new URL('/api/option-transactions/open-positions/realtime', apiUrl);
        if (refresh === 'true') url.searchParams.set('refresh', 'true');
        let response: Response;
        try {
            response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    'X-API-Key': serviceKey,
                },
                signal: AbortSignal.timeout(90_000),
            });
        } catch {
            res.status(503).json({ error: 'webportfolio API did not answer', code: 'webportfolio_unreachable' });
            return;
        }

        const body = (await response.json().catch(() => ({}))) as {
            success?: boolean;
            data?: OwnedOptionPosition[];
            error?: string;
        };
        if (!response.ok || !body.success || !Array.isArray(body.data)) {
            res.status(response.status >= 400 && response.status < 500 ? response.status : 503).json({
                error: body.error ?? 'webportfolio API returned an unexpected response',
                code:
                    response.status === 401 || response.status === 403
                        ? 'webportfolio_unauthorized'
                        : 'webportfolio_unavailable',
            });
            return;
        }

        const payload: OwnedOptionsResponse = {
            positions: body.data,
            underlyings: await liveUnderlyings(body.data),
            generatedAt: localTimestamp(),
        };
        res.json(payload);
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
     * One signal, named by the four columns that identify it. Exists so the drill-in
     * can jump to another signal on the same underlying without the page having to
     * load that whole week to find it.
     */
    router.get('/signal', async (req, res, next) => {
        const { symbol, reportDate, expiration } = req.query;
        const strike = Number(req.query.strike);

        if (typeof symbol !== 'string' || symbol.length === 0) {
            res.status(400).json({ error: 'symbol is required' });
            return;
        }
        if (typeof reportDate !== 'string' || !isIsoDate(reportDate)) {
            res.status(400).json({ error: 'reportDate must be YYYY-MM-DD' });
            return;
        }
        if (typeof expiration !== 'string' || !isIsoDate(expiration)) {
            res.status(400).json({ error: 'expiration must be YYYY-MM-DD' });
            return;
        }
        if (!Number.isFinite(strike)) {
            res.status(400).json({ error: 'strike must be a number' });
            return;
        }

        try {
            const trade = await fetchSignal(config.db, { symbol, reportDate, strike, expiration });
            if (!trade) {
                res.status(404).json({ error: 'signal not found' });
                return;
            }
            res.json(trade);
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
