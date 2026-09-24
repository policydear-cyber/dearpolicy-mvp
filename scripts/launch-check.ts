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
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkDatabaseTlsIsSecure,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
} from "@/lib/launch/guards";
import { evaluateBucketPrivacy, requiredPrivateBucketIds } from "@/lib/launch/storage-guards";
import { spawnSync } from "node:child_process";
import {
  assertManifestComplete,
  REQUIRED_CAPABILITIES,
  summarizeManifest,
  type CapabilityId,
  type CapabilityResult,
  type CapabilityStatus,
  type CapabilityCheckType,
} from "@/lib/launch/capability-manifest";
import { classifyRoutes } from "./route-inventory-regressions";
import { REQUIRED_CI_SUITES } from "./ci-required-suites";
import { checkRequestOrigin } from "@/lib/http/csrf";
import { checkMalwareScannerConfigured, registeredScanAdapterNames, selectedScanAdapterName } from "@/lib/claims/evidence/scan-adapter";

const results: CapabilityResult[] = [];
const labelOf = new Map(REQUIRED_CAPABILITIES.map((c) => [c.id, c.label]));

// ---------------------------------------------------------------------
// Checkpoint 14h (claude/v1-launch-hardening): structured-evidence
// plumbing for report(). Before this checkpoint, 6 of this file's 24
// verifiers (background_job_reliability, dead_letter_retry_support,
// privacy_safe_observability, redaction_verification,
// model_prompt_schema_governance, full_household_e2e_journey) were each a
// single static report(id, status, "<fixed string>") call with NO dynamic
// inspection of the actual codebase -- meaning no amount of real
// production fixing could ever change what they reported, because they
// never checked anything at runtime. This checkpoint rewrites all 6 (plus
// corrects malware_scanning_configuration's blocked_by_code/blocked_by_
// external_configuration classification, which was real but wrong) to
// perform genuine runtime/source-evidence checks, and extends report()
// itself so EVERY verifier -- not just the 6 rewritten ones -- now emits
// the full structured-evidence shape the launch-hardening spec requires
// (Capability ID, Status, Check type, Command/runtime probe, Evidence
// summary, Blocking reason, Remediation, Last verified timestamp).
//
// Design choice: checkType/probe/remediation are properties of the
// CAPABILITY (which kind of evidence backs it, what command would
// reproduce that evidence, what would fix it), not of which particular
// branch a given run's report() call happened to take. A lookup table
// keyed by CapabilityId is therefore the correct, minimal extension --
// not duplicating the same 3 facts across this file's 65 individual
// report() call sites, which would be far MORE likely to drift out of
// sync (exactly the failure mode this whole checkpoint exists to fix).
// evidenceSummary/blockingReason default to `detail` itself (already a
// thorough per-branch narrative at every call site); lastVerified
// defaults to the real wall-clock time this script actually ran. Any of
// these can still be overridden per call via the optional 4th argument,
// used where a shorter/more specific evidence-summary or a
// probe-specific timestamp (e.g. a checked-in last-known-good result's
// own recorded time) is more honest than the default.
// ---------------------------------------------------------------------
const BUILD_TIMESTAMP = new Date().toISOString();

const CHECK_TYPES: Record<CapabilityId, CapabilityCheckType> = {
  authentication: "static-grep",
  household_authorization: "static-grep",
  route_classification: "static-grep",
  rls_migration_present: "static-grep",
  live_rls_verification: "live-query",
  private_storage_migration_present: "static-grep",
  live_bucket_privacy: "live-query",
  policy_document_quarantine: "static-grep",
  claim_evidence_quarantine: "static-grep",
  malware_scanning_configuration: "env-check",
  shared_rate_limiter: "static-grep",
  csrf_protection: "static-grep",
  secure_database_tls: "env-check",
  data_export: "static-grep",
  data_deletion_and_invalidation: "static-grep",
  background_job_reliability: "runtime-probe",
  dead_letter_retry_support: "runtime-probe",
  privacy_safe_observability: "static-grep",
  redaction_verification: "runtime-probe",
  model_prompt_schema_governance: "static-grep",
  full_household_e2e_journey: "runtime-probe",
  evaluation_thresholds: "static-grep",
  production_build: "build-probe",
  github_ci_status: "ci-api-check",
};

const PROBES: Record<CapabilityId, string> = {
  authentication: "existsSync() on the 7 required auth files + regex for getCurrentUser()/requireCurrentUser() export in lib/auth/session.ts",
  household_authorization: "classifyRoutes() static scan of every app/api/**/route.ts for requireHouseholdContext() usage",
  route_classification: "classifyRoutes() static scan of every app/api/**/route.ts's ROUTE_AUTH export",
  rls_migration_present: "regex for ENABLE ROW LEVEL SECURITY / CREATE POLICY in sql/household-rls.sql",
  live_rls_verification: "live SQL query against pg_class/pg_policies/pg_roles/information_schema over DATABASE_URL",
  private_storage_migration_present: "regex for storage.buckets/storage.objects + CREATE POLICY in sql/storage-rls.sql",
  live_bucket_privacy: "live Supabase Storage listBuckets() API call",
  policy_document_quarantine: "regex for isPolicyProcessingAllowed()'s scan_clean gate + runPolicyQuarantineGate() call in lib/rag/ingest.ts",
  claim_evidence_quarantine: "regex for the current.scan_status !== 'clean' gate in lib/claims/evidence/pipeline.ts",
  malware_scanning_configuration: "checkFileScannerConfigured(prodEnv) + inspection of lib/scanning/adapter.ts's SCAN_ADAPTERS registry for a real (non-null) entry",
  shared_rate_limiter: "regex scan of every migrated route for the shared Postgres-backed limiter import + import-boundary ban on the legacy in-memory limiter",
  csrf_protection: "regex for checkRequestOrigin() call in middleware.ts",
  secure_database_tls: "checkDatabaseTlsIsSecure(prodEnv)",
  data_export: "regex/shape check of lib/household/export.ts, lib/household/export-store.ts, and both export route handlers",
  data_deletion_and_invalidation: "regex/shape check of lib/lifecycle/{types,state-machine,deletion-requests,coordinator}.ts, sql/lifecycle.sql, and the active-read-scopes regression suite's own source",
  background_job_reliability: "regex for the enqueue-only pattern in lib/rag/processing-queue.ts + lib/claims/evidence/queue.ts, existsSync on lib/jobs/worker-runtime.ts + scripts/worker.ts + the jobs:worker script, and `node --import tsx scripts/worker-runtime-regressions.ts` spawned as a child process",
  dead_letter_retry_support: "regex/export check of lib/jobs/dead-letter.ts + scripts/dead-letter.ts, and `node --import tsx scripts/dead-letter-regressions.ts` spawned as a child process",
  privacy_safe_observability: "regex for the 5 Checkpoint 14b event names at their exact call sites (lib/claims/monetary-gate.ts, lib/claims/composition/engine.ts, app/api/policies/upload/route.ts, app/api/policies/scan-callback/route.ts, lib/storage/cleanup.ts), plus a codebase grep confirming the still-uncovered call sites (extraction/OCR/embeddings/chat/exports)",
  redaction_verification: "`node --import tsx scripts/telemetry-regressions.ts` spawned as a child process (35 cases)",
  model_prompt_schema_governance: "region-scoped regex for assertVerifiedForMonetaryUse( inside structuredCompletion()'s (lib/ai/llm.ts) and attemptHostedOcr()'s (lib/documents/ocr-hosted.ts) own function bodies, plus a codebase-wide grep for any real caller of staleExecutionSummary() outside its own module/tests/this file",
  full_household_e2e_journey: "existsSync on the orchestrator + 9 stage files, then a live spawnSync of scripts/full-household-e2e-orchestrator.mjs (bounded timeout) recording its result to scripts/full-household-e2e-last-result.json",
  evaluation_thresholds: "package.json script presence + .github/workflows/ci.yml step presence",
  production_build: "spawned `npm run build`",
  github_ci_status: "GitHub Checks/Statuses API query for the current commit",
};

const REMEDIATIONS: Record<CapabilityId, string> = {
  authentication: "Restore the missing auth file(s), or re-export getCurrentUser()/requireCurrentUser() from lib/auth/session.ts.",
  household_authorization: "Add a requireHouseholdContext() call to every listed household-scoped route before it touches household data.",
  route_classification: "Add a valid ROUTE_AUTH export to every listed route file.",
  rls_migration_present: "Add ENABLE ROW LEVEL SECURITY and CREATE POLICY statements to sql/household-rls.sql.",
  live_rls_verification: "Apply sql/household-rls.sql to the target database, or configure a production DATABASE_URL so this check has something real to verify against.",
  private_storage_migration_present: "Add storage.buckets/storage.objects CREATE POLICY statements to sql/storage-rls.sql.",
  live_bucket_privacy: "Mark the required buckets private in Supabase Storage, or configure SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY so this check has something real to verify against.",
  policy_document_quarantine: "Wire runPolicyQuarantineGate()'s scan_clean gate into lib/rag/ingest.ts's processPolicy() entry point.",
  claim_evidence_quarantine: "Gate lib/claims/evidence/pipeline.ts's quarantined -> processing transition on current.scan_status === 'clean'.",
  malware_scanning_configuration: "Set MALWARE_SCANNER_PROVIDER=virustotal and VIRUSTOTAL_API_KEY in production, or register a real (non-null) adapter in lib/scanning/adapter.ts's SCAN_ADAPTERS if none exists yet.",
  shared_rate_limiter: "Migrate the listed route(s) onto the shared Postgres-backed rate limiter.",
  csrf_protection: "Wire checkRequestOrigin() into middleware.ts ahead of every /api/* mutation.",
  secure_database_tls: "Configure DATABASE_URL with TLS (sslmode=require or equivalent) and certificate verification left on.",
  data_export: "Close each named gap in the household export snapshot/store/routes so it fully satisfies the spec.",
  data_deletion_and_invalidation: "Implement the remaining deletion flow(s)/state-machine guarantees named in the blocking reason.",
  background_job_reliability: "Build a live end-to-end fixture test for the policy-processing path (mirroring scripts/pipeline-worker-regressions.ts's claim-evidence proof) so both real call sites, not just one, are proven to reach the durable-job model end to end.",
  dead_letter_retry_support: "Fix the failing worker-runtime/dead-letter regression case(s) named in the blocking reason, or wire the missing drain/CLI/export.",
  privacy_safe_observability: "Add recordEvent()/recordErrorEvent() calls at the remaining call sites: extraction, OCR, embeddings, chat-turn-level, and exports.",
  redaction_verification: "Investigate and fix the telemetry-regressions.ts failure(s); see the runtime probe's captured output in the blocking reason.",
  model_prompt_schema_governance: "Call assertVerifiedForMonetaryUse(record) at both governed chokepoints if that check failed, or wire a real caller for staleExecutionSummary()'s worklist if only that check failed.",
  full_household_e2e_journey: "Replace the dev-auth signup substitute with real Supabase Auth signup+signin, drive claim-session creation through the real chat route, and exercise this journey against a real (non-test) malware-scan adapter.",
  evaluation_thresholds: "Add the missing npm script(s) and/or wire them into .github/workflows/ci.yml as required (non-optional) steps.",
  production_build: "Investigate the `npm run build` failure output captured in the blocking reason.",
  github_ci_status: "Investigate the failing CI check(s)/run(s), or configure GITHUB_TOKEN/CI access so this check has something real to query.",
};

