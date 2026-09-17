-- DearPolicy benefit catalogue.
-- A policy is a contract with fixed rules, so its benefits are extracted once
-- when a document is processed and stored here. Every later question is a
-- lookup plus arithmetic in application code: instant, identical every time,
-- and correctable by the user. Additive and repeatable; deletes nothing.
CREATE TABLE IF NOT EXISTS policy_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  product_name text,
  benefit_name text NOT NULL,
  traits text[] NOT NULL DEFAULT '{}',
  formula_kind text NOT NULL DEFAULT 'none',
  formula_value numeric,
  currency text,
  fact_key text,
  offset_days integer,
  maximum_days integer,
  source_page integer,
  quote text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- A rule a person corrected after reading their own policy. Human review
-- outranks extraction, so a reviewed row survives re-indexing.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- True when the payout rule came from a heading above the row rather than from
-- the row itself. Weaker evidence, so it is shown to a person before it is ever
-- turned into money.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS basis_inferred boolean NOT NULL DEFAULT false;
-- Traits an event MUST have for this benefit to respond at all. An
-- accident-only benefit must never be offered for dengue.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS requires text[] NOT NULL DEFAULT '{}';
-- When this document's benefit rules were last read. A document that yields no
-- rules has still been read; without this it would ask to be read forever.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS benefits_indexed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_policy_benefits_policy ON policy_benefits(account_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_benefits_traits ON policy_benefits USING gin(traits);
