/**
 * The list of `npm run <script>` steps that .github/workflows/ci.yml must
 * contain for scripts/launch-check.ts's github_ci_status capability check
 * (checkGithubCiStatus()) to consider CI "wired correctly" -- and the same
 * list scripts/ci-workflow-coverage-regressions.ts regression-tests against
 * the real workflow file.
 *
 * Extracted into its own module, rather than living only inline inside
 * checkGithubCiStatus(), so the two checks share one source of truth
 * instead of hand-duplicated copies that could silently drift apart --
 * exactly the failure mode a "does CI cover every required suite"
 * regression would otherwise be unable to catch (a hand-duplicated list in
 * the regression file could go stale right alongside a real gap in CI and
 * still report green).
 */
export const REQUIRED_CI_SUITES: readonly string[] = [
  "security:test",
  "security:tls-test",
  "security:launch-guard-test",
  "security:rls-test",
  "security:authz-client-test",
  "security:household-test",
  "security:route-inventory-test",
  "security:import-boundary-test",
  "security:authz-http-test",
  "security:storage-rls-test",
  "security:storage-orphans-test",
  "security:db-rate-limit-test",
  "security:csrf-test",
  "security:launch-check-test",
  "security:policy-quarantine-test",
  "security:scan-callback-test",
  "security:storage-cleanup-test",
  "security:household-export-test",
  "security:lifecycle-test",
  "security:lifecycle-query-guard-test",
  "security:active-read-scopes-test",
  "security:policy-deletion-test",
  "security:claim-evidence-deletion-test",
  "security:family-member-deletion-test",
  "security:household-membership-deletion-test",
  "security:invitation-revocation-deletion-test",
  "security:household-deletion-test",
  "security:claim-evidence-deletion-coordinator-test",
  "security:family-member-deletion-coordinator-test",
  "security:household-deletion-coordinator-test",
  "security:household-membership-deletion-coordinator-test",
  "security:invitation-revocation-deletion-coordinator-test",
  "security:placeholder-content-test",
  "security:background-jobs-test",
  "security:telemetry-test",
  "security:model-provenance-test",
  "claims:evidence-provenance-test",
  "claims:evidence-document-type-test",
  "claims:evidence-picker-test",
  "claims:evidence-review-workflow-test",
  "claims:reviewer-authorization-test",
  "claims:decision-identity-test",
  "claims:reviewer-benefit-e2e-test",
  "claims:travel-currency-test",
  "claims:legacy-decision-test",
  "claims:evidence-browser-write-test",
  "claims:evidence-download-test",
  "security:rollout-staleness-test",
  "e2e:full-household-test",
  "security:malware-scanning-virustotal-test",
  "security:pipeline-worker-test",
  "security:worker-runtime-test",
  "security:dead-letter-test",
  "e2e:full-journey-test",
  "security:launch-check-verifier-test",
  "ai:model-execution-staleness-test",
];
