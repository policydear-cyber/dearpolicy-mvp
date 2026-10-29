/** A document waiting for the one later re-read intake schedules after a reading-service failure (background_jobs key
 * `<policyId>:retry-read`, lib/rag/ingest.ts scheduleDeferredRead) is being read: the Documents page (GET /api/policies)
 * does not call it stalled, and Try again (POST /api/policies/reprocess) never starts a second paid read beside it.
 * When that re-read is dead, or overdue and unclaimed, the document is stalled and Try again still works, and the read
 * it starts replaces any re-read still waiting, so a worker never reads the document twice. The existing cases (a live
 * intake job, no job at all, the 2-minute grace) are unchanged.
 *
 * Runs the real route handlers against a real Postgres database: every row is made up, written inside one transaction
 * that is rolled back at the end (the routes' own transactions become savepoints). Dev auth; no model, no storage, no
 * job is started (JOB_DRAIN_ON_REQUEST=0).
 *   DATABASE_URL=postgresql://.../dp_<own db> npm run policies:retry-read-test */
import assert from "node:assert/strict";
import { Client } from "pg";
import { NextRequest } from "next/server";

process.env.DEV_AUTH_ENABLED = "1";
process.env.JOB_DRAIN_ON_REQUEST = "0";
const USER_ID = "f1000000-0000-4000-8000-000000000001";
process.env.DEV_ACCOUNT_ID = USER_ID;

let passed = 0;
const failed: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed.push(name); console.log("not ok - " + name + "\n  " + (e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 200) : String(e))); }
}

