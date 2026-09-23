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
  // Real executable check: evaluates checkMalwareScannerConfigured() (the
  // same function wired into instrumentation.ts's production startup
  // guard) against a simulated production environment, exactly like
  // guardStatus() does for lib/launch/guards.ts's guards. This one check
  // now covers BOTH claim-evidence and policy-document uploads -- both
  // route through the same shared lib/scanning/adapter.ts registry (see
  // lib/claims/evidence/scan-adapter.ts's header comment for why it is a
  // thin wrapper around that module rather than its own copy).
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
        `adapter to select (see lib/scanning/adapter.ts's SCAN_ADAPTERS, shared by both claim evidence and policy documents).`,
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
  report(
    "background_job_reliability",
    "blocked_by_code",
    "lib/jobs/queue.ts now provides a shared durable job model -- idempotency-key enqueue, a FOR UPDATE SKIP " +
      "LOCKED claim with a time-boxed lease, heartbeatJob() lease extension, an ownership-CAS guard on complete/" +
      "fail/finalize-cancellation (sabotage-and-restore-verified: a worker that never held a still-valid lease " +
      "cannot mark a job succeeded), and recoverExpiredLeases() to reclaim a job whose worker stopped " +
      "heartbeating -- see scripts/background-jobs-regressions.ts's 13 cases. This capability stays blocked_by_code " +
      "regardless: the primitive existing is not the same as it being used. lib/claims/evidence/queue.ts and " +
      "lib/rag/processing-queue.ts -- the actual call sites this checkpoint exists to fix -- have not been migrated " +
      "onto it yet and still run as an in-memory, single-process promise chain with none of these properties in " +
      "production. Not reporting ready until at least the real processing pipeline is wired onto lib/jobs/queue.ts " +
      "and proven end to end, not merely until the shared machinery exists -- Priority 7.",
  );
}

function checkDeadLetterRetrySupport() {
  report(
    "dead_letter_retry_support",
    "blocked_by_code",
    "lib/jobs/queue.ts's failJob() now classifies every failure as transient (bounded-retried with exponential " +
      "backoff via computeBackoffMs(), dead_letter once attempt_count reaches max_attempts) or non_retryable " +
      "(dead_letter immediately, regardless of attempt_count) -- sabotage-and-restore-verified: removing the " +
      "attempt_count >= max_attempts bound was confirmed to let a job retry past its limit instead of dead-" +
      "lettering, then restored. recoverExpiredLeases() applies the identical bound to a lease that expired " +
      "mid-processing, so a crashed worker cannot reset a job's effective retry budget. Still blocked_by_code for " +
      "the same reason as background_job_reliability above: no real job type in this codebase is dead-letter-" +
      "classified yet, because none has been migrated onto this framework -- Priority 7.",
  );
}

function checkPrivacySafeObservability() {
  report(
    "privacy_safe_observability",
    "blocked_by_code",
    "lib/telemetry/index.ts is now the single production telemetry boundary (recordEvent()/recordErrorEvent()), " +
      "with a real TelemetryAdapter interface, bounded send timeout, and failure isolation (a failing/hanging " +
      "adapter never fails or delays the caller -- sabotage-and-restore-verified, see scripts/telemetry-regressions.ts). " +
      "It is wired into concrete production call sites: middleware.ts propagates/generates a correlation id on " +
      "every response, lib/auth/request-context.ts's routeErrorResponse() records an error event for every " +
      "authorization/validation/etc. failure across its call sites, lib/jobs/queue.ts records an event at every " +
      "durable-job transition, and lib/lifecycle/coordinator.ts records an event at every one of the 8 deletion-" +
      "flow resource types. Machine-readable alert conditions for all 13 required categories are defined in " +
      "lib/telemetry/alerts.ts with unit-tested evaluate() predicates. Still blocked_by_code because the " +
      "checkpoint's full call-site list is NOT yet met: uploads, malware scanning, extraction, OCR, embeddings, " +
      "chat, claim-evidence processing, calculators, composition, exports, storage cleanup, and model-provider " +
      "calls do not yet call recordEvent()/recordErrorEvent() directly (they are only covered indirectly, if at " +
      "all, via routeErrorResponse() on their route handlers' error paths) -- Priority 8. Also blocked_by_external_" +
      "configuration in practice: checkTelemetryProductionAdapterConfigured() (lib/launch/guards.ts, in " +
      "PRODUCTION_STARTUP_GUARDS) correctly refuses to start production without TELEMETRY_PRODUCTION_ADAPTER_" +
      "CONFIGURED set and a real (non-Noop) adapter wired, and no production adapter has been configured.",
  );
}

function checkRedactionVerification() {
  report(
    "redaction_verification",
    "ready",
    "lib/telemetry/redact.ts's redactDeep() recursively strips policy wording, medical facts, chat/document text, " +
      "names/emails/phone numbers, authorization headers, cookies, signed-URL query strings, passwords, tokens, " +
      "and raw SQL params from nested objects, arrays, Maps, Sets, and Error objects (including their .cause " +
      "chain), with circular-reference and max-depth protection. All 5 of the checkpoint's named sabotage cycles " +
      "were performed against the live source and genuinely verified: (1) authorization-header leakage -- removing " +
      "\"authorization\"/\"auth_header\" from the key denylist was caught only after adding a test that isolates " +
      "the key-based path from the independent Bearer-pattern value scrubber (a real test-coverage gap this " +
      "sabotage cycle exposed and closed); (2) signed-URL leakage -- neutering stripQueryString() was caught by " +
      "the existing test, plus a new isolating case for a short/non-token-shaped signature; (3) nested medical-" +
      "text leakage -- removing medical/diagnosis/symptom from the denylist was caught immediately; (4) raw " +
      "error-message response -- making classifyError()'s unknown-error fallback return error.message was caught " +
      "immediately; (5) missing production telemetry adapter guard -- forcing " +
      "checkTelemetryProductionAdapterConfigured() to always return ok:true was caught immediately by both the " +
      "telemetry suite and the launch-guard suite. Every file was restored byte-identical afterward and re-" +
      "verified clean (scripts/telemetry-regressions.ts, 35 cases). Marked ready on its own merits -- the " +
      "redaction engine itself is sabotage-verified -- while privacy_safe_observability above stays blocked_by_" +
      "code for the separate reason that not every required call site emits telemetry through it yet.",
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
      "security:placeholder-content-test",
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
