-- Human-assisted live synthetic test: PROGRESS for one run (counts only, scoped to the run).
-- Edit the run identifier on the next line, then run. Reads no document contents.
WITH run AS (SELECT lower('dp-synthetic-YYYYMMDD-HHMM-xxxxxx') AS id),
users AS (SELECT u.id FROM auth.users u, run WHERE lower(u.email) LIKE '%' || run.id || '%'),
households AS (SELECT DISTINCT hm.household_id AS id FROM household_members hm WHERE hm.user_id IN (SELECT id FROM users))
SELECT json_build_object(
  'run_auth_users', (SELECT count(*) FROM users),
  'run_households', (SELECT count(*) FROM households),
  'reviewer_household_memberships', (SELECT count(*) FROM household_members hm JOIN claim_reviewers r ON r.user_id = hm.user_id WHERE r.user_id IN (SELECT id FROM users)),
  'family_members', (SELECT count(*) FROM family_members WHERE account_id IN (SELECT id FROM households)),
  'policies_by_state', (SELECT coalesce(json_object_agg(k, n), '{}'::json) FROM (SELECT quarantine_status || '/' || processing_status AS k, count(*) AS n FROM policies WHERE account_id IN (SELECT id FROM households) GROUP BY 1) s),
  'evidence_by_status', (SELECT coalesce(json_object_agg(status, n), '{}'::json) FROM (SELECT status, count(*) AS n FROM claim_evidence_documents WHERE account_id IN (SELECT id FROM households) GROUP BY 1) s),
  'jobs_open', (SELECT count(*) FROM background_jobs WHERE status IN ('queued', 'processing', 'failed_retryable')),
  'jobs_dead_letter_for_run', (SELECT count(*) FROM background_jobs WHERE status = 'dead_letter' AND account_id IN (SELECT id FROM households)),
  'server_only_failure_diagnostics_for_run', (SELECT count(*) FROM processing_failure_diagnostics WHERE account_id IN (SELECT id FROM households)),
  'active_assignments', (SELECT count(*) FROM claim_review_assignments WHERE status = 'active' AND reviewer_user_id IN (SELECT id FROM users))
) AS progress;
