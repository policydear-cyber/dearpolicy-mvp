-- DearPolicy Coverage Ledger.
-- One row per (person, plan, event, how it pays). This is the table an
-- insurance agent keeps in their head, written down: it is what every payout
-- answer is looked up from, and what the person confirms once so that answers
-- are right every time after. Additive and repeatable; deletes nothing.
CREATE TABLE IF NOT EXISTS coverage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES policies(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  insurer text,
  event_type text NOT NULL,
  detail text,
  cause text,
  pays_kind text NOT NULL DEFAULT 'stated',
  amount numeric,
  currency text NOT NULL DEFAULT 'SGD',
  sum_basis numeric,
  offset_days integer,
  maximum_days integer,
  conditions text[] NOT NULL DEFAULT '{}',
  note text,
  source_page integer,
  quote text,
  origin text NOT NULL DEFAULT 'wording',
  inferred boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'proposed',
  seed_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coverage_rules ADD COLUMN IF NOT EXISTS cause text;
-- A numeric threshold the event must reach ("delayed at least 6 hours").
ALTER TABLE coverage_rules ADD COLUMN IF NOT EXISTS minimum_fact text;
ALTER TABLE coverage_rules ADD COLUMN IF NOT EXISTS minimum_value numeric;
-- When the model last read this document into the ledger. NULL means never.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS ledger_read_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_coverage_rules_member ON coverage_rules(account_id, family_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_rules_seed ON coverage_rules(account_id, seed_key) WHERE seed_key IS NOT NULL;
