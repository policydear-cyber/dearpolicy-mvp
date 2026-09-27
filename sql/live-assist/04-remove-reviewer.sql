-- Human-assisted live synthetic test: CLEANUP of the synthetic reviewer's assignments and
-- provisioning. Revokes (with an audit entry), then removes the reviewer row; its assignments
-- go with it (ON DELETE CASCADE). The reviewer audit log is append-only by design and keeps
-- its identifier-only rows. Refuses unless the reviewer's email carries the run identifier.
DO $op$
DECLARE
  run_id text := lower('dp-synthetic-YYYYMMDD-HHMM-xxxxxx');
  reviewer uuid := '00000000-0000-0000-0000-000000000000';
  actor text := 'operator:' || 'dc-live-assist';
  a record;
BEGIN
  IF run_id NOT LIKE 'dp-synthetic-%' OR length(run_id) < 30 THEN RAISE EXCEPTION 'set the run identifier'; END IF;
  IF NOT EXISTS (SELECT 1 FROM claim_reviewers r WHERE r.user_id = reviewer AND lower(r.display_label) LIKE run_id || '%') THEN
    RAISE EXCEPTION 'refused: no synthetic reviewer of this run has that id';
  END IF;
  FOR a IN UPDATE claim_review_assignments SET status = 'revoked', revoked_at = now(), revoked_by = actor, revoke_reason = 'synthetic test cleanup'
           WHERE reviewer_user_id = reviewer AND status = 'active'
           RETURNING id, account_id, claim_session_id, evidence_document_id LOOP
    INSERT INTO claim_reviewer_audit_log(actor, action, reviewer_user_id, assignment_id, account_id, claim_session_id, evidence_document_id, details)
    VALUES (actor, 'assignment_revoked', reviewer, a.id, a.account_id, a.claim_session_id, a.evidence_document_id, jsonb_build_object('reason', 'synthetic test cleanup'));
  END LOOP;
  DELETE FROM claim_reviewers WHERE user_id = reviewer;
END
$op$;
