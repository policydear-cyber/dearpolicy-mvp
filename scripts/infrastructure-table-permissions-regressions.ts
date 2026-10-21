/**
 * Infrastructure-table permissions, proven at the database.
 *
 * A browser holding a Supabase JWT reaches Postgres as `anon` or
 * `authenticated`. On Supabase every new public table is granted to both
 * roles by default privileges, so a table without RLS/revokes is readable
 * and writable by any signed-in user through the Data API. This suite
 * reproduces that: it creates the Supabase roles, sets the same default
 * privileges, applies every migration in the runbook order, and then:
 *
 *   1. derives the table list from sql/*.sql and requires every table to be
 *      classified in lib/db/table-inventory.ts;
 *   2. for every service/worker/operator-only table, requires anon, a
 *      household member, a household owner, a reviewer and another
 *      household to be refused SELECT/INSERT/UPDATE/DELETE/TRUNCATE (and
 *      nextval on its sequences), with no existence signal;
 *   3. requires household-read-only tables to refuse every direct write;
 *   4. checks RLS, policies, grants, SECURITY DEFINER functions and views;
 *   5. proves the legitimate server/worker/operator paths still work.
 *
 * Every matrix cell is recorded; the suite prints every unauthorized path
 * it finds and fails if any exist, and it fails if it exits before its
 * completion sentinel.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { discoverMigrationTables, inventoryDrift, INFRASTRUCTURE_TABLES, HOUSEHOLD_READ_ONLY_TABLES, TABLE_INVENTORY } from "@/lib/db/table-inventory";

/** docs/migration-runbook.md section 3, in order (storage-rls.sql needs Supabase Storage and is covered by security:storage-rls-test). */
export const MIGRATION_ORDER = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/processing-failure-diagnostics.sql", "sql/storage-purge.sql", "sql/household-rls.sql", "sql/infrastructure-rls.sql",
  // Optional household tables (each needs household-rls.sql and sets its own RLS, policies and grants).
  "sql/policy-member-exclusions.sql", "sql/detected-name-dismissals.sql",
];

let finished = false;
process.on("beforeExit", () => {
  if (!finished && !process.exitCode) { console.error("infrastructure-table permissions regressions did not finish (a pending operation never settled)"); process.exitCode = 1; }
});

