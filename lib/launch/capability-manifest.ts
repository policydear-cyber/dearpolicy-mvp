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

/** Verbatim (kebab->snake mapped) ids for the 24 capabilities the launch
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
  | "github_ci_status";

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
];

const REQUIRED_IDS = new Set<CapabilityId>(REQUIRED_CAPABILITIES.map((c) => c.id));

export type CapabilityResult = {
  id: CapabilityId;
  label: string;
  status: CapabilityStatus;
  detail: string;
};

/**
 * Throws if `results` does not contain EXACTLY the 24 required capabilities,
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
