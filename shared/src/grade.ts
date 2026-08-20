/**
 * The green / yellow / red grade shown on a trade.
 *
 * Every criterion grades on its own and the trade takes the WORST of them, so two
 * yellows are still a yellow. It borrows the threshold names, the defaults and the
 * colour language from webportfolio's settings screen, but the arithmetic here was
 * never read from that app — so a trade sitting right on a threshold can grade
 * differently in the two. That is a deliberate choice, not drift.
 *
 * Pure, so the settings page, the modal and the tests all share one implementation.
 */

import { normalizeCautionSymbols } from './caution';

export type GradeBand = 'green' | 'yellow' | 'red' | 'ungraded';

export const GRADE_BAND_LABELS: Record<GradeBand, string> = {
    green: 'Green',
    yellow: 'Yellow',
    red: 'Red',
    ungraded: 'Ungraded',
};

export type GradeBreach = 'yield' | 'delta' | 'otm' | 'caution' | 'vix';

export interface GradeReason {
    breach: GradeBreach;
    /** What this one criterion grades on its own. The worst of them is the grade. */
    band: 'yellow' | 'red';
    /** Written for a reader, not a log: shown as-is under the badge. */
    detail: string;
}

export interface GradeResult {
    band: GradeBand;
    /** Every criterion that came in below green, in the order they are checked. */
    reasons: GradeReason[];
}

export interface GradeSettings {
    /** More negative is riskier. -0.25 means "flag a delta below -0.25". */
    deltaThreshold: number;
    /** Further out again, where the delta stops being a warning and grades red. */
    deltaRedThreshold: number;
    /** Percent the strike must sit below the price to be comfortable. */
    otmPercentThreshold: number;
    annualizedRedBelow: number;
    annualizedYellowBelow: number;
}

/** Matches webportfolio's settings screen. */
export const GRADE_DEFAULTS: GradeSettings = {
    deltaThreshold: -0.25,
    deltaRedThreshold: -0.4,
    otmPercentThreshold: 10,
    annualizedRedBelow: 25,
    annualizedYellowBelow: 35,
};

export const GRADE_SETTING_KEYS = Object.keys(GRADE_DEFAULTS) as (keyof GradeSettings)[];

export function isGradeSettingKey(value: string): value is keyof GradeSettings {
    return (GRADE_SETTING_KEYS as string[]).includes(value);
}

const GRADE_SETTING_RANGES: Record<keyof GradeSettings, { min: number; max: number }> = {
    deltaThreshold: { min: -1, max: 0 },
    deltaRedThreshold: { min: -1, max: 0 },
    otmPercentThreshold: { min: 0, max: 1000 },
    annualizedRedBelow: { min: 0, max: 1000 },
    annualizedYellowBelow: { min: 0, max: 1000 },
};

export function isGradeSettingValue(key: keyof GradeSettings, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const range = GRADE_SETTING_RANGES[key];
    return value >= range.min && value <= range.max;
}

/**
 * Returns the reason a set of thresholds is unusable, or null. The red/yellow check
 * is not pedantry: with red above yellow, `yield < red` catches everything yellow
 * would have caught and the yellow band becomes unreachable.
 */
export function gradeSettingsError(settings: GradeSettings): string | null {
    for (const key of GRADE_SETTING_KEYS) {
        if (!isGradeSettingValue(key, settings[key])) {
            const range = GRADE_SETTING_RANGES[key];
            return `${key} must be a number between ${range.min} and ${range.max}.`;
        }
    }
    if (settings.annualizedRedBelow > settings.annualizedYellowBelow) {
        return 'The red threshold must not be above the yellow threshold, or nothing can grade yellow.';
    }
    if (settings.deltaRedThreshold > settings.deltaThreshold) {
        return 'The red delta must not be closer to zero than the delta threshold, or no delta can grade yellow.';
    }
    return null;
}

/** Stored values are text. Anything unparseable falls back to its default. */
export function parseGradeSettings(values: Record<string, string>): GradeSettings {
    const settings = { ...GRADE_DEFAULTS };
    for (const key of GRADE_SETTING_KEYS) {
        const raw = values[key];
        if (raw === undefined) continue;
        const parsed = Number(raw);
        if (isGradeSettingValue(key, parsed)) settings[key] = parsed;
    }
    return settings;
}

/** Under this, options are cheap and a put seller is being paid too little to wait. */
export const VIX_CALM_BELOW = 15;

/** And under this the premium has gone, whatever the individual trade looks like. */
export const VIX_DEAD_BELOW = 12.5;

