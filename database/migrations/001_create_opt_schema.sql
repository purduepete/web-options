-- 001 · Create the `opt` schema.
--
-- Everything this project owns lives here. Nothing in dbo is ever created,
-- altered or dropped by weboptions — dbo belongs to the webportfolio app and is
-- read-only from this side.
--
-- CREATE SCHEMA must be the first statement in its batch, so it is wrapped in
-- EXEC to allow the existence guard. T-SQL has no CREATE SCHEMA IF NOT EXISTS.

IF SCHEMA_ID('opt') IS NULL
    EXEC('CREATE SCHEMA [opt] AUTHORIZATION [dbo]');
GO
