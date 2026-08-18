-- One row per published weekly results report. publish_date is the natural key:
-- re-ingesting a week deletes this row and lets the cascade take the callouts
-- with it. Percentages (hit_rate, return_pct) are stored as percentage points
-- (e.g. 92.1, not 0.921), matching opt.calendar_trade.ann_yield's convention.
IF OBJECT_ID('opt.report_week', 'U') IS NULL
BEGIN
    CREATE TABLE opt.report_week (
        id INT IDENTITY(1,1) NOT NULL,
        publish_date DATE NOT NULL,
        title NVARCHAR(200) NULL,
        source_url NVARCHAR(500) NULL,
        -- Headline performance metrics for the week's closed activity.
        net_pnl DECIMAL(18,2) NULL,
        closed_legs INT NULL,
        winning_legs INT NULL,
        roll_legs INT NULL,
        hit_rate DECIMAL(9,4) NULL,
        winners_amount DECIMAL(18,2) NULL,
        roll_cost DECIMAL(18,2) NULL,
        collateral DECIMAL(18,2) NULL,
        return_pct DECIMAL(9,4) NULL,
        new_positions INT NULL,
        new_premium DECIMAL(18,2) NULL,
        net_cash DECIMAL(18,2) NULL,
        median_days_held INT NULL,
        -- Open-position book summary as of the report.
        open_positions_total INT NULL,
        open_calls INT NULL,
        open_puts INT NULL,
        open_green INT NULL,
        open_yellow INT NULL,
        open_red INT NULL,
        -- Label/text pairs (VIX, macro context), never queried, so JSON.
        macro NVARCHAR(MAX) NULL,
        source_hash CHAR(64) NOT NULL,
        ingested_at DATETIME2(0) NOT NULL CONSTRAINT DF_opt_report_week_ingested_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_opt_report_week PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_opt_report_week_publish_date UNIQUE (publish_date),
        CONSTRAINT CK_opt_report_week_macro_json CHECK (macro IS NULL OR ISJSON(macro) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_opt_report_week_publish_date' AND object_id = OBJECT_ID('opt.report_week'))
    CREATE INDEX IX_opt_report_week_publish_date ON opt.report_week (publish_date DESC);
GO
