-- 013 - WebOptions needs read-only visibility into WebPortfolio-owned tables,
-- including dbo.option_transactions for ownership matching. db_datareader also
-- covers future tables in this shared database, as explicitly requested.
-- The service remains write-protected by the per-schema denies in migration 009.

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members drm
    JOIN sys.database_principals role_principal ON role_principal.principal_id = drm.role_principal_id
    JOIN sys.database_principals member_principal ON member_principal.principal_id = drm.member_principal_id
    WHERE role_principal.name = 'db_datareader'
      AND member_principal.name = 'weboptions_ro'
)
    ALTER ROLE db_datareader ADD MEMBER weboptions_ro;
GO