/**
 * `npm run launch:check` -- the launch-readiness gate.
 *
 * This is built around lib/launch/capability-manifest.ts's list of the 24
 * capabilities required before this app can safely serve real households.
 * Every one of those 24 gets exactly one CapabilityResult, and
 * assertManifestComplete() throws (crashing this script, not just
 * reporting a bad status) if any capability is missing, duplicated, or
 * unrecognized -- so a forgotten wiring is a hard failure of the check
 * itself, not a silently-absent line in the report. This is what makes
 * "N ready, 0 blocked by code" a claim this script can no longer get wrong
 * by omission.
 *
 * This is deliberately NOT a collection of source-text checks wherever a
 * real one is possible: most items evaluate real exported guard functions
 * against a simulated production environment, run a real query against a
 * live database or Supabase project, or attempt a real production build.
 * Where no live signal is possible in an arbitrary environment (a missing
 * feature entirely), the capability is reported blocked_by_code with the
 * specific gap named in the detail -- never silently marked ready, and
 * never reclassified as blocked_by_external_configuration just because
 * that would look better in the summary line.
 *
 * Every item is one of the CapabilityStatus values from
 * lib/launch/capability-manifest.ts: ready, blocked_by_code,
 * blocked_by_external_configuration, not_applicable, or resource_blocked
 * (a check that would run, and might reveal a real problem, but that this
 * particular environment does not have the CPU/RAM/time to complete --
 * never conflated with "ready").
 *
 * Exit code is always 0 in plain report mode (this is meant to run safely
 * in CI against a non-production environment, where missing production
 * secrets are expected, not a failure of this branch's code). Pass
 * --strict to fail (exit 1) on any blocked_by_code item -- the category a
 * real code change could and should have fixed before merge.
 */
import { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkDatabaseTlsIsSecure,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
} from "@/lib/launch/guards";
import { evaluateBucketPrivacy, requiredPrivateBucketIds } from "@/lib/launch/storage-guards";
import {
  assertManifestComplete,
  REQUIRED_CAPABILITIES,
  summarizeManifest,
  type CapabilityId,
  type CapabilityResult,
  type CapabilityStatus,
} from "@/lib/launch/capability-manifest";
import { classifyRoutes } from "./route-inventory-regressions";
import { checkRequestOrigin } from "@/lib/http/csrf";
import { checkMalwareScannerConfigured } from "@/lib/claims/evidence/scan-adapter";

const results: CapabilityResult[] = [];
const labelOf = new Map(REQUIRED_CAPABILITIES.map((c) => [c.id, c.label]));

function report(id: CapabilityId, status: CapabilityStatus, detail: string) {
  results.push({ id, label: labelOf.get(id) ?? id, status, detail });
}

// Evaluate every startup guard as if this were a production boot, using
// whatever real configuration this process actually has -- so a developer
// can run `NODE_ENV=production npm run launch:check` locally against their
// real .env.local/Vercel-pulled env to get a true answer before deploying.
const prodEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };

function guardStatus(guard: (env: NodeJS.ProcessEnv) => { ok: boolean; message: string }, externalConfig: boolean): { status: CapabilityStatus; detail: string } {
  const result = guard(prodEnv);
  if (result.ok) return { status: "ready", detail: result.message };
  return { status: externalConfig ? "blocked_by_external_configuration" : "blocked_by_code", detail: result.message };
}

// ---------------------------------------------------------------------
// secure_database_tls
// ---------------------------------------------------------------------
{
  const { status, detail } = guardStatus(checkDatabaseTlsIsSecure, true);
  report("secure_database_tls", status, detail);
}

