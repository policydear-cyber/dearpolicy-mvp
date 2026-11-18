-- Plans (DC approved 18 Nov 2026: Free, Plus, Family; lib/plans/catalogue.ts).
--
-- household_plans: one row per household that is on a paid or complimentary plan, or has a Stripe customer. A household
-- with no row (or a row whose status keeps no plan) is on Free.
-- household_question_counts: questions each household has asked Ask DearPolicy in a calendar month (UTC). Counted here,
-- not from chat_messages, because deleting chats must never give a household its questions back (Critic, 18 Nov).
-- Additive only: two new tables, nothing existing is changed or dropped.
--
-- Written only by the server (the Stripe webhook, lib/billing/stripe.ts, through the trusted connection). Browser sessions
-- get no privilege on it at all, so a household can never give itself a plan: accounts would not do, because
-- accounts_update lets an owner update any column of their own row.
--
-- Code deployed before this file is applied keeps working: every household reads as Free, and the limits stay off
-- until DEARPOLICY_PLAN_LIMITS=on (lib/billing/household-plan.ts).
--
-- A complimentary plan (for example the owner's own household, or a tester) is one row with status 'complimentary':
--   INSERT INTO household_plans(account_id, plan, status) VALUES ('<household id>', 'family', 'complimentary')
--   ON CONFLICT (account_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, updated_at = now();
--
-- Rollback: DROP TABLE IF EXISTS household_question_counts; DROP TABLE IF EXISTS household_plans;
CREATE TABLE IF NOT EXISTS household_plans (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('free', 'plus', 'family')),
  -- Stripe's subscription status, or 'complimentary' for a plan given without payment.
  status text NOT NULL,
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  -- The Stripe event this row was last written from, so an older event that arrives late never overwrites a newer one.
  stripe_event_created timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS household_plans_stripe_customer ON household_plans(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE household_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON household_plans FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON household_plans FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON household_plans FROM authenticated'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS household_question_counts (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month date NOT NULL,
  questions integer NOT NULL DEFAULT 0 CHECK (questions >= 0),
  PRIMARY KEY (account_id, month)
);
ALTER TABLE household_question_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON household_question_counts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON household_question_counts FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON household_question_counts FROM authenticated'; END IF;
END $$;
