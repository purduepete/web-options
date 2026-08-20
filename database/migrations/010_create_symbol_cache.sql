-- 010 · Cached market data for the trade drill-in modal.
--
-- WebOptions can reach no price history at all. `opt.telegram_contract_price` holds
-- one close per SIGNALLED CONTRACT since 2026-08-05, but a 200 day average needs ten
-- months of daily closes for the UNDERLYING, so the backend fetches them from Yahoo
-- and parks them here. These two tables are a cache: losing them costs one refetch.
--
-- They live in `optcfg` because that is the only schema this app may write. A DENY at
-- schema scope beats a GRANT at table scope, so nothing writable can live in `opt`.
--
-- `weboptions_ro` holds SELECT, INSERT and DELETE on optcfg and deliberately NO UPDATE
-- (see 009), so a refresh is DELETE-then-INSERT of the whole set for one symbol. The
-- grant is at SCHEMA::optcfg scope, so these tables inherit it and need no new grant.
--
-- The symbol is the key. Symbols are stored exactly as the signal feed spells them
-- (BRK.B, not BRK-B); the dot-to-hyphen swap Yahoo wants happens on the wire only.

IF OBJECT_ID('optcfg.symbol_profile', 'U') IS NULL
BEGIN
    CREATE TABLE optcfg.symbol_profile (
        symbol       VARCHAR(20)    NOT NULL,
        long_name    NVARCHAR(120)  NULL,
        exchange     VARCHAR(40)    NULL,
        currency     VARCHAR(10)    NULL,
        price        DECIMAL(18, 4) NULL,
        price_date   DATE           NULL,
        refreshed_at DATETIME2(0)   NOT NULL
            CONSTRAINT DF_optcfg_symbol_profile_refreshed_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_optcfg_symbol_profile PRIMARY KEY CLUSTERED (symbol)
    );
END
GO

-- Two years of daily closes per symbol, ~500 rows. Only the close is kept: the chart
-- draws one line per series and the moving averages need nothing else.
IF OBJECT_ID('optcfg.price_bar', 'U') IS NULL
BEGIN
    CREATE TABLE optcfg.price_bar (
        symbol   VARCHAR(20)    NOT NULL,
        bar_date DATE           NOT NULL,
        [close]  DECIMAL(18, 4) NOT NULL,
        CONSTRAINT PK_optcfg_price_bar PRIMARY KEY CLUSTERED (symbol, bar_date)
    );
END
GO
