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
import { assertManifestComplete, REQUIRED_CAPABILITIES, summarizeManifest, type CapabilityResult } from "../lib/launch/capability-manifest";

function fixtureResults(overrideStatus?: Partial<Record<string, CapabilityResult["status"]>>): CapabilityResult[] {
  return REQUIRED_CAPABILITIES.map((c) => ({
    id: c.id,
    label: c.label,
    status: overrideStatus?.[c.id] ?? "ready",
    detail: "fixture",
  }));
}

function testCapabilityManifest() {
  // Exactly the 24 required capabilities, each once: must not throw.
  assert.doesNotThrow(() => assertManifestComplete(fixtureResults()), "a complete, non-duplicated manifest must pass");

  // Missing one capability entirely.
  const missingOne = fixtureResults().slice(1);
  assert.throws(() => assertManifestComplete(missingOne), /missing:/, "dropping one required capability must throw and say which one");

  // A duplicated capability (and, as a side effect, one fewer distinct id --
  // still must be reported as "duplicated", not folded into "missing").
  const duplicated = fixtureResults();
  duplicated.push({ ...duplicated[0] });
  assert.throws(() => assertManifestComplete(duplicated), /duplicated:/, "reporting the same capability twice must throw");

  // An unknown capability id that isn't part of the required 24.
  const withUnknown = fixtureResults();
  withUnknown.push({ id: "not_a_real_capability" as CapabilityResult["id"], label: "bogus", status: "ready", detail: "x" });
  assert.throws(() => assertManifestComplete(withUnknown), /unknown id/, "an unrecognized capability id must throw, not be silently accepted");

  // summarizeManifest() counts every status bucket, including zero-count ones.
  const mixed = fixtureResults({
    policy_document_quarantine: "blocked_by_code",
    claim_evidence_quarantine: "blocked_by_code",
    live_rls_verification: "blocked_by_external_configuration",
    production_build: "resource_blocked",
  });
  const summary = summarizeManifest(mixed);
  assert.equal(summary.blocked_by_code, 2);
  assert.equal(summary.blocked_by_external_configuration, 1);
  assert.equal(summary.resource_blocked, 1);
  assert.equal(summary.not_applicable, 0);
  assert.equal(summary.ready, REQUIRED_CAPABILITIES.length - 4);

  // The critical honesty property the whole manifest exists to guarantee:
  // Priorities 4 and 6-10's capabilities reporting blocked_by_code must
  // never be silently reclassified as blocked_by_external_configuration --
  // prove assertManifestComplete() itself has no special-casing that would
  // let that slip through (it shouldn't -- it only checks identity/coverage,
  // not status), by confirming a manifest with every code-incomplete
  // capability marked blocked_by_code still passes structural validation
  // untouched.
  const priorityFourAndSixToTen: CapabilityResult["id"][] = [
    "policy_document_quarantine",
    "claim_evidence_quarantine",
    "malware_scanning_configuration",
    "data_export",
    "data_deletion_and_invalidation",
    "background_job_reliability",
    "dead_letter_retry_support",
    "privacy_safe_observability",
    "redaction_verification",
    "model_prompt_schema_governance",
    "full_household_e2e_journey",
  ];
  const honestlyBlocked = fixtureResults(
    Object.fromEntries(priorityFourAndSixToTen.map((id) => [id, "blocked_by_code"])) as Partial<Record<string, CapabilityResult["status"]>>,
  );
  assert.doesNotThrow(() => assertManifestComplete(honestlyBlocked));
  const honestSummary = summarizeManifest(honestlyBlocked);
  assert.equal(honestSummary.blocked_by_code, priorityFourAndSixToTen.length, "every Priority 4/6-10 capability marked blocked_by_code must be counted as such, not dropped");

  console.log(
    "capability-manifest regressions passed: assertManifestComplete() rejects a missing, duplicated, or unknown capability id and accepts " +
      "exactly the required 24; summarizeManifest() counts every status bucket accurately, including a manifest honestly reporting Priority " +
      "4/6-10 gaps as blocked_by_code.",
  );
}

function main() {
  testCapabilityManifest();

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
