-- Apply separately using the migrator, after independent review. Never at worker startup.
-- Renames the settle capture kind from closing_1315 to settle (#16). Rerunnable.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE sd_web_options_owner;
ALTER TABLE public.option_collection_run DROP CONSTRAINT IF EXISTS option_collection_run_capture_kind_check;
UPDATE public.option_collection_run SET capture_kind = 'settle' WHERE capture_kind = 'closing_1315';
ALTER TABLE public.option_collection_run ADD CONSTRAINT option_collection_run_capture_kind_check
    CHECK (capture_kind IN ('open_session','close','recovery','settle'));
COMMIT;
