/**
 * The machine-readable launch-capability manifest.
 *
 * This is the single source of truth for "what must be true before this
 * app can safely serve real households" -- scripts/launch-check.ts builds
 * one CapabilityResult per entry below and nothing else; assertManifestComplete()
 * throws if a capability is missing, duplicated, or unknown, so a forgotten
 * wiring is a hard failure of the check itself rather than a silent gap in
 * the report.
 *
 * Every capability's status must be one of:
 *
 *   ready                          -- verified safe/present by an executable
 *                                      check, run against this environment
 *   blocked_by_code                -- the required behavior does not exist
 *                                      yet (or exists but does not meet the
 *                                      stated requirement); only a code
 *                                      change can fix this, and it is NEVER
 *                                      converted into blocked_by_external_configuration
 *                                      just because the gap is inconvenient
 *                                      to report
 *   blocked_by_external_configuration -- the code is correct and complete;
 *                                      this environment simply lacks a
 *                                      secret, live database, or other
 *                                      operator-supplied value to verify
 *                                      against
 *   not_applicable                 -- does not apply in this deployment
 *                                      shape (reserved; unused today -- every
 *                                      capability below applies to this app)
 *   resource_blocked                -- the check is real and would run, but
 *                                      this sandbox does not have the
 *                                      CPU/RAM/time to complete it (e.g. a
 *                                      full `next build`). This is
 *                                      explicitly NOT the same as "ready" or
 *                                      "blocked_by_code": the check was
 *                                      never actually completed, so it must
 *                                      never be reported as having passed.
 *
 * Until Priorities 4 and 6-10 (see the PR description) are implemented, the
 * capabilities they cover MUST report blocked_by_code here. Converting a
 * missing-code gap into blocked_by_external_configuration to make the
 * summary line look better is exactly the failure mode this manifest exists
 * to prevent.
 */

export type CapabilityStatus =
  | "ready"
  | "blocked_by_code"
  | "blocked_by_external_configuration"
  | "not_applicable"
  | "resource_blocked";

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "ready",
  "blocked_by_code",
  "blocked_by_external_configuration",
  "not_applicable",
  "resource_blocked",
];

/**
 * Checkpoint 14h (claude/v1-launch-hardening): what KIND of evidence a
 * capability's status is based on. Added alongside the other structured-
 * evidence fields below specifically so a verifier can no longer report a
 * status without also saying HOW it knows -- "hardcoded" is a legitimate,
 * honest value for a verifier that genuinely has no dynamic check yet, but
 * it must never be the value actually used once a capability's real
 * production wiring exists and can be inspected or executed. Before this
 * checkpoint, background_job_reliability, dead_letter_retry_support,
 * privacy_safe_observability, redaction_verification,
 * model_prompt_schema_governance and full_household_e2e_journey were all,
 * in effect, "hardcoded": a single static report() call with a fixed
 * string, regardless of the real state of the code they described. This
 * type exists so that regression is now something a test can assert
 * against directly (see scripts/launch-check-verifier-regressions.ts).
 */
export type CapabilityCheckType =
  | "static-grep"    // source-text inspection of real files (existsSync/readFileSync + regex), not a whole-file guess
  | "runtime-probe"   // a real script/regression-suite/child-process is spawned and its actual exit code/output is read
  | "env-check"       // a real guard function is evaluated against a simulated/real production environment
  | "live-query"      // a real network/DB/API call is made against a live external system
  | "build-probe"     // a real production build is attempted
  | "ci-api-check"    // a real call to an external CI provider's API
  | "hardcoded";      // no dynamic check exists yet for this capability -- must not be used once one does

/** Verbatim (kebab->snake mapped) ids for the capabilities the launch
 * gate is required to cover, at minimum, per the launch-hardening spec. */
export type CapabilityId =
  | "authentication"
  | "household_authorization"
  | "route_classification"
  | "rls_migration_present"
  | "live_rls_verification"
  | "private_storage_migration_present"
  | "live_bucket_privacy"
  | "policy_document_quarantine"
  | "claim_evidence_quarantine"
  | "malware_scanning_configuration"
  | "shared_rate_limiter"
  | "csrf_protection"
  | "secure_database_tls"
  | "data_export"
  | "data_deletion_and_invalidation"
  | "background_job_reliability"
  | "dead_letter_retry_support"
  | "privacy_safe_observability"
  | "redaction_verification"
  | "model_prompt_schema_governance"
  | "full_household_e2e_journey"
  | "evaluation_thresholds"
  | "production_build"
  | "github_ci_status"
  | "infrastructure_table_protection"
  | "policy_state_protection";

export type CapabilityDefinition = { id: CapabilityId; label: string };

