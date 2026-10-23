import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config';

const execute = vi.hoisted(() => vi.fn());
vi.mock('node:util', () => ({ promisify: () => execute }));

const config = {
    history: { python: 'python.exe', collectorRoot: 'collector' },
} as AppConfig;
const slots = [{ sessionDate: '2026-10-23', captureKind: 'close', scheduledAt: '2026-10-23T20:00:00Z' }];

beforeEach(() => {
    vi.resetModules();
    execute.mockReset().mockResolvedValue({ stdout: JSON.stringify(slots) });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('history schedule reuse', () => {
    it('shares concurrent and completed schedule calculations across contracts', async () => {
        const { readSchedule } = await import('../src/history/schedule');
        const results = await Promise.all([
            readSchedule(config, '2026-10-23', '2026-10-23'),
            readSchedule(config, '2026-10-23', '2026-10-23'),
        ]);
        expect(results).toEqual([slots, slots]);
        expect(await readSchedule(config, '2026-10-23', '2026-10-23')).toEqual(slots);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('expires after 5 minutes and separates ranges and collector configurations', async () => {
        const { readSchedule } = await import('../src/history/schedule');
        await readSchedule(config, '2026-10-23', '2026-10-23');
        vi.advanceTimersByTime(5 * 60 * 1000);
        await readSchedule(config, '2026-10-23', '2026-10-23');
        await readSchedule(config, '2026-10-22', '2026-10-23');
        await readSchedule(
            { ...config, history: { ...config.history!, collectorRoot: 'new-release' } },
            '2026-10-23',
            '2026-10-23'
        );
        expect(execute).toHaveBeenCalledTimes(4);
    });

    it('evicts the oldest range after reaching the 32-range bound', async () => {
        const { readSchedule } = await import('../src/history/schedule');
        for (let day = 1; day <= 31; day++) {
            await readSchedule(config, `2026-10-${String(day).padStart(2, '0')}`, '2026-10-31');
        }
        await readSchedule(config, '2026-11-01', '2026-11-01');
        await readSchedule(config, '2026-11-02', '2026-11-02');
        await readSchedule(config, '2026-10-01', '2026-10-31');
        expect(execute).toHaveBeenCalledTimes(34);
    });

    it('reports failures and retries rather than caching a failed calculation', async () => {
        const { readSchedule } = await import('../src/history/schedule');
        execute.mockRejectedValueOnce(new Error('Python failed'));
        await expect(readSchedule(config, '2026-10-23', '2026-10-23')).rejects.toThrow('Python failed');
        execute.mockResolvedValueOnce({ stdout: JSON.stringify([{ scheduledAt: 'invalid' }]) });
        await expect(readSchedule(config, '2026-10-23', '2026-10-23')).rejects.toThrow('Invalid history schedule');
        expect(await readSchedule(config, '2026-10-23', '2026-10-23')).toEqual(slots);
        expect(execute).toHaveBeenCalledTimes(3);
    });
});
