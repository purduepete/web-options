-- 003 · Permissions for the service login.
--
-- This is the file that makes decision 7 real. The weboptions server process runs
-- as `weboptions_ro` and is physically incapable of writing — not by convention,
-- not by code review, by permission. Every write in this project is operator
-- tooling run by hand from the laptop as purduepete.
--
-- DELIBERATE DEVIATION from the agreed plan, flagged for review: the plan said
-- `ALTER ROLE db_datareader ADD MEMBER weboptions_ro`. db_datareader grants SELECT
-- on EVERY table in the database, which would let this dashboard read all of
-- webportfolio's data including its own dbo.user_api_keys hashes. weboptions needs
-- exactly two things, so it is granted exactly two things.
--
-- The DENY is belt and braces. GRANT alone is enough today, but DENY outranks any
-- future GRANT or role membership, so a later "just add it to db_datawriter for a
-- minute" cannot quietly reopen the write path.
--
-- The user itself is created by `npm run create-readonly-user`, not here, because
-- creating it requires a password and no password belongs in a committed file.

IF DATABASE_PRINCIPAL_ID('weboptions_ro') IS NULL
    THROW 50001, 'weboptions_ro does not exist. Run `npm run create-readonly-user` first.', 1;
GO

-- Includes opt.api_key, which the server must read to authenticate anyone at all.
-- Accepted knowingly: the column holds SHA-256 of 36 random bytes, so the table is
-- of no use to a reader, and the DENY below means it can never be written.
-- telegram_signal moved from dbo to opt (webportfolio#596), so the schema-level
-- grant above already covers it. The prior object-level
-- `GRANT SELECT ON OBJECT::dbo.telegram_signal` is retired; do not reintroduce it.
GRANT SELECT ON SCHEMA::opt TO weboptions_ro;
GO

-- Database scope, so it also covers tables and schemas that do not exist yet.
DENY INSERT, UPDATE, DELETE, ALTER TO weboptions_ro;
GO
