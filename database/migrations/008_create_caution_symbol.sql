-- 008 · Underlyings to flag with a caution icon.
--
-- One global list, not one per key. Every key is held by the same person on a
-- different device, so a list that did not follow them between the phone and the
-- laptop would be the wrong shape.
--
-- The symbol IS the key. There is nothing else to say about a row, and a surrogate
-- id would only invite a second row for the same ticker. VARCHAR(20) matches
-- webportfolio's `caution_symbols`; anything longer is not a ticker.
--
-- Saving replaces the whole set (DELETE then INSERT in one transaction), so no
-- UPDATE is granted in 009 and none is needed here.

IF OBJECT_ID('optcfg.caution_symbol', 'U') IS NULL
BEGIN
    CREATE TABLE optcfg.caution_symbol (
        symbol      VARCHAR(20)  NOT NULL,
        created_at  DATETIME2(0) NOT NULL
            CONSTRAINT DF_optcfg_caution_symbol_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_optcfg_caution_symbol PRIMARY KEY CLUSTERED (symbol)
    );
END
GO
