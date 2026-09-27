-- Human-assisted live synthetic test: ZERO-RESIDUE check (counts only). Every value must be 0.
-- Run after cleanup. Fill in the run identifier and the ids from the manifest.
WITH run AS (SELECT lower('dp-synthetic-YYYYMMDD-HHMM-xxxxxx') AS id),
ids AS (SELECT ARRAY[
  '00000000-0000-0000-0000-000000000000',  -- owner A user id
  '00000000-0000-0000-0000-000000000000',  -- owner B user id
  '00000000-0000-0000-0000-000000000000'   -- reviewer user id
]::uuid[] AS users, ARRAY[
  '00000000-0000-0000-0000-000000000000',  -- owner A household id
  '00000000-0000-0000-0000-000000000000'   -- owner B household id
]::uuid[] AS households)
SELECT json_build_object(
  'auth_users', (SELECT count(*) FROM auth.users u, run, ids WHERE u.id = ANY(ids.users) OR lower(u.email) LIKE '%' || run.id || '%'),
  'auth_sessions', (SELECT count(*) FROM auth.sessions s, ids WHERE s.user_id = ANY(ids.users)),
  'households', (SELECT count(*) FROM accounts a, ids WHERE a.id = ANY(ids.households)),
  'memberships', (SELECT count(*) FROM household_members hm, ids WHERE hm.user_id = ANY(ids.users) OR hm.household_id = ANY(ids.households)),
  'family_members', (SELECT count(*) FROM family_members f, ids WHERE f.account_id = ANY(ids.households)),
  'policies', (SELECT count(*) FROM policies p, ids WHERE p.account_id = ANY(ids.households)),
  'claims', (SELECT count(*) FROM claim_sessions c, ids WHERE c.account_id = ANY(ids.households)),
  'evidence', (SELECT count(*) FROM claim_evidence_documents e, ids WHERE e.account_id = ANY(ids.households)),
  'exports', (SELECT count(*) FROM household_exports x, ids WHERE x.household_id = ANY(ids.households)),
  'jobs_open', (SELECT count(*) FROM background_jobs j, ids WHERE j.account_id = ANY(ids.households) AND j.status IN ('queued', 'processing', 'failed_retryable')),
  'reviewers', (SELECT count(*) FROM claim_reviewers r, ids WHERE r.user_id = ANY(ids.users)),
  'assignments', (SELECT count(*) FROM claim_review_assignments ra, ids WHERE ra.reviewer_user_id = ANY(ids.users)),
  'storage_objects', (SELECT count(*) FROM storage.objects o, ids WHERE EXISTS (SELECT 1 FROM unnest(ids.households) h WHERE o.name LIKE h::text || '/%' OR o.name LIKE '%/' || h::text || '/%'))
) AS residue;
