-- 012 · One more table the service login may read: dbo.stock_price.
--
-- The navbar shows the VIX, and the VIX lives in webportfolio's own daily price
-- table under the symbol 'VIX' -- one row per system_date, written each midnight
-- by that app's price-updater Function. It is not in dbo.historical_indices;
-- index_definitions has no VIX row at all.
--
-- Stated plainly, because 003 promised "exactly two things" and this is a third:
-- weboptions_ro can now read every symbol/price row in dbo.stock_price, which is
-- the set of tickers the portfolio follows plus their last two closes. No hashes,
-- no keys, no positions, no quantities. Object scope, not schema scope, so nothing
-- else in dbo comes with it, and the per-schema DENY from 009 still means this
-- login cannot write a byte of it.
--
-- Verify with `npm run verify-readonly`.

IF DATABASE_PRINCIPAL_ID('weboptions_ro') IS NULL
    THROW 50001, 'weboptions_ro does not exist. Run `npm run create-readonly-user` first.', 1;
GO

GRANT SELECT ON OBJECT::dbo.stock_price TO weboptions_ro;
GO