/** Order matches the launch-hardening spec's own list. */
export const REQUIRED_CAPABILITIES: readonly CapabilityDefinition[] = [
  { id: "authentication", label: "Authentication" },
  { id: "household_authorization", label: "Household authorization" },
  { id: "route_classification", label: "Route classification" },
  { id: "rls_migration_present", label: "RLS migration present" },
  { id: "live_rls_verification", label: "Live RLS verification" },
  { id: "private_storage_migration_present", label: "Private storage migration present" },
  { id: "live_bucket_privacy", label: "Live bucket privacy" },
  { id: "policy_document_quarantine", label: "Policy-document quarantine" },
  { id: "claim_evidence_quarantine", label: "Claim-evidence quarantine" },
  { id: "malware_scanning_configuration", label: "Malware-scanning configuration" },
  { id: "shared_rate_limiter", label: "Shared rate limiter" },
  { id: "csrf_protection", label: "CSRF protection" },
  { id: "secure_database_tls", label: "Secure database TLS" },
  { id: "data_export", label: "Data export" },
  { id: "data_deletion_and_invalidation", label: "Data deletion and invalidation" },
  { id: "background_job_reliability", label: "Background job reliability" },
  { id: "dead_letter_retry_support", label: "Dead-letter/retry support" },
  { id: "privacy_safe_observability", label: "Privacy-safe observability" },
  { id: "redaction_verification", label: "Redaction verification" },
  { id: "model_prompt_schema_governance", label: "Model/prompt/schema governance" },
  { id: "full_household_e2e_journey", label: "Full household E2E journey" },
  { id: "evaluation_thresholds", label: "Evaluation thresholds" },
  { id: "production_build", label: "Production build" },
  { id: "github_ci_status", label: "GitHub CI status/manual verification state" },
  { id: "infrastructure_table_protection", label: "Infrastructure-table protection" },
  { id: "policy_state_protection", label: "Policy-processing and coverage-verification state protection" },
];

const REQUIRED_IDS = new Set<CapabilityId>(REQUIRED_CAPABILITIES.map((c) => c.id));

/**
 * Checkpoint 14h: the full structured-evidence shape every CapabilityResult
 * must carry, per the launch-hardening spec's own requirement ("Each
 * capability verifier must report structured evidence: Capability ID,
 * Status, Check type, Command or runtime probe, Evidence summary, Blocking
 * reason, Remediation, Last verified timestamp or build identity where
 * appropriate"). `detail` is kept as the primary human-readable narrative
 * (every existing verifier's prose already lives there and is NOT
 * duplicated); the fields below are the machine-checkable structured
 * complement scripts/launch-check.ts's report() now always populates,
 * either explicitly per call site or via its per-capability CHECK_TYPES/
 * PROBES/REMEDIATIONS lookup tables -- see that file's own comment on
 * report() for why a lookup table rather than 65 duplicated call-site
 * literals is the correct place for a property (which KIND of check this
 * is, what command/probe it runs, what fixes it) that is a property of the
 * CAPABILITY, not of which branch a particular run happened to take.
 */
export type CapabilityResult = {
  id: CapabilityId;
  label: string;
  status: CapabilityStatus;
  detail: string;
  /** What kind of evidence backs `status` -- never "hardcoded" once a real
   * dynamic check exists for this capability (see CapabilityCheckType). */
  checkType: CapabilityCheckType;
  /** The actual command, function call, or runtime probe this result is
   * based on -- specific enough that a reader could re-run it themselves. */
  probe: string;
  /** A short, structured summary of what was actually found -- distinct
   * from `detail`'s full narrative prose. */
  evidenceSummary: string;
  /** Present exactly when `status` is not "ready" (or "not_applicable"):
   * why this capability is blocked, independent of the full `detail` text. */
  blockingReason?: string;
  /** Present exactly when `status` is not "ready" (or "not_applicable"):
   * the concrete next step that would move this capability toward ready. */
  remediation?: string;
  /** ISO timestamp of when THIS check actually ran, or a build/commit
   * identity when that is the more meaningful "as of" marker (e.g. a
   * checked-in last-known-good result file's own recorded timestamp). */
  lastVerified: string;
};

/**
 * Throws if `results` does not contain EXACTLY the required capabilities,
 * each exactly once. This is what makes "a forgotten wiring" a hard failure
 * of launch:check itself (it throws and the script exits non-zero) instead
 * of a silently-missing line in the printed report -- the specific bug class
 * that made "zero blocked by code" misleading before this manifest existed.
 */
export function assertManifestComplete(results: CapabilityResult[]): void {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);

  const missing = REQUIRED_CAPABILITIES.filter((c) => !counts.has(c.id));
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const unknown = results.filter((r) => !REQUIRED_IDS.has(r.id)).map((r) => r.id);

  if (missing.length > 0 || duplicated.length > 0 || unknown.length > 0) {
    const problems: string[] = [];
    if (missing.length > 0) problems.push(`missing: ${missing.map((c) => c.id).join(", ")}`);
    if (duplicated.length > 0) problems.push(`duplicated: ${duplicated.join(", ")}`);
    if (unknown.length > 0) problems.push(`unknown id(s) not in the required list: ${unknown.join(", ")}`);
    throw new Error(
      `Launch capability manifest is incomplete -- this is a bug in launch-check.ts itself, not a ` +
        `launch-readiness finding: ${problems.join("; ")}.`,
    );
  }
}

export type ManifestSummary = Record<CapabilityStatus, number>;

export function summarizeManifest(results: CapabilityResult[]): ManifestSummary {
  const summary: ManifestSummary = {
    ready: 0,
    blocked_by_code: 0,
    blocked_by_external_configuration: 0,
    not_applicable: 0,
    resource_blocked: 0,
  };
  for (const r of results) summary[r.status] += 1;
  return summary;
}
