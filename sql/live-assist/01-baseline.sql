-- Human-assisted live synthetic test: BASELINE (count-only; reads no row contents).
-- Run in the Supabase SQL editor before step 1. Save the returned JSON row in the manifest.
SELECT json_build_object(
  'captured_at', now(),
  'accounts', (SELECT count(*) FROM accounts),
  'household_members', (SELECT count(*) FROM household_members),
  'family_members', (SELECT count(*) FROM family_members),
  'policies', (SELECT count(*) FROM policies),
  'claim_sessions', (SELECT count(*) FROM claim_sessions),
  'claim_evidence_documents', (SELECT count(*) FROM claim_evidence_documents),
  'household_exports', (SELECT count(*) FROM household_exports),
  'claim_reviewers', (SELECT count(*) FROM claim_reviewers),
  'claim_review_assignments_active', (SELECT count(*) FROM claim_review_assignments WHERE status = 'active'),
  'auth_users', (SELECT count(*) FROM auth.users),
  'background_jobs_open', (SELECT count(*) FROM background_jobs WHERE status IN ('queued', 'processing', 'failed_retryable')),
  'background_jobs_dead_letter', (SELECT count(*) FROM background_jobs WHERE status = 'dead_letter'),
  'storage_objects', (SELECT count(*) FROM storage.objects)
) AS baseline;
