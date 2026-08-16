import sql from 'mssql';
import type { DbConfig } from '../config';
import { getPool } from '../db';

export interface ApiKeyRecord {
    label: string;
    prefix: string;
    expiresAt: Date | null;
}

const LOOKUP_QUERY = `
SELECT TOP 1 label, prefix, expires_at
FROM opt.api_key
WHERE key_hash = @keyHash
  AND is_revoked = 0
  AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())
`;

export async function findActiveKey(db: DbConfig, keyHash: string): Promise<ApiKeyRecord | null> {
    const pool = await getPool(db);
    const result = await pool
        .request()
        .input('keyHash', sql.Char(64), keyHash)
        .query<{ label: string; prefix: string; expires_at: Date | null }>(LOOKUP_QUERY);

    const row = result.recordset[0];
    if (!row) return null;
    return { label: row.label, prefix: row.prefix, expiresAt: row.expires_at ?? null };
}
