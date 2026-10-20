SET ROLE sd_web_options_owner;

CREATE TABLE public.collector_schema (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.vader_contract (
    contract_key text PRIMARY KEY,
    symbol text NOT NULL,
    expiration date NOT NULL,
    strike numeric(16, 3) NOT NULL CHECK (strike > 0),
    option_right text NOT NULL DEFAULT 'P' CHECK (option_right = 'P'),
    occ_symbol text NOT NULL UNIQUE CHECK (length(occ_symbol) = 21),
    first_seen date NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (symbol, expiration, strike, option_right)
);
CREATE INDEX vader_contract_expiration ON public.vader_contract (expiration);

CREATE TABLE public.vader_signal (
    source_id text PRIMARY KEY,
    contract_key text NOT NULL REFERENCES public.vader_contract,
    report_date date NOT NULL,
    tier text,
    advertised_premium_per_contract numeric(20, 8),
    advertised_delta numeric(16, 10),
    entry_mark_per_share numeric(20, 8),
    entry_delta numeric(16, 10),
    entry_iv_fraction numeric(20, 10),
    source_current boolean NOT NULL DEFAULT true,
    source_payload jsonb NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX vader_signal_contract ON public.vader_signal (contract_key, report_date);

CREATE TABLE public.vader_signal_revision (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id text NOT NULL REFERENCES public.vader_signal,
    prior_payload jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.option_collection_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_date date NOT NULL,
    capture_kind text NOT NULL CHECK (capture_kind IN ('open_session', 'close', 'recovery')),
    scheduled_at timestamptz NOT NULL,
    deadline timestamptz NOT NULL CHECK (deadline >= scheduled_at),
    started_at timestamptz,
    finished_at timestamptz,
    related_missed_slots bigint[] NOT NULL DEFAULT '{}',
    discovery_status text NOT NULL DEFAULT 'pending',
    discovery_error text,
    expected_count integer NOT NULL DEFAULT 0,
    price_count integer NOT NULL DEFAULT 0,
    delta_count integer NOT NULL DEFAULT 0,
    iv_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'complete', 'partial', 'failed', 'missed', 'no_work')),
    UNIQUE (session_date, capture_kind, scheduled_at)
);

CREATE TABLE public.option_quote (
    run_id bigint NOT NULL REFERENCES public.option_collection_run,
    contract_key text NOT NULL REFERENCES public.vader_contract,
    bid_per_share numeric(20, 8) CHECK (bid_per_share >= 0),
    ask_per_share numeric(20, 8) CHECK (ask_per_share >= 0),
    mark_per_share numeric(20, 8) CHECK (mark_per_share >= 0),
    mid_per_share numeric(20, 8) CHECK (mid_per_share >= 0),
    last_per_share numeric(20, 8) CHECK (last_per_share >= 0),
    underlying_price numeric(20, 8) CHECK (underlying_price >= 0),
    provider_quote_time timestamptz,
    price_received_at timestamptz,
    price_status text NOT NULL DEFAULT 'missing' CHECK (price_status IN ('missing', 'ok', 'invalid', 'late')),
    price_error text,
    price_flags text[] NOT NULL DEFAULT '{}',
    delta numeric(16, 10) CHECK (delta BETWEEN -1 AND 0),
    delta_event_time timestamptz,
    delta_received_at timestamptz,
    delta_status text NOT NULL DEFAULT 'missing' CHECK (delta_status IN ('missing', 'ok')),
    delta_error text,
    delta_flags text[] NOT NULL DEFAULT '{}',
    implied_volatility_fraction numeric(20, 10) CHECK (implied_volatility_fraction >= 0),
    iv_event_time timestamptz,
    iv_received_at timestamptz,
    iv_status text NOT NULL DEFAULT 'missing' CHECK (iv_status IN ('missing', 'ok')),
    iv_error text,
    iv_flags text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, contract_key),
    CHECK (bid_per_share IS NULL OR ask_per_share IS NULL OR bid_per_share <= ask_per_share
           OR 'crossed' = ANY(price_flags))
);
CREATE INDEX option_quote_contract ON public.option_quote (contract_key, run_id);

CREATE TABLE public.option_quote_diagnostic (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES public.option_collection_run,
    contract_key text NOT NULL REFERENCES public.vader_contract,
    component text NOT NULL,
    received_at timestamptz NOT NULL,
    reason text NOT NULL
);

CREATE TABLE public.collector_health (
    id integer PRIMARY KEY CHECK (id = 1),
    heartbeat_at timestamptz NOT NULL,
    last_error text,
    last_alert_key text
);

GRANT USAGE ON SCHEMA public TO sd_web_options_runtime;
GRANT SELECT, INSERT, UPDATE ON public.vader_contract, public.vader_signal,
    public.option_collection_run, public.option_quote, public.collector_health
    TO sd_web_options_runtime;
GRANT SELECT, INSERT ON public.option_quote_diagnostic, public.vader_signal_revision TO sd_web_options_runtime;
GRANT SELECT ON public.collector_schema TO sd_web_options_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sd_web_options_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, sd_web_options_runtime;

INSERT INTO public.collector_schema (version) VALUES (1);
RESET ROLE;
