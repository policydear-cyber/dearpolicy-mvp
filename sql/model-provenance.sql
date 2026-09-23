-- Checkpoint 10 (claude/v1-launch-hardening): model execution provenance.
--
-- One row per model-call ATTEMPT (a primary attempt and any fallback
-- attempt are separate rows, sharing attempt_group_id, ordered by
-- attempt_index) -- append-only and immutable. Nothing in this codebase
-- ever UPDATEs a row here; a correction is a new row whose
-- supersedes_execution_id points at the row it corrects, so the original
-- (possibly wrong) record is never silently rewritten. Additive and
-- idempotent, same convention as sql/model-usage.sql and
-- sql/background-jobs.sql: run through the whole file every time inside an
-- advisory-locked transaction (see lib/ai/provenance.ts's
-- ensureProvenanceSchema()), never a tracked migration list.
--
-- Two levels of identity per row, per the checkpoint's own requirement that
-- "a family alias is not an execution identity":
--   requested_*  -- what the CALLER asked for (may legitimately be a family
--                   alias like "flash" or "haiku" that a provider resolves
--                   to a specific dated model server-side).
--   resolved_*   -- what the PROVIDER'S OWN RESPONSE reported for this
--                   exact call. NULL when the provider's response did not
--                   carry one (never backfilled from requested_model).
-- `verified` is computed once at insert time (see lib/ai/provenance.ts's
-- computeVerified()) and is true only when status='succeeded' AND
-- resolved_model is a real, non-empty value the provider returned. Any
-- downstream code that gates a monetary result on model-derived evidence
-- must check verified, never merely that a row exists.
CREATE TABLE IF NOT EXISTS model_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  attempt_group_id uuid NOT NULL,
  attempt_index integer NOT NULL DEFAULT 0,

  -- What this call was FOR: a stable operation id (e.g.
  -- "claim_evidence_extraction", "policy_coverage_extraction",
  -- "chat_reply") -- never freeform, see lib/ai/provenance.ts's
  -- KNOWN_OPERATIONS. household_ref/resource_ref are pseudonymized via
  -- lib/telemetry/pseudonymize.ts's pseudonymizeId(), the same keyed-HMAC
  -- scheme Checkpoint 9 uses, never a raw id.
  operation text NOT NULL,
  role text NOT NULL,
  household_ref text,
  resource_ref text,

  -- Requested identity.
  requested_provider text NOT NULL,
  requested_model text NOT NULL,
  requested_capability text NOT NULL,
  requested_rollout text,
  prompt_version text,
  schema_version text,
  input_artifact_type text,
  input_artifact_version text,
  requested_at timestamptz NOT NULL,

  -- Resolved identity -- from the provider's own response, or NULL.
  resolved_provider text NOT NULL,
  resolved_model text,
  provider_request_id text,
  region text,
  finish_reason text,
  resolved_at timestamptz,

  -- Outcome and cost/latency, same shape as model_usage but scoped to one
  -- attempt of one governed operation rather than a billing rollup.
  status text NOT NULL,
  error_category text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6),
  latency_ms integer,

  verified boolean NOT NULL DEFAULT false,
  supersedes_execution_id uuid REFERENCES model_executions(id),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT model_executions_status_check CHECK (status IN ('succeeded','failed')),
  CONSTRAINT model_executions_attempt_index_check CHECK (attempt_index >= 0)
);

CREATE INDEX IF NOT EXISTS idx_model_executions_attempt_group ON model_executions(attempt_group_id, attempt_index);
CREATE INDEX IF NOT EXISTS idx_model_executions_correlation ON model_executions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_model_executions_operation_time ON model_executions(operation, created_at);
CREATE INDEX IF NOT EXISTS idx_model_executions_resource ON model_executions(resource_ref) WHERE resource_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_model_executions_unverified ON model_executions(operation, created_at) WHERE NOT verified;
