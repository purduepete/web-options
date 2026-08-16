import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { READ_ONLY_LOGIN, SECRET_FILE, connectAsOperator, describeTarget, loadOperatorConfig } from './operator';

/**
 * Creates the contained user the service runs as, or rotates its password.
 *
 * Kept out of the .sql migrations because CREATE USER needs a password, DDL cannot
 * be parameterized, and no password belongs in a committed file. The permissions
 * themselves are declarative and live in 003_grant_readonly_user.sql — run this
 * first, then `npm run migrate`.
 */

// Alphanumeric only. Azure SQL's policy needs three of four character classes,
// which upper + lower + digit satisfies, and it keeps the value safe to paste into
// a connection string or a service environment variable without escaping.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const GENERATED_LENGTH = 40;

function generatePassword(): string {
    const classes = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789'];
    // Guarantee one of each class rather than relying on chance, then fill the rest.
    const chars = classes.map((set) => set[crypto.randomInt(set.length)]!);
    while (chars.length < GENERATED_LENGTH) {
        chars.push(ALPHABET[crypto.randomInt(ALPHABET.length)]!);
    }
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
}

export function assertSafePassword(password: string): void {
    if (password.length < 16) {
        throw new Error('WEBOPTIONS_RO_PASSWORD must be at least 16 characters.');
    }
    if (!/^[A-Za-z0-9]+$/.test(password)) {
        throw new Error(
            'WEBOPTIONS_RO_PASSWORD must be alphanumeric. Symbols are rejected so the ' +
                'value cannot break out of the DDL string literal or a connection string.',
        );
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        throw new Error('WEBOPTIONS_RO_PASSWORD needs an uppercase letter, a lowercase letter and a digit.');
    }
}

async function main(): Promise<void> {
    const confirmed = process.argv.includes('--confirm');
    const rotating = process.argv.includes('--rotate');
    const config = loadOperatorConfig();

    console.log(`target ${describeTarget(config)}`);
    console.log(`user   ${READ_ONLY_LOGIN}`);

    const pool = await connectAsOperator(config);
    try {
        // Checked before deciding anything, so the dry run can say what would happen.
        const probe = await pool
            .request()
            .query<{ id: number | null }>(`SELECT DATABASE_PRINCIPAL_ID('${READ_ONLY_LOGIN}') AS id`);
        const exists = probe.recordset[0]?.id != null;

        // Re-running this after deployment would mint a new password and lock the
        // running server out of the database. Changing an existing password has to be
        // asked for, never inferred.
        if (exists && !rotating) {
            console.log('\nUser already exists. Nothing to do.');
            console.log('To change its password, re-run with --rotate --confirm.');
            console.log('The server will need the new password before it can reconnect.');
            return;
        }

        const supplied = process.env.WEBOPTIONS_RO_PASSWORD;
        const password = supplied ?? generatePassword();
        assertSafePassword(password);

        console.log(`action ${exists ? 'rotate password' : 'create user'}`);
        console.log(`source ${supplied ? 'WEBOPTIONS_RO_PASSWORD' : 'generated'}`);

        if (!confirmed) {
            console.log('\nDry run. This altered nothing. To apply:');
            console.log('  npx tsx backend/tools/create-readonly-user.ts --confirm');
            console.log('(npm run swallows --confirm, so call the tool directly.)');
            return;
        }

        // The password is validated as alphanumeric above, so it cannot terminate this
        // literal; the doubling is a second line of defence, not the only one.
        const literal = password.replace(/'/g, "''");
        const statement = exists ? 'ALTER USER' : 'CREATE USER';
        await pool.request().batch(`EXEC('${statement} [${READ_ONLY_LOGIN}] WITH PASSWORD = ''${literal}''')`);

        console.log(`\n${exists ? 'Password rotated' : 'User created'}.`);

        if (!supplied) {
            fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
            fs.writeFileSync(SECRET_FILE, password, { encoding: 'utf-8', mode: 0o600 });
            console.log(`\nPassword written to ${SECRET_FILE}`);
            console.log('That path is gitignored. Copy the value into the jimbrownhome service');
            console.log('environment as DB_PASSWORD, then delete the file.');
        }

        if (!exists) {
            console.log('Next: npx tsx backend/tools/migrate.ts --confirm  (applies 003)');
        }
    } finally {
        await pool.close();
    }
}

main().catch((error: Error) => {
    console.error(`failed: ${error.message}`);
    process.exitCode = 1;
});
