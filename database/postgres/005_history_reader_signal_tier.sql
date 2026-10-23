-- Execute as postgres only after independent review (the tables belong to sd_web_options_owner).
-- Lets the Contract History page show each contract's VADER tier and first signal date.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
GRANT SELECT (contract_key, report_date, tier)
    ON public.vader_signal TO sd_web_options_reader;
COMMIT;
