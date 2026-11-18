-- One owner per household (DC, 18 Nov 2026).
--
-- A household has exactly one owner. The owner alone uploads, deletes,
-- re-reads and links documents, manages people, changes settings, invites,
-- removes, exports and deletes. Members view and use Ask, and can leave.
-- Ownership moves only by transfer (lib/household/repo.ts transferOwnership).
--
-- Apply this file, then re-run sql/household-rls.sql (which makes browser
-- writes to documents, people, benefits and claims owner-only). Both are
-- idempotent. The app enforces the same rules on the server whether or not
-- these have been applied.
--
-- Production on 18 Nov 2026 (read-only check before writing this): 2
-- households, each with exactly one owner and no other members, and no
-- pending owner invitations. Step 1 below therefore changes nothing there.

-- 1. Existing households with more than one owner keep the EARLIEST owner
--    (by created_at, then user_id) and the others become members. Each
--    change is listed as a NOTICE, so nothing is demoted silently.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT household_id, user_id
    FROM (
      SELECT household_id, user_id,
             row_number() OVER (PARTITION BY household_id ORDER BY created_at, user_id) AS n
      FROM household_members
      WHERE role = 'owner'
    ) ranked
    WHERE n > 1
  LOOP
    RAISE NOTICE 'household % : owner % becomes a member (the earliest owner stays owner)', r.household_id, r.user_id;
    UPDATE household_members SET role = 'member' WHERE household_id = r.household_id AND user_id = r.user_id;
  END LOOP;

  -- A household with members but no owner is listed, not changed: who
  -- should own it is the household's decision.
  FOR r IN
    SELECT household_id FROM household_members GROUP BY household_id
    HAVING count(*) FILTER (WHERE role = 'owner') = 0
  LOOP
    RAISE NOTICE 'household % has no owner; left unchanged', r.household_id;
  END LOOP;
END $$;

-- 2. At most one owner per household. Deferred to commit so a transfer
--    (promote the new owner, then demote the old one, in one transaction)
--    passes. A btree exclusion constraint needs no extension.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_members_one_owner') THEN
    ALTER TABLE household_members
      ADD CONSTRAINT household_members_one_owner
      EXCLUDE USING btree (household_id WITH =) WHERE (role = 'owner')
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- 3. An invitation only ever adds a member. Pending invitations stored as
--    "owner" become "member" (the accept route already adds every invitee
--    as a member); accepted and revoked ones are history and stay as they
--    were.
UPDATE household_invitations SET role = 'member'
WHERE role = 'owner' AND accepted_at IS NULL AND revoked_at IS NULL;