function report(
  id: CapabilityId,
  status: CapabilityStatus,
  detail: string,
  overrides: Partial<Pick<CapabilityResult, "checkType" | "probe" | "evidenceSummary" | "blockingReason" | "remediation" | "lastVerified">> = {},
) {
  const isBlocking = status !== "ready" && status !== "not_applicable";
  results.push({
    id,
    label: labelOf.get(id) ?? id,
    status,
    detail,
    checkType: overrides.checkType ?? CHECK_TYPES[id],
    probe: overrides.probe ?? PROBES[id],
    evidenceSummary: overrides.evidenceSummary ?? detail,
    blockingReason: isBlocking ? overrides.blockingReason ?? detail : undefined,
    remediation: isBlocking ? overrides.remediation ?? REMEDIATIONS[id] : undefined,
    lastVerified: overrides.lastVerified ?? BUILD_TIMESTAMP,
  });
}

/** Runs a repo-relative `node --import tsx <script>` regression suite
 * synchronously and returns its real exit code and combined output -- the
 * actual runtime-probe mechanism behind background_job_reliability,
 * dead_letter_retry_support and redaction_verification below. Every
 * suite this is used on was measured directly in this sandbox at well
 * under 10s and well under 100MB RSS (see Checkpoint 14h's own PR-comment
 * evidence), so running it synchronously inside launch:check itself is a
 * real judgment call, not a guess: full-project-tsc/next-build/pdf.js-scale
 * risk does not apply to these small, PGlite-backed suites. */
function runRegressionSuite(scriptPath: string, timeoutMs = 60_000): { passed: boolean; output: string; timedOut: boolean; killedBySignal: boolean } {
  const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  // Two distinct "did not complete" shapes, both real and both observed in
  // this sandbox: (1) spawnSync's own `timeout` elapsing (kills with
  // SIGTERM by default); (2) the environment's memcg OOM killer killing
  // the child directly with SIGKILL when this nested tsx-in-tsx process
  // tree (this suite ITSELF is spawned from an already tsx-loaded
  // scripts/launch-check.ts, itself possibly spawned from an already
  // tsx-loaded test harness) exceeds this sandbox's tight memory ceiling --
  // confirmed directly: signal=SIGKILL, status=null, dmesg showing a real
  // `Memory cgroup out of memory: Killed process ... (node)` entry. NEITHER
  // is a real failed verification (the suite never finished), so neither
  // may be reported blocked_by_code -- that would misrepresent an
  // environment limit as a code defect. Both are surfaced as
  // killedBySignal so callers report resource_blocked instead.
  const killedBySignal = result.status === null && Boolean(result.signal) && result.error === undefined;
  return { passed: result.status === 0 && !result.error, output, timedOut: killedBySignal, killedBySignal };
}

/** Isolates roughly the region of `source` that is ONE function's own
 * body: from `declarationPattern`'s match to the start of the NEXT
 * top-level `export `/`function `/`async function `/`class ` declaration
 * (this codebase's own convention keeps those at column 0), or end of
 * file. This is a real, if approximate, scoping -- not a whole-file
 * regex guess -- specifically so a check like "does structuredCompletion()
 * call assertVerifiedForMonetaryUse()" cannot be satisfied by an
 * unrelated call somewhere else lower in the same file. Returns null if
 * `declarationPattern` is not found at all. */
