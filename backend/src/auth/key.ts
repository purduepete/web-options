import crypto from 'node:crypto';

/**
 * API key format and hashing.
 *
 * Only the SHA-256 digest is ever stored, so a reader of opt.api_key cannot
 * reconstruct a key. Lookup is by digest against a unique index, which means no
 * user-supplied secret is ever compared byte-by-byte in application code and
 * there is no comparison timing to leak.
 */

export const KEY_PREFIX = 'woak_';
const ENTROPY_BYTES = 36;

/** Stored in `prefix` so a key can be identified in listings without revealing it. */
export const PREFIX_LENGTH = 12;

export function generateKey(): string {
    return KEY_PREFIX + crypto.randomBytes(ENTROPY_BYTES).toString('base64url');
}

export function hashKey(key: string): string {
    return crypto.createHash('sha256').update(key, 'utf-8').digest('hex');
}

export function keyPrefix(key: string): string {
    return key.slice(0, PREFIX_LENGTH);
}

export function looksLikeKey(value: string): boolean {
    return value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length + 20;
}
