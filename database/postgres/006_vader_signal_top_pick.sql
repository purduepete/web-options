-- Execute as postgres only after independent review (the tables belong to sd_web_options_owner).
-- Mirrors opt.telegram_signal.is_top_pick so the Contract History page can group top picks.
-- A constant default makes ADD COLUMN a catalog-only change; existing rows read false
-- until the collector's next sync or the one-time backfill sets them.
-- The runtime role's table-level SELECT/INSERT/UPDATE already covers a new column.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public.vader_signal ADD COLUMN IF NOT EXISTS is_top_pick boolean NOT NULL DEFAULT false;
GRANT SELECT (is_top_pick) ON public.vader_signal TO sd_web_options_reader;
COMMIT;