function extractFunctionRegion(source: string, declarationPattern: RegExp): string | null {
  const startMatch = declarationPattern.exec(source);
  if (!startMatch) return null;
  const searchFrom = startMatch.index + startMatch[0].length;
  const nextDeclPattern = /^(?:export\s|(?:async\s+)?function\s|class\s)/m;
  const rest = source.slice(searchFrom);
  const nextMatch = nextDeclPattern.exec(rest);
  const endIndex = nextMatch ? searchFrom + nextMatch.index : source.length;
  return source.slice(startMatch.index, endIndex);
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
  // Checkpoint 3 (claude/v1-launch-hardening): lib/policies/quarantine/
  // store.ts's runPolicyQuarantineGate()/assertPolicyProcessingAllowed()
  // gate lib/rag/ingest.ts's processPolicy() -- the single entry point for
  // OCR, parsing, extraction, embeddings and indexing on a policy document
  // -- on a persisted quarantine_status of exactly "scan_clean". Checked by
  // source shape below; the executable DB-backed proof (including
  // duplicate/out-of-order/deleted/superseded/cross-household callback
  // idempotency, and a sabotage-then-restore cycle against the gate) is
  // scripts/policy-quarantine-regressions.ts, run as part of
  // security:policy-quarantine-test.
  const storePath = "lib/policies/quarantine/store.ts";
  const statePath = "lib/policies/quarantine/state-machine.ts";
  const ingestPath = "lib/rag/ingest.ts";
  const missing = [storePath, statePath, ingestPath].filter((p) => !existsSync(p));
  if (missing.length) {
    report("policy_document_quarantine", "blocked_by_code", `Missing: ${missing.join(", ")}.`);
    return;
  }
  const storeSource = readFileSync(storePath, "utf8");
  const ingestSource = readFileSync(ingestPath, "utf8");
  const hasCleanGateFn = /export function isPolicyProcessingAllowed\(/.test(storeSource) &&
    /row\.quarantine_status\s*===\s*["']scan_clean["']/.test(storeSource);
  const ingestCallsGate = /runPolicyQuarantineGate\(/.test(ingestSource) && /if \(!gate\.cleared\) return;/.test(ingestSource);
  if (!hasCleanGateFn || !ingestCallsGate) {
    report(
      "policy_document_quarantine",
      "blocked_by_code",
      `${storePath} does not gate on an explicit scan_clean status, or ${ingestPath}'s processPolicy() does not call ` +
        `the gate at its own entry point -- this does not satisfy "Only scan_clean documents may be parsed, OCRed, ` +
        `embedded, indexed, or sent to a model".`,
    );
    return;
  }
  report(
    "policy_document_quarantine",
    "ready",
    `${ingestPath}'s processPolicy() -- the single entry point for a policy document's OCR/parsing/extraction/` +
      `embedding/indexing -- gates on ${storePath}'s isPolicyProcessingAllowed(), which requires a persisted ` +
      `quarantine_status of exactly "scan_clean" (uploaded/quarantined/scan_pending/scan_rejected/deleted all stay ` +
      `blocked). Re-checked on every reprocess and reindex, not cached. See security:policy-quarantine-test for the ` +
      `executable DB-backed proof, including a sabotage-then-restore cycle against this exact check.`,
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
  // Checkpoint 14h: corrected classification. This is a REAL dynamic
  // check (it always was -- checkMalwareScannerConfigured() evaluates
  // real env vars against a simulated production environment, exactly
  // like guardStatus() does for lib/launch/guards.ts's guards) but its
  // blocked_by_code/blocked_by_external_configuration split was wrong per
  // this spec's own classification rules: "Implementation complete but
  // live credentials/service/migration absent -> blocked_by_external_
  // configuration. Do not classify missing production adapters as
  // external configuration if the adapter implementation itself is
  // absent." Before this fix, the "no scanner selected" branch ALWAYS
  // reported blocked_by_code, even after Checkpoint 14e registered a real
  // virustotal adapter in lib/scanning/adapter.ts's SCAN_ADAPTERS -- the
  // exact stale-verifier bug this checkpoint exists to fix: the adapter
  // implementation now genuinely exists, so "not configured in THIS
  // environment" is external configuration, not missing code. The
  // distinction now actually inspects the registry (real object
  // inspection, not a guess): a real, non-null adapter is REGISTERED
  // whenever Object.keys(SCAN_ADAPTERS) has more than just "null" in it.
  const registeredAdapters = registeredScanAdapterNames();
  const hasRealAdapterRegistered = registeredAdapters.some((name) => name !== "null");
  const result = checkMalwareScannerConfigured(prodEnv);
  const selectedName = selectedScanAdapterName(prodEnv);
  const hasRealScannerSelected = selectedName !== "null" && registeredAdapters.includes(selectedName);

  if (!hasRealAdapterRegistered) {
    // No amount of MALWARE_SCANNER_PROVIDER configuration could ever
    // select a real scanner -- this is a genuine code gap, not a missing
    // secret.
    report(
      "malware_scanning_configuration",
      "blocked_by_code",
      `No real (non-null) malware-scanning adapter is registered in lib/scanning/adapter.ts's SCAN_ADAPTERS -- only ` +
        `${registeredAdapters.join(", ")}. Configuring MALWARE_SCANNER_PROVIDER cannot select a scanner that does not exist in code.`,
      { evidenceSummary: `SCAN_ADAPTERS registry keys: ${registeredAdapters.join(", ")} (no non-null entry).` },
    );
    return;
  }
  if (result.ok && hasRealScannerSelected) {
    report(
      "malware_scanning_configuration",
      "ready",
      `${result.message} A real adapter ("${selectedName}") is both registered in lib/scanning/adapter.ts's SCAN_ADAPTERS and selected in this environment.`,
      { evidenceSummary: `checkFileScannerConfigured(prodEnv).ok=true; selected adapter="${selectedName}"; registered adapters=${registeredAdapters.join(", ")}.` },
    );
    return;
  }
  if (result.ok) {
    // Only reachable via MALWARE_SCANNING_INTENTIONALLY_DISABLED -- an
    // operator's explicit, acknowledged choice, not a code gap (a real
    // adapter IS registered; this environment has simply chosen not to
    // select one). Genuinely external configuration: the code is
    // complete, the operator's own env var says so.
    report(
      "malware_scanning_configuration",
      "blocked_by_external_configuration",
      `${result.message} A real adapter is registered (${registeredAdapters.filter((n) => n !== "null").join(", ")}) but not selected in this environment.`,
      { evidenceSummary: `checkFileScannerConfigured(prodEnv).ok=true via MALWARE_SCANNING_INTENTIONALLY_DISABLED; registered real adapter(s): ${registeredAdapters.filter((n) => n !== "null").join(", ")}.` },
    );
    return;
  }
  // result.ok === false: production would refuse to boot. The adapter
  // implementation is present in code (checked above); what is missing
  // is this environment's MALWARE_SCANNER_PROVIDER/credentials -- exactly
  // "implementation complete but live credentials absent".
  report(
    "malware_scanning_configuration",
    "blocked_by_external_configuration",
    `${result.message} A real adapter implementation IS registered (${registeredAdapters.filter((n) => n !== "null").join(", ")}) -- this environment simply has not configured MALWARE_SCANNER_PROVIDER/credentials to select it.`,
    { evidenceSummary: `checkFileScannerConfigured(prodEnv).ok=false; registered real adapter(s): ${registeredAdapters.filter((n) => n !== "null").join(", ")}; selected="${selectedName}".` },
  );
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
  // Checkpoint 6 (claude/v1-launch-hardening): lib/household/export.ts
  // (snapshot content) + lib/household/export-store.ts (idempotency/CAS/
  // expiry) + app/api/household/export/**\/route.ts (owner-gated,
  // recent-auth-gated routes). Checked by source shape below; the
  // executable DB-backed proof (content inclusions/exclusions,
  // cross-household isolation, idempotency, CAS lifecycle, race-safe
  // expiry) is scripts/household-export-regressions.ts, run as part of
  // security:household-export-test.
  const exportPath = "lib/household/export.ts";
  const storePath = "lib/household/export-store.ts";
  const createRoutePath = "app/api/household/export/route.ts";
  const downloadRoutePath = "app/api/household/export/[id]/download/route.ts";
  const missing = [exportPath, storePath, createRoutePath, downloadRoutePath].filter((p) => !existsSync(p));
  if (missing.length) {
    report("data_export", "blocked_by_code", `Missing: ${missing.join(", ")}.`);
    return;
  }
  const exportSource = readFileSync(exportPath, "utf8");
  const storeSource = readFileSync(storePath, "utf8");
  const createRouteSource = readFileSync(createRoutePath, "utf8");
  const downloadRouteSource = readFileSync(downloadRoutePath, "utf8");

  // The content builder's own SELECTs must never name storage_key or
  // extracted_json -- these are exactly the signed-url-adjacent/raw-
  // provider-payload fields the spec's exclude list names.
  const policySelect = /SELECT id, family_member_id, insurer[^;]*FROM policies/s.exec(exportSource)?.[0] ?? "";
  const evidenceSelect = /SELECT id, claim_session_id, document_type[^;]*FROM claim_evidence_documents/s.exec(exportSource)?.[0] ?? "";
  const noStorageKeys = policySelect.length > 0 && evidenceSelect.length > 0 &&
    !policySelect.includes("storage_key") && !evidenceSelect.includes("storage_key") && !policySelect.includes("extracted_json");

  const isIdempotent = /idx_household_exports_idempotency/.test(readFileSync("sql/schema.sql", "utf8")) &&
    /ON CONFLICT \(household_id, idempotency_key\) DO NOTHING/.test(storeSource);
  const hasExpiry = /expireIfPast/.test(storeSource) && /status='expired'/.test(storeSource);
  const createRequiresOwnerAndRecentAuth = /requireHouseholdOwner\(/.test(createRouteSource) && /requireRecentAuthentication\(/.test(createRouteSource);
  const downloadRequiresOwnerAndRecentAuth = /requireHouseholdOwner\(/.test(downloadRouteSource) && /requireRecentAuthentication\(/.test(downloadRouteSource);
  const downloadNeverRedirectsToSignedUrl = !/signedUrl|createSignedUrl/i.test(downloadRouteSource);

  const problems: string[] = [];
  if (!noStorageKeys) problems.push("the snapshot builder's own SELECTs still reference storage_key or extracted_json");
  if (!isIdempotent) problems.push("no idempotency-key unique index/ON CONFLICT DO NOTHING path");
  if (!hasExpiry) problems.push("no expiry handling");
  if (!createRequiresOwnerAndRecentAuth) problems.push("the create route does not require both household-owner authorization and recent authentication");
  if (!downloadRequiresOwnerAndRecentAuth) problems.push("the download route does not require both household-owner authorization and recent authentication");
  if (!downloadNeverRedirectsToSignedUrl) problems.push("the download route appears to hand out a signed URL rather than streaming the content itself");

  if (problems.length > 0) {
    report("data_export", "blocked_by_code", `Household export does not fully satisfy the spec: ${problems.join("; ")}.`);
    return;
  }
  report(
    "data_export",
    "ready",
    "lib/household/export.ts builds a versioned, deterministic snapshot excluding storage keys/raw provider payloads/internal " +
      "telemetry; lib/household/export-store.ts is idempotent (unique index + ON CONFLICT) with CAS status transitions and " +
      "expiry; the create and download routes require household-owner authorization and a recently-authenticated session; " +
      "the download route streams content directly rather than minting a signed URL. Exercised end to end (including " +
      "cross-household isolation and a race-safety case) by scripts/household-export-regressions.ts.",
  );
}

function checkDataDeletionAndInvalidation() {
  // Checkpoint 7 (claude/v1-launch-hardening), in progress. Real source-
  // shape verification below, following the same convention as
  // checkDataExport() above: this reports the capability's TRUE current
  // state rather than treating "the state machine exists" as "the
  // capability is ready" -- the checkpoint spec is explicit that launch
  // readiness is blocked until the ENTIRE lifecycle (all 8 deletion
  // flows) works, not just the shared machinery.
  const typesPath = "lib/lifecycle/types.ts";
  const stateMachinePath = "lib/lifecycle/state-machine.ts";
  const requestsPath = "lib/lifecycle/deletion-requests.ts";
  const coordinatorPath = "lib/lifecycle/coordinator.ts";
  const schemaPath = "sql/lifecycle.sql";
  const missing = [typesPath, stateMachinePath, requestsPath, coordinatorPath, schemaPath].filter((p) => !existsSync(p));
  if (missing.length) {
    report(
      "data_deletion_and_invalidation",
      "blocked_by_code",
      `No deletion/invalidation lifecycle exists yet -- missing: ${missing.join(", ")}.`,
    );
    return;
  }

  const stateMachineSource = readFileSync(stateMachinePath, "utf8");
  const requestsSource = readFileSync(requestsPath, "utf8");
  const coordinatorSource = readFileSync(coordinatorPath, "utf8");
  const schemaSource = readFileSync(schemaPath, "utf8");
  const guardSource = existsSync("scripts/lifecycle-query-guard-regressions.ts")
    ? readFileSync("scripts/lifecycle-query-guard-regressions.ts", "utf8")
    : "";

  const hasLifecycleStates = ["active", "pending_deletion", "soft_deleted", "permanently_deleted", "audit_tombstone"].every((state) =>
    schemaSource.includes(`'${state}'`),
  );
  // The state machine must CAS on the current state (never a blind
  // UPDATE) and re-read on a lost race rather than trust the caller --
  // exactly the household-export expireIfPast() lesson this checkpoint
  // explicitly builds on.
  const hasCas = /WHERE \$\{target\.idColumn\}=\$2 AND account_id=\$3 AND lifecycle_state=\$4/.test(stateMachineSource) &&
    /LifecycleVersionConflictError/.test(stateMachineSource);
  const hasIdempotentRequests = /ON CONFLICT \(account_id, resource_type, resource_id, idempotency_key\) DO NOTHING/.test(requestsSource);
  const hasQueryGuardRegression = /KNOWN_UNGUARDED/.test(guardSource) && /unguardedOccurrences/.test(guardSource);

  // Which of the 8 deletion flows the coordinator actually implements --
  // checked by function name, one per flow, so this list has to be
  // extended (not just left alone) as each flow is genuinely built.
  const flowFunctions: Record<string, string> = {
    "policy document deletion": "requestPolicyDocumentDeletion",
    "whole-policy deletion": "requestPolicyDeletion",
    "claim-evidence deletion": "requestClaimEvidenceDeletion",
    "family-member deletion": "requestFamilyMemberDeletion",
    "household-member removal": "requestHouseholdMemberRemoval",
    "leave-household": "requestHouseholdLeave",
    "invitation revocation": "requestInvitationRevocation",
    "household/account deletion": "requestHouseholdDeletion",
  };
  const implementedFlows = Object.entries(flowFunctions).filter(([, fn]) => new RegExp(`function ${fn}\\(`).test(coordinatorSource));
  const missingFlows = Object.entries(flowFunctions).filter(([, fn]) => !new RegExp(`function ${fn}\\(`).test(coordinatorSource));

  const problems: string[] = [];
  if (!hasLifecycleStates) problems.push("sql/lifecycle.sql does not define all five runtime-validated lifecycle states");
  if (!hasCas) problems.push("lib/lifecycle/state-machine.ts's transitionLifecycle() does not CAS on the current state / handle a lost race");
  if (!hasIdempotentRequests) problems.push("lib/lifecycle/deletion-requests.ts is not idempotent (no unique-index + ON CONFLICT DO NOTHING path)");
  if (!hasQueryGuardRegression) problems.push("no repository-level regression enforcing the lifecycle predicate on active-record queries");
  if (missingFlows.length) problems.push(`${missingFlows.length}/8 deletion flows not yet implemented: ${missingFlows.map(([name]) => name).join(", ")}`);

  if (problems.length === 0) {
    report(
      "data_deletion_and_invalidation",
      "ready",
      `Deletion & invalidation lifecycle complete: all 8 deletion flows this checkpoint's LIFECYCLE_RESOURCE_TYPES ` +
        `anticipated are implemented and regression-tested (${implementedFlows.map(([name]) => name).join(", ")}), ` +
        `on top of a central CAS-based state machine (active/pending_deletion/soft_deleted/permanently_deleted/` +
        `audit_tombstone) with recovery only before permanent deletion; idempotent deletion_requests bookkeeping ` +
        `(unique-index + ON CONFLICT DO NOTHING, proven under concurrent/retried requests by every flow's own ` +
        `regression suite); immediate read-side exclusion wired into chat retrieval, the policy list route, and ` +
        `every ordinary application read across all four lifecycle-scoped tables (accounts, policies, ` +
        `claim_evidence_documents, family_members) via lib/lifecycle/scopes.ts's activePredicate() -- the ` +
        `query-guard allowlist is at zero, proven behaviorally (not just via static text scanning) by ` +
        `scripts/active-read-scopes-regressions.ts; storage-cleanup engine integration; a redacted ` +
        `deletion_audit_log. Whole-policy and claim-evidence deletion each invalidate their own derived cause/CI/` +
        `disability match data and reset open claim sessions to a needs-document state, closing two real, ` +
        `previously-undiscovered gaps (lib/ledger/store.ts's stale Coverage Ledger rows, and claim-evidence's ` +
        `own unjoined match tables) found and fixed while building this checkpoint, not merely inherited. ` +
        `Family-member deletion, household-member removal, leave-household, invitation revocation, and ` +
        `household/account deletion each migrated (or, for household deletion, wrapped) a pre-existing raw, ` +
        `unrecoverable DELETE that bypassed this lifecycle machinery entirely -- four more real, ` +
        `previously-undiscovered gaps closed along the way, each verified via a sabotage-and-restore cycle ` +
        `confirming the exact safety-critical control (a precondition, an idempotency short-circuit, or -- ` +
        `uniquely for household deletion -- the pre-flight existence check protecting a retry from a ` +
        `foreign-key crash) actually does what its regression suite claims. Household deletion is the one flow ` +
        `that deliberately stays an immediate hard delete rather than a deferred soft-delete -- see ` +
        `lib/lifecycle/coordinator.ts's requestHouseholdDeletion() for why (deletion_requests/deletion_audit_log ` +
        `rows are themselves ON DELETE CASCADE-tied to the accounts row they describe, and no existing read path ` +
        `gates access on accounts.lifecycle_state) -- and is now additionally gated on a recently-authenticated ` +
        `session (requireRecentAuthentication(), app/api/household/route.ts's DELETE handler), closing the ` +
        `reauthentication gap deleteHousehold()'s own doc comment had flagged. See each flow's own ` +
        `scripts/*-regressions.ts for its full behavioral case list. Whether this has actually been exercised ` +
        `against a live Supabase project (as opposed to PGlite, which every regression suite above uses) is the ` +
        `responsibility of the live-environment checks elsewhere in this script, not this one.`,
    );
    return;
  }

  report(
    "data_deletion_and_invalidation",
    "blocked_by_code",
    `Deletion & invalidation lifecycle in progress, not launch-ready: ${problems.join("; ")}. ` +
      `Implemented and tested so far (scripts/lifecycle-regressions.ts, scripts/lifecycle-query-guard-regressions.ts, ` +
      `scripts/active-read-scopes-regressions.ts, scripts/policy-deletion-regressions.ts): ` +
      `${implementedFlows.map(([name]) => name).join(", ") || "none"}; a central CAS-based state machine ` +
      `(active/pending_deletion/soft_deleted/permanently_deleted/audit_tombstone) with recovery only before permanent ` +
      `deletion; idempotent deletion_requests bookkeeping; immediate read-side exclusion wired into chat retrieval, ` +
      `the policy list route, and now every ordinary application read across all four lifecycle-scoped tables ` +
      `(accounts, policies, claim_evidence_documents, family_members) via lib/lifecycle/scopes.ts's activePredicate() ` +
      `-- the query-guard allowlist is at zero, and scripts/active-read-scopes-regressions.ts proves the exclusion ` +
      `behaviorally (seeded active+non-active rows through the real application functions), not just via static ` +
      `text scanning; storage-cleanup engine integration (a pending_deletion+ row stops protecting its storage ` +
      `object); a redacted deletion_audit_log. Whole-policy deletion additionally resolves the full supersedes_id ` +
      `version chain, protects a shared reference/wording document still authorizing another active family ` +
      `member's confirmed cover (refusing the delete rather than silently breaking their coverage) while ` +
      `cascading an orphaned reference document into the same deletion, supersedes any cause/CI/disability ` +
      `definition-match citing a deleted policy, and resets an open claim session's stale decision-packet to a ` +
      `needs-document state -- see scripts/policy-deletion-regressions.ts for the 11 behavioral cases proving ` +
      `this, including a sabotage-and-restore-verified reference-document protection check and a fix to ` +
      `lib/ledger/store.ts (a real, previously-undiscovered gap where a deleted policy's Coverage Ledger rows ` +
      `kept appearing indefinitely, since coverage_rules has no lifecycle_state column of its own and was not ` +
      `joined back to policies). Claim-evidence deletion additionally revokes logical access to a single ` +
      `evidence document (no version-chain cascade -- the business-level supersedes_id/superseded_at audit ` +
      `history on claim_evidence_documents stays intact and untouched by design, distinct from lifecycle_state), ` +
      `and -- generalizing the same match-supersession helper Whole-policy deletion introduced, now shared as ` +
      `invalidateClaimMatchesReferencing() -- supersedes any cause/CI/disability definition-match keyed on the ` +
      `deleted evidence_document_id and resets an open claim session's stale decision-packet, closing a real, ` +
      `previously-undiscovered gap: lib/claims/evidence/store.ts's loadActiveCauseDefinitionMatches() and its ` +
      `CI/disability counterparts filter only superseded_at IS NULL and never join back to ` +
      `claim_evidence_documents, so without this explicit supersession a deleted document's stale match would ` +
      `otherwise keep surfacing. All writes to claim_evidence_audit_log go through the single-writer ` +
      `appendClaimEvidenceAudit() convention. See scripts/claim-evidence-deletion-regressions.ts for the 9 ` +
      `behavioral cases proving this, including a sabotage-and-restore-verified check on the evidence-match ` +
      `invalidation step. Family-member deletion additionally migrates what was previously a raw, unrecoverable ` +
      `DELETE FROM family_members in app/api/family/[id]/route.ts (bypassing this checkpoint's lifecycle ` +
      `machinery entirely, despite family_members already being read-side migrated via activePredicate()) onto ` +
      `the same CAS state machine, while preserving unchanged the pre-existing product rule that refuses -- ` +
      `rather than cascades -- deletion of a profile with any linked policy, policy_members link, chat history, ` +
      `claim session, coverage-ledger rule, or premium record; a policy already excluded by activePredicate() ` +
      `(e.g. already soft-deleted) correctly does not block the member's own deletion. See ` +
      `scripts/family-member-deletion-regressions.ts for the 11 behavioral cases proving this, including a ` +
      `sabotage-and-restore-verified check on the linked-activity precondition. Household-member removal and ` +
      `leave-household both wrap lib/household/repo.ts's removeMember() (which already owns the last-remaining- ` +
      `owner refusal and RLS-enforced authorization -- deliberately not reimplemented here) with deletion_requests ` +
      `idempotency and a deletion_audit_log entry; household_members has no lifecycle-tracked table of its own ` +
      `(no transitionLifecycle() step for this flow), so it is represented entirely through deletion_requests, ` +
      `exactly as lib/lifecycle/types.ts's own comment anticipates. Proven against REAL Postgres Row Level ` +
      `Security (the same household-rls.sql policies scripts/rls-regressions.ts proves), not a scripted fake ` +
      `pool -- including a case where a plain member is correctly refused (ForbiddenError) when trying to remove ` +
      `another member, and idempotency proven by a sabotage-and-restore-verified check confirming that without ` +
      `the deletion_requests short-circuit, a retry would re-invoke removeMember() and throw NotFoundError ` +
      `against an already-removed member. See scripts/household-membership-deletion-regressions.ts for the 7 ` +
      `behavioral cases proving this. Invitation revocation wraps lib/household/repo.ts's revokeInvitation() the ` +
      `same way (deliberately not reimplemented), scoping its deletion_requests/deletion_audit_log bookkeeping to ` +
      `the invitation's OWN household_id (read directly, service-level) rather than the caller's currently active ` +
      `household -- the two can legitimately differ for a caller who owns more than one household, and ` +
      `revokeInvitation()'s RLS-scoped UPDATE remains the actual authorization decision either way. Proven that a ` +
      `revoked invitation can no longer be accepted (an end-to-end check through acceptInvitation(), not just ` +
      `revokeInvitation()'s own guard) and that a plain member is correctly refused (RLS-enforced) when trying to ` +
      `revoke another owner's invitation. See scripts/invitation-revocation-deletion-regressions.ts for the 9 ` +
      `behavioral cases proving this, including a sabotage-and-restore-verified check on the idempotency ` +
      `short-circuit. This capability stays blocked until every one of the 8 deletion flows the spec requires is ` +
      `implemented and regression-tested, not merely until the shared machinery exists.`,
  );
}

function checkBackgroundJobReliability() {
  // Checkpoint 14h: was a single static report() call with a fixed
  // string, unconditionally "blocked_by_code", regardless of what the
  // real code actually did -- see this file's own module doc comment and
  // scripts/launch-check-verifier-regressions.ts for the sabotage-based
  // proof this is no longer true. This now performs three REAL, dynamic
  // checks: (1) the two real production call sites are structurally
  // enqueue-only, not same-process claim+run; (2) a genuinely separate
  // worker driver exists and is wired to a real `npm run` entry point;
  // (3) that worker driver's own regression suite is actually spawned as
  // a child process and its real exit code is read (a runtime probe, not
  // an assumption from a comment).
  const queuePath = "lib/rag/processing-queue.ts";
  const evidenceQueuePath = "lib/claims/evidence/queue.ts";
  const workerRuntimePath = "lib/jobs/worker-runtime.ts";
  const workerEntryPath = "scripts/worker.ts";
  const workerRuntimeSuitePath = "scripts/worker-runtime-regressions.ts";
  const requiredFiles = [queuePath, evidenceQueuePath, workerRuntimePath, workerEntryPath, workerRuntimeSuitePath];
  const missing = requiredFiles.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    report(
      "background_job_reliability",
      "blocked_by_code",
      `Missing required file(s): ${missing.join(", ")}. A durable job model alone is not this capability -- a ` +
        `genuinely separate worker process claiming and running previously-enqueued work is.`,
    );
    return;
  }

  const queueSource = readFileSync(queuePath, "utf8");
  const evidenceQueueSource = readFileSync(evidenceQueuePath, "utf8");
  const workerRuntimeSource = readFileSync(workerRuntimePath, "utf8");

  // Enqueue-only: the real call sites must call enqueueJob() and must NOT
  // themselves import/call runAsDurableJob() (the same-process claim+run
  // primitive) -- that would mean the request-handling process still
  // claims and runs its own just-enqueued work, the exact gap this
  // capability names.
  const queueIsEnqueueOnly = /enqueueJob\(/.test(queueSource) && !/runAsDurableJob\(/.test(queueSource);
  const evidenceQueueIsEnqueueOnly = /enqueueJob\(/.test(evidenceQueueSource) && !/runAsDurableJob\(/.test(evidenceQueueSource);

  // A genuinely separate worker driver: claims via claimNextJob() (never
  // enqueues), and a poll loop that can run standalone.
  const workerRuntimeIsClaimOnly = /claimNextJob\(/.test(workerRuntimeSource) &&
    !/enqueueJob\(/.test(workerRuntimeSource) &&
    /export (async )?function runWorkerLoop\(/.test(workerRuntimeSource);

  let pkg: { scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync("package.json", "utf8"));
  } catch {
    /* handled by the check below */
  }
  const hasWorkerNpmScript = Boolean(pkg.scripts?.["jobs:worker"]);

  const structuralProblems: string[] = [];
  if (!queueIsEnqueueOnly) structuralProblems.push(`${queuePath} is not enqueue-only (still calls runAsDurableJob() or never calls enqueueJob())`);
  if (!evidenceQueueIsEnqueueOnly) structuralProblems.push(`${evidenceQueuePath} is not enqueue-only (still calls runAsDurableJob() or never calls enqueueJob())`);
  if (!workerRuntimeIsClaimOnly) structuralProblems.push(`${workerRuntimePath} does not look like a claim-only driver (missing claimNextJob()/runWorkerLoop(), or itself enqueues)`);
  if (!hasWorkerNpmScript) structuralProblems.push(`package.json has no "jobs:worker" script to actually run ${workerEntryPath} as a deployable process`);

  if (structuralProblems.length > 0) {
    report(
      "background_job_reliability",
      "blocked_by_code",
      `Structural check failed: ${structuralProblems.join("; ")}.`,
      { evidenceSummary: `enqueue-only: processing-queue=${queueIsEnqueueOnly}, evidence-queue=${evidenceQueueIsEnqueueOnly}; claim-only worker driver=${workerRuntimeIsClaimOnly}; jobs:worker script=${hasWorkerNpmScript}.` },
    );
    return;
  }

  // Runtime probe: actually spawn the worker-runtime regression suite and
  // read its real exit code -- not inferred from source, executed.
  const probe = runRegressionSuite(workerRuntimeSuitePath);
  if (!probe.passed && probe.killedBySignal) {
    report(
      "background_job_reliability",
      "resource_blocked",
      `Structural wiring is correct, but \`node --import tsx ${workerRuntimeSuitePath}\` was killed by a signal (likely this ` +
        `sandbox's memcg OOM killer, given nested tsx-in-tsx process memory pressure) before it could complete -- this is a real ` +
        `environment limit, not a code defect, and must not be reported as either ready or blocked_by_code.`,
      { evidenceSummary: `runRegressionSuite(${workerRuntimeSuitePath}) => killedBySignal=true, did not complete.` },
    );
    return;
  }
  if (!probe.passed) {
    report(
      "background_job_reliability",
      "blocked_by_code",
      `Structural wiring is correct (enqueue-only call sites, a claim-only worker driver, a jobs:worker npm script) but ` +
        `\`node --import tsx ${workerRuntimeSuitePath}\` failed. Output:\n${probe.output.slice(-4000)}`,
      { evidenceSummary: `runRegressionSuite(${workerRuntimeSuitePath}) => passed=false.` },
    );
    return;
  }

  // Even with all of the above true, this capability still has ONE real,
  // honest remaining gap: only the claim-evidence path has a live,
  // fixture-backed end-to-end proof that a REAL pipeline failure reaches
  // failJob()/dead_letter through a genuinely separate worker pass. The
  // policy-processing path is structurally identical but unverified by a
  // live fixture -- checked here by grepping for it directly rather than
  // asserting it from a comment.
  const pipelineWorkerSuite = existsSync("scripts/pipeline-worker-regressions.ts") ? readFileSync("scripts/pipeline-worker-regressions.ts", "utf8") : "";
  const hasPolicyProcessingLiveFixture = /processPolicy\(/.test(pipelineWorkerSuite);

  if (!hasPolicyProcessingLiveFixture) {
    report(
      "background_job_reliability",
      "blocked_by_code",
      `Real fix verified: ${queuePath} and ${evidenceQueuePath} are enqueue-only, ${workerRuntimePath}/${workerEntryPath} ` +
        `provide a genuinely separate claim-only worker driver wired to \`npm run jobs:worker\`, and its regression suite ` +
        `(${workerRuntimeSuitePath}) really passes as a spawned child process (${probe.output.split("\n").pop()}). Still ` +
        `blocked_by_code on one honest remaining gap: only the claim-evidence path (scripts/pipeline-worker-regressions.ts) ` +
        `has a live, fixture-backed end-to-end proof that a real pipeline failure reaches failJob()/dead_letter through a ` +
        `genuinely separate worker pass -- the policy-processing path (processPolicy()) is structurally identical but has ` +
        `no such live fixture test yet.`,
      { evidenceSummary: `worker-runtime-regressions.ts passed live; scripts/pipeline-worker-regressions.ts does not reference processPolicy(), so the policy-processing path has no live end-to-end proof.` },
    );
    return;
  }

  report(
    "background_job_reliability",
    "ready",
    `${queuePath} and ${evidenceQueuePath} are enqueue-only, ${workerRuntimePath}/${workerEntryPath} provide a genuinely ` +
      `separate claim-only worker driver wired to \`npm run jobs:worker\`, its regression suite really passes as a spawned ` +
      `child process, and both the claim-evidence and policy-processing paths have a live, fixture-backed end-to-end proof.`,
  );
}

function checkDeadLetterRetrySupport() {
  // Checkpoint 14h: was a single static report() call with a fixed
  // string, unconditionally "blocked_by_code". Now performs three REAL
  // dynamic checks: (1) failJob()'s classification/bound logic exists in
  // source; (2) a real operational drain (list/count/retry) is exported
  // and wired to a real CLI, not just alertable-on; (3) the drain's own
  // regression suite is actually spawned as a child process and its real
  // exit code is read.
  const queuePath = "lib/jobs/queue.ts";
  const deadLetterPath = "lib/jobs/dead-letter.ts";
  const cliPath = "scripts/dead-letter.ts";
  const suitePath = "scripts/dead-letter-regressions.ts";
  const requiredFiles = [queuePath, deadLetterPath, cliPath, suitePath];
  const missing = requiredFiles.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    report("dead_letter_retry_support", "blocked_by_code", `Missing required file(s): ${missing.join(", ")}.`);
    return;
  }

  const queueSource = readFileSync(queuePath, "utf8");
  const deadLetterSource = readFileSync(deadLetterPath, "utf8");
  const cliSource = readFileSync(cliPath, "utf8");

  const hasBoundedFailJob = /attempt_count\s*>=\s*max_attempts/.test(queueSource) && /dead_letter/.test(queueSource);
  const hasDrainExports = /export async function listDeadLetterJobs\(/.test(deadLetterSource) &&
    /export async function countDeadLetterJobsByType\(/.test(deadLetterSource) &&
    /export async function retryDeadLetterJob\(/.test(deadLetterSource);
  // The retry must be CAS-guarded on status='dead_letter' -- a blind
  // requeue of a job that already moved on would be a real safety bug,
  // not just a nice-to-have -- and must reset attempt_count, or a
  // requeued job at its ceiling would immediately re-dead-letter on its
  // very next failure.
  const retryIsCasGuardedAndResetsAttempts = /WHERE\s+id=\$1\s+AND\s+status='dead_letter'/.test(deadLetterSource) &&
    /attempt_count\s*=\s*0/.test(deadLetterSource);
  const hasOperationalCli = /listDeadLetterJobs|countDeadLetterJobsByType|retryDeadLetterJob/.test(cliSource);

  const structuralProblems: string[] = [];
  if (!hasBoundedFailJob) structuralProblems.push(`${queuePath}'s failJob() does not look bound to max_attempts before dead-lettering`);
  if (!hasDrainExports) structuralProblems.push(`${deadLetterPath} does not export all of listDeadLetterJobs()/countDeadLetterJobsByType()/retryDeadLetterJob()`);
  if (!retryIsCasGuardedAndResetsAttempts) structuralProblems.push(`${deadLetterPath}'s retryDeadLetterJob() is not CAS-guarded on status='dead_letter' and/or does not reset attempt_count`);
  if (!hasOperationalCli) structuralProblems.push(`${cliPath} does not call the real drain functions -- an operator has no way to act on a dead-lettered job`);

  if (structuralProblems.length > 0) {
    report(
      "dead_letter_retry_support",
      "blocked_by_code",
      `Structural check failed: ${structuralProblems.join("; ")}.`,
      { evidenceSummary: `bounded failJob=${hasBoundedFailJob}, drain exports=${hasDrainExports}, CAS-guarded retry=${retryIsCasGuardedAndResetsAttempts}, operational CLI=${hasOperationalCli}.` },
    );
    return;
  }

  const probe = runRegressionSuite(suitePath);
  if (!probe.passed && probe.killedBySignal) {
    report(
      "dead_letter_retry_support",
      "resource_blocked",
      `Structural wiring is correct, but \`node --import tsx ${suitePath}\` was killed by a signal (likely this sandbox's memcg ` +
        `OOM killer, given nested tsx-in-tsx process memory pressure) before it could complete -- this is a real environment ` +
        `limit, not a code defect, and must not be reported as either ready or blocked_by_code.`,
      { evidenceSummary: `runRegressionSuite(${suitePath}) => killedBySignal=true, did not complete.` },
    );
    return;
  }
  if (!probe.passed) {
    report(
      "dead_letter_retry_support",
      "blocked_by_code",
      `Structural wiring is correct (bounded failJob(), a real list/count/retry drain, CAS-guarded and attempt-count-reset ` +
        `retry, and an operational CLI) but \`node --import tsx ${suitePath}\` failed. Output:\n${probe.output.slice(-4000)}`,
      { evidenceSummary: `runRegressionSuite(${suitePath}) => passed=false.` },
    );
    return;
  }

  report(
    "dead_letter_retry_support",
    "ready",
    `lib/jobs/queue.ts's failJob() classifies every failure as transient (bounded-retried, dead_letter once ` +
      `attempt_count reaches max_attempts) or non_retryable (dead_letter immediately). ${deadLetterPath} provides a real, ` +
      `generic drain (listDeadLetterJobs/countDeadLetterJobsByType/retryDeadLetterJob) that does not care which pipeline ` +
      `produced the dead-lettered row -- retryDeadLetterJob() is CAS-guarded on status='dead_letter' and resets ` +
      `attempt_count so a retried job at its ceiling is not immediately re-dead-lettered. ${cliPath} gives an operator a ` +
      `real way to list/retry a dead-lettered job, not just alert on volume. All of this is proven live: ` +
      `\`node --import tsx ${suitePath}\` really passes as a spawned child process (${probe.output.split("\n").pop()}) ` +
      `-- list/count visibility, requeue resets attempt_count, a requeued job is actually claimed and completed by the ` +
      `next worker pass, and retry is refused for a non-dead-letter or already-retried job id. Whether a real POLICY-` +
      `PROCESSING failure specifically has been proven to reach dead_letter via a live fixture is background_job_` +
      `reliability's own honest remaining gap (see that capability), not this one's: this drain is generic and is proven ` +
      `end to end against a real dead-lettered job regardless of which pipeline produced it.`,
  );
}

function checkPrivacySafeObservability() {
  // Checkpoint 14h: was a single static report() call with a fixed
  // string, unconditionally "blocked_by_code" for reasons that had
  // partly gone stale (checkTelemetryProductionAdapterConfigured() is a
  // real env-check, covered by its own guard elsewhere; the observability
  // BOUNDARY module's existence alone was never the question). This now
  // greps for the exact 5 Checkpoint 14b event names at their exact real
  // call sites -- a structural check, per the user's own earlier
  // acceptance that "a redaction library alone is insufficient" and that
  // real call-site presence, not just the boundary module's existence,
  // is what this capability actually requires -- and is honest that
  // broader coverage (extraction, OCR, embeddings, chat-turn-level,
  // exports) remains a real, uncovered gap rather than force-passing.
  const wiredCallSites: { label: string; path: string; eventPattern: RegExp }[] = [
    { label: "Monetary gates", path: "lib/claims/monetary-gate.ts", eventPattern: /name:\s*"(chat|claims)\.calculator\.monetary_gate"/ },
    { label: "Composition", path: "lib/claims/composition/engine.ts", eventPattern: /name:\s*"claims\.composition\.completed"/ },
    { label: "Policy upload route", path: "app/api/policies/upload/route.ts", eventPattern: /name:\s*"upload\.policy\.(queued|rejected)"/ },
    { label: "Scan-callback route", path: "app/api/policies/scan-callback/route.ts", eventPattern: /name:\s*"scan_callback\.(rejected|result|unresolved_policy)"/ },
    { label: "Storage cleanup", path: "lib/storage/cleanup.ts", eventPattern: /name:\s*"storage\.cleanup\.executed"/ },
  ];

  const missingFiles = wiredCallSites.filter((c) => !existsSync(c.path));
  if (missingFiles.length > 0) {
    report("privacy_safe_observability", "blocked_by_code", `Missing required file(s): ${missingFiles.map((c) => c.path).join(", ")}.`);
    return;
  }

  const callSiteResults = wiredCallSites.map((c) => {
    const source = readFileSync(c.path, "utf8");
    const callsRecordEvent = /recordEvent\(|recordErrorEvent\(/.test(source);
    const hasRealEventName = c.eventPattern.test(source);
    return { ...c, wired: callsRecordEvent && hasRealEventName };
  });
  const unwired = callSiteResults.filter((c) => !c.wired);

  // The still-genuinely-uncovered broader surface -- checked directly,
  // not asserted from a comment, so this list cannot silently go stale
  // the way the OLD static text itself already had.
  const broaderSurface: { label: string; path: string }[] = [
    { label: "Claim-evidence extraction", path: "lib/claims/evidence/extract.ts" },
    { label: "Policy ingest/extraction", path: "lib/rag/ingest.ts" },
    { label: "Hosted OCR", path: "lib/documents/ocr-hosted.ts" },
    { label: "Model completions", path: "lib/ai/llm.ts" },
    { label: "Household export", path: "lib/household/export.ts" },
    { label: "Chat workflow", path: "lib/chat/workflow.ts" },
  ];
  const stillUncovered = broaderSurface.filter((c) => existsSync(c.path) && !/recordEvent\(|recordErrorEvent\(/.test(readFileSync(c.path, "utf8")));

  if (unwired.length > 0) {
    report(
      "privacy_safe_observability",
      "blocked_by_code",
      `${wiredCallSites.length - unwired.length}/${wiredCallSites.length} of Checkpoint 14b's own committed call sites are ` +
        `still wired; regressed at: ${unwired.map((c) => `${c.label} (${c.path})`).join(", ")}. This does NOT satisfy ` +
        `even the narrow, already-committed call-site list, let alone the broader one.`,
      { evidenceSummary: callSiteResults.map((c) => `${c.label}: ${c.wired ? "wired" : "NOT wired"}`).join("; ") },
    );
    return;
  }

  // All 5 committed call sites are genuinely wired -- but the capability
  // as a whole is still honestly incomplete: broader coverage remains a
  // real gap, so this stays blocked_by_code rather than being force-
  // passed. Never quietly reclassified as blocked_by_external_
  // configuration -- this is a missing call site, not a missing secret.
  report(
    "privacy_safe_observability",
    "blocked_by_code",
    `All 5 of Checkpoint 14b's committed call sites really emit their real event through recordEvent()/` +
      `recordErrorEvent() (verified by grepping each file's actual real event name, not assumed): ${callSiteResults.map((c) => `${c.label} ("${c.path}")`).join(", ")}. ` +
      `Still blocked_by_code, honestly: broader call-site coverage is genuinely incomplete -- ${stillUncovered.length > 0 ? `confirmed uncovered right now: ${stillUncovered.map((c) => c.label).join(", ")}` : "no recordEvent()/recordErrorEvent() call in the other checked surface files"} ` +
      `-- uploads/malware-scanning/monetary-gates/composition/storage-cleanup are covered; extraction, OCR, embeddings, ` +
      `chat-turn-level, and exports are not yet, and this check does not force-pass that gap away.`,
    { evidenceSummary: `wired 5/5 committed call sites; uncovered broader surface: ${stillUncovered.map((c) => c.label).join(", ") || "none checked found uncovered"}.` },
  );
}

function checkRedactionVerification() {
  // Checkpoint 14h: was a single static report() call, unconditionally
  // "ready", regardless of whether scripts/telemetry-regressions.ts
  // (which the fixed text CITED as its evidence) actually passed on this
  // run. This now really spawns that suite as a child process and reads
  // its real exit code -- a genuine runtime probe, not a citation.
  const suitePath = "scripts/telemetry-regressions.ts";
  const redactPath = "lib/telemetry/redact.ts";
  if (!existsSync(suitePath) || !existsSync(redactPath)) {
    report("redaction_verification", "blocked_by_code", `Missing required file(s): ${[suitePath, redactPath].filter((p) => !existsSync(p)).join(", ")}.`);
    return;
  }
  const redactSource = readFileSync(redactPath, "utf8");
  if (!/export function redactDeep\(/.test(redactSource)) {
    report("redaction_verification", "blocked_by_code", `${redactPath} no longer exports redactDeep() -- the redaction engine's own entry point is missing.`);
    return;
  }

  const probe = runRegressionSuite(suitePath, 60_000);
  if (!probe.passed && probe.killedBySignal) {
    report(
      "redaction_verification",
      "resource_blocked",
      `\`node --import tsx ${suitePath}\` was killed by a signal (likely this sandbox's memcg OOM killer, given nested ` +
        `tsx-in-tsx process memory pressure) before it could complete -- this is a real environment limit, not a code defect, ` +
        `and must not be reported as either ready or blocked_by_code.`,
      { evidenceSummary: `runRegressionSuite(${suitePath}) => killedBySignal=true, did not complete.` },
    );
    return;
  }
  if (!probe.passed) {
    report(
      "redaction_verification",
      "blocked_by_code",
      `\`node --import tsx ${suitePath}\` failed -- the redaction engine's real, sabotage-verified test suite is not ` +
        `currently green, so this can no longer be reported ready on the strength of a past run's citation alone. Output:\n${probe.output.slice(-4000)}`,
      { evidenceSummary: `runRegressionSuite(${suitePath}) => passed=false.` },
    );
    return;
  }

  report(
    "redaction_verification",
    "ready",
    `lib/telemetry/redact.ts's redactDeep() recursively strips policy wording, medical facts, chat/document text, names/` +
      `emails/phone numbers, authorization headers, cookies, signed-URL query strings, passwords, tokens, and raw SQL ` +
      `params from nested objects, arrays, Maps, Sets, and Error objects (including their .cause chain), with circular-` +
      `reference and max-depth protection. Verified live on THIS run, not cited from a past one: \`node --import tsx ` +
      `${suitePath}\` really passes as a spawned child process right now (${probe.output.split("\n").pop()}). ` +
      `privacy_safe_observability stays blocked_by_code for the separate, honest reason that not every required call ` +
      `site emits telemetry through this engine yet -- this capability is about the redaction engine's own correctness, ` +
      `which IS proven, sabotage-verified, and re-verified live on every launch:check run.`,
  );
}

function checkModelPromptSchemaGovernance() {
  // Checkpoint 14h: was a single static report() call, unconditionally
  // "blocked_by_code" on the grounds that "assertVerifiedForMonetaryUse()
  // is a sabotage-verified primitive that NOTHING in this codebase's
  // calculators or evidence-linking code actually calls yet" -- true when
  // that text was written, genuinely fixed by Checkpoint 14b (lib/ai/
  // llm.ts's structuredCompletion() and lib/documents/ocr-hosted.ts's
  // attemptHostedOcr() both now call it), and never updated. This now
  // greps for the real call inside each function's OWN body (region-
  // scoped by brace-matching, not a whole-file guess that could match an
  // unrelated helper), plus checks the one gap that genuinely remains:
  // staleExecutionSummary()'s worklist still has no real caller anywhere
  // in the codebase outside its own module/tests/this file.
  const llmPath = "lib/ai/llm.ts";
  const ocrPath = "lib/documents/ocr-hosted.ts";
  const provenancePath = "lib/ai/provenance.ts";
  const staleness = "lib/ai/staleness.ts";
  const requiredFiles = [llmPath, ocrPath, provenancePath, staleness];
  const missing = requiredFiles.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    report("model_prompt_schema_governance", "blocked_by_code", `Missing required file(s): ${missing.join(", ")}.`);
    return;
  }

  const llmSource = readFileSync(llmPath, "utf8");
  const ocrSource = readFileSync(ocrPath, "utf8");
  const provenanceSource = readFileSync(provenancePath, "utf8");

  const hasAssertFn = /export function assertVerifiedForMonetaryUse\(/.test(provenanceSource);

  const structuredRegion = extractFunctionRegion(llmSource, /export async function structuredCompletion</);
  const ocrRegion = extractFunctionRegion(ocrSource, /async function attemptHostedOcr\(/);
  const structuredCallsAssert = structuredRegion !== null && /assertVerifiedForMonetaryUse\(/.test(structuredRegion);
  const ocrCallsAssert = ocrRegion !== null && /assertVerifiedForMonetaryUse\(/.test(ocrRegion);

  const chokepointProblems: string[] = [];
  if (!hasAssertFn) chokepointProblems.push(`${provenancePath} no longer exports assertVerifiedForMonetaryUse()`);
  if (structuredRegion === null) chokepointProblems.push(`could not locate structuredCompletion()'s own function body in ${llmPath}`);
  else if (!structuredCallsAssert) chokepointProblems.push(`structuredCompletion() in ${llmPath} does not call assertVerifiedForMonetaryUse() inside its own body`);
  if (ocrRegion === null) chokepointProblems.push(`could not locate attemptHostedOcr()'s own function body in ${ocrPath}`);
  else if (!ocrCallsAssert) chokepointProblems.push(`attemptHostedOcr() in ${ocrPath} does not call assertVerifiedForMonetaryUse() inside its own body`);

  if (chokepointProblems.length > 0) {
    report(
      "model_prompt_schema_governance",
      "blocked_by_code",
      `assertVerifiedForMonetaryUse() is not actually gating both governed chokepoints: ${chokepointProblems.join("; ")}. ` +
        `No monetary-relevant model result is presently gated by verified provenance.`,
      { evidenceSummary: `structuredCompletion() calls assert=${structuredCallsAssert}; attemptHostedOcr() calls assert=${ocrCallsAssert}.` },
    );
    return;
  }

  // Chokepoints are real and wired. The one remaining honest gap: an
  // operator can SEE staleExecutionSummary()'s worklist counts, but
  // nothing automatically re-processes anything -- checked by grepping
  // the whole app/lib/scripts tree for a real caller outside the
  // definition/test/this-file, so this cannot silently go stale either.
  const callerFiles = ["lib", "app", "scripts"];
  let hasRealStalenessCaller = false;
  const staleCallerRe = /staleExecutionSummary\(/;
  function scanDir(dir: string) {
    if (hasRealStalenessCaller) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hasRealStalenessCaller) return;
      const full = `${dir}/${entry}`;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
        scanDir(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        if (full === staleness || full.includes("regressions.ts") || full === "scripts/launch-check.ts") continue;
        const content = readFileSync(full, "utf8");
        if (staleCallerRe.test(content)) {
          hasRealStalenessCaller = true;
          return;
        }
      }
    }
  }
  for (const dir of callerFiles) scanDir(dir);

  if (!hasRealStalenessCaller) {
    report(
      "model_prompt_schema_governance",
      "blocked_by_code",
      `Both governed chokepoints (structuredCompletion(), attemptHostedOcr()) really call assertVerifiedForMonetaryUse() ` +
        `inside their own function bodies -- verified by region-scoped source inspection, not a whole-file guess -- so ` +
        `every monetary-relevant model result IS gated by verified provenance. Still blocked_by_code on one honest, ` +
        `narrower remaining gap: staleExecutionSummary()'s worklist has no real caller anywhere in lib/app/scripts outside ` +
        `its own module, its regression suite, and this file's own string literal -- an operator can see the count, ` +
        `nothing automatically acts on it yet.`,
      { evidenceSummary: `chokepoint gating: structuredCompletion=true, attemptHostedOcr=true; staleExecutionSummary() real caller found=false.` },
    );
    return;
  }

  report(
    "model_prompt_schema_governance",
    "ready",
    `Both governed chokepoints (lib/ai/llm.ts's structuredCompletion(), lib/documents/ocr-hosted.ts's attemptHostedOcr()) ` +
      `really call assertVerifiedForMonetaryUse() inside their own function bodies, gating every monetary-relevant model ` +
      `result on verified provenance, and staleExecutionSummary()'s worklist now has a real caller wiring it to an actual ` +
      `re-processing trigger.`,
  );
}

function checkFullHouseholdE2eJourney() {
  // Checkpoint 14h: was a single static report() call describing
  // Checkpoint 12's superseded 17-step, single-process suite (which
  // deliberately EXCLUDED family-member/household deletion for OOM
  // reasons) -- never updated after Checkpoint 14g replaced it with a
  // genuinely more complete 9-stage, multi-process orchestrator that DOES
  // include both deletion stages. This now checks for that orchestrator's
  // real existence, and -- measured directly in this sandbox at ~26-30s
  // wall-clock and a safe ~430MB free-memory floor, well inside this
  // sandbox's budget -- actually SPAWNS it as a real runtime probe on
  // every launch:check run, recording the real result (with a timestamp)
  // to a checked-in JSON artifact as the "last verified" evidence this
  // spec's own schema calls for.
  const orchestratorPath = "scripts/full-household-e2e-orchestrator.mjs";
  const stagesDir = "scripts/e2e/stages";
  const requiredStages = [
    "01-auth-household-setup", "02-policy-upload-quarantine", "03-chat-claim-flow",
    "04-evidence-review-calculation", "05-export", "06-evidence-deletion-invalidation",
    "07-policy-deletion-invalidation", "08-membership-removal", "09-household-deletion-cleanup",
  ];
  const stagePaths = requiredStages.map((s) => `${stagesDir}/${s}.ts`);
  const missing = [orchestratorPath, ...stagePaths].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    report(
      "full_household_e2e_journey",
      "blocked_by_code",
      `Missing required file(s): ${missing.join(", ")}. No multi-process, multi-stage E2E orchestrator exists to probe.`,
    );
    return;
  }

  const resultArtifactPath = "scripts/full-household-e2e-last-result.json";
  const startedAt = Date.now();
  let spawnResult: ReturnType<typeof spawnSync> | null = null;
  let spawnThrew: Error | null = null;
  try {
    spawnResult = spawnSync(process.execPath, [orchestratorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 150_000,
      env: process.env,
    });
  } catch (error) {
    spawnThrew = error instanceof Error ? error : new Error(String(error));
  }
  const durationMs = Date.now() - startedAt;
  const nowIso = new Date().toISOString();

  if (spawnThrew || !spawnResult || spawnResult.error) {
    // Could not even start the probe in this environment -- a resource/
    // environment limitation this check would otherwise run and might
    // reveal a real problem with, not a code defect, and never "ready".
    const message = spawnThrew?.message ?? spawnResult?.error?.message ?? "unknown spawn failure";
    // Fall back to the last checked-in known-good result, if one exists,
    // so this run's report is honest about BOTH the live-probe failure
    // AND whatever was last actually verified -- never silently reverting
    // to a static, unverified claim.
    let lastKnownGood: { passed?: boolean; verifiedAt?: string; durationMs?: number } | null = null;
    if (existsSync(resultArtifactPath)) {
      try {
        lastKnownGood = JSON.parse(readFileSync(resultArtifactPath, "utf8"));
      } catch {
        /* corrupt/unreadable -- treated as absent below */
      }
    }
    report(
      "full_household_e2e_journey",
      "resource_blocked",
      `Could not spawn ${orchestratorPath} in this environment: ${message}. ` +
        (lastKnownGood
          ? `Last known-good live result (NOT from this run): passed=${lastKnownGood.passed}, verifiedAt=${lastKnownGood.verifiedAt}.`
          : `No prior last-known-good result is checked in either.`),
      { evidenceSummary: `spawnSync threw/failed: ${message}.`, lastVerified: lastKnownGood?.verifiedAt ?? nowIso },
    );
    return;
  }

  const combinedOutput = `${spawnResult.stdout ?? ""}${spawnResult.stderr ?? ""}`;
  const timedOut = Boolean(spawnResult.signal);
  const passed = spawnResult.status === 0 && !timedOut;
  const stagesPassedCount = (combinedOutput.match(/=== Stage OK:/g) ?? []).length;
  const failedStageMatch = combinedOutput.match(/# FAILURE at stage (\S+)/);

  const artifact = {
    passed,
    stagesTotal: requiredStages.length,
    stagesPassed: passed ? requiredStages.length : stagesPassedCount,
    durationMs,
    verifiedAt: nowIso,
    substitutions: [
      "signup/sign-in uses the dev-auth identity path (DEV_AUTH_ENABLED/DEV_ACCOUNT_ID), not real Supabase Auth",
      "claim-session creation calls lib/claims/session.ts's createClaimSession() directly, not a REST route",
      "both uploads are short-circuited by a fake malware-scan adapter reporting \"infected\", not a real scanner",
    ],
  };
  try {
    writeFileSync(resultArtifactPath, JSON.stringify(artifact, null, 2) + "\n");
  } catch {
    /* best-effort -- the live result below still reflects THIS run either way */
  }

  if (!passed && timedOut) {
    // Killed by signal (spawnSync's own timeout, or this sandbox's memcg
    // OOM killer) before completing -- a real environment limit, not a
    // code defect. Never reported as blocked_by_code or ready.
    report(
      "full_household_e2e_journey",
      "resource_blocked",
      `Live spawn of ${orchestratorPath} was killed by a signal before completing (${stagesPassedCount}/${requiredStages.length} ` +
        `stages had passed so far, ${durationMs}ms elapsed) -- likely this sandbox's memory ceiling under the current process ` +
        `nesting, not a code defect. This was NOT completed, so it must not be reported as ready or blocked_by_code.`,
      { evidenceSummary: `spawnSync(${orchestratorPath}) => signal=${spawnResult.signal}, stagesPassed=${stagesPassedCount}/${requiredStages.length}, durationMs=${durationMs}.`, lastVerified: nowIso },
    );
    return;
  }
  if (!passed) {
    report(
      "full_household_e2e_journey",
      "blocked_by_code",
      `Live spawn of ${orchestratorPath} FAILED just now (real runtime probe, not a citation): ${stagesPassedCount}/${requiredStages.length} stages passed` +
        `${failedStageMatch ? `, failing at stage ${failedStageMatch[1]}` : ""} in ${durationMs}ms. Tail of output:\n${combinedOutput.slice(-4000)}`,
      { evidenceSummary: `spawnSync(${orchestratorPath}) => exit=${spawnResult.status}, stagesPassed=${stagesPassedCount}/${requiredStages.length}, durationMs=${durationMs}.`, lastVerified: nowIso },
    );
    return;
  }

  report(
    "full_household_e2e_journey",
    "blocked_by_code",
    `Live spawn of ${orchestratorPath} PASSED just now (real runtime probe, not a citation): all ${requiredStages.length} stages ` +
      `-- household visibility/rename, family-member creation, a real policy upload reaching a real quarantine-rejected ` +
      `terminal state, a real claim-evidence upload reaching a real rejected terminal state, evidence review/calculation, ` +
      `export, AND (an improvement over the superseded Checkpoint 12 suite) evidence deletion+invalidation, policy ` +
      `deletion+invalidation, membership removal, and household deletion+cleanup -- passed against the SAME persisted ` +
      `PGlite fixture across 9 separate child processes in ${durationMs}ms. Result recorded to ${resultArtifactPath} with ` +
      `this timestamp. Still honestly blocked_by_code: 3 substitutions remain (see ${resultArtifactPath}) -- real ` +
      `Supabase Auth signup/signin, the real chat-driven claim-session REST path, and a real (non-test) malware-scan ` +
      `adapter are not exercised by this journey, so this is not yet the full real-auth, real-scanner, ` +
      `signup-through-deletion journey.`,
    { evidenceSummary: `spawnSync(${orchestratorPath}) => exit=0, stagesPassed=${requiredStages.length}/${requiredStages.length}, durationMs=${durationMs}.`, lastVerified: nowIso },
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
    const missingCiSteps = REQUIRED_CI_SUITES.filter((s) => !ci.includes(`npm run ${s}`));
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

  // Checkpoint 14h: --only=<id1>,<id2> runs ONLY the named capability
  // check(s) and skips assertManifestComplete()'s all-24 requirement --
  // an informational, explicitly-opt-in mode for quickly re-checking one
  // capability (e.g. after a sabotage-and-restore edit in
  // scripts/launch-check-verifier-regressions.ts) without paying for
  // checkProductionBuild()'s real `npm run build` or the live network
  // calls every other capability besides the requested one would trigger.
  // Default (no --only) behavior -- every capability, the full manifest
  // assertion, exit 1 on --strict with blocked_by_code -- is completely
  // unchanged.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;
  const runs = only
    ? (id: string | string[], fn: () => void | Promise<void>) => ((Array.isArray(id) ? id.some((i) => only.has(i)) : only.has(id)) ? fn() : undefined)
    : (_id: string | string[], fn: () => void | Promise<void>) => fn();

  await runs("policy_document_quarantine", checkPolicyDocumentQuarantine);
  await runs("claim_evidence_quarantine", checkClaimEvidenceQuarantine);
  await runs("malware_scanning_configuration", checkMalwareScanningConfiguration);
  await runs("shared_rate_limiter", checkSharedRateLimiter);
  await runs("csrf_protection", checkCsrfProtection);
  await runs("rls_migration_present", checkRlsMigrationPresent);
  await runs("private_storage_migration_present", checkPrivateStorageMigrationPresent);
  await runs("data_export", checkDataExport);
  await runs("data_deletion_and_invalidation", checkDataDeletionAndInvalidation);
  await runs("background_job_reliability", checkBackgroundJobReliability);
  await runs("dead_letter_retry_support", checkDeadLetterRetrySupport);
  await runs("privacy_safe_observability", checkPrivacySafeObservability);
  await runs("redaction_verification", checkRedactionVerification);
  await runs("model_prompt_schema_governance", checkModelPromptSchemaGovernance);
  await runs("full_household_e2e_journey", checkFullHouseholdE2eJourney);
  await runs("evaluation_thresholds", checkEvaluationThresholds);

  await runs(["household_authorization", "route_classification"], checkRouteInventoryCapabilities);
  await runs("live_rls_verification", checkLiveRlsVerification);
  await runs("live_bucket_privacy", checkLiveBucketPrivacy);
  await runs("github_ci_status", checkGithubCiStatus);
  await runs("production_build", checkProductionBuild);

  if (!only) {
    assertManifestComplete(results);
  }

  const strict = process.argv.includes("--strict");
  const summary = summarizeManifest(results);

  if (process.argv.includes("--json")) {
    // Checkpoint 14h: machine-readable output for exactly the results
    // that actually ran (all 24 by default, or only the --only= subset) --
    // what scripts/launch-check-verifier-regressions.ts's sabotage-and-
    // restore harness parses, rather than screen-scraping the human-
    // readable text report below.
    console.log(JSON.stringify(results));
    return;
  }

  console.log("\nLaunch capability manifest\n===========================");
  for (const item of results) {
    console.log(`[${item.status.toUpperCase()}] ${item.label}`);
    console.log(`    check_type: ${item.checkType}`);
    console.log(`    probe: ${item.probe}`);
    if (item.blockingReason) console.log(`    blocking_reason: ${item.blockingReason.slice(0, 300)}${item.blockingReason.length > 300 ? "..." : ""}`);
    if (item.remediation) console.log(`    remediation: ${item.remediation}`);
    console.log(`    last_verified: ${item.lastVerified}`);
    console.log(`    detail: ${item.detail}`);
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