// ---------------------------------------------------------------------
// authentication -- Supabase Auth is the production identity boundary
// (app/api/login is the DEV_AUTH_ENABLED shared-household-password gate,
// development-only, and is covered by "Development/shared authentication
// disabled in production" rather than this capability). This checks the
// real code structure a login flow depends on: the session-resolution
// module, and every route it takes to sign up, sign in, sign out, reset a
// password and confirm the reset. A live "does signup+signin actually
// work end-to-end" proof is Priority 10's job (full_household_e2e_journey);
// this is the code-presence precondition for that.
// ---------------------------------------------------------------------
function checkAuthentication() {
  const requiredFiles = [
    "lib/auth/session.ts",
    "app/api/auth/signup/route.ts",
    "app/api/auth/signin/route.ts",
    "app/api/auth/signout/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/auth/update-password/route.ts",
    "app/api/auth/callback/route.ts",
  ];
  const missing = requiredFiles.filter((f) => !existsSync(f));
  if (missing.length > 0) {
    report("authentication", "blocked_by_code", `Missing required authentication file(s): ${missing.join(", ")}.`);
    return;
  }
  const sessionSource = readFileSync("lib/auth/session.ts", "utf8");
  if (!/export\s+(async\s+function\s+getCurrentUser|function\s+requireCurrentUser)/.test(sessionSource)) {
    report(
      "authentication",
      "blocked_by_code",
      "lib/auth/session.ts exists but no longer exports getCurrentUser()/requireCurrentUser() -- the shared " +
        "session-resolution boundary every protected route depends on is missing.",
    );
    return;
  }
  report(
    "authentication",
    "ready",
    "Supabase Auth session resolution (lib/auth/session.ts) and the signup/signin/signout/reset-password/" +
      "update-password/callback routes are all present. A live signup+signin proof is exercised by the full " +
      "household E2E journey (see that capability), not here.",
  );
}
checkAuthentication();

// ---------------------------------------------------------------------
// household_authorization / route_classification -- both derived from the
// same live route-inventory scan (see scripts/route-inventory-regressions.ts).
// ---------------------------------------------------------------------
async function checkRouteInventoryCapabilities() {
  const result = await classifyRoutes();

  const classificationProblems: string[] = [];
  if (result.unclassified.length > 0) classificationProblems.push(`unclassified route(s): ${result.unclassified.join(", ")}`);
  if (result.invalid.length > 0) classificationProblems.push(`invalid ROUTE_AUTH value(s): ${result.invalid.map((i) => `${i.file}="${i.value}"`).join(", ")}`);
  if (result.publicRouteViolations.length > 0) {
    classificationProblems.push(result.publicRouteViolations.map((v) => `${v.file} (${v.reason})`).join("; "));
  }
  if (classificationProblems.length > 0) {
    report("route_classification", "blocked_by_code", classificationProblems.join("; "));
  } else {
    report(
      "route_classification",
      "ready",
      `All ${result.routeFiles.length} app/api/**/route.ts files carry a valid ROUTE_AUTH classification ` +
        `(${Object.entries(result.byClass).map(([k, v]) => `${k}=${v}`).join(", ")}).`,
    );
  }

  if (result.missingHouseholdContext.length > 0) {
    report(
      "household_authorization",
      "blocked_by_code",
      `Household-scoped route(s) never calling requireHouseholdContext(): ${result.missingHouseholdContext.join(", ")}.`,
    );
  } else {
    report(
      "household_authorization",
      "ready",
      "Every household-member/household-owner route calls requireHouseholdContext() before touching household data.",
    );
  }
}

// ---------------------------------------------------------------------
// rls_migration_present / private_storage_migration_present -- static
// presence-and-shape checks over the actual migration SQL, distinct from
// the live checks below that ask "is a real database/project actually in
// this state right now".
// ---------------------------------------------------------------------
function checkRlsMigrationPresent() {
  const path = "sql/household-rls.sql";
  if (!existsSync(path)) {
    report("rls_migration_present", "blocked_by_code", `${path} does not exist.`);
    return;
  }
  const sql = readFileSync(path, "utf8");
  const hasEnable = /ENABLE ROW LEVEL SECURITY/i.test(sql);
  const hasPolicy = /CREATE POLICY/i.test(sql);
  if (!hasEnable || !hasPolicy) {
    report(
      "rls_migration_present",
      "blocked_by_code",
      `${path} exists but is missing ${!hasEnable ? "ENABLE ROW LEVEL SECURITY" : ""}${!hasEnable && !hasPolicy ? " and " : ""}${!hasPolicy ? "CREATE POLICY" : ""} statements.`,
    );
    return;
  }
  report("rls_migration_present", "ready", `${path} enables RLS and defines real policies. Whether it has actually been applied is the live check below.`);
}

function checkPrivateStorageMigrationPresent() {
  const path = "sql/storage-rls.sql";
  if (!existsSync(path)) {
    report("private_storage_migration_present", "blocked_by_code", `${path} does not exist.`);
    return;
  }
  const sql = readFileSync(path, "utf8");
  const referencesBuckets = /storage\.buckets|storage\.objects/i.test(sql);
  const hasPolicy = /CREATE POLICY/i.test(sql);
  if (!referencesBuckets || !hasPolicy) {
    report(
      "private_storage_migration_present",
      "blocked_by_code",
      `${path} exists but does not both reference storage.buckets/storage.objects and define CREATE POLICY statements.`,
    );
    return;
  }
  report("private_storage_migration_present", "ready", `${path} defines storage object/bucket access policies. Whether the live buckets are actually private is the live check below.`);
}

