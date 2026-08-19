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
-- NO LONGER THE WHOLE STORY. This file used to end with a database-scoped
-- `DENY INSERT, UPDATE, DELETE, ALTER`. The caution list (007-009) needs one
-- writable table, and a database-scoped DENY outranks any GRANT below it, so the
-- deny is now issued per schema in 009 instead. Read 009 alongside this one; the
-- write path is still closed everywhere except `optcfg`.
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
