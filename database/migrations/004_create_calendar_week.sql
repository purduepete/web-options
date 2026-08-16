-- One row per published calendar. publish_date is the natural key: re-ingesting a
-- week deletes this row and lets the cascade take the days and trades with it.
IF OBJECT_ID('opt.calendar_week', 'U') IS NULL
BEGIN
    CREATE TABLE opt.calendar_week (
        id INT IDENTITY(1,1) NOT NULL,
        publish_date DATE NOT NULL,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        title NVARCHAR(200) NULL,
        -- Three label/text pairs that are never queried, so JSON rather than a child table.
        macro NVARCHAR(MAX) NULL,
        source_hash CHAR(64) NOT NULL,
        ingested_at DATETIME2(0) NOT NULL CONSTRAINT DF_opt_calendar_week_ingested_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_opt_calendar_week PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_opt_calendar_week_publish_date UNIQUE (publish_date),
        CONSTRAINT CK_opt_calendar_week_macro_json CHECK (macro IS NULL OR ISJSON(macro) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_opt_calendar_week_week_start' AND object_id = OBJECT_ID('opt.calendar_week'))
    CREATE INDEX IX_opt_calendar_week_week_start ON opt.calendar_week (week_start DESC);
GO
