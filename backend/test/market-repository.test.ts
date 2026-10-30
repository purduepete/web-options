import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const issued: string[] = [];
let recordset: Record<string, unknown>[] = [];

class FakeRequest {
    input(): this {
        return this;
    }

    async query(text: string): Promise<{ recordset: Record<string, unknown>[] }> {
        issued.push(text);
        return { recordset };
    }
}

vi.mock('mssql', () => ({
    default: {
        VarChar: () => 'varchar',
        Decimal: () => 'decimal',
        Int: () => 'int',
    },
}));

vi.mock('../src/db', () => ({
    getPool: async () => ({ request: () => new FakeRequest() }),
}));

const { pastSignalsFor } = await import('../src/market/repository');

const db = { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' };

beforeEach(() => {
    issued.length = 0;
    recordset = [];
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('pastSignalsFor', () => {
    it('returns the strategy and collateral classifications from the detail query', async () => {
        recordset = [
            {
                report_date: '2026-10-30',
                strike: '77',
                expiration: '2026-11-20',
                annualized_yield: '34.6',
                strategy_type: 'CSP',
                collateral_bucket: 'ETF',
                tier: null,
                is_top_pick: 0,
                owned_live_contracts: 0,
                owned_paper_contracts: 0,
            },
        ];

        const signals = await pastSignalsFor(db, 'GDX', { strike: null, expiration: null, reportDate: null }, 20);

        expect(issued[0]).toContain('strategy_type, collateral_bucket');
        expect(issued[0]).toContain('s.strategy_type');
        expect(issued[0]).toContain('s.collateral_bucket');
        expect(signals[0]).toMatchObject({
            strategyType: 'CSP',
            collateralBucket: 'ETF',
            tier: null,
            isTopPick: false,
        });
    });
});
