-- Values are normalized at ingest, never at read: '$175P' -> 175.0000 + 'P',
-- '9.7%' -> 9.7000, '$17,500' -> 17500.00.
IF OBJECT_ID('opt.calendar_trade', 'U') IS NULL
BEGIN
    CREATE TABLE opt.calendar_trade (
        id INT IDENTITY(1,1) NOT NULL,
        day_id INT NOT NULL,
        ticker VARCHAR(16) NOT NULL,
        option_right CHAR(1) NOT NULL,
        strike DECIMAL(18,4) NULL,
        expiry DATE NULL,
        dte INT NULL,
        delta DECIMAL(9,4) NULL,
        ann_yield DECIMAL(9,4) NULL,
        premium DECIMAL(18,2) NULL,
        collateral DECIMAL(18,2) NULL,
        risk VARCHAR(20) NULL,
        note NVARCHAR(MAX) NULL,
        sort_order INT NOT NULL,
        CONSTRAINT PK_opt_calendar_trade PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_opt_calendar_trade_day FOREIGN KEY (day_id)
            REFERENCES opt.calendar_day (id) ON DELETE CASCADE,
        CONSTRAINT UQ_opt_calendar_trade_order UNIQUE (day_id, sort_order),
        CONSTRAINT CK_opt_calendar_trade_right CHECK (option_right IN ('P', 'C'))
    );
END
GO
