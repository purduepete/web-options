-- Apply separately using the migrator, after independent review. Never at worker startup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE sd_web_options_owner;

CREATE TABLE IF NOT EXISTS public.broker_contract (
    contract_key text PRIMARY KEY CHECK (length(contract_key) = 21),
    symbol text NOT NULL,
    expiration date NOT NULL,
    strike numeric(16,3) NOT NULL CHECK (strike > 0),
    synced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.option_owner (
    source_kind text NOT NULL CHECK (source_kind IN ('signal','vader_contract','portfolio')),
    source_id text NOT NULL,
    contract_key text NOT NULL REFERENCES public.broker_contract,
    original_contract_key text NOT NULL,
    authenticated_user_id bigint,
    account_id bigint,
    is_paper boolean,
    report_date date,
    source_current boolean NOT NULL DEFAULT true,
    source_payload jsonb NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS public.broker_option_quote (
    LIKE public.option_quote INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES,
    FOREIGN KEY (run_id) REFERENCES public.option_collection_run,
    FOREIGN KEY (contract_key) REFERENCES public.broker_contract
);
ALTER TABLE public.broker_option_quote ADD COLUMN IF NOT EXISTS provider_summary_date date;
ALTER TABLE public.broker_option_quote ADD COLUMN IF NOT EXISTS provider_prev_close_date date;
ALTER TABLE public.broker_option_quote ADD COLUMN IF NOT EXISTS provider_last_trade_time timestamptz;
CREATE TABLE IF NOT EXISTS public.option_capture_owner (
    run_id bigint NOT NULL,
    contract_key text NOT NULL,
    source_kind text NOT NULL,
    source_id text NOT NULL,
    owner_payload jsonb NOT NULL,
    PRIMARY KEY (run_id,contract_key,source_kind,source_id),
    FOREIGN KEY (run_id,contract_key) REFERENCES public.broker_option_quote
);
CREATE TABLE IF NOT EXISTS public.broker_quote_diagnostic (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id bigint NOT NULL,
    contract_key text NOT NULL,
    component text NOT NULL,
    received_at timestamptz NOT NULL,
    reason text NOT NULL,
    FOREIGN KEY (run_id,contract_key) REFERENCES public.broker_option_quote
);
CREATE TABLE IF NOT EXISTS public.azure_option_observation (
    run_id bigint NOT NULL REFERENCES public.option_collection_run,
    dataset text NOT NULL,
    source_key text NOT NULL,
    observed_at timestamptz NOT NULL,
    source_payload jsonb NOT NULL,
    PRIMARY KEY (run_id,dataset,source_key)
);
ALTER TABLE public.option_collection_run DROP CONSTRAINT IF EXISTS option_collection_run_capture_kind_check;
ALTER TABLE public.option_collection_run ADD CONSTRAINT option_collection_run_capture_kind_check
    CHECK (capture_kind IN ('open_session','close','recovery','closing_1315')) NOT VALID;

GRANT SELECT,INSERT ON public.broker_contract TO sd_web_options_runtime;
REVOKE UPDATE ON public.broker_contract FROM sd_web_options_runtime;
GRANT UPDATE (synced_at) ON public.broker_contract TO sd_web_options_runtime;
GRANT SELECT,INSERT,UPDATE ON public.option_owner,public.broker_option_quote
    TO sd_web_options_runtime;
GRANT SELECT,INSERT ON public.option_capture_owner,public.broker_quote_diagnostic TO sd_web_options_runtime;
GRANT SELECT,INSERT ON public.azure_option_observation TO sd_web_options_runtime;
GRANT USAGE,SELECT ON SEQUENCE public.broker_quote_diagnostic_id_seq TO sd_web_options_runtime;
INSERT INTO public.collector_schema(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;

-- Existing rows are scanned outside the short exclusive-lock transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE sd_web_options_owner;
ALTER TABLE public.option_collection_run VALIDATE CONSTRAINT option_collection_run_capture_kind_check;
COMMIT;
