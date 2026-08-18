-- Notable-trade write-ups (roll chains, assignments, closes) for a report week.
-- ON DELETE CASCADE is required: re-ingest is a single DELETE of the week row.
-- `kind` is intentionally NOT constrained by a CHECK: it is validated against
-- an app-level allowlist at normalize time instead, so a new callout kind is a
-- one-line code change rather than a migration.
IF OBJECT_ID('opt.report_callout', 'U') IS NULL
BEGIN
    CREATE TABLE opt.report_callout (
        id INT IDENTITY(1,1) NOT NULL,
        report_week_id INT NOT NULL,
        ticker VARCHAR(16) NOT NULL,
        kind VARCHAR(20) NOT NULL,
        headline NVARCHAR(300) NOT NULL,
        -- Short paraphrase only, never the article's own prose verbatim.
        body NVARCHAR(MAX) NULL,
        sort_order INT NOT NULL,
        CONSTRAINT PK_opt_report_callout PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_opt_report_callout_week FOREIGN KEY (report_week_id)
            REFERENCES opt.report_week (id) ON DELETE CASCADE,
        CONSTRAINT UQ_opt_report_callout_order UNIQUE (report_week_id, sort_order)
    );
END
GO