export function gradeVix(value: number): 'green' | 'yellow' | 'red' {
    if (value < VIX_DEAD_BELOW) return 'red';
    return value < VIX_CALM_BELOW ? 'yellow' : 'green';
}

export interface GradeInput {
    symbol: string;
    /** Whichever source the card is displaying, so the badge cannot contradict it. */
    annualizedYield: number | null;
    delta: number | null;
    strike: number | null;
    /** The underlying's CURRENT price. Null simply means the OTM test cannot run. */
    price: number | null;
    cautionSymbols?: readonly string[];
    /** The last VIX close. The one criterion that is about the market, not the trade. */
    vix?: number | null;
}

const RANK: Record<Exclude<GradeBand, 'ungraded'>, number> = { green: 0, yellow: 1, red: 2 };

function percent(value: number): string {
    return `${value.toFixed(1)}%`;
}

/**
 * Every criterion grades on its own, and the trade takes the worst of them. Two
 * yellows are still a yellow; a yellow beside a red is a red. Nothing accumulates,
 * so a second flag can never cost a trade a band the first one did not.
 *
 * Comparison directions are spelled out below because every one of them is easy to
 * invert, and an inverted one grades the riskiest trades green.
 */
export function gradeTrade(input: GradeInput, settings: GradeSettings = GRADE_DEFAULTS): GradeResult {
    const reasons: GradeReason[] = [];

    // The yield grades on two thresholds: under the red one it is a red outright.
    if (input.annualizedYield !== null) {
        if (input.annualizedYield < settings.annualizedRedBelow) {
            reasons.push({
                breach: 'yield',
                band: 'red',
                detail: `Annualized return is ${percent(input.annualizedYield)}; target is ${percent(settings.annualizedRedBelow)} or above`,
            });
        } else if (input.annualizedYield < settings.annualizedYellowBelow) {
            reasons.push({
                breach: 'yield',
                band: 'yellow',
                detail: `Annualized return is ${percent(input.annualizedYield)}; target is ${percent(settings.annualizedYellowBelow)} or above`,
            });
        }
    }

    // Both numbers are negative on a put, so "beyond -0.25" is MORE negative:
    // -0.31 breaches and -0.19 does not. Never compare magnitudes.
    if (input.delta !== null && input.delta < settings.deltaThreshold) {
        const red = input.delta < settings.deltaRedThreshold;
        const breached = red ? settings.deltaRedThreshold : settings.deltaThreshold;
        reasons.push({
            breach: 'delta',
            band: red ? 'red' : 'yellow',
            detail: `Delta ${input.delta.toFixed(2)} is above ${breached.toFixed(2)}; assignment is more likely.`,
        });
    }

    // Divides by PRICE. `Trade.percentFromStrike` divides by strike, so feeding that
    // in would disagree with the cushion printed beside this badge.
    if (input.price !== null && input.price > 0 && input.strike !== null) {
        const cushion = (input.price - input.strike) / input.price;
        if (cushion < settings.otmPercentThreshold / 100) {
            reasons.push({
                breach: 'otm',
                band: 'yellow',
                detail:
                    cushion < 0
                        ? `The strike is ${percent(Math.abs(cushion) * 100)} above the price, so it is already in the money.`
                        : `Strike is ${percent(cushion * 100)} below current price; target is ${percent(settings.otmPercentThreshold)} or above`,
            });
        }
    }

    const cautioned = normalizeCautionSymbols(input.cautionSymbols ?? []);
    const [symbol] = normalizeCautionSymbols([input.symbol]);
    if (symbol && cautioned.includes(symbol)) {
        reasons.push({ breach: 'caution', band: 'red', detail: `${symbol} is on the caution list.` });
    }

    // The one criterion that is not about this trade. A quiet market prices every
    // put thinly, so it grades the whole board rather than singling one out.
    if (input.vix !== null && input.vix !== undefined) {
        const band = gradeVix(input.vix);
        if (band !== 'green') {
            const floor = band === 'red' ? VIX_DEAD_BELOW : VIX_CALM_BELOW;
            reasons.push({
                breach: 'vix',
                band,
                detail: `VIX closed at ${input.vix.toFixed(2)}, below ${floor}; premium is thin across the market.`,
            });
        }
    }

    if (input.annualizedYield === null) return { band: 'ungraded', reasons };

    const band = reasons.reduce<Exclude<GradeBand, 'ungraded'>>(
        (worst, reason) => (RANK[reason.band] > RANK[worst] ? reason.band : worst),
        'green',
    );

    return { band, reasons };
}

export interface GradeSettingsResponse {
    settings: GradeSettings;
}

export interface SaveGradeSettingsRequest {
    settings: GradeSettings;
}
