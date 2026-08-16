-- ON DELETE CASCADE is required: re-ingest is a single DELETE of the week row.
-- The chain week -> day -> trade is linear with no second path, so cascade is legal.
IF OBJECT_ID('opt.calendar_day', 'U') IS NULL
BEGIN
    CREATE TABLE opt.calendar_day (
        id INT IDENTITY(1,1) NOT NULL,
        week_id INT NOT NULL,
        day_name NVARCHAR(20) NOT NULL,
        day_date DATE NOT NULL,
        -- Bracketed: RULE is a reserved keyword, and EVENT is quoted to match.
        [rule] NVARCHAR(MAX) NULL,
        [event] NVARCHAR(MAX) NULL,
        sort_order INT NOT NULL,
        CONSTRAINT PK_opt_calendar_day PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_opt_calendar_day_week FOREIGN KEY (week_id)
            REFERENCES opt.calendar_week (id) ON DELETE CASCADE,
        CONSTRAINT UQ_opt_calendar_day_order UNIQUE (week_id, sort_order)
    );
END
GO