const HOUSEHOLD = "f2000000-0000-4000-8000-000000000001";
const MEMBER = "f3000000-0000-4000-8000-000000000001";
const id = (n: number) => `f4000000-0000-4000-8000-00000000000${n}`;
const DOCS = {
  waiting: id(1),       // queued, retry_scheduled; own job dead; re-read due in 20 minutes
  deadReread: id(2),    // queued; own job dead; re-read dead too
  overdueReread: id(3), // queued; own job dead; re-read due 15 minutes ago, never claimed
  liveOwnJob: id(4),    // queued; own job claimable now (existing case)
  noJob: id(5),         // queued an hour ago; no job at all (existing case)
  fresh: id(6),         // queued a moment ago; no job yet (existing 2-minute grace)
  readInPart: id(7),    // ready, read in part; re-read due in 20 minutes
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (your own database, never the shared one)");
  if (/\/dearpolicy(\?|$)/.test(url)) throw new Error("refusing to run against the shared dearpolicy database");
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query("BEGIN");

  // Every route query goes through this one connection, inside the outer transaction.
  const { pool } = await import("@/lib/db/client");
  let savepoint = 0;
  const guarded = async (text: string, params?: unknown[]) => {
    const sp = `q${++savepoint}`;
    await db.query(`SAVEPOINT ${sp}`);
    try { const r = await db.query(text, params as unknown[]); await db.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e) { await db.query(`ROLLBACK TO SAVEPOINT ${sp}`); throw e; }
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = ((text: string, params?: unknown[]) => guarded(text, params)) as unknown as typeof pool.query;
  pool.connect = (async () => {
    const stack: string[] = [];
    return {
      query: async (text: string, params?: unknown[]) => {
        const t = text.trim().toUpperCase();
        if (t.startsWith("BEGIN")) { const sp = `t${++savepoint}`; stack.push(sp); return db.query(`SAVEPOINT ${sp}`); }
        if (t === "COMMIT") { const sp = stack.pop(); await db.query(`RELEASE SAVEPOINT ${sp}`); return db.query("RESET ROLE"); }
        if (t === "ROLLBACK") { const sp = stack.pop(); await db.query(`ROLLBACK TO SAVEPOINT ${sp}`); await db.query(`RELEASE SAVEPOINT ${sp}`); return db.query("RESET ROLE"); }
        return db.query(text, params as unknown[]);
      },
      release: () => undefined,
    };
  }) as unknown as typeof pool.connect;

  try {
    await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'Example Household'),($2,'Household') ON CONFLICT (id) DO NOTHING`, [HOUSEHOLD, USER_ID]);
    await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [HOUSEHOLD, USER_ID]);
    await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'Lim Ah Kow','self')`, [MEMBER, HOUSEHOLD]);
    const policy = (pid: string, status: string, stage: string, ageMinutes: number) => db.query(
      `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,insurer,processing_status,processing_stage,quarantine_status,updated_at)
       VALUES ($1,$2,$3,$4,$5,'Example Insurance',$6,$7,'scan_clean',now() - make_interval(mins => $8))`,
      [pid, HOUSEHOLD, MEMBER, `example-${pid.slice(-1)}.pdf`, `${HOUSEHOLD}/${pid}.pdf`, status, stage, ageMinutes]);
    const job = (key: string, status: string, dueMinutes: number) => db.query(
      `INSERT INTO background_jobs(account_id,job_type,idempotency_key,status,attempt_count,payload,available_at)
       VALUES ($1,'policy_processing',$2,$3,$4,$5::jsonb,now() + make_interval(mins => $6))`,
      [HOUSEHOLD, key, status, status === "dead_letter" ? 3 : 0,
        JSON.stringify({ policyId: key.split(":")[0], familyMemberId: MEMBER, storageKey: "x", deferredRetry: key.endsWith(":retry-read") }), dueMinutes]);

    await policy(DOCS.waiting, "queued", "retry_scheduled", 60);
    await job(DOCS.waiting, "dead_letter", -70);
    await job(DOCS.waiting + ":retry-read", "queued", 20);
    await policy(DOCS.deadReread, "queued", "retry_scheduled", 60);
    await job(DOCS.deadReread, "dead_letter", -70);
    await job(DOCS.deadReread + ":retry-read", "dead_letter", -30);
    await policy(DOCS.overdueReread, "queued", "retry_scheduled", 60);
    await job(DOCS.overdueReread, "dead_letter", -70);
    await job(DOCS.overdueReread + ":retry-read", "queued", -15);
    await policy(DOCS.liveOwnJob, "queued", "queued", 60);
    await job(DOCS.liveOwnJob, "queued", 0);
    await policy(DOCS.noJob, "queued", "queued", 60);
    await policy(DOCS.fresh, "queued", "queued", 0);
    await policy(DOCS.readInPart, "ready", "complete", 60);
    await job(DOCS.readInPart, "succeeded", -70);
    await job(DOCS.readInPart + ":retry-read", "queued", 20);

    const { ACTIVE_HOUSEHOLD_COOKIE } = await import("@/lib/auth/request-context");
    const { GET } = await import("@/app/api/policies/route");
    const { POST } = await import("@/app/api/policies/reprocess/route");
    const cookie = `${ACTIVE_HOUSEHOLD_COOKIE}=${HOUSEHOLD}`;
    const jobs = async (pid: string) => {
      const r = await db.query<{ idempotency_key: string; status: string; available_at: Date }>(
        `SELECT idempotency_key,status,available_at FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key IN ($1,$1||':retry-read')`, [pid]);
      const own = r.rows.find((x) => x.idempotency_key === pid), reread = r.rows.find((x) => x.idempotency_key !== pid);
      return { own: own?.status ?? null, reread: reread?.status ?? null, rereadDue: reread?.available_at?.getTime() ?? null };
    };
    // Waiting reads: own job not live, and no re-read waiting either (a second read = two of these).
    const pendingReads = async (pid: string) => {
      const j = await jobs(pid);
      return [j.own, j.reread].filter((s) => s === "queued" || s === "failed_retryable" || s === "processing").length;
    };
    const tryAgain = async (pid: string) => {
      const res = await POST(new NextRequest("http://localhost/api/policies/reprocess", {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ policyId: pid }) }));
      // The route enqueues after its response; let that finish before looking.
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
      return res.status;
    };

    const listRes = await GET(new NextRequest("http://localhost/api/policies", { headers: { cookie } }));
    assert.equal(listRes.status, 200, "GET /api/policies");
    const listed = (await listRes.json()).policies as { id: string; processing_stalled: boolean }[];
    const stalled = (pid: string) => { const p = listed.find((x) => x.id === pid); assert.ok(p, "listed " + pid); return p.processing_stalled; };

    await check("Documents page: a document waiting for its scheduled re-read is not stalled (no Try again)", async () => {
      assert.equal(stalled(DOCS.waiting), false);
    });
    await check("Try again on a document waiting for its scheduled re-read starts no second read", async () => {
      const before = await jobs(DOCS.waiting);
      assert.equal(await tryAgain(DOCS.waiting), 409);
      const after = await jobs(DOCS.waiting);
      assert.deepEqual(after, before, "jobs unchanged");
      assert.equal(after.own, "dead_letter");
      assert.equal(await pendingReads(DOCS.waiting), 1);
    });
    await check("a dead re-read leaves the document stalled, and Try again still reads it once", async () => {
      assert.equal(stalled(DOCS.deadReread), true);
      assert.equal(await tryAgain(DOCS.deadReread), 202);
      const after = await jobs(DOCS.deadReread);
      assert.equal(after.own, "queued");
      assert.equal(after.reread, "dead_letter");
      assert.equal(await pendingReads(DOCS.deadReread), 1);
    });
    await check("an overdue, unclaimed re-read leaves the document stalled; Try again reads it once (the waiting re-read is retired)", async () => {
      assert.equal(stalled(DOCS.overdueReread), true);
      assert.equal(await tryAgain(DOCS.overdueReread), 202);
      const after = await jobs(DOCS.overdueReread);
      assert.equal(after.own, "queued");
      assert.equal(after.reread, "cancelled");
      assert.equal(await pendingReads(DOCS.overdueReread), 1);
    });
    await check("Re-analyse of a document read in part replaces its scheduled re-read: one read, not two", async () => {
      assert.equal(stalled(DOCS.readInPart), false);
      assert.equal(await tryAgain(DOCS.readInPart), 202);
      const after = await jobs(DOCS.readInPart);
      assert.equal(after.own, "queued");
      assert.equal(after.reread, "cancelled");
      assert.equal(await pendingReads(DOCS.readInPart), 1);
    });
    await check("existing: a live intake job is not stalled and Try again is refused", async () => {
      assert.equal(stalled(DOCS.liveOwnJob), false);
      assert.equal(await tryAgain(DOCS.liveOwnJob), 409);
      assert.equal((await jobs(DOCS.liveOwnJob)).own, "queued");
    });
    await check("existing: an in-progress document with no job is stalled and Try again starts it", async () => {
      assert.equal(stalled(DOCS.noJob), true);
      assert.equal(await tryAgain(DOCS.noJob), 202);
      assert.equal((await jobs(DOCS.noJob)).own, "queued");
    });
    await check("existing: a document queued a moment ago is not stalled (2-minute grace) and Try again is refused", async () => {
      assert.equal(stalled(DOCS.fresh), false);
      assert.equal(await tryAgain(DOCS.fresh), 409);
      assert.equal((await jobs(DOCS.fresh)).own, null);
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.query("ROLLBACK").catch(() => undefined);
    await db.end();
  }
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
