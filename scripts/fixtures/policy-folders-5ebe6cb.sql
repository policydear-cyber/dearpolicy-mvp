-- Policy folders: the household groups the documents of one policy (its schedule or certificate, its wording, its riders
-- and anything else) into one folder, says who the policy is for, and confirms when every document is in it. Built from
-- DC's design (11 Nov 2026, "Create a policy"; 18 Nov 2026, "one folder includes all the documents pertaining to that
-- policy, and if they need to add documents, they can").
--
-- The household decides the grouping. Nothing here is guessed: a printed policy number may suggest a grouping on the
-- Documents page, but no folder is made until the household says yes. One document may sit in two folders (a couple who
-- share one policy wording each have their own folder with their own schedule). A folder never merges people: chat takes
-- a "% of the sum assured" base from another document of the same folder only where that document is the person's own.
--
-- Additive only: three new tables, nothing existing is changed or dropped. Requires sql/schema.sql, sql/lifecycle.sql and
-- sql/household-rls.sql (is_household_member). Code deployed before this file is applied keeps working without it: every
-- reader checks to_regclass('public.policy_folders') first, and the Documents page shows no folders until it exists.
-- Rollback: DROP TABLE policy_folder_documents, policy_folder_people, policy_folders; DROP FUNCTION policy_folder_same_household();
--
-- Browser roles may only read their own household's rows. Every write goes through the server (app/api/policies/folders),
-- which allows it to the household's owner only and checks every document and person belongs to the household; the
-- trigger below refuses a row naming another household's folder, document or person even so.
CREATE TABLE IF NOT EXISTS policy_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The household's own name for it; null shows a name made from its documents.
  name text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 120),
  -- The household answered yes to "Are these all the documents for this policy?". Adding or removing a document asks again.
  complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_folders_account ON policy_folders(account_id);

CREATE TABLE IF NOT EXISTS policy_folder_people (
  folder_id uuid NOT NULL,
  account_id uuid NOT NULL,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, family_member_id),
  FOREIGN KEY (folder_id, account_id) REFERENCES policy_folders(id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_policy_folder_people_account ON policy_folder_people(account_id);

CREATE TABLE IF NOT EXISTS policy_folder_documents (
  folder_id uuid NOT NULL,
  account_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  -- What the household said the document is, from the slot it was added in. A guide only: the reading decides what the
  -- document is, and this is never used as evidence.
  slot text CHECK (slot IS NULL OR slot IN ('schedule', 'wording', 'rider', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, policy_id),
  FOREIGN KEY (folder_id, account_id) REFERENCES policy_folders(id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_policy_folder_documents_account ON policy_folder_documents(account_id);
CREATE INDEX IF NOT EXISTS idx_policy_folder_documents_policy ON policy_folder_documents(policy_id);

-- A folder's document and person must be its own household's.
CREATE OR REPLACE FUNCTION policy_folder_same_household() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'policy_folder_documents' THEN
    IF NOT EXISTS (SELECT 1 FROM public.policies p WHERE p.id = NEW.policy_id AND p.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'policy folder document belongs to another household' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.family_members f WHERE f.id = NEW.family_member_id AND f.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'policy folder person belongs to another household' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS policy_folder_documents_same_household ON policy_folder_documents;
CREATE TRIGGER policy_folder_documents_same_household BEFORE INSERT OR UPDATE ON policy_folder_documents
  FOR EACH ROW EXECUTE FUNCTION policy_folder_same_household();
DROP TRIGGER IF EXISTS policy_folder_people_same_household ON policy_folder_people;
CREATE TRIGGER policy_folder_people_same_household BEFORE INSERT OR UPDATE ON policy_folder_people
  FOR EACH ROW EXECUTE FUNCTION policy_folder_same_household();

-- Read by every member of the household; no browser writes.
ALTER TABLE public.policy_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_folder_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_folder_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.policy_folders;
DROP POLICY IF EXISTS household_member_select ON public.policy_folder_people;
DROP POLICY IF EXISTS household_member_select ON public.policy_folder_documents;
CREATE POLICY household_member_select ON public.policy_folders FOR SELECT TO authenticated USING (is_household_member(account_id));
CREATE POLICY household_member_select ON public.policy_folder_people FOR SELECT TO authenticated USING (is_household_member(account_id));
CREATE POLICY household_member_select ON public.policy_folder_documents FOR SELECT TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.policy_folders, public.policy_folder_people, public.policy_folder_documents FROM anon, authenticated;
GRANT SELECT ON public.policy_folders, public.policy_folder_people, public.policy_folder_documents TO authenticated;
