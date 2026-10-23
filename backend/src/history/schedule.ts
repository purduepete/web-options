import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config';

const execute = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_RANGES = 32;
const MAX_SLOTS = 10000;

export interface ScheduleSlot {
    sessionDate: string;
    captureKind: string;
    scheduledAt: string;
}

const schedules = new Map<string, { expires: number; result: Promise<ScheduleSlot[]> }>();

export async function readSchedule(config: AppConfig, from: string, to: string): Promise<ScheduleSlot[]> {
    if (!config.history?.python) throw new Error('History schedule executable is not configured');
    const key = JSON.stringify([config.history.python, config.history.collectorRoot, from, to]);
    const now = Date.now();
    for (const [cachedKey, entry] of schedules) {
        if (entry.expires <= now) schedules.delete(cachedKey);
    }
    const cached = schedules.get(key);
    if (cached) return cached.result;

    const result = execute(config.history.python, ['-m', 'collector.history_schedule', '--from', from, '--to', to], {
        cwd: config.history.collectorRoot,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
    }).then(({ stdout }) => {
        const value: unknown = JSON.parse(stdout);
        if (
            !Array.isArray(value) ||
            value.length > MAX_SLOTS ||
            !value.every(
                (slot: unknown) =>
                    typeof slot === 'object' &&
                    slot !== null &&
                    'sessionDate' in slot &&
                    typeof slot.sessionDate === 'string' &&
                    'captureKind' in slot &&
                    typeof slot.captureKind === 'string' &&
                    'scheduledAt' in slot &&
                    typeof slot.scheduledAt === 'string' &&
                    Number.isFinite(Date.parse(slot.scheduledAt))
            )
        )
            throw new Error('Invalid history schedule output');
        return value;
    });
    if (schedules.size >= MAX_CACHED_RANGES) {
        const oldest = schedules.keys().next().value;
        if (oldest !== undefined) schedules.delete(oldest);
    }
    schedules.set(key, { expires: now + CACHE_TTL_MS, result });
    try {
        return await result;
    } catch (error) {
        if (schedules.get(key)?.result === result) schedules.delete(key);
        throw error;
    }
}
