-- 002 · API keys issued by weboptions.
--
-- Deliberately independent of webportfolio's dbo.user_api_keys: a key minted here
-- grants access to this dashboard only, and revoking one has no effect on the
-- other app. Only the SHA-256 hash is stored, so the table is useless to an
-- attacker who reads it; `prefix` exists purely so a human can tell two keys
-- apart in `list-keys` output without the plaintext.

IF OBJECT_ID('opt.api_key', 'U') IS NULL
BEGIN
    CREATE TABLE opt.api_key (
        id          INT IDENTITY(1, 1) NOT NULL,
        key_hash    CHAR(64)           NOT NULL,
        prefix      VARCHAR(16)        NOT NULL,
        label       NVARCHAR(100)      NOT NULL,
        created_at  DATETIME2(0)       NOT NULL
            CONSTRAINT DF_opt_api_key_created_at DEFAULT SYSUTCDATETIME(),
        expires_at  DATETIME2(0)       NULL,
        is_revoked  BIT                NOT NULL
            CONSTRAINT DF_opt_api_key_is_revoked DEFAULT 0,
        CONSTRAINT PK_opt_api_key PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_opt_api_key_key_hash UNIQUE (key_hash)
    );
END
GO

-- Lookup is by hash; this index only serves the admin listing.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_opt_api_key_prefix' AND object_id = OBJECT_ID('opt.api_key')
)
    CREATE INDEX IX_opt_api_key_prefix ON opt.api_key (prefix);
GO
