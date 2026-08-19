-- 007 · Create the `optcfg` schema.
--
-- The one place in this database the weboptions server process is allowed to
-- write. Everything else it touches -- `opt`, and webportfolio's `dbo` -- stays
-- SELECT-only, and 009 denies writes on those schemas by name.
--
-- A separate schema rather than another table in `opt` is deliberate. SQL Server
-- resolves a DENY at a higher scope over a GRANT at a lower one, so a table in
-- `opt` could not be made writable while `DENY ... ON SCHEMA::opt` stands. Split
-- by schema and the boundary is one line of permissions instead of a list of
-- object-level exceptions that has to be maintained as tables are added.
--
-- CREATE SCHEMA must be the first statement in its batch, so it is wrapped in
-- EXEC to allow the existence guard. T-SQL has no CREATE SCHEMA IF NOT EXISTS.

IF SCHEMA_ID('optcfg') IS NULL
    EXEC('CREATE SCHEMA [optcfg] AUTHORIZATION [dbo]');
GO
