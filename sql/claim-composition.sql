-- Claim-composition engine: immutable audit snapshot of one deterministic
-- composeClaim() result (lib/claims/composition/engine.ts). A snapshot row
-- is never UPDATEd or DELETEd by application code -- a new calculation
-- (whenever any MATERIAL input changes: facts, coverage/policy versions,
-- evidence, composition rules, raw calculations, deductions, caps,
-- included/excluded decisions, final per-currency totals) gets its own
-- row, distinguished by its own calculation_id, which composeClaim()
-- computes as a stable SHA-256 hash over exactly those material inputs
-- (see engine.ts's own doc comment on calculationId). A presentation-only
-- change (e.g. a policy's display label) does not change calculation_id
-- and therefore never creates a new row for what is actually the same
-- underlying calculation.
CREATE TABLE IF NOT EXISTS claim_composition_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  calculation_id text NOT NULL,
  engine_version text NOT NULL,
  -- The exact ClaimFacts this calculation was computed from (input fact
  -- versions) and the exact policy/coverage effective/expiry windows in
  -- play (policy/coverage versions) -- both required by the audit spec on
  -- top of the full result itself, so a later dispute over "what did
  -- DearPolicy know at the time" never has to be reconstructed from chat
  -- history.
  facts_snapshot jsonb NOT NULL,
  coverage_versions jsonb NOT NULL,
  -- The full ClaimCompositionResult: per-policy sections, alternative
  -- groups, per-currency totals, excluded benefits with reason codes,
  -- outstanding questions and the disclaimer text shown to the user.
  result jsonb NOT NULL,
  calculated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Idempotent by design: composeClaim() is deterministic, so re-running it
-- against the same material inputs on a later chat turn reproduces the
-- SAME calculation_id for the same claim session -- inserting it again is
-- a safe no-op (see lib/claims/composition/store.ts's ON CONFLICT DO
-- NOTHING), never a duplicate audit row for what is actually the same
-- calculation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_composition_snapshots_dedupe
  ON claim_composition_snapshots(account_id, claim_session_id, calculation_id);
CREATE INDEX IF NOT EXISTS idx_claim_composition_snapshots_claim
  ON claim_composition_snapshots(account_id, claim_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_composition_snapshots_member
  ON claim_composition_snapshots(account_id, family_member_id);
