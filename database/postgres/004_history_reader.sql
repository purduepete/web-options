-- Execute as administrator only after independent review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
CREATE ROLE sd_web_options_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
    NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
ALTER ROLE sd_web_options_reader SET default_transaction_read_only = on;
ALTER ROLE sd_web_options_reader SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE web_options TO sd_web_options_reader;
GRANT USAGE ON SCHEMA public TO sd_web_options_reader;
GRANT SELECT (contract_key, symbol, expiration, strike, occ_symbol, first_seen)
    ON public.vader_contract TO sd_web_options_reader;
GRANT SELECT (contract_key, symbol, expiration, strike)
    ON public.broker_contract TO sd_web_options_reader;
GRANT SELECT (source_kind, source_id, contract_key, original_contract_key, report_date)
    ON public.option_owner TO sd_web_options_reader;
GRANT SELECT (run_id, contract_key, source_kind, source_id)
    ON public.option_capture_owner TO sd_web_options_reader;
GRANT SELECT (id, session_date, capture_kind, scheduled_at, deadline,
    started_at, finished_at, discovery_status, status)
    ON public.option_collection_run TO sd_web_options_reader;
GRANT SELECT ON public.broker_option_quote, public.option_quote
    TO sd_web_options_reader;
COMMIT;
