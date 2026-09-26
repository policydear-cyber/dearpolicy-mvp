/**
 * Production-topology proof, run against `next build && next start`
 * (NODE_ENV=production, every startup guard active) plus the local fake
 * VirusTotal API and a local Postgres. Drives ONLY the public HTTP surface
 * Vercel Cron uses (GET /api/internal/jobs/run with Bearer CRON_SECRET),
 * then checks the resulting state in the database. Synthetic data only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const BASE = process.env.TOPOLOGY_BASE_URL ?? "http://127.0.0.1:3100";
const FAKE = process.env.TOPOLOGY_FAKE_URL ?? "http://127.0.0.1:4010";
const PATH = "/api/internal/jobs/run";

async function main() {
  const secret = process.env.CRON_SECRET ?? "";
  assert.ok(secret.length >= 16, "the proof needs the synthetic CRON_SECRET the server was started with");
  const seed = JSON.parse(readFileSync(".topology-seed.json", "utf8")) as { household: string; docs: Record<"clean" | "infected" | "deleted", { policyId: string; sha256: string }> };
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const policy = async (id: string) => (await db.query<{ quarantine_status: string | null; processing_status: string; lifecycle_state: string }>(
    `SELECT quarantine_status, processing_status, lifecycle_state FROM policies WHERE id=$1`, [id])).rows[0];
  const jobs = async (id: string) => (await db.query<{ status: string; attempt_count: number; lease_owner: string | null }>(
    `SELECT status, attempt_count, lease_owner FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1`, [id])).rows;
  const fake = async () => (await (await fetch(`${FAKE}/__stats`)).json()) as { submissions: number; submittedSha256: string[] };
  const call = (auth?: string) => fetch(`${BASE}${PATH}`, { headers: auth ? { authorization: auth } : {}, redirect: "manual" });

  // 1. The endpoint refuses callers without the secret.
  assert.equal((await call()).status, 401, "no Authorization header must be refused");
  assert.equal((await call(`Bearer ${"x".repeat(secret.length)}`)).status, 401, "a wrong secret must be refused");
  assert.equal((await fake()).submissions, 0, "nothing may be scanned before an authorised run");
  for (const k of ["clean", "infected", "deleted"] as const) assert.equal((await jobs(seed.docs[k].policyId))[0]?.status, "queued");

  // 2. One authorised run (what Vercel Cron sends) starts the worker, which
  //    claims the queued jobs and scans through the real adapter.
  const res = await call(`Bearer ${secret}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /\bno-store\b/);
  const body = (await res.json()) as { ok: boolean; claimed: number; byType: Record<string, { succeeded: number; failed: number }>; stoppedBy: string };
  assert.equal(body.ok, true);
  assert.equal(body.claimed, 3, "the run must claim all three queued synthetic jobs");
  assert.deepEqual(Object.keys(body).sort(), ["byType", "claimed", "deadLetteredLeases", "ok", "recoveredLeases", "stoppedBy"], "counts only");

  const stats1 = await fake();
  const clean = await policy(seed.docs.clean.policyId);
  const infected = await policy(seed.docs.infected.policyId);
  const deleted = await policy(seed.docs.deleted.policyId);
  assert.equal(clean.quarantine_status, "scan_clean", "the clean synthetic scan completed and released the document");
  assert.equal(infected.quarantine_status, "scan_rejected", "the malicious synthetic scan is rejected");
  assert.notEqual(deleted.quarantine_status, "scan_clean", "a deleted document is never released");
  assert.equal(stats1.submissions, 2, "exactly the clean and infected documents were submitted");
  assert.ok(stats1.submittedSha256.includes(seed.docs.clean.sha256));
  assert.ok(stats1.submittedSha256.includes(seed.docs.infected.sha256));
  assert.ok(!stats1.submittedSha256.includes(seed.docs.deleted.sha256), "a deleted document is never sent to the scanner");
  for (const k of ["clean", "infected", "deleted"] as const) {
    const [j] = await jobs(seed.docs[k].policyId);
    assert.ok(j.attempt_count >= 1, `${k}: claimed by the runner`);
    assert.equal(j.lease_owner, null, `${k}: lease released`);
    assert.notEqual(j.status, "processing");
  }
  const infectedJob = (await jobs(seed.docs.infected.policyId))[0];
  const deletedJob = (await jobs(seed.docs.deleted.policyId))[0];
  assert.equal(infectedJob.status, "succeeded", "infected: the job ends; rejection is terminal, not retried");
  assert.equal(deletedJob.status, "succeeded", "deleted: the job ends without scanning");

  // 3. A later run never rescans the infected or deleted documents.
  await db.query(`UPDATE background_jobs SET available_at=now() WHERE job_type='policy_processing' AND status='failed_retryable'`);
  const res2 = await call(`Bearer ${secret}`);
  assert.equal(res2.status, 200);
  const stats2 = await fake();
  assert.equal(stats2.submittedSha256.filter((s) => s === seed.docs.infected.sha256).length, 1, "infected is never resubmitted");
  assert.ok(!stats2.submittedSha256.includes(seed.docs.deleted.sha256), "deleted is never submitted");
  assert.equal((await policy(seed.docs.infected.policyId)).quarantine_status, "scan_rejected");
  assert.equal((await policy(seed.docs.deleted.policyId)).lifecycle_state, "pending_deletion");
  assert.equal((await policy(seed.docs.clean.policyId)).quarantine_status, "scan_clean", "a retried processing attempt never re-quarantines a cleared document");

  const cleanJob = (await jobs(seed.docs.clean.policyId))[0];
  console.log(JSON.stringify({
    proof: "production-topology",
    unauthorisedRefused: true,
    firstRun: { claimed: body.claimed, byType: body.byType, stoppedBy: body.stoppedBy },
    scans: { submitted: stats1.submissions, clean: "scan_clean", infected: "scan_rejected (terminal)", deleted: "never submitted" },
    cleanDocumentAfterScan: { processing_status: (await policy(seed.docs.clean.policyId)).processing_status, job: cleanJob.status, attempts: cleanJob.attempt_count,
      note: "post-scan extraction needs a model provider; none is configured in this proof, so the job may end failed_retryable after the scan completed" },
  }, null, 2));
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
