/**
 * Safe processing-failure storage (sql/processing-failure-diagnostics.sql,
 * lib/diagnostics/processing-failures.ts). Proves, against the real
 * repository DDL + RLS under the real `authenticated` role, that a household
 * browser session cannot read raw provider text, analysis ids, engine counts,
 * storage paths or stack fragments from any table it can SELECT, and that the
 * raw detail survives only in the service-only diagnostics table.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

const FILES = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/household-rls.sql", "sql/infrastructure-rls.sql",
];
const LEAK = /virustotal analysis|malicious=|NjY0ZjU3|SECRET-STORAGE-KEY|accounts\/[0-9a-f-]{36}\/|\bat [A-Za-z_.]+ \(|ECONNREFUSED|x-apikey|stack/i;
const HOUSEHOLD = "71000000-0000-4000-8000-000000000001", USER = "71000000-0000-4000-8000-0000000000aa", MEMBER = "71000000-0000-4000-8000-000000000002";
const POLICY = "71000000-0000-4000-8000-000000000003", SESSION = "71000000-0000-4000-8000-000000000004", EVIDENCE = "71000000-0000-4000-8000-000000000005";
const RAW = "ECONNREFUSED https://storage.example/object/accounts/71000000-0000-4000-8000-000000000001/SECRET-STORAGE-KEY.pdf\n    at readObject (/app/lib/storage/supabase.ts:10:5)";
const RAW_VT = "VirusTotal analysis NjY0ZjU3YzFjNWM2YjM6MTcwMDAwMDAwMA==: malicious=0 suspicious=0 harmless=0 undetected=64 timeout=0.";
let cases = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }

async function main() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  const migration = await readFile(path.resolve("sql/processing-failure-diagnostics.sql"), "utf8");
  for (const f of FILES) {
    if (f === "sql/household-rls.sql") await db.exec(migration);
    await db.exec(await readFile(path.resolve(f), "utf8"));
  }
  const originalQuery = pool.query;
  pool.query = (async (text: string, params: unknown[] = []) => { const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; }) as typeof pool.query;
  try {
    // Synthetic household holding raw, pre-migration failure text everywhere it used to be written.
    await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'SYNTHETIC household')`, [HOUSEHOLD]);
    await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [HOUSEHOLD, USER]);
    await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'SYNTHETIC Parent','self')`, [MEMBER, HOUSEHOLD]);
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,scan_result_detail,processing_error)
      VALUES ($1,$2,$3,'synthetic.pdf','k','failed','scan_pending',$4,$5)`, [POLICY, HOUSEHOLD, MEMBER, RAW_VT, RAW]);
    await db.query(`INSERT INTO policy_document_audit_log(account_id,actor,action,policy_id,reason,reason_code) VALUES ($1,'system','scan_attempt_failed',$2,$3,'SCAN_ATTEMPT_FAILED')`, [HOUSEHOLD, POLICY, RAW]);
    await db.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts) VALUES ($1,$2,$3,'fact_finding','{}'::jsonb)`, [SESSION, HOUSEHOLD, MEMBER]);
    await db.query(`INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,status,scan_status,processing_error,processing_error_code)
      VALUES ($1,$2,$3,$4,'hospital_bill','bill.pdf','k2','application/pdf',4,'h2','failed','clean',$5,'PROCESSING_ERROR')`, [EVIDENCE, HOUSEHOLD, MEMBER, SESSION, RAW]).catch(async (e) => {
      throw new Error(`seed claim evidence: ${e instanceof Error ? e.message : e}`);
    });
    await db.query(`INSERT INTO claim_evidence_audit_log(account_id,actor,action,evidence_document_id,claim_session_id,reason,reason_code) VALUES ($1,'system','processing_failed',$2,$3,$4,'PROCESSING_ERROR')`, [HOUSEHOLD, EVIDENCE, SESSION, RAW]);

    await t("the additive migration backfills: raw detail moves to the service-only table, household-readable copies become fixed text", async () => {
      await db.exec(migration);
      const diag = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM processing_failure_diagnostics WHERE detail LIKE '%SECRET-STORAGE-KEY%' OR detail LIKE '%VirusTotal analysis%'`);
      assert.ok(diag.rows[0].n >= 5, `raw detail preserved server-side (${diag.rows[0].n})`);
      const again = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM processing_failure_diagnostics`);
      await db.exec(migration);
      const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM processing_failure_diagnostics`);
      assert.equal(after.rows[0].n, again.rows[0].n, "re-running the migration is a no-op");
    });

    async function asHousehold<T>(sql: string): Promise<T[]> {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL ROLE authenticated");
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [USER]);
        return (await db.query<T>(sql)).rows;
      } finally { await db.query("ROLLBACK"); }
    }
    await t("a household browser session can read its own rows, and none of them contains provider text, ids, counts, storage paths or stack fragments", async () => {
      for (const table of ["policies", "policy_document_audit_log", "claim_evidence_documents", "claim_evidence_audit_log"]) {
        const rows = await asHousehold<{ j: unknown }>(`SELECT row_to_json(x) AS j FROM ${table} x`);
        assert.ok(rows.length >= 1, `${table}: the household can read its own rows (the test is meaningful)`);
        for (const r of rows) assert.ok(!LEAK.test(JSON.stringify(r.j)), `${table} leaks: ${JSON.stringify(r.j).slice(0, 200)}`);
      }
    });
    await t("a household browser session cannot read the diagnostics table at all", async () => {
      await assert.rejects(() => asHousehold(`SELECT detail FROM processing_failure_diagnostics`), /permission denied/i);
    });
    await t("positive control: the service role still sees the raw diagnostic detail", async () => {
      const r = await db.query<{ detail: string }>(`SELECT detail FROM processing_failure_diagnostics WHERE resource_id=$1`, [POLICY]);
      assert.ok(r.rows.some((x) => x.detail.includes("SECRET-STORAGE-KEY")));
    });
    await t("the runtime writer stores raw detail only in diagnostics and never throws", async () => {
      const { recordProcessingFailure, POLICY_PROCESSING_FAILED_MESSAGE } = await import("@/lib/diagnostics/processing-failures");
      await recordProcessingFailure({ accountId: HOUSEHOLD, resourceType: "policy_document", resourceId: POLICY, failureCode: "PROCESSING_FAILED", error: new Error(RAW) });
      const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM processing_failure_diagnostics WHERE failure_code='PROCESSING_FAILED' AND error_class='Error'`);
      assert.ok(r.rows[0].n >= 1);
      const { POLICY_PROCESSING_STOPPED_MESSAGE } = await import("@/lib/policies/quarantine/ui");
      assert.equal(POLICY_PROCESSING_FAILED_MESSAGE, POLICY_PROCESSING_STOPPED_MESSAGE, "stored and returned messages are the same fixed text");
      const broken = pool.query; pool.query = (async () => { throw new Error("db down"); }) as typeof pool.query;
      await recordProcessingFailure({ accountId: HOUSEHOLD, resourceType: "policy_document", resourceId: POLICY, failureCode: "X", error: "x" });
      pool.query = broken;
    });
    await t("every failure writer stores the fixed message (or an allowlisted user-actionable reason), never the raw error", async () => {
      const ingest = await readFile(path.resolve("lib/rag/ingest.ts"), "utf8");
      const pipeline = await readFile(path.resolve("lib/claims/evidence/pipeline.ts"), "utf8");
      const store = await readFile(path.resolve("lib/policies/quarantine/store.ts"), "utf8");
      // The ONLY exception to the fixed message is the explicit allowlist of
      // user-actionable reasons (a PDF password the person can supply);
      // ingest must gate on BOTH the typed error and allowlist membership,
      // so no raw error text can ever ride in on a thrown message.
      const { USER_ACTIONABLE_PROCESSING_ERRORS, UserActionableProcessingError, PDF_PASSWORD_REQUIRED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE } = await import("@/lib/documents/processing-errors");
      assert.ok(USER_ACTIONABLE_PROCESSING_ERRORS.has(PDF_PASSWORD_REQUIRED_MESSAGE));
      assert.ok(USER_ACTIONABLE_PROCESSING_ERRORS.has(PDF_PASSWORD_INCORRECT_MESSAGE));
      // V1.1 Task 1 requires an unreadable document to tell the household what is unavailable: three fixed, internals-free sentences join the allowlist.
      // Round 5: one more fixed sentence -- a reading SERVICE that is still failing is not an unreadable document (DOCUMENT_READING_SERVICE_MESSAGE, internals-free).
      // Round 10: two more -- a photo too blurred to read says how to take it again (UNREADABLE_PHOTO_MESSAGE), and a PDF cut off part-way says to download it again (INCOMPLETE_PDF_MESSAGE); both fixed and internals-free.
      // Cap advice: one more -- a reading stopped by the household's monthly limit says so and that nothing is wrong with the file (READING_LIMIT_REACHED_MESSAGE); fixed, internals-free, no amount, plan or owner.
      assert.equal(USER_ACTIONABLE_PROCESSING_ERRORS.size, 9, "the allowlist stays deliberate and small");
      assert.ok(new UserActionableProcessingError(PDF_PASSWORD_REQUIRED_MESSAGE) instanceof Error);
      assert.match(ingest, /instanceof UserActionableProcessingError && USER_ACTIONABLE_PROCESSING_ERRORS\.has\(error\.message\)/);
      assert.match(ingest, /\[userReason \?\? POLICY_PROCESSING_FAILED_MESSAGE, args\.policyId, args\.accountId\]/);
      assert.match(pipeline, /markFailed\(args\.accountId, args\.documentId, current\.status, code, EVIDENCE_PROCESSING_FAILED_MESSAGE\)/);
      assert.match(store, /reason: SCAN_ATTEMPT_FAILED_MESSAGE/);
      for (const [name, src] of [["ingest", ingest], ["pipeline", pipeline]] as const) assert.ok(!/processing_error=\$1[^\n]*\n[^\n]*\[message,/.test(src), `${name} no longer writes the raw message`);
    });
    await t("reviewer API responses never select raw failure or scanner fields", async () => {
      const { readdirSync, statSync, readFileSync } = await import("node:fs");
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = path.join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
      for (const f of walk("app/api/reviewer")) assert.ok(!/processing_error|scan_result_detail|scan_provider|processing_failure_diagnostics/.test(readFileSync(f, "utf8")), f);
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
  console.log(`processing-failure storage regressions passed: ${cases} cases (backfill + idempotency, household-session read proofs over 4 tables, diagnostics denied to browser roles, runtime writer, reviewer API).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
