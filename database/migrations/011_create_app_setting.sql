-- 011 · Generic key/value settings owned by WebOptions.
--
-- Today it holds the four grading thresholds borrowed from webportfolio's settings
-- screen (delta, OTM percent, and the two annualized yield bands). It is deliberately
-- generic so the next setting does not need a migration of its own.
--
-- BECAUSE it is generic, a save must only ever delete the keys it is about to write:
-- `DELETE FROM optcfg.app_setting WHERE name IN (...)`. An unqualified DELETE would
-- wipe every future setting the moment a second feature stores one here.
--
-- Values are stored as text and parsed by `shared/src/grade.ts`, so a new setting of
-- another type needs no schema change. No UPDATE is granted (see 009) and none is
-- needed: a save is DELETE then INSERT inside one transaction.

IF OBJECT_ID('optcfg.app_setting', 'U') IS NULL
BEGIN
    CREATE TABLE optcfg.app_setting (
        name       VARCHAR(64)  NOT NULL,
        value      VARCHAR(64)  NOT NULL,
        updated_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_optcfg_app_setting_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_optcfg_app_setting PRIMARY KEY CLUSTERED (name)
    );
END
GO
