/**
 * Regression suite for lib/launch/storage-guards.ts's evaluateBucketPrivacy()
 * -- the pure logic backing scripts/launch-check.ts's "Storage buckets are
 * private" live check. Unit-level (fixture data, not a live Supabase
 * project) by design: the live HTTP call itself (client.storage.listBuckets())
 * has nothing new to prove beyond "the Supabase SDK works", while this
 * function's own branching (missing bucket vs public bucket vs both fine)
 * is exactly the part worth a real regression test, matching the same
 * split scripts/storage-orphans-regressions.ts already uses for
 * auditStorage()'s DB-facing logic vs its pure comparison logic.
 */
import assert from "node:assert/strict";
import { evaluateBucketPrivacy, requiredPrivateBucketIds } from "../lib/launch/storage-guards";

function main() {
  const required = ["policy-files", "claim-evidence-files"];

  // Both required buckets exist and are private: no problems.
  const clean = evaluateBucketPrivacy(
    [
      { id: "policy-files", public: false },
      { id: "claim-evidence-files", public: false },
      { id: "some-other-bucket", public: true }, // unrelated bucket -- must be ignored entirely
    ],
    required,
  );
  assert.deepEqual(clean, [], "two private required buckets plus an unrelated public bucket must report zero problems");

  // One bucket is public.
  const onePublic = evaluateBucketPrivacy(
    [
      { id: "policy-files", public: true },
      { id: "claim-evidence-files", public: false },
    ],
    required,
  );
  assert.equal(onePublic.length, 1, "exactly one problem for exactly one public required bucket");
  assert.equal(onePublic[0].bucket, "policy-files");
  assert.match(onePublic[0].reason, /PUBLIC/, "the reason must say the bucket is public, not something generic");

  // Both buckets are public.
  const bothPublic = evaluateBucketPrivacy(
    [
      { id: "policy-files", public: true },
      { id: "claim-evidence-files", public: true },
    ],
    required,
  );
  assert.equal(bothPublic.length, 2, "both public buckets must each be reported");

  // A required bucket doesn't exist at all yet.
  const missing = evaluateBucketPrivacy([{ id: "claim-evidence-files", public: false }], required);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].bucket, "policy-files");
  assert.match(missing[0].reason, /does not exist/, "a missing bucket's reason must say so, distinct from a public-bucket problem");

  // Neither bucket exists.
  const noneExist = evaluateBucketPrivacy([], required);
  assert.equal(noneExist.length, 2, "with zero buckets present, both required buckets must be reported missing");

  // requiredPrivateBucketIds() reads env vars with the documented defaults.
  const defaults = requiredPrivateBucketIds({});
  assert.deepEqual(defaults, ["policy-files", "claim-evidence-files"], "with no env vars set, the documented defaults must be used");

  const customEnv = requiredPrivateBucketIds({ SUPABASE_STORAGE_BUCKET: "my-policies", SUPABASE_CLAIM_EVIDENCE_BUCKET: "my-evidence" } as NodeJS.ProcessEnv);
  assert.deepEqual(customEnv, ["my-policies", "my-evidence"], "a configured env var must override the default bucket id");

  console.log(
    "launch-check regressions passed: evaluateBucketPrivacy() correctly reports zero problems for private buckets, flags public buckets by name, " +
      "flags missing buckets distinctly from public ones, ignores unrelated buckets, and requiredPrivateBucketIds() respects env overrides and defaults.",
  );
}

main();
