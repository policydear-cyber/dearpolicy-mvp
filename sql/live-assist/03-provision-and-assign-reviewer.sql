-- Human-assisted live synthetic test: OPERATOR provisions the synthetic reviewer and assigns
-- the synthetic claim. Same rows and audit entries as `npm run reviewer:admin -- provision`
-- and `-- assign` (lib/claims/reviewers/admin.ts). Refuses unless everything belongs to this run.
-- Fill in the four values, run once, copy the returned assignment id into the manifest.
DO $op$
DECLARE
  run_id text := lower('dp-synthetic-YYYYMMDD-HHMM-xxxxxx');
  reviewer uuid := '00000000-0000-0000-0000-000000000000';  -- reviewer user id (Authentication -> Users)
  household uuid := '00000000-0000-0000-0000-000000000000'; -- owner A household id
  claim uuid := '00000000-0000-0000-0000-000000000000';     -- claim id (from the claim URL)
  actor text := 'operator:' || 'dc-live-assist';
  member uuid;
  assignment uuid;
  expires timestamptz;
BEGIN
  IF run_id NOT LIKE 'dp-synthetic-%' OR length(run_id) < 30 THEN RAISE EXCEPTION 'set the run identifier'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = reviewer AND lower(email) LIKE '%' || run_id || '%') THEN
    RAISE EXCEPTION 'refused: the reviewer user does not exist or its email lacks the run identifier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM household_members hm JOIN auth.users u ON u.id = hm.user_id
                  WHERE hm.household_id = household AND hm.role = 'owner' AND lower(u.email) LIKE '%' || run_id || '%') THEN
    RAISE EXCEPTION 'refused: the household is not owned by a synthetic user of this run';
  END IF;
  IF EXISTS (SELECT 1 FROM household_members WHERE household_id = household AND user_id = reviewer) THEN
    RAISE EXCEPTION 'refused: the reviewer belongs to this household (self-review)';
  END IF;
  IF EXISTS (SELECT 1 FROM household_members WHERE user_id = reviewer) THEN
    RAISE EXCEPTION 'refused: the reviewer has household membership; reviewers must not belong to any household';
  END IF;
  SELECT cs.family_member_id INTO member FROM claim_sessions cs WHERE cs.id = claim AND cs.account_id = household;
  IF member IS NULL THEN RAISE EXCEPTION 'refused: that claim is not in that household'; END IF;

  INSERT INTO claim_reviewers(user_id, display_label, status, provisioned_by)
  VALUES (reviewer, run_id || '-reviewer', 'active', actor)
  ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO claim_reviewer_audit_log(actor, action, reviewer_user_id, details)
    VALUES (actor, 'reviewer_provisioned', reviewer, jsonb_build_object('displayLabel', run_id || '-reviewer', 'databaseRole', session_user::text));
  END IF;

  INSERT INTO claim_review_assignments(reviewer_user_id, account_id, family_member_id, claim_session_id, evidence_document_id, expires_at, assigned_by)
  VALUES (reviewer, household, member, claim, NULL, now() + make_interval(hours => 2), actor)
  RETURNING id, expires_at INTO assignment, expires;
  INSERT INTO claim_reviewer_audit_log(actor, action, reviewer_user_id, assignment_id, account_id, claim_session_id, evidence_document_id, details)
  VALUES (actor, 'assignment_created', reviewer, assignment, household, claim, NULL, jsonb_build_object('expiresAt', expires::text, 'databaseRole', session_user::text));
  RAISE NOTICE 'assignment id: %, expires: %', assignment, expires;
END
$op$;
-- The notice above carries the assignment id. To see it again:
-- SELECT id, expires_at FROM claim_review_assignments WHERE reviewer_user_id = '<reviewer id>' AND status = 'active';
