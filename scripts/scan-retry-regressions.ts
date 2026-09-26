/**
 * Bounded automatic scan retry (lib/scanning/retry.ts, retry-processor.ts),
 * on PGlite with the real repository DDL, the real quarantine gate
 * (lib/policies/quarantine/store.ts), the real claim-evidence pipeline and
 * the real durable job queue/worker (lib/jobs/*). Synthetic documents only.
 *
 * Proves: transient outcomes schedule a durable, idempotent retry with
 * exponential backoff and the provider's own Retry-After respected; nothing
 * is released without a real clean verdict; infected is terminal; deleted or
 * superseded documents are never rescanned; attempts are bounded and the
 * last one dead-letters; no-hint outcomes (no scanner, misconfiguration)
 * never retry; and no provider text reaches a household-readable column, an
 * audit reason or a job payload. Every blocked case has a positive control.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

const FILES = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/processing-failure-diagnostics.sql", "sql/household-rls.sql", "sql/infrastructure-rls.sql",
];
const LEAK = /virustotal analysis|NjY0ZjU3|malicious=|QuotaExceeded|x-apikey|SECRET/i;
const RAW_VT = "VirusTotal analysis NjY0ZjU3YzFjNWM2YjM6MTcwMDAwMDAwMA== QuotaExceededError x-apikey SECRET";
const HOUSEHOLD = "72000000-0000-4000-8000-000000000001", USER = "72000000-0000-4000-8000-0000000000aa", MEMBER = "72000000-0000-4000-8000-000000000002";
const SESSION = "72000000-0000-4000-8000-000000000003";

let cases = 0;
async function t(name: string, fn: () => Promise<void> | void) { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }

async function main() {
  const storage = await mkdtemp(path.join(os.tmpdir(), "scan-retry-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(storage, "policies");
  process.env.LOCAL_CLAIM_EVIDENCE_DIR = path.join(storage, "evidence");
  delete process.env.SUPABASE_URL;

  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of FILES) await db.exec(await readFile(path.resolve(f), "utf8"));
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  try {
    const { __registerFileScanAdapterForTests } = await import("@/lib/scanning/adapter");
    const { VirusTotalAdapterError, parseRetryAfterHeader } = await import("@/lib/scanning/adapters/virustotal");
    const retry = await import("@/lib/scanning/retry");
    const { processScanRetryJob, ScanRetryExhaustedError } = await import("@/lib/scanning/retry-processor");
    const { runPolicyQuarantineGate, getPolicyQuarantineRow, markPolicyDocumentDeleted } = await import("@/lib/policies/quarantine/store");
    const { processClaimEvidence } = await import("@/lib/claims/evidence/pipeline");
    const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
    type Job = import("@/lib/jobs/queue").BackgroundJobRow;

    // Scriptable synthetic scanner: every call pops the next outcome.
    let calls = 0; let script: Array<"transient" | "rate_limited" | "clean" | "infected" | "misconfigured" | "throws" | "no_hint"> = [];
    __registerFileScanAdapterForTests({ name: "test-retry", async scanFile() {
      calls++;
      const next = script.shift() ?? "transient";
      if (next === "clean") return { status: "clean" as const, detail: RAW_VT };
      if (next === "infected") return { status: "infected" as const, detail: RAW_VT };
      if (next === "misconfigured") throw new VirusTotalAdapterError(`VirusTotal failed with an authentication error: ${RAW_VT}`);
      if (next === "throws") throw new Error(`socket hang up ${RAW_VT}`);
      if (next === "no_hint") return { status: "scan_unavailable" as const, detail: RAW_VT };
      if (next === "rate_limited") return { status: "scan_unavailable" as const, detail: RAW_VT, retry: { reason: "rate_limited" as const, retryAfterSeconds: 5400 } };
      return { status: "scan_unavailable" as const, detail: RAW_VT, retry: { reason: "provider_timeout" as const, retryAfterSeconds: null } };
    } });
    process.env.MALWARE_SCANNER_PROVIDER = "test-retry";

    await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'SYNTHETIC scan-retry household')`, [HOUSEHOLD]);
    await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [HOUSEHOLD, USER]);
    await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'SYNTHETIC Parent','self')`, [MEMBER, HOUSEHOLD]);
    await db.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts) VALUES ($1,$2,$3,'fact_finding','{}'::jsonb)`, [SESSION, HOUSEHOLD, MEMBER]);

    let seq = 0;
    async function newPolicy(): Promise<string> {
      seq++;
      const id = `72100000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      const key = `synthetic/${id}.pdf`;
      await mkdir(path.join(process.env.LOCAL_STORAGE_DIR!, "synthetic"), { recursive: true });
      await writeFile(path.join(process.env.LOCAL_STORAGE_DIR!, key), Buffer.from("%PDF-1.4 SYNTHETIC"));
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status) VALUES ($1,$2,$3,'synthetic.pdf',$4,$5,'queued')`,
        [id, HOUSEHOLD, MEMBER, key, `hash-${id}`]);
      return id;
    }
    async function newEvidence(): Promise<string> {
      seq++;
      const id = `72200000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      const key = `synthetic/${id}.pdf`;
      await mkdir(path.join(process.env.LOCAL_CLAIM_EVIDENCE_DIR!, "synthetic"), { recursive: true });
      await writeFile(path.join(process.env.LOCAL_CLAIM_EVIDENCE_DIR!, key), Buffer.from("%PDF-1.4 SYNTHETIC"));
      await db.query(`INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,status,scan_status)
        VALUES ($1,$2,$3,$4,'hospital_bill','bill.pdf',$5,'application/pdf',18,$6,'uploaded','pending_scan')`, [id, HOUSEHOLD, MEMBER, SESSION, key, `hash-${id}`]);
      return id;
    }
    const readBytes = (id: string) => async () => new Uint8Array(await readFile(path.join(process.env.LOCAL_STORAGE_DIR!, `synthetic/${id}.pdf`)));
    const retryJobs = async (type: string, id: string) => (await db.query<Job>(`SELECT * FROM background_jobs WHERE job_type=$1 AND idempotency_key LIKE $2 ORDER BY idempotency_key`, [retry.SCAN_RETRY_JOB_TYPE, `${type}:${id}:scan-retry:%`])).rows;
    const policyAudit = async (id: string) => (await db.query<{ action: string; reason: string | null; new_value: unknown }>(`SELECT action,reason,new_value FROM policy_document_audit_log WHERE policy_id=$1 ORDER BY occurred_at,id`, [id])).rows;
    const runRetry = async (job: Job) => processScanRetryJob({ ...job, lease_owner: null });
    const settle = async (p: Promise<unknown>) => { try { await p; } catch { /* processing after a clean scan needs model services; the scan outcome is what is asserted */ } };

    // -------------------------------------------------------------------
    await t("backoff is exponential and bounded; a rate limit waits a conservative floor; provider Retry-After is respected", () => {
      const d = (n: number, hint: Parameters<typeof retry.computeScanRetryDelayMs>[1]) => retry.computeScanRetryDelayMs(n, hint);
      const timeout = { reason: "provider_timeout" as const, retryAfterSeconds: null };
      assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => d(n, timeout) / 60_000), [2, 4, 8, 16, 32, 64]);
      assert.equal(d(20, timeout), retry.SCAN_RETRY_MAX_DELAY_MS, "capped");
      assert.equal(d(1, { reason: "rate_limited", retryAfterSeconds: null }), retry.SCAN_RETRY_RATE_LIMIT_FLOOR_MS, "no quota-reset guess: conservative floor");
      assert.equal(d(1, { reason: "rate_limited", retryAfterSeconds: 5400 }), 5_400_000, "provider metadata respected");
      assert.equal(d(1, { reason: "provider_unavailable", retryAfterSeconds: 10 ** 9 }), retry.SCAN_RETRY_PROVIDER_MAX_WAIT_MS, "bounded even if the provider asks for longer");
      for (let i = 0; i < 3; i++) assert.equal(d(3, timeout), d(3, timeout), "deterministic");
      assert.equal(parseRetryAfterHeader("120"), 120);
      assert.equal(parseRetryAfterHeader(new Date(Date.now() + 90_000).toUTCString()) !== null, true);
      assert.equal(parseRetryAfterHeader("soon"), null);
      assert.equal(parseRetryAfterHeader("999999999"), 86_400);
    });

    await t("a transient policy scan schedules one durable retry (Retry-After respected) and keeps the document on hold, with no provider text anywhere household-readable", async () => {
      const id = await newPolicy(); script = ["rate_limited"];
      const started = Date.now();
      const gate = await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: id, readBytes: readBytes(id) });
      assert.equal(gate.cleared, false);
      assert.equal((await getPolicyQuarantineRow(HOUSEHOLD, id))?.quarantine_status, "scan_pending", "never released");
      const jobs = await retryJobs("policy_document", id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].idempotency_key, `policy_document:${id}:scan-retry:1`);
      assert.ok(new Date(jobs[0].available_at).getTime() - started >= 5_400_000 - 5_000, "not before the provider's Retry-After");
      assert.doesNotMatch(JSON.stringify(jobs[0].payload), LEAK, "job payload carries no provider text");
      const audit = await policyAudit(id);
      assert.ok(audit.some((a) => a.action === "scan_retry_scheduled" && a.reason === retry.SCAN_RETRY_SCHEDULED_MESSAGE));
      const row = (await db.query(`SELECT scan_result_detail,processing_error FROM policies WHERE id=$1`, [id])).rows[0];
      assert.doesNotMatch(JSON.stringify(row) + JSON.stringify(audit), LEAK);
    });

    await t("idempotent: concurrent/duplicate scheduling of the same attempt creates one job", async () => {
      const id = await newPolicy();
      const hint = { reason: "provider_timeout" as const, retryAfterSeconds: null };
      const [a, b] = await Promise.all([
        retry.scheduleScanRetry({ accountId: HOUSEHOLD, resourceType: "policy_document", resourceId: id, hint }),
        retry.scheduleScanRetry({ accountId: HOUSEHOLD, resourceType: "policy_document", resourceId: id, hint }),
      ]);
      assert.ok(a.scheduled && b.scheduled);
      assert.equal((await retryJobs("policy_document", id)).length, 1);
    });

    await t("positive control: the retry releases the document only through a real clean verdict, and schedules nothing more", async () => {
      const id = await newPolicy(); script = ["transient"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: id, readBytes: readBytes(id) });
      const [job] = await retryJobs("policy_document", id);
      script = ["clean"];
      await settle(runRetry(job));
      assert.equal((await getPolicyQuarantineRow(HOUSEHOLD, id))?.quarantine_status, "scan_clean");
      assert.equal((await retryJobs("policy_document", id)).length, 1);
    });

    await t("an infected verdict on retry is terminal: rejected, never retried again", async () => {
      const id = await newPolicy(); script = ["transient"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: id, readBytes: readBytes(id) });
      const [job] = await retryJobs("policy_document", id);
      script = ["infected"];
      await runRetry(job);
      assert.equal((await getPolicyQuarantineRow(HOUSEHOLD, id))?.quarantine_status, "scan_rejected");
      assert.equal((await retryJobs("policy_document", id)).length, 1, "no further attempt");
      const before = calls; await runRetry(job);
      assert.equal(calls, before, "a rejected document is never rescanned (duplicate invocation is a no-op)");
    });

    await t("a deleted or superseded document is never retried", async () => {
      const id = await newPolicy(); script = ["transient"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: id, readBytes: readBytes(id) });
      const [job] = await retryJobs("policy_document", id);
      await markPolicyDocumentDeleted(HOUSEHOLD, id);
      const before = calls; await runRetry(job);
      assert.equal(calls, before, "deleted: not rescanned");
      assert.equal((await retryJobs("policy_document", id)).length, 1);
      const superseded = await newPolicy(); script = ["transient"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: superseded, readBytes: readBytes(superseded) });
      const [job2] = await retryJobs("policy_document", superseded);
      await db.query(`UPDATE policies SET superseded_at=now() WHERE id=$1`, [superseded]);
      const before2 = calls; await runRetry(job2);
      assert.equal(calls, before2, "superseded: not rescanned");
    });

    await t("bounded: after the last permitted attempt the job is dead-lettered and the document stays on hold with safe wording", async () => {
      const id = await newPolicy(); script = ["transient"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: id, readBytes: readBytes(id) });
      for (let attempt = 1; attempt < retry.MAX_SCAN_RETRY_ATTEMPTS; attempt++) {
        const job = (await retryJobs("policy_document", id)).find((j) => (j.payload as { attempt: number }).attempt === attempt)!;
        script = ["transient"]; await runRetry(job);
      }
      assert.equal((await retryJobs("policy_document", id)).length, retry.MAX_SCAN_RETRY_ATTEMPTS);
      const last = (await retryJobs("policy_document", id)).at(-1)!;
      await db.query(`UPDATE background_jobs SET available_at=now() - interval '1 minute' WHERE id=$1`, [last.id]);
      await db.query(`UPDATE background_jobs SET available_at=now() + interval '1 day' WHERE job_type=$1 AND id<>$2 AND status IN ('queued','failed_retryable')`, [retry.SCAN_RETRY_JOB_TYPE, last.id]);
      script = ["transient"];
      const outcome = await claimAndProcessOne({ jobType: retry.SCAN_RETRY_JOB_TYPE, workerId: "worker-synthetic", process: processScanRetryJob });
      assert.equal(outcome, "failed");
      const finalRow = (await db.query<Job>(`SELECT * FROM background_jobs WHERE id=$1`, [last.id])).rows[0];
      assert.equal(finalRow.status, "dead_letter");
      assert.equal(finalRow.last_error_message, retry.SCAN_RETRY_EXHAUSTED_ERROR);
      assert.equal((await retryJobs("policy_document", id)).length, retry.MAX_SCAN_RETRY_ATTEMPTS, "no attempt beyond the bound");
      assert.equal((await getPolicyQuarantineRow(HOUSEHOLD, id))?.quarantine_status, "scan_pending", "never released");
      const audit = await policyAudit(id);
      assert.ok(audit.some((a) => a.action === "scan_retry_exhausted" && a.reason === retry.SCAN_RETRY_EXHAUSTED_MESSAGE));
      assert.doesNotMatch(JSON.stringify(audit), LEAK);
      const refused = await retry.scheduleScanRetry({ accountId: HOUSEHOLD, resourceType: "policy_document", resourceId: id, hint: { reason: "provider_timeout", retryAfterSeconds: null } });
      assert.equal(refused.scheduled, false);
      void ScanRetryExhaustedError;
    });

    await t("no hint, no automatic retry: no scanner configured, or a misconfigured scanner; a crashed call does retry (control)", async () => {
      const a = await newPolicy(); script = ["no_hint"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: a, readBytes: readBytes(a) });
      assert.equal((await retryJobs("policy_document", a)).length, 0);
      const b = await newPolicy(); script = ["misconfigured"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: b, readBytes: readBytes(b) });
      assert.equal((await retryJobs("policy_document", b)).length, 0);
      const c = await newPolicy(); script = ["throws"];
      await runPolicyQuarantineGate({ accountId: HOUSEHOLD, policyId: c, readBytes: readBytes(c) });
      assert.equal((await retryJobs("policy_document", c)).length, 1);
      assert.doesNotMatch(JSON.stringify(await policyAudit(c)), LEAK);
    });

    await t("claim evidence: a transient scan holds the document and schedules a retry; the retry clears it only on a clean verdict", async () => {
      const id = await newEvidence(); script = ["transient"];
      await settle(processClaimEvidence({ accountId: HOUSEHOLD, documentId: id }));
      let doc = (await db.query<{ status: string; scan_status: string }>(`SELECT status,scan_status FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0];
      assert.deepEqual([doc.status, doc.scan_status], ["quarantined", "scan_unavailable"]);
      const [job] = await retryJobs("claim_evidence", id);
      assert.ok(job, "retry scheduled");
      await settle(processClaimEvidence({ accountId: HOUSEHOLD, documentId: id }));
      doc = (await db.query<{ status: string; scan_status: string }>(`SELECT status,scan_status FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0];
      assert.equal(doc.scan_status, "scan_unavailable", "an ordinary reprocess never rescans or releases a held document");
      script = ["clean"];
      await settle(runRetry(job));
      doc = (await db.query<{ status: string; scan_status: string }>(`SELECT status,scan_status FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0];
      assert.equal(doc.scan_status, "clean");
      const audit = (await db.query(`SELECT action,reason FROM claim_evidence_audit_log WHERE evidence_document_id=$1`, [id])).rows;
      assert.doesNotMatch(JSON.stringify(audit), LEAK);
    });

    await t("claim evidence: infected on retry is terminal; superseded evidence is never rescanned", async () => {
      const id = await newEvidence(); script = ["transient"];
      await settle(processClaimEvidence({ accountId: HOUSEHOLD, documentId: id }));
      const [job] = await retryJobs("claim_evidence", id);
      script = ["infected"]; await runRetry(job);
      const doc = (await db.query<{ status: string }>(`SELECT status FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0];
      assert.equal(doc.status, "rejected");
      const other = await newEvidence(); script = ["transient"];
      await settle(processClaimEvidence({ accountId: HOUSEHOLD, documentId: other }));
      const [job2] = await retryJobs("claim_evidence", other);
      await db.query(`UPDATE claim_evidence_documents SET superseded_at=now() WHERE id=$1`, [other]);
      const before = calls; await runRetry(job2);
      assert.equal(calls, before);
    });

    await t("household browser sessions cannot read scan-retry jobs", async () => {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL ROLE authenticated");
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [USER]);
        let denied = false;
        try { const r = await db.query(`SELECT count(*)::int AS n FROM background_jobs`); denied = (r.rows[0] as { n: number }).n === 0; } catch { denied = true; }
        assert.ok(denied, "background_jobs is service-only");
      } finally { await db.query("ROLLBACK"); }
    });
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  console.log(`scan-retry regressions passed: ${cases} cases`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