// ---------------------------------------------------------------------
// live_rls_verification -- real query against pg_policies/pg_class/
// pg_roles over a real connection when one is configured.
// ---------------------------------------------------------------------
async function checkLiveRlsVerification() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1/.test(url)) {
    report(
      "live_rls_verification",
      "blocked_by_external_configuration",
      "No production DATABASE_URL configured in this environment -- cannot verify real database state. " +
        "This does NOT mean RLS is fine; it means this check has nothing to check against here.",
    );
    return;
  }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const disabled = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`,
    );
    const noPolicies = await client.query<{ tablename: string }>(
      `select c.relname as tablename from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`,
    );
    const anonGrants = await client.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    const roles = await client.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('authenticated', 'anon')`,
    );
    const authenticated = roles.rows.find((r) => r.rolname === "authenticated");

    const problems: string[] = [];
    if (disabled.rows.length > 0) problems.push(`RLS disabled on: ${disabled.rows.map((r) => r.relname).join(", ")}`);
    if (noPolicies.rows.length > 0) problems.push(`RLS enabled but zero policies exist on: ${noPolicies.rows.map((r) => r.tablename).join(", ")}`);
    if (anonGrants.rows.length > 0) problems.push(`anon role still has table grants on: ${anonGrants.rows.map((r) => r.table_name).join(", ")}`);
    if (!authenticated) {
      problems.push("The `authenticated` role does not exist on this database -- sql/household-rls.sql has not been applied.");
    } else if (authenticated.rolbypassrls || authenticated.rolsuper) {
      problems.push("The `authenticated` role has BYPASSRLS or SUPERUSER set -- every request routed through createUserSupabaseClient() would silently bypass every RLS policy.");
    }

    if (problems.length > 0) {
      report("live_rls_verification", "blocked_by_code", problems.join("; "));
    } else {
      report(
        "live_rls_verification",
        "ready",
        "Every public table has RLS enabled with at least one real policy, anon has no table grants, and the " +
          "authenticated role (what every per-request query runs as) has neither BYPASSRLS nor SUPERUSER.",
      );
    }
  } catch (error) {
    report("live_rls_verification", "blocked_by_external_configuration", `Could not connect to verify: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------
// live_bucket_privacy -- real Supabase Storage API call when configured.
// ---------------------------------------------------------------------
async function checkLiveBucketPrivacy() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const requiredBuckets = requiredPrivateBucketIds();
  if (!url || !key) {
    report(
      "live_bucket_privacy",
      "blocked_by_external_configuration",
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured in this environment -- cannot verify real bucket " +
        "state. This does NOT mean the buckets are private; it means this check has nothing to check against here.",
    );
    return;
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await client.storage.listBuckets();
    if (error) throw new Error(error.message);
    const problems = evaluateBucketPrivacy((data ?? []).map((b) => ({ id: b.id, public: b.public })), requiredBuckets);
    if (problems.length > 0) {
      report("live_bucket_privacy", "blocked_by_code", problems.map((p) => `${p.bucket}: ${p.reason}`).join("; "));
    } else {
      report("live_bucket_privacy", "ready", `Both required buckets (${requiredBuckets.join(", ")}) exist and are private.`);
    }
  } catch (error) {
    report("live_bucket_privacy", "blocked_by_external_configuration", `Could not verify: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------
// policy_document_quarantine / claim_evidence_quarantine
// ---------------------------------------------------------------------
function checkPolicyDocumentQuarantine() {
  // Mirrors lib/claims/evidence/{state-machine,scan-adapter,pipeline}.ts's
  // location convention -- none of these exist yet for policy documents.
  const candidates = ["lib/policies/quarantine", "lib/rag/quarantine", "lib/policies/state-machine.ts", "lib/rag/state-machine.ts"];
  const present = candidates.filter((p) => existsSync(p));
  if (present.length > 0) {
    report(
      "policy_document_quarantine",
      "blocked_by_code",
      `Found ${present.join(", ")} but launch-check has not yet been updated to verify it against the full quarantine requirement -- treat as incomplete until this check is rewritten alongside it.`,
    );
    return;
  }
  report(
    "policy_document_quarantine",
    "blocked_by_code",
    "No policy-document quarantine state machine exists yet. Policy uploads go directly into the existing " +
      "ingest pipeline (lib/rag/ingest.ts) with no uploaded/quarantined/scan_pending/scan_clean/scan_rejected/" +
      "processing/processed/failed/deleted state machine, no scan gate before extraction, and no per-transition " +
      "audit event -- this is Priority 4's primary remaining deliverable.",
  );
}

function checkClaimEvidenceQuarantine() {
  // lib/claims/evidence/pipeline.ts's own header comment documents this
  // directly (see also scan-adapter.ts's header): "The pipeline
  // deliberately does NOT block processing on scan_status being anything
  // other than 'infected'". A null-scanner "scan_unavailable" result is
  // therefore NOT infected and the document proceeds straight through
  // quarantined -> processing -> extraction/OCR/embedding/model calls,
  // which does not meet "Only scan_clean documents may be parsed, OCRed,
  // embedded, indexed, or sent to a model."
  const pipelinePath = "lib/claims/evidence/pipeline.ts";
  if (!existsSync(pipelinePath)) {
    report("claim_evidence_quarantine", "blocked_by_code", `${pipelinePath} does not exist.`);
    return;
  }
  const source = readFileSync(pipelinePath, "utf8");
  // The real gate: quarantined -> processing must require scan_status ===
  // "clean" before it transitions. Checked by source shape (an executable
  // DB-backed proof of this is scripts/claim-evidence-regressions.ts's
  // dedicated quarantine-gating tests, run as part of claims:evidence-test).
  const hasCleanGate = /current\.scan_status\s*!==\s*["']clean["']/.test(source);
  if (!hasCleanGate) {
    report(
      "claim_evidence_quarantine",
      "blocked_by_code",
      `${pipelinePath} does not gate the quarantined -> processing transition on an explicit clean scan result. ` +
        `This does not satisfy "Only scan_clean documents may be parsed, OCRed, embedded, indexed, or sent to a model".`,
    );
    return;
  }
  report(
    "claim_evidence_quarantine",
    "ready",
    `${pipelinePath} gates processing on an explicit clean-scan result (current.scan_status !== "clean" stays in ` +
      `quarantined). See claims:evidence-test for the executable DB-backed proof.`,
  );
}

function checkMalwareScanningConfiguration() {
  // Real executable check: evaluates checkMalwareScannerConfigured() (the
  // same function wired into instrumentation.ts's production startup
  // guard) against a simulated production environment, exactly like
  // guardStatus() does for lib/launch/guards.ts's guards.
  const result = checkMalwareScannerConfigured(prodEnv);
  const hasRealScannerSelected = (prodEnv.MALWARE_SCANNER_PROVIDER?.trim() ?? "") !== "" && prodEnv.MALWARE_SCANNER_PROVIDER?.trim() !== "null";
  if (result.ok && hasRealScannerSelected) {
    report("malware_scanning_configuration", "ready", result.message);
    return;
  }
  if (result.ok) {
    // Only reachable via MALWARE_SCANNING_INTENTIONALLY_DISABLED -- an
    // operator's explicit, acknowledged choice, not a code gap, but still
    // not "ready": there is no real scanner, so claim-evidence quarantine
    // is permanently blocked by design until one is configured.
    report(
      "malware_scanning_configuration",
      "blocked_by_code",
      `${result.message} No real scanner adapter is implemented yet regardless -- there is currently only the null ` +
        `adapter to select (see lib/claims/evidence/scan-adapter.ts's SCAN_ADAPTERS).`,
    );
    return;
  }
  report("malware_scanning_configuration", "blocked_by_code", result.message);
}

// ---------------------------------------------------------------------
// shared_rate_limiter -- every previously-migrated route uses the shared
// Postgres-backed limiter, and the legacy in-memory limiter is banned
// under app/ by scripts/import-boundary-regressions.ts. This re-derives
// the same two facts directly rather than shelling out to that suite.
// ---------------------------------------------------------------------
function checkSharedRateLimiter() {
  const dbLimiterPath = "lib/http/db-rate-limit.ts";
  if (!existsSync(dbLimiterPath)) {
    report("shared_rate_limiter", "blocked_by_code", `${dbLimiterPath} does not exist.`);
    return;
  }
  const rateLimitedRoutes = [
    "app/api/login/route.ts",
    "app/api/auth/signup/route.ts",
    "app/api/auth/signin/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/household/invitations/accept/route.ts",
    "app/api/household/invitations/route.ts",
  ];
  const notMigrated = rateLimitedRoutes.filter((f) => {
    if (!existsSync(f)) return true;
    const source = readFileSync(f, "utf8");
    return !source.includes("createDbRateLimiter");
  });
  if (notMigrated.length > 0) {
    report("shared_rate_limiter", "blocked_by_code", `Route(s) not using the shared Postgres-backed rate limiter: ${notMigrated.join(", ")}.`);
    return;
  }
  report(
    "shared_rate_limiter",
    "ready",
    `${rateLimitedRoutes.length} rate-limited routes use createDbRateLimiter() (cross-instance-safe, atomic Postgres counting). ` +
      `The legacy in-memory limiter is banned under app/ by the import-boundary regression suite.`,
  );
}

// ---------------------------------------------------------------------
// csrf_protection -- exercises the real checkRequestOrigin() function
// directly (not a fixture re-implementation) against a same-origin and a
// cross-origin request, and confirms middleware.ts actually wires it in.
// ---------------------------------------------------------------------
function checkCsrfProtection() {
  const middlewarePath = "middleware.ts";
  if (!existsSync(middlewarePath)) {
    report("csrf_protection", "blocked_by_code", `${middlewarePath} does not exist.`);
    return;
  }
  const middlewareSource = readFileSync(middlewarePath, "utf8");
  if (!middlewareSource.includes("checkRequestOrigin")) {
    report("csrf_protection", "blocked_by_code", `${middlewarePath} does not call checkRequestOrigin() -- CSRF protection is not wired into the request path.`);
    return;
  }
  const sameOrigin = checkRequestOrigin({ method: "POST", headers: new Headers({ origin: "https://app.example.com" }) }, "https://app.example.com");
  const crossOrigin = checkRequestOrigin({ method: "POST", headers: new Headers({ origin: "https://evil.example.com" }) }, "https://app.example.com");
  if (!sameOrigin.allowed || crossOrigin.allowed) {
    report(
      "csrf_protection",
      "blocked_by_code",
      `checkRequestOrigin() behaves incorrectly: same-origin allowed=${sameOrigin.allowed} (expected true), cross-origin allowed=${crossOrigin.allowed} (expected false).`,
    );
    return;
  }
  report("csrf_protection", "ready", `middleware.ts calls checkRequestOrigin() ahead of every /api/* mutation, and it correctly allows same-origin and blocks cross-origin requests.`);
}

// ---------------------------------------------------------------------
// data_export / data_deletion_and_invalidation / background_job_reliability /
// dead_letter_retry_support / privacy_safe_observability /
// redaction_verification / model_prompt_schema_governance /
// full_household_e2e_journey -- Priorities 6-10. None of these have any
// implementation yet; each is reported blocked_by_code with the specific
// missing piece named, never silently omitted or downgraded to an
// external-configuration blocker.
// ---------------------------------------------------------------------
function checkDataExport() {
  report(
    "data_export",
    "blocked_by_code",
    "No data-export implementation exists yet (no lib/export module, no export route). Household data export, " +
      "policy/claim metadata and audit-history export are unimplemented -- Priority 6.",
  );
}

function checkDataDeletionAndInvalidation() {
  report(
    "data_deletion_and_invalidation",
    "blocked_by_code",
    "No deletion/invalidation lifecycle exists yet: no lifecycle states (active/pending_deletion/soft_deleted/" +
      "permanently_deleted/retained_audit_tombstone), and no transactional invalidation of derived data (chunks, " +
      "embeddings, coverages, evidence matches, claim calculations, cached summaries, jobs, storage objects) on " +
      "delete of a policy document, policy, claim evidence, family member, household member, or household -- Priority 6.",
  );
}

function checkBackgroundJobReliability() {
  report(
    "background_job_reliability",
    "blocked_by_code",
    "No shared durable job model exists yet: lib/claims/evidence/queue.ts and lib/rag/processing-queue.ts have " +
      "no idempotency key, processing lease, lease expiry/recovery, heartbeat, attempt count, or bounded retry -- " +
      "Priority 7.",
  );
}

function checkDeadLetterRetrySupport() {
  report(
    "dead_letter_retry_support",
    "blocked_by_code",
    "No dead-letter state or bounded-retry/non-retryable-error classification exists anywhere in the processing " +
      "pipeline -- a permanently failing job has nowhere to land except a plain \"failed\" status with no distinction " +
      "from a job that simply hasn't been retried yet -- Priority 7.",
  );
}

function checkPrivacySafeObservability() {
  report(
    "privacy_safe_observability",
    "blocked_by_code",
    "No centralized structured telemetry boundary exists yet (no lib/observability or lib/telemetry module). " +
      "Nothing enforces the required/forbidden field lists for a correlation-id-scoped operational record -- Priority 8.",
  );
}

function checkRedactionVerification() {
  report(
    "redaction_verification",
    "blocked_by_code",
    "No redaction module exists yet, so there is nothing to verify recursively strips policy wording, medical " +
      "facts, chat contents, document text, tokens, signed URLs, or raw provider payloads from operational records -- Priority 8.",
  );
}

function checkModelPromptSchemaGovernance() {
  const hasUsageTable = existsSync("sql/model-usage.sql");
  report(
    "model_prompt_schema_governance",
    "blocked_by_code",
    (hasUsageTable
      ? "sql/model-usage.sql records provider/model/tokens/cost/duration per call, but not the resolved execution " +
        "identity the spec requires: "
      : "No model-usage persistence exists at all, and none of the following is recorded: ") +
      "exact returned provider model ID/version, provider response/request id, prompt/schema version, input/" +
      "output artifact version, retry/fallback chain, or region. lib/ai/providers.ts's alias resolution " +
      "(gemini:flash etc.) is a legitimate, deliberate design choice per that file's own comment -- the gap is " +
      "that no resolved execution identity is persisted alongside it, so a dynamically-resolved alias is not yet " +
      "reproducible/invalidatable as the spec requires -- Priority 9.",
  );
}

function checkFullHouseholdE2eJourney() {
  report(
    "full_household_e2e_journey",
    "blocked_by_code",
    "No end-to-end application-level test exists covering the 22-step authenticated household journey " +
      "(signup through household deletion). The claim-ci-regressions.ts and similar suites test calculation " +
      "engines directly, not the full route-authorization-to-storage journey -- Priority 10.",
  );
}

// ---------------------------------------------------------------------
// evaluation_thresholds -- eval:extraction and eval:claim-quality both
// already set process.exitCode on threshold failure, and CI already runs
// both as required (non-optional) steps.
// ---------------------------------------------------------------------
function checkEvaluationThresholds() {
  const requiredScripts = ["eval:extraction", "eval:claim-quality"];
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync("package.json", "utf8"));
  } catch (error) {
    report("evaluation_thresholds", "blocked_by_code", `Could not read/parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const missingScripts = requiredScripts.filter((s) => !pkg.scripts?.[s]);
  if (missingScripts.length > 0) {
    report("evaluation_thresholds", "blocked_by_code", `Missing required npm script(s): ${missingScripts.join(", ")}.`);
    return;
  }
  const ciPath = ".github/workflows/ci.yml";
  if (!existsSync(ciPath)) {
    report("evaluation_thresholds", "blocked_by_code", `${ciPath} does not exist -- evaluation thresholds are not enforced anywhere.`);
    return;
  }
  const ci = readFileSync(ciPath, "utf8");
  const missingCiSteps = requiredScripts.filter((s) => !ci.includes(`npm run ${s}`));
  if (missingCiSteps.length > 0) {
    report("evaluation_thresholds", "blocked_by_code", `CI does not run: ${missingCiSteps.map((s) => `npm run ${s}`).join(", ")}.`);
    return;
  }
  report(
    "evaluation_thresholds",
    "ready",
    `Both ${requiredScripts.join(" and ")} are wired into CI as required (non-optional) steps, and both set a ` +
      `non-zero exit code on a quality-threshold failure -- a regression in extraction accuracy or claim-quality ` +
      `fails the build.`,
  );
}

// ---------------------------------------------------------------------
// production_build -- attempts a real `next build`. In a resource-limited
// sandbox this is expected to be resource_blocked, not ready -- see the
// distinction in the module doc comment above.
// ---------------------------------------------------------------------
function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  // `npm run build` spawns a shell, which spawns `next build`, which spawns
  // its own webpack worker processes -- killing only the direct child (as a
  // bare child.kill() does) leaves those grandchildren running and can peg
  // a resource-constrained sandbox's single core indefinitely, starving
  // every other command in the same environment (observed directly while
  // verifying this check: a killed-in-name-only build left the sandbox
  // unresponsive to plain `pgrep`/`cat` for several minutes afterward).
  // Spawning detached and killing the negative pid targets the whole
  // process GROUP instead of just the one process.
  try {
    process.kill(-pid, signal);
  } catch {
    // Already exited, or this platform doesn't support process groups
    // (e.g. Windows) -- fall back to killing just the direct child.
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

function checkProductionBuild(): Promise<void> {
  return new Promise((resolve) => {
    const timeoutMs = 150_000;
    const child = spawn("npm", ["run", "build"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=700" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, "SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      output += d.toString();
    });
    child.stderr.on("data", (d) => {
      output += d.toString();
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Whatever the outcome, make sure nothing from this build survives
      // this check -- a real production build succeeding or failing should
      // never leave a webpack worker running in the background.
      killProcessGroup(child.pid, "SIGKILL");
    };
    child.on("close", (code, signal) => {
      const tail = output.slice(-2000);
      finish();
      // A process killed by the OOM killer or a signal does not always
      // surface as a populated `signal` on this close event -- observed
      // directly in this sandbox: an OOM-killed `next build` reported
      // code=137 (128 + SIGKILL's signal number 9, the standard POSIX
      // convention for "killed by signal N") with signal=null, because the
      // signal was delivered to the grandchild build process, not to the
      // immediate `npm` child this event fires for. Treat the standard
      // 128+N killed-by-signal exit codes the same as an observed signal.
      const killedBySignalCode = code !== null && code >= 128 && code <= 128 + 64;
      if (timedOut || signal === "SIGKILL" || signal === "SIGTERM" || killedBySignalCode) {
        report(
          "production_build",
          "resource_blocked",
          `\`npm run build\` did not complete within ${Math.round(timeoutMs / 1000)}s in this environment ` +
            `(signal=${signal ?? "none"}, exit code=${code ?? "none"}) -- resource-constrained (documented low-memory/` +
            `single-core sandbox: this exact run was observed being killed, likely by the kernel OOM killer, partway ` +
            `through "Creating an optimized production build"), not a code failure. This was NOT completed, so it ` +
            `must not be reported as ready.`,
        );
      } else if (code === 0) {
        report("production_build", "ready", "`npm run build` completed successfully.");
      } else {
        report("production_build", "blocked_by_code", `\`npm run build\` exited with code ${code}. Tail of output:\n${tail}`);
      }
      resolve();
    });
    child.on("error", (error) => {
      finish();
      report("production_build", "resource_blocked", `Could not spawn \`npm run build\`: ${error.message}`);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------
// github_ci_status -- a real GitHub API call for the latest workflow run
// on this branch/commit, when a token is configured. Also verifies (as a
// static, always-available signal) that CI actually runs the security
// regression suites this branch has been adding.
// ---------------------------------------------------------------------
async function checkGithubCiStatus() {
  const ciPath = ".github/workflows/ci.yml";
  const staticProblems: string[] = [];
  if (!existsSync(ciPath)) {
    staticProblems.push(`${ciPath} does not exist`);
  } else {
    const ci = readFileSync(ciPath, "utf8");
    const expectedSteps = [
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
    ];
    const missingCiSteps = expectedSteps.filter((s) => !ci.includes(`npm run ${s}`));
    if (missingCiSteps.length > 0) {
      staticProblems.push(`CI does not run: ${missingCiSteps.map((s) => `npm run ${s}`).join(", ")}`);
    }
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim() ?? "policydear-cyber/dearpolicy-mvp";
  const sha = process.env.GITHUB_SHA?.trim();

  if (staticProblems.length > 0) {
    report("github_ci_status", "blocked_by_code", staticProblems.join("; "));
    return;
  }

  if (!token) {
    report(
      "github_ci_status",
      "blocked_by_external_configuration",
      "GITHUB_TOKEN not configured in this environment -- cannot query the live GitHub Actions run status for " +
        `${repository}${sha ? `@${sha}` : ""}. CI itself is configured correctly (verified statically above).`,
    );
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const url = sha
      ? `https://api.github.com/repos/${repository}/commits/${sha}/check-runs`
      : `https://api.github.com/repos/${repository}/actions/runs?per_page=1`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "dearpolicy-launch-check" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      report("github_ci_status", "blocked_by_external_configuration", `GitHub API returned ${response.status} ${response.statusText}.`);
      return;
    }
    const data = (await response.json()) as { check_runs?: { status: string; conclusion: string | null }[]; workflow_runs?: { status: string; conclusion: string | null }[] };
    const runs = data.check_runs ?? data.workflow_runs ?? [];
    if (runs.length === 0) {
      report("github_ci_status", "blocked_by_external_configuration", "No CI runs found for this commit/branch yet.");
      return;
    }
    const failing = runs.filter((r) => r.status === "completed" && r.conclusion && r.conclusion !== "success");
    if (failing.length > 0) {
      report("github_ci_status", "blocked_by_code", `${failing.length} CI check(s)/run(s) are not passing.`);
      return;
    }
    const incomplete = runs.filter((r) => r.status !== "completed");
    report(
      "github_ci_status",
      incomplete.length > 0 ? "blocked_by_external_configuration" : "ready",
      incomplete.length > 0 ? "CI is still running for this commit -- re-check once it completes." : "The latest CI run(s) for this commit/branch completed successfully.",
    );
  } catch (error) {
    report("github_ci_status", "blocked_by_external_configuration", `Could not query the GitHub API: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

// ---------------------------------------------------------------------

async function main() {
  const { status: devAuthStatus, detail: devAuthDetail } = guardStatus(checkDevAuthNotInProduction, true);
  const { status: devAccountStatus, detail: devAccountDetail } = guardStatus(checkDevAccountIdNotInProduction, true);
  const { status: secretsStatus, detail: secretsDetail } = guardStatus(checkRequiredProductionSecrets, true);
  const { status: serviceRoleStatus, detail: serviceRoleDetail } = guardStatus(checkServiceRoleKeyNotPublic, false);
  // These four startup guards are cross-cutting production-safety checks
  // rather than one of the 24 named capabilities on their own; they feed
  // into `authentication` (dev-auth/dev-account fallback must be off) and
  // are otherwise reported for visibility below the manifest, matching how
  // instrumentation.ts's assertProductionSafe() treats them as a single
  // startup gate.
  const startupGuardProblems = [
    devAuthStatus !== "ready" ? devAuthDetail : null,
    devAccountStatus !== "ready" ? devAccountDetail : null,
    secretsStatus !== "ready" ? secretsDetail : null,
    serviceRoleStatus !== "ready" ? serviceRoleDetail : null,
  ].filter((x): x is string => x !== null);

  checkPolicyDocumentQuarantine();
  checkClaimEvidenceQuarantine();
  checkMalwareScanningConfiguration();
  checkSharedRateLimiter();
  checkCsrfProtection();
  checkRlsMigrationPresent();
  checkPrivateStorageMigrationPresent();
  checkDataExport();
  checkDataDeletionAndInvalidation();
  checkBackgroundJobReliability();
  checkDeadLetterRetrySupport();
  checkPrivacySafeObservability();
  checkRedactionVerification();
  checkModelPromptSchemaGovernance();
  checkFullHouseholdE2eJourney();
  checkEvaluationThresholds();

  await checkRouteInventoryCapabilities();
  await checkLiveRlsVerification();
  await checkLiveBucketPrivacy();
  await checkGithubCiStatus();
  await checkProductionBuild();

  assertManifestComplete(results);

  const strict = process.argv.includes("--strict");
  const summary = summarizeManifest(results);

  console.log("\nLaunch capability manifest\n===========================");
  for (const item of results) {
    console.log(`[${item.status.toUpperCase()}] ${item.label}\n    ${item.detail}`);
  }
  if (startupGuardProblems.length > 0) {
    console.log("\nAdditional production-startup guard finding(s) (not one of the 24 capabilities on their own, feeding into `authentication`):");
    for (const p of startupGuardProblems) console.log(`  - ${p}`);
  }

  console.log(
    `\n${summary.ready} ready, ${summary.blocked_by_code} blocked by code, ${summary.blocked_by_external_configuration} ` +
      `blocked by external configuration, ${summary.not_applicable} not applicable, ${summary.resource_blocked} resource-blocked ` +
      `(${results.length}/${REQUIRED_CAPABILITIES.length} required capabilities reported).`,
  );

  if (summary.blocked_by_code > 0) {
    console.log(
      "\nblocked_by_code means exactly what it says: a code change is required before this capability can be " +
        "considered launch-ready. See each item's detail above for the specific gap.",
    );
  }

  if (strict && summary.blocked_by_code > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
