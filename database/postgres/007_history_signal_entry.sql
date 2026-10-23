-- Execute as administrator only after independent review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
CREATE VIEW public.history_signal_entry WITH (security_barrier = true) AS
SELECT v.contract_key, g.report_date, g.entry_mark_per_share, g.entry_delta,
       (NULLIF(g.source_payload->>'entry_captured_at', '')::timestamp AT TIME ZONE 'UTC') AS captured_at
FROM public.vader_signal g
JOIN public.vader_contract v ON v.contract_key = g.contract_key;
ALTER VIEW public.history_signal_entry OWNER TO sd_web_options_owner;
REVOKE ALL ON public.history_signal_entry FROM PUBLIC;
GRANT SELECT ON public.history_signal_entry TO sd_web_options_reader;
COMMIT;
