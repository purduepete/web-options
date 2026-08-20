import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRADE_DEFAULTS } from '@weboptions/shared';

/*
 * `optcfg.app_setting` is a GENERIC key/value table and there is no UPDATE grant, so
 * a save is a delete followed by an insert. That pattern one keystroke short of
 * `DELETE FROM optcfg.app_setting` — which would take out whatever the next feature
 * stores there. These tests read the SQL that was actually issued and refuse the
 * unqualified form.
 */

/** Every statement the repository issued, with the parameters bound to it. */
interface Issued {
    text: string;
    inputs: Record<string, unknown>;
}

const issued: Issued[] = [];
let recordset: { name: string; value: string }[] = [];
const transactionCalls: string[] = [];

class FakeRequest {
    readonly inputs: Record<string, unknown> = {};

    input(name: string, _type: unknown, value: unknown): this {
        this.inputs[name] = value;
        return this;
    }

    async query(text: string): Promise<{ recordset: unknown[] }> {
        issued.push({ text, inputs: this.inputs });
        return { recordset };
    }
}

class FakeTransaction {
    async begin(): Promise<void> {
        transactionCalls.push('begin');
    }
    async commit(): Promise<void> {
        transactionCalls.push('commit');
    }
    async rollback(): Promise<void> {
        transactionCalls.push('rollback');
    }
}

vi.mock('mssql', () => ({
    default: {
        VarChar: () => 'varchar',
        Transaction: FakeTransaction,
        Request: FakeRequest,
    },
}));

vi.mock('../src/db', () => ({
    getPool: async () => ({ request: () => new FakeRequest() }),
}));

const { readGradeSettings, replaceGradeSettings } = await import('../src/settings/repository');

const db = { server: 'unused', database: 'unused', user: 'weboptions_ro', password: 'unused' };

beforeEach(() => {
    issued.length = 0;
    transactionCalls.length = 0;
    recordset = [];
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('readGradeSettings', () => {
    it('asks only for the keys it owns', async () => {
        await readGradeSettings(db);

        expect(issued).toHaveLength(1);
        expect(issued[0]?.text).toContain('WHERE name IN (@n0, @n1, @n2, @n3, @n4)');
        expect(Object.values(issued[0]?.inputs ?? {})).toEqual([
            'deltaThreshold',
            'deltaRedThreshold',
            'otmPercentThreshold',
            'annualizedRedBelow',
            'annualizedYellowBelow',
        ]);
    });

    it('binds the key names as parameters rather than writing them into the SQL', async () => {
        await readGradeSettings(db);

        expect(issued[0]?.text).not.toContain('deltaThreshold');
    });

    it('reads what is stored', async () => {
        recordset = [
            { name: 'deltaThreshold', value: '-0.4' },
            { name: 'annualizedRedBelow', value: '30' },
        ];

        expect(await readGradeSettings(db)).toEqual({
            ...GRADE_DEFAULTS,
            deltaThreshold: -0.4,
            annualizedRedBelow: 30,
        });
    });

    it('falls back to the defaults on a fresh database, so nothing is ungraded for want of a row', async () => {
        expect(await readGradeSettings(db)).toEqual(GRADE_DEFAULTS);
    });
});

describe('replaceGradeSettings', () => {
    it('deletes ONLY its own keys, so an unrelated setting survives a save', async () => {
        await replaceGradeSettings(db, GRADE_DEFAULTS);

        const remove = issued.find((statement) => statement.text.includes('DELETE'));
        expect(remove?.text).toContain('WHERE name IN (@n0, @n1, @n2, @n3, @n4)');
        // The failure this guards against: `DELETE FROM optcfg.app_setting;`
        expect(remove?.text).not.toMatch(/DELETE FROM optcfg\.app_setting\s*$/);
    });

    it('writes them all in one insert', async () => {
        await replaceGradeSettings(db, { ...GRADE_DEFAULTS, otmPercentThreshold: 12 });

        const insert = issued.find((statement) => statement.text.includes('INSERT'));
        expect(insert?.text).toContain('(@k0, @v0), (@k1, @v1), (@k2, @v2), (@k3, @v3), (@k4, @v4)');
        expect(insert?.inputs).toMatchObject({
            k2: 'otmPercentThreshold',
            // Stored as text, because the column is VarChar and the parse is shared.
            v2: '12',
        });
    });

    it('does both inside one transaction, so a failed insert cannot leave the table empty', async () => {
        await replaceGradeSettings(db, GRADE_DEFAULTS);

        expect(transactionCalls).toEqual(['begin', 'commit']);
    });

    it('rolls back and rethrows when the insert fails', async () => {
        const boom = new Error('DENY');
        vi.spyOn(FakeRequest.prototype, 'query').mockRejectedValueOnce(boom);

        await expect(replaceGradeSettings(db, GRADE_DEFAULTS)).rejects.toThrow(boom);
        expect(transactionCalls).toEqual(['begin', 'rollback']);
    });

    it('answers with what it stored', async () => {
        const settings = { ...GRADE_DEFAULTS, deltaThreshold: -0.3 };

        expect(await replaceGradeSettings(db, settings)).toEqual(settings);
    });
});