const failures: string[] = [];
let checks = 0;
function record(ok: boolean, label: string) { checks++; if (!ok) failures.push(label); }
const DENIED = /permission denied/i;
const fixed = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
function asUser(userId: string) { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; }

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;

  // --- Supabase's roles and default privileges, before any migration ----
  await db.exec(`
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  for (const file of MIGRATION_ORDER) {
    if (!existsSync(path.resolve(file))) { record(false, `migration missing: ${file}`); continue; }
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }

  // --- the app's pool on this database: service statements run as the
  // owner; a client that switches to `authenticated` (createUserSupabaseClient)
  // runs its statements as that role. One statement at a time.
  let lock = Promise.resolve();
  const serial = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock; let release!: () => void; lock = new Promise<void>((r) => { release = r; });
    await prev; try { return await fn(); } finally { release(); }
  };
  const run = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text); const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = ((text: string, params: unknown[] = []) => serial(() => run(text, params))) as typeof pool.query;
  pool.connect = (async () => {
    let userRole = false;
    return {
      query: (text: string, params: unknown[] = []) => serial(async () => {
        const sql = text.trim();
        if (/^SET LOCAL ROLE authenticated$/i.test(sql)) { userRole = true; return { rows: [], rowCount: 0 }; }
        if (!userRole || /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return run(text, params);
        await db.query("SET ROLE authenticated");
        try { return await run(text, params); } finally { await db.query("RESET ROLE"); }
      }),
      release: () => {},
    };
  }) as typeof pool.connect;

  const ownerA = fixed("b9700000", 1), memberA = fixed("b9700000", 2), ownerB = fixed("b9700000", 3), reviewer = fixed("b9700000", 4);
  const householdA = fixed("a9700000", 1), householdB = fixed("a9700000", 2);
  const personA = fixed("d9700000", 1), removable = fixed("d9700000", 2), claimA = fixed("e9700000", 1), policyA = fixed("f9700000", 1);

  // Direct browser session: role + JWT subject, always rolled back.
  async function asBrowser<T>(who: { role: "anon" | "authenticated"; userId: string | null }, fn: () => Promise<T>): Promise<T> {
    return serial(async () => {
      await db.query("BEGIN");
      try {
        await db.query(`SET LOCAL ROLE ${who.role}`);
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [who.userId ?? ""]);
        return await fn();
      } finally { await db.query("ROLLBACK"); }
    });
  }
  const attempt = async (who: { role: "anon" | "authenticated"; userId: string | null }, sql: string, params: unknown[] = []) =>
    asBrowser(who, async () => { try { const r = await db.query(sql, params); return { ok: true as const, rows: r.rows.length, error: "" }; } catch (e) { return { ok: false as const, rows: 0, error: (e as Error).message }; } });

  try {
    // --- fixtures (service connection) ---------------------------------
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Household A'),($2,'Household B')`, [householdA, householdB]);
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`, [householdA, ownerA, memberA, householdB, ownerB]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$3,'Person A','Person A','self'),($2,$3,'Typo profile','Typo profile','other')`, [personA, removable, householdA]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death')`, [claimA, householdA, personA]);
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority,effective_date,file_hash,quarantine_status)
       VALUES($1,$2,$3,'Insurer','Policy','certificate',true,'ready','policy.pdf','k',90,'2020-01-01','sha256:p','scan_clean')`, [policyA, householdA, personA]);

    // === 1. inventory ====================================================
    const discovered = discoverMigrationTables();
    const drift = inventoryDrift(discovered);
    record(drift.unclassified.length === 0, `unclassified tables (add them to lib/db/table-inventory.ts): ${drift.unclassified.join(", ")}`);
    record(drift.stale.length === 0, `inventory lists tables no migration creates: ${drift.stale.join(", ")}`);
    const live = (await pool.query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')`)).rows.map((r) => r.relname);
    for (const t of live) record(t in TABLE_INVENTORY, `table in the migrated database but not classified: ${t}`);

    // === 5. legitimate server / worker / operator paths ===================
    const behaviour: string[] = [];
    async function control(name: string, fn: () => Promise<void>) {
      try { await fn(); behaviour.push(name); checks++; } catch (e) { failures.push(`control failed: ${name}: ${(e as Error).message}`); }
    }
    const admin = await import("@/lib/claims/reviewers/admin");
    const { enqueueJob, claimNextJob, heartbeatJob, completeJob, failJob } = await import("@/lib/jobs/queue");
    const { retryDeadLetterJob } = await import("@/lib/jobs/dead-letter");
    const { createDbRateLimiter } = await import("@/lib/http/db-rate-limit");
    const { withCleanupLock, appendCleanupAudit } = await import("@/lib/storage/cleanup");
    const { recordCallbackEventOnce } = await import("@/lib/scanning/callback-auth");
    const { recordModelExecution } = await import("@/lib/ai/provenance");
    const { createUserSupabaseClient } = await import("@/lib/db/authz-client");
    const { requestPolicyDocumentDeletion } = await import("@/lib/lifecycle/coordinator");
    let jobA = "";

    await control("reviewer provisioning and assignment through the operator boundary", async () => {
      await admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
      const a = await admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdA, claimSessionId: claimA, expiresInHours: 24, operator: "ops.lead" });
      assert.ok(a.assignmentId);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM claim_reviewer_audit_log`)).rows[0].n >= 2, true);
    });
    await control("durable jobs: enqueue, claim, heartbeat, complete", async () => {
      const { row } = await enqueueJob(pool, { jobType: "infra-test", idempotencyKey: "k-1", accountId: householdA, payload: { n: 1 } });
      jobA = row.id;
      const claimed = await claimNextJob(pool, { jobType: "infra-test", workerId: "worker-1" });
      assert.equal(claimed?.id, row.id);
      await heartbeatJob(pool, { jobId: row.id, workerId: "worker-1" });
      assert.equal((await completeJob(pool, { jobId: row.id, workerId: "worker-1" })).status, "succeeded");
    });
    await control("durable jobs: bounded retry into dead-letter, then operator retry", async () => {
      const { row } = await enqueueJob(pool, { jobType: "infra-test-dl", idempotencyKey: "k-2", accountId: householdA, maxAttempts: 1 });
      await claimNextJob(pool, { jobType: "infra-test-dl", workerId: "worker-2" });
      assert.equal((await failJob(pool, { jobId: row.id, workerId: "worker-2", errorCategory: "transient", errorMessage: "timeout" })).status, "dead_letter");
      assert.equal((await retryDeadLetterJob(row.id)).status, "queued");
    });
    await control("cross-instance rate limiting on the shared bucket table", async () => {
      const a = createDbRateLimiter({ name: "infra-test-signin", windowMs: 60_000, max: 2 });
      const b = createDbRateLimiter({ name: "infra-test-signin", windowMs: 60_000, max: 2 });
      assert.equal((await a.attempt("203.0.113.9")).allowed, true);
      assert.equal((await b.attempt("203.0.113.9")).allowed, true);
      assert.equal((await a.attempt("203.0.113.9")).allowed, false, "the third attempt across two instances is refused");
    });
    await control("deletion request created through the authorised route (DELETE /api/family/[id])", async () => {
      const { DELETE } = await import("@/app/api/family/[id]/route");
      asUser(ownerA);
      const res = await DELETE(new NextRequest(`http://localhost/api/family/${removable}`, { method: "DELETE", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` } }), { params: Promise.resolve({ id: removable }) });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM deletion_requests WHERE account_id=$1 AND resource_id=$2`, [householdA, removable])).rows[0].n, 1);
      assert.ok((await pool.query(`SELECT count(*)::int AS n FROM deletion_audit_log WHERE account_id=$1`, [householdA])).rows[0].n >= 1);
    });
    await control("deletion coordinator processing under the household's RLS-scoped client (policy document; server-written audit)", async () => {
      const outcome = await createUserSupabaseClient(ownerA, (client) => requestPolicyDocumentDeletion({
        client, accountId: householdA, actorUserId: ownerA, policyId: policyA, reasonCategory: "user_requested", idempotencyKey: "del-policy-a",
      }));
      assert.equal(outcome.status, "accepted");
      assert.equal((await pool.query(`SELECT lifecycle_state FROM policies WHERE id=$1`, [policyA])).rows[0].lifecycle_state, "pending_deletion");
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM policy_document_audit_log WHERE policy_id=$1 AND action='deleted'`, [policyA])).rows[0].n, 1);
    });
    await control("household export requested through the route and completed by a worker pass", async () => {
      const { POST } = await import("@/app/api/household/export/route");
      const { HOUSEHOLD_EXPORT_JOB_TYPE } = await import("@/lib/household/export-queue");
      const { processHouseholdExportJob } = await import("@/lib/jobs/household-export-processor");
      const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
      asUser(ownerA);
      const res = await POST(new NextRequest("http://localhost/api/household/export", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "Idempotency-Key": "export-1" } }));
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(await claimAndProcessOne({ jobType: HOUSEHOLD_EXPORT_JOB_TYPE, workerId: "export-worker", process: processHouseholdExportJob }), "succeeded");
      assert.equal((await pool.query(`SELECT status FROM household_exports WHERE household_id=$1`, [householdA])).rows[0].status, "ready");
    });
    await control("storage-cleanup locking and audit persistence", async () => {
      await withCleanupLock(pool, "local:claim-evidence", async () => {
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM storage_cleanup_locks WHERE lock_key='local:claim-evidence'`)).rows[0].n, 1);
        await appendCleanupAudit(pool, { driver: "local", domain: "claim-evidence", action: "object_skipped_referenced", displayKey: "a…b", manifestHash: "sha256:m", actor: "operator:test" });
      });
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM storage_cleanup_locks`)).rows[0].n, 0, "lock released");
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM storage_cleanup_audit_log`)).rows[0].n, 1);
    });
    await control("scan-callback replay protection", async () => {
      assert.equal(await recordCallbackEventOnce("virustotal", "evt-1"), true);
      assert.equal(await recordCallbackEventOnce("virustotal", "evt-1"), false);
    });
    await control("model-execution provenance persistence", async () => {
      const rec = await recordModelExecution({
        attemptGroupId: randomUUID(), attemptIndex: 0, operation: "policy_extraction", role: "reading", householdId: householdA,
        requested: { provider: "anthropic", model: "claude-haiku-4-5", capability: "reading" }, requestedAt: new Date(),
        resolved: { resolvedModel: "claude-haiku-4-5-20250514", providerRequestId: "msg_1", finishReason: "end_turn", region: null },
        status: "succeeded", usage: { input: 1, output: 1 }, latencyMs: 1,
      } as never);
      assert.ok(rec?.id);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM model_executions WHERE id=$1`, [rec!.id])).rows[0].n, 1);
    });

    // === 2. the browser-role matrix ======================================
    const identities = [
      { name: "anon", role: "anon" as const, userId: null },
      { name: "household member", role: "authenticated" as const, userId: memberA },
      { name: "household owner", role: "authenticated" as const, userId: ownerA },
      { name: "reviewer", role: "authenticated" as const, userId: reviewer },
      { name: "other household", role: "authenticated" as const, userId: ownerB },
    ];
    // An ordinary (non-identity, non-generated) column, so the UPDATE probe
    // reaches the privilege check rather than an identity-column error.
    const firstColumn = async (t: string) => (await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_identity='NO' AND is_generated='NEVER'
         AND coalesce(column_default,'') NOT LIKE 'nextval(%' ORDER BY ordinal_position LIMIT 1`, [t])).rows[0].column_name;
    let matrix = 0;
    for (const t of INFRASTRUCTURE_TABLES) {
      if (!live.includes(t)) { record(false, `infrastructure table not created by the migrations: ${t}`); continue; }
      const col = await firstColumn(t);
      const ops: [string, string][] = [
        ["select", `SELECT * FROM public.${t} LIMIT 1`], ["insert", `INSERT INTO public.${t} DEFAULT VALUES`],
        ["update", `UPDATE public.${t} SET ${col}=${col}`], ["delete", `DELETE FROM public.${t}`], ["truncate", `TRUNCATE public.${t}`],
      ];
      const sequences = (await pool.query<{ seq: string | null }>(
        `SELECT pg_get_serial_sequence(format('public.%I',$1::text), column_name) AS seq FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).rows
        .map((r) => r.seq).filter((s): s is string => !!s);
      for (const who of identities) {
        for (const [op, sql] of ops) {
          const r = await attempt(who, sql); matrix++;
          record(!r.ok && DENIED.test(r.error), `${who.name} can ${op.toUpperCase()} ${t}${r.ok ? ` (returned ${r.rows} rows)` : ` (${r.error})`}`);
        }
        for (const seq of sequences) {
          const r = await attempt(who, `SELECT nextval($1::regclass)`, [seq]); matrix++;
          record(!r.ok && DENIED.test(r.error), `${who.name} can advance sequence ${seq}`);
        }
      }
    }
    // No existence signal: another household gets the same refusal for a real row as for a missing one.
    if (jobA) {
      const real = await attempt({ role: "authenticated", userId: ownerB }, `UPDATE public.background_jobs SET status=status WHERE id=$1`, [jobA]);
      const missing = await attempt({ role: "authenticated", userId: ownerB }, `UPDATE public.background_jobs SET status=status WHERE id=$1`, [randomUUID()]);
      record(real.error === missing.error && !real.ok, `another household can distinguish an existing background job (${real.error} vs ${missing.error})`);
    }

    // === 3. household-readable tables: reads scoped, every direct write refused
    for (const t of HOUSEHOLD_READ_ONLY_TABLES) {
      const col = await firstColumn(t);
      for (const who of identities.filter((i) => i.role === "authenticated")) {
        for (const [op, sql] of [["insert", `INSERT INTO public.${t} DEFAULT VALUES`], ["update", `UPDATE public.${t} SET ${col}=${col}`], ["delete", `DELETE FROM public.${t}`], ["truncate", `TRUNCATE public.${t}`]] as const) {
          const r = await attempt(who, sql); matrix++;
          record(!r.ok && DENIED.test(r.error), `${who.name} can ${op.toUpperCase()} household-read-only ${t}${r.ok ? "" : ` (${r.error})`}`);
        }
      }
      const other = await attempt({ role: "authenticated", userId: ownerB }, `SELECT 1 FROM public.${t} WHERE account_id=$1`, [householdA]); matrix++;
      record(other.ok && other.rows === 0, `another household can read ${t} rows of household A`);
    }
    const ownAudit = await attempt({ role: "authenticated", userId: ownerA }, `SELECT 1 FROM public.policy_document_audit_log WHERE account_id=$1`, [householdA]);
    record(ownAudit.ok && ownAudit.rows >= 1, "control: a household can still read its own policy audit trail");

    // === 3b. optional household-writable tables: own household only ======
    // policy_member_exclusions ("does not cover this person") and policy_name_dismissals ("not in my family").
    await pool.query(`INSERT INTO policy_member_exclusions(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [policyA, personA, householdA]);
    await pool.query(`INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'someone else','Someone Else')`, [policyA, householdA]);
    for (const [t, insert, params, forgedParams] of [
      ["policy_member_exclusions", `INSERT INTO public.policy_member_exclusions(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [policyA, removable, householdA], [policyA, removable, householdB]],
      ["policy_name_dismissals", `INSERT INTO public.policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'another name','Another Name')`, [policyA, householdA], [policyA, householdB]],
    ] as const) {
      for (const [op, sql] of [["SELECT", `SELECT 1 FROM public.${t}`], ["INSERT", insert], ["DELETE", `DELETE FROM public.${t}`]] as const) {
        const r = await attempt({ role: "anon", userId: null }, sql, op === "INSERT" ? [...params] : []); matrix++;
        record(!r.ok && DENIED.test(r.error), `anon can ${op} ${t}${r.ok ? "" : ` (${r.error})`}`);
      }
      const read = await attempt({ role: "authenticated", userId: ownerB }, `SELECT 1 FROM public.${t} WHERE account_id=$1`, [householdA]); matrix++;
      record(read.ok && read.rows === 0, `another household can read ${t} rows of household A`);
      const write = await attempt({ role: "authenticated", userId: ownerB }, insert, [...params]); matrix++;
      record(!write.ok, `another household can write a ${t} row for household A`);
      const forged = await attempt({ role: "authenticated", userId: ownerB }, insert, [...forgedParams]); matrix++;
      record(!forged.ok, `another household can file a ${t} row under its own household naming household A's document`);
      const removed = await attempt({ role: "authenticated", userId: ownerB }, `DELETE FROM public.${t} WHERE account_id=$1 RETURNING 1`, [householdA]); matrix++;
      record(removed.ok && removed.rows === 0, `another household can delete ${t} rows of household A`);
      const own = await attempt({ role: "authenticated", userId: memberA }, `SELECT 1 FROM public.${t} WHERE account_id=$1`, [householdA]);
      record(own.ok && own.rows === 1, `control: a member of household A cannot read its own ${t} row (${own.error})`);
      const ownWrite = await attempt({ role: "authenticated", userId: memberA }, insert, [...params]);
      record(ownWrite.ok, `control: a member of household A cannot add a ${t} row (${ownWrite.error})`);
    }

    // Lifecycle specifics named in the requirements.
    for (const [label, sql] of [
      ["mark a deletion request complete", `UPDATE public.deletion_requests SET lifecycle_state='soft_deleted', completed_at=now() WHERE account_id='${householdA}'`],
      ["shorten retention", `UPDATE public.deletion_requests SET retention_deadline=now() WHERE account_id='${householdA}'`],
      ["modify deletion audit history", `DELETE FROM public.deletion_audit_log WHERE account_id='${householdA}'`],
      ["mark an export ready", `UPDATE public.household_exports SET status='ready' WHERE household_id='${householdA}'`],
      ["choose an export storage key", `UPDATE public.household_exports SET storage_key='other/key' WHERE household_id='${householdA}'`],
      ["extend export expiry", `UPDATE public.household_exports SET expires_at=now()+interval '10 years' WHERE household_id='${householdA}'`],
      ["forge a cleanup result", `INSERT INTO public.storage_cleanup_audit_log(driver,domain,action,display_key,manifest_hash,actor) VALUES('local','claim-evidence','object_deleted','x','x','x')`],
      ["acquire a cleanup lock", `INSERT INTO public.storage_cleanup_locks(lock_key,holder) VALUES('local:claim-evidence','me')`],
      ["enqueue a job", `INSERT INTO public.background_jobs(job_type,idempotency_key,payload) VALUES('household_export','x','{}')`],
      ["claim/heartbeat/complete a job", `UPDATE public.background_jobs SET status='succeeded', lease_owner='me'`],
      ["reset the plan spend ledger", `DELETE FROM public.model_usage WHERE account_id='${householdA}'`],
    ] as const) {
      for (const who of [identities[1], identities[2], identities[3]]) {
        const r = await attempt(who, sql); matrix++;
        record(!r.ok && DENIED.test(r.error), `${who.name} can ${label}${r.ok ? "" : ` (${r.error})`}`);
      }
    }

    // === 4. catalogue checks ============================================
    for (const t of INFRASTRUCTURE_TABLES.filter((x) => live.includes(x))) {
      const rls = (await pool.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE oid=format('public.%I',$1::text)::regclass`, [t])).rows[0];
      record(rls?.relrowsecurity === true, `RLS not enabled on ${t}`);
      const grants = (await pool.query(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated','PUBLIC')`, [t])).rows;
      record(grants.length === 0, `browser roles still hold grants on ${t}: ${JSON.stringify(grants)}`);
      const colGrants = (await pool.query(`SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated','PUBLIC')`, [t])).rows;
      record(colGrants.length === 0, `browser roles still hold column grants on ${t}: ${JSON.stringify(colGrants)}`);
      const policies = (await pool.query<{ policyname: string; qual: string | null; with_check: string | null }>(`SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t])).rows;
      for (const p of policies) record((p.qual ?? "false") === "false" && (p.with_check ?? "false") === "false", `permissive policy ${p.policyname} on ${t} (${p.qual} / ${p.with_check})`);
    }
    const definers = (await pool.query<{ proname: string; proconfig: string[] | null; anon_exec: boolean; public_exec: boolean }>(
      `SELECT p.proname, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type='EXECUTE') AS public_exec
         FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef`)).rows;
    for (const f of definers) {
      record((f.proconfig ?? []).some((c) => c.startsWith("search_path=")), `SECURITY DEFINER function ${f.proname} has no fixed search_path`);
      record(!f.anon_exec && !f.public_exec, `SECURITY DEFINER function ${f.proname} is executable by anon/PUBLIC`);
    }
    const views = (await pool.query<{ relname: string; reloptions: string[] | null }>(`SELECT relname, reloptions FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('v','m')`)).rows;
    for (const v of views) record((v.reloptions ?? []).includes("security_invoker=true"), `view ${v.relname} bypasses underlying RLS (no security_invoker)`);

    console.log(`infrastructure-table permissions: ${discovered.length} tables discovered and classified; ${INFRASTRUCTURE_TABLES.length} service/operator-only, ${HOUSEHOLD_READ_ONLY_TABLES.length} household-read-only; ${matrix} browser-role matrix cells; ${behaviour.length} service/worker/operator controls; ${definers.length} SECURITY DEFINER functions; ${checks} checks.`);
    if (failures.length) {
      console.error(`UNAUTHORIZED OR BROKEN PATHS (${failures.length}):\n - ${failures.join("\n - ")}`);
      process.exitCode = 1;
    } else {
      console.log(`DearPolicy infrastructure-table permissions regressions passed (${checks} checks, ${matrix} matrix cells, ${behaviour.length} controls).`);
    }
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  finished = true;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
