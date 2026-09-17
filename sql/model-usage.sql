-- One row per model call, hosted or local, so a household's cost is a sum,
-- not a guess. Additive and idempotent.
CREATE TABLE IF NOT EXISTS model_usage (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  priced boolean NOT NULL DEFAULT true,
  duration_ms integer,
  ok boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_model_usage_month ON model_usage(account_id, at);
