-- The conditions a cover attaches to its own benefits.
--
-- policy_benefits answers "how much". This answers "unless". They are separate
-- tables because they are separate things in the document: a benefit is a row
-- in a schedule, a condition is a paragraph that governs every row under it.
-- Storing a condition on a benefit row would mean copying the same exclusion
-- onto thirty-three dismemberment rows and losing the fact that it is one
-- sentence about one cover.
CREATE TABLE IF NOT EXISTS policy_cover_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  -- The cover this governs, as the document names it. NULL where the document
  -- states the condition once for everything it covers.
  product_name text,
  condition_kind text NOT NULL,
  -- For an exclusion: which cause, from the closed list in
  -- lib/insurance/cover-conditions.ts.
  cause text,
  applies_to_events text[] NOT NULL DEFAULT '{}',
  condition_names text[] NOT NULL DEFAULT '{}',
  days integer,
  amount numeric,
  amount_basis text,
  scope text,
  -- Kept verbatim. Paraphrasing "unless caused solely and directly by an
  -- Accident" is how a correct exclusion becomes a wrong refusal.
  carve_out text,
  source_page integer,
  quote text NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cover_conditions_policy ON policy_cover_conditions(account_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_cover_conditions_kind ON policy_cover_conditions(condition_kind);
-- When this document's conditions were last read. A document that states no
-- conditions has still been read; without this it would ask to be read forever.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS conditions_indexed_at timestamptz;
