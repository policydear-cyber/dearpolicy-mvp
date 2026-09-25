/**
 * Pure evaluation logic backing scripts/launch-check.ts's "Storage buckets
 * are private" live check -- split out from the live Supabase Storage API
 * call itself so this logic is unit-testable with fixture data
 * (scripts/launch-check-regressions.ts) without needing a real Supabase
 * project, the same separation scripts/storage-orphans.ts's
 * auditStorage() already uses for its own DB-facing logic.
 *
 * This is the code-level half of the gap sql/storage-rls.sql's own header
 * comment flags: "Both buckets ... MUST be created with 'Public bucket'
 * left OFF ... The idempotent UPDATE at the bottom of this file is a
 * safety net, not a substitute for creating them private in the first
 * place." That UPDATE only runs when storage-rls.sql is actually applied
 * to the live project (still not done, per the PR description's external
 * blockers) -- this check is the launch-readiness signal that catches the
 * bucket being public (or missing entirely) independent of whether that
 * migration has landed yet.
 */

export interface BucketInfo {
  id: string;
  public: boolean;
}

export interface BucketPrivacyProblem {
  bucket: string;
  reason: string;
}

/** Checks that every bucket id in `requiredPrivateBucketIds` exists in
 * `buckets` and is NOT public. Buckets present but not required (e.g. an
 * unrelated bucket the project also happens to have) are ignored --
 * this only asserts about the buckets this app itself depends on. */
export function evaluateBucketPrivacy(buckets: BucketInfo[], requiredPrivateBucketIds: string[]): BucketPrivacyProblem[] {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const problems: BucketPrivacyProblem[] = [];
  for (const id of requiredPrivateBucketIds) {
    const bucket = byId.get(id);
    if (!bucket) {
      problems.push({ bucket: id, reason: "bucket does not exist yet -- must be created (Supabase Storage Management API/dashboard, not SQL) before launch" });
      continue;
    }
    if (bucket.public) {
      problems.push({
        bucket: id,
        reason: "bucket is PUBLIC -- every object would be servable over a predictable, unauthenticated URL regardless of any RLS policy; must be private",
      });
    }
  }
  return problems;
}

/** The bucket ids this app depends on being private, matching
 * lib/storage/supabase.ts's own env-var-with-default resolution and
 * sql/storage-rls.sql's hardcoded policy targets. Kept as a function
 * (not a module-level constant) so it reads process.env fresh at call
 * time, matching how the rest of this codebase's env-driven config
 * behaves (e.g. lib/db/client.ts's devAccountId()). */
export function requiredPrivateBucketIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.SUPABASE_STORAGE_BUCKET?.trim() || "policy-files", env.SUPABASE_CLAIM_EVIDENCE_BUCKET?.trim() || "claim-evidence-files"];
}
