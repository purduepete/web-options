-- 009 · Re-scope the write ban so exactly one table is writable.
--
-- Until now the service login carried a database-scoped
-- `DENY INSERT, UPDATE, DELETE, ALTER`, and the app was physically incapable of
-- writing anything. The caution list is a global setting saved from the settings
-- page, so it needs one table it can write, and a database-scoped DENY outranks
-- every GRANT beneath it -- including a GRANT on that table. The ban therefore
-- moves down a level: still on by default, now denied per schema, with `optcfg`
-- and nothing else left out.
--
-- What this widens, stated plainly: a caller holding a valid API key can replace
-- the contents of optcfg.caution_symbol. That is the whole of it. Every other
-- table in this database, in every schema that exists when this runs, is still
-- denied INSERT, UPDATE and DELETE by name, and ALTER is still denied outright,
-- so the process cannot reshape or drop even the table it writes to.
--
-- Verify with `npm run verify-readonly`, which probes both sides of the line.

IF DATABASE_PRINCIPAL_ID('weboptions_ro') IS NULL
    THROW 50001, 'weboptions_ro does not exist. Run `npm run create-readonly-user` first.', 1;
GO

-- Clears the database-scoped DENY that 003 used to issue. Leaving it in place
-- would silently beat the GRANT at the bottom of this file. A no-op on a database
-- where 003 has only ever run in its current form.
REVOKE INSERT, UPDATE, DELETE, ALTER FROM weboptions_ro;
GO

-- Nothing here ever changes a schema, so this one keeps database scope.
DENY ALTER TO weboptions_ro;
GO

-- Every schema except optcfg, one at a time. Read out of sys.schemas rather than
-- listed, so it covers the schemas the other apps sharing this database own (dbo,
-- and inv from webinventory) without this file having to track their names.
--
-- A schema created AFTER this runs is not covered. It is also granted nothing, so
-- a write to it fails for want of permission; the DENY is the belt to that
-- braces. Re-run this migration whenever a new schema appears.
DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'DENY INSERT, UPDATE, DELETE ON SCHEMA::' + QUOTENAME(name)
                   + N' TO weboptions_ro;' + CHAR(13) + CHAR(10)
FROM sys.schemas
WHERE name <> 'optcfg'
  AND schema_id < 16384  -- excludes the schemas that exist only to back fixed database roles
  AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest');

EXEC sys.sp_executesql @sql;
GO

-- The carve-out. INSERT and DELETE because saving replaces the whole set; no
-- UPDATE, because no row is ever edited in place.
GRANT SELECT, INSERT, DELETE ON SCHEMA::optcfg TO weboptions_ro;
GO
