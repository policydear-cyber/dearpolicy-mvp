/**
 * Rehearses the LIVE application procedure for
 * sql/processing-failure-diagnostics.sql (docs/migration-runbook.md §14) on a
 * disposable PGlite database shaped like the live one: every earlier
 * migration already applied, Supabase-style default privileges that grant
 * the API roles on new public tables, and synthetic rows holding raw failure
 * text. Runs the runbook's own pre-check and post-check SQL files and asserts
 * their expected results. Synthetic data only; never touches a real database.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const FILES = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/household-rls.sql", "sql/infrastructure-rls.sql",
];
const H = "72000000-0000-4000-8000-000000000001", U = "72000000-0000-4000-8000-0000000000aa", M = "72000000-0000-4000-8000-000000000002";
const POL = "72000000-0000-4000-8000-000000000003", S = "72000000-0000-4000-8000-000000000004", E = "72000000-0000-4000-8000-000000000005";
const RAW = "SYNTHETIC raw failure: ECONNREFUSED storage path accounts/SECRET-STORAGE-KEY";
const RAW_VT = "SYNTHETIC VirusTotal analysis abc: malicious=0 undetected=64";
let cases = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }

type Row = Record<string, unknown>;
async function liveLikeDb() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of FILES) await db.exec(await readFile(path.resolve(f), "utf8"));
  // Supabase grants the API roles on every new table in public by default.
  await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
                 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;`);
  await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'SYNTHETIC household')`, [H]);
  await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [H, U]);
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'SYNTHETIC Parent','self')`, [M, H]);
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,scan_result_detail,processing_error)
    VALUES ($1,$2,$3,'synthetic.pdf','k','failed','scan_pending',$4,$5)`, [POL, H, M, RAW_VT, RAW]);
  await db.query(`INSERT INTO policy_document_audit_log(account_id,actor,action,policy_id,reason,reason_code) VALUES ($1,'system','scan_attempt_failed',$2,$3,'SCAN_ATTEMPT_FAILED')`, [H, POL, RAW]);
  await db.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts) VALUES ($1,$2,$3,'fact_finding','{}'::jsonb)`, [S, H, M]);
  await db.query(`INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,status,scan_status,processing_error,processing_error_code)
    VALUES ($1,$2,$3,$4,'hospital_bill','bill.pdf','k2','application/pdf',4,'h2','failed','clean',$5,'PROCESSING_ERROR')`, [E, H, M, S, RAW]);
  await db.query(`INSERT INTO claim_evidence_audit_log(account_id,actor,action,evidence_document_id,claim_session_id,reason,reason_code) VALUES ($1,'system','processing_failed',$2,$3,$4,'PROCESSING_ERROR')`, [H, E, S, RAW]);
  return db;
}
async function runChecks(db: PGlite, file: string): Promise<Row[]> {
  const results = await db.exec(await readFile(path.resolve(file), "utf8"));
  return results.map((r) => (r.rows[0] ?? {}) as Row);
}
const COUNT_KEYS = ["policies_processing_error", "policies_scan_result_detail", "evidence_processing_error", "evidence_audit_reason", "policy_audit_reason"];
async function authenticatedCanRead(db: PGlite): Promise<boolean> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [U]);
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM processing_failure_diagnostics");
    return r.rows[0].n > 0;
  } catch { return false; } finally { await db.query("ROLLBACK"); }
}

async function main() {
  const migration = await readFile(path.resolve("sql/processing-failure-diagnostics.sql"), "utf8");
  const infra = await readFile(path.resolve("sql/infrastructure-rls.sql"), "utf8");

  const db = await liveLikeDb();
  let preCounts: Row = {};
  await t("pre-check: dependencies present, table new, backfill counts reported (counts only)", async () => {
    const [deps, exists, counts, defaults] = await runChecks(db, "sql/checks/processing-failure-diagnostics-pre.sql");
    for (const k of ["has_accounts", "has_policies", "has_policy_audit", "has_evidence", "has_evidence_audit", "household_rls_applied"]) assert.equal(deps[k], true, k);
    assert.equal(exists.diagnostics_table_exists, false);
    for (const k of COUNT_KEYS) assert.equal(counts[k], 1, k);
    preCounts = counts;
    assert.ok(String(defaults.default_acl ?? "").includes("authenticated"), "the rehearsal DB has Supabase-style default grants (the test is meaningful)");
  });

  await t("apply: migration + infrastructure-rls.sql in ONE transaction", async () => {
    await db.exec(`BEGIN;\n${migration}\n${infra}\nCOMMIT;`);
  });

  await t("post-check: RLS on, one always-false policy, no browser privileges, no raw text left, detail preserved", async () => {
    const [q1, q2, q3, q4] = await runChecks(db, "sql/checks/processing-failure-diagnostics-post.sql");
    for (const k of ["table_exists", "rls_enabled", "exactly_one_policy", "policy_is_always_false"]) assert.equal(q1[k], true, k);
    for (const k of ["no_browser_table_grants", "authenticated_cannot_select", "anon_cannot_select", "authenticated_no_sequence"]) assert.equal(q2[k], true, k);
    for (const k of COUNT_KEYS) assert.equal(q3[k], 0, k);
    const sum = COUNT_KEYS.reduce((a, k) => a + Number(preCounts[k] ?? 0), 0);
    assert.ok(Number(q4.diagnostics_rows) >= sum, `diagnostics ${q4.diagnostics_rows} >= ${sum}`);
    assert.equal(await authenticatedCanRead(db), false);
  });

  await t("re-applying the same transaction is a no-op", async () => {
    const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM processing_failure_diagnostics")).rows[0].n;
    await db.exec(`BEGIN;\n${migration}\n${infra}\nCOMMIT;`);
    const after = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM processing_failure_diagnostics")).rows[0].n;
    assert.equal(after, before);
  });
  await db.close();

  await t("negative control: the migration ALONE leaves the new table browser-readable, and the post-check catches it", async () => {
    const bare = await liveLikeDb();
    await bare.exec(migration);
    const [, q2] = await runChecks(bare, "sql/checks/processing-failure-diagnostics-post.sql");
    assert.equal(q2.authenticated_cannot_select, false, "without infrastructure-rls.sql in the same transaction, authenticated could read raw detail");
    await bare.close();
  });

  console.log(`processing-failure migration procedure rehearsal passed: ${cases} cases (pre-check, single-transaction apply, post-check, idempotent re-apply, negative control).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
