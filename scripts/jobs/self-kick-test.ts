/** Background work goes on without anyone opening the app (DC, 10 Nov; lib/jobs/self-kick.ts): work due soon starts one
 * authenticated POST to this deployment's own job runner, which answers at once and runs a batch after its response,
 * chaining one link at a time while work is due soon. Disposable PGlite with the pool patched (as
 * scripts/worker-runtime-regressions.ts); fake job types and a recording fetch: no model, no network.
 *   npm run -s jobs:self-kick-test */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { enqueueJob } from "@/lib/jobs/queue";
import { JOB_RUNNER_PATH } from "@/lib/jobs/cron-runner";
import { CHAIN_LEASE_KEY, CHAIN_LEASE_MS, KICK_CHAIN_HEADER, KICK_HOP_HEADER, KICK_HORIZON_MS, MAX_KICK_HOPS, holdChainLease, kickChain, kickHop, kickIfPending as kickRaw, kickUrl, nextDueInMs, resetKickStateForTests, runKickedLink } from "@/lib/jobs/self-kick";
import { guardCapUsd } from "@/lib/benefit-table/guard-flag";

const SECRET = "s".repeat(48);
const VERCEL = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "app.example.test", VERCEL_URL: "app-abc123.example.test", CRON_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
let outbound = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { outbound++; throw new Error("no network"); }) as typeof fetch;
type Sent = { url: string; auth: string | null; hop: string | null; method: string; chain: string | null };
/** The job types the runner takes, in these cases. */
const TYPES = ["sk_due", "sk_later", "sk_read", "sk_soon", "sk_mine"];
const kickIfPending = (p: Parameters<typeof kickRaw>[0] = {}) => kickRaw({ jobTypes: TYPES, ...p });
const recorder = (status = 202) => { const sent: Sent[] = []; const f = (async (url: string, init: RequestInit) => {
  const h = new Headers(init.headers); sent.push({ url: String(url), auth: h.get("authorization"), hop: h.get(KICK_HOP_HEADER), method: init.method ?? "GET", chain: h.get(KICK_CHAIN_HEADER) });
  return new Response("{}", { status }); }) as unknown as typeof fetch; return { sent, f }; };

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["sql/schema.sql", "sql/background-jobs.sql"]) await db.exec(await readFile(path.resolve(file), "utf8"));
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length) { const res = await db.exec(text); const last = res[res.length - 1]; return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;
  const clear = async () => { await pool.query("DELETE FROM background_jobs"); await pool.query("DELETE FROM storage_cleanup_locks"); };
  const enqueue = (jobType: string, delayMs = 0) => enqueueJob(pool, { jobType, idempotencyKey: randomUUID(), payload: {}, maxAttempts: 1, ...(delayMs ? { availableAt: new Date(Date.now() + delayMs) } : {}) });
  let passed = 0; const failures: string[] = [];
  const test = async (name: string, fn: () => Promise<void>) => { try { await clear(); resetKickStateForTests(); await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); } };

  await test("A the address is this deployment's own: production domain, else the deployment URL; never off Vercel", async () => {
    assert.equal(kickUrl(VERCEL), `https://app.example.test${JOB_RUNNER_PATH}`);
    assert.equal(kickUrl({ ...VERCEL, VERCEL_ENV: "preview" }), `https://app-abc123.example.test${JOB_RUNNER_PATH}`);
    assert.equal(kickUrl({ ...VERCEL, VERCEL: "" }), null);
    assert.equal(kickUrl({ ...VERCEL, VERCEL_PROJECT_PRODUCTION_URL: "evil.test/x?", VERCEL_URL: "" }), null);
    assert.equal(kickHop("3"), 3); assert.equal(kickHop("x"), 1); assert.equal(kickHop(String(MAX_KICK_HOPS + 5)), 1);
  });

  await test("B nothing is sent off Vercel, without a CRON_SECRET, with the drain off, or with no work due soon", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_due");
    assert.equal(await kickIfPending({ env: { ...VERCEL, VERCEL: "" }, fetchImpl: f }), "off");
    assert.equal(await kickIfPending({ env: { ...VERCEL, CRON_SECRET: "short" }, fetchImpl: f }), "off");
    assert.equal(await kickIfPending({ env: { ...VERCEL, JOB_DRAIN_ON_REQUEST: "false" }, fetchImpl: f }), "off");
    await clear();
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "no_work");
    await enqueue("sk_later", KICK_HORIZON_MS + 3600_000);
    resetKickStateForTests();
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "no_work", "work due hours away is left to the drain and the daily run");
    assert.equal(sent.length, 0);
  });

  await test("C work due now sends one authenticated POST to the runner, throttled per function; a chain link is not throttled", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_due");
    assert.equal(await nextDueInMs(TYPES), 0);
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "sent");
    const chain = sent[0].chain!;
    assert.ok(kickChain(chain));
    assert.deepEqual(sent[0], { url: `https://app.example.test${JOB_RUNNER_PATH}`, auth: `Bearer ${SECRET}`, hop: "1", method: "POST", chain });
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "throttled");
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f, hop: 4, chain }), "sent", "the chain's own next link renews its lease");
    assert.equal(sent[1].hop, "5"); assert.equal(sent[1].chain, chain);
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f, hop: MAX_KICK_HOPS, chain }), "last_hop");
    assert.equal(sent.length, 2);
    const failing = recorder(500);
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: failing.f, hop: 1 }), "failed", "never throws");
  });

  await test("D a link runs the batch, then sends the next link while work is still due soon", async () => {
    const { sent, f } = recorder();
    const ran: string[] = [];
    const types = [{ jobType: "sk_read", process: async () => { ran.push("read"); await enqueue("sk_read"); } }];
    await enqueue("sk_read");
    const out = await runKickedLink({ hop: 2, chain: randomUUID(), startedAt: Date.now(), jobTypes: types as never, env: VERCEL, fetchImpl: f });
    assert.ok(out.summary && out.summary.claimed >= 1);
    assert.ok(ran.length >= 1);
    assert.equal(out.next, "sent"); assert.equal(sent[0].hop, "3");
  });

  await test("E a link waits inside its own time for a job due in a moment, then runs it; the chain ends when the queue is empty", async () => {
    const { sent, f } = recorder();
    let ran = 0; const slept: number[] = [];
    const types = [{ jobType: "sk_soon", process: async () => { ran++; } }];
    await enqueue("sk_soon", 1500);
    const out = await runKickedLink({ hop: 1, chain: randomUUID(), startedAt: Date.now(), jobTypes: types as never, env: VERCEL, fetchImpl: f,
      sleep: async (ms) => { slept.push(ms); await new Promise((r) => setTimeout(r, ms)); } });
    assert.ok(slept.length >= 1); assert.ok(slept.reduce((a, b) => a + b, 0) <= 1500 + 50);
    assert.equal(ran, 1);
    assert.equal(out.next, "no_work"); assert.equal(sent.length, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM storage_cleanup_locks")).rows[0].n, 0, "the ended chain frees its lease");
  });

  await test("F a link with too little time left to wait passes the wait on to the next link", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_later", 5 * 60_000);
    const out = await runKickedLink({ hop: 1, chain: randomUUID(), startedAt: Date.now() - 200_000, jobTypes: [{ jobType: "sk_later", process: async () => undefined }] as never, env: VERCEL, fetchImpl: f, sleep: async () => undefined });
    assert.equal(out.summary, null); assert.equal(out.next, "sent"); assert.equal(sent[0].hop, "2");
  });

  await test("G a link that finds nothing it can claim (another runner has it) ends its chain: chains never pile up", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_mine");
    // Another runner claims it between the link's look and its batch.
    let taken = false;
    const out = await runKickedLink({ hop: 1, chain: randomUUID(), startedAt: Date.now(), jobTypes: [{ jobType: "sk_mine", process: async () => undefined }] as never, env: VERCEL, fetchImpl: f,
      db: { query: (async (text: string, params?: unknown[]) => { if (!taken && /SELECT CASE WHEN MIN/.test(text)) { taken = true; const r = await pool.query(text, params as never[]); await pool.query("UPDATE background_jobs SET status='succeeded'"); return r; } return pool.query(text, params as never[]); }) as typeof pool.query } });
    assert.equal(out.summary?.claimed, 0); assert.equal(out.next, "ended"); assert.equal(sent.length, 0);
  });

  await test("K Critic probe: an instance polling every 2 s for 5 minutes, a job due in 10 minutes, starts ONE chain", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_later", 10 * 60_000);
    let t = Date.now();
    const outcomes: Record<string, number> = {};
    for (let i = 0; i < 150; i++) {
      t += 2000;
      const o = await kickIfPending({ env: VERCEL, fetchImpl: f, now: () => t });
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    }
    assert.equal(sent.length, 1, JSON.stringify(outcomes));
    // Every instance at once (each with its own throttle): still one chain.
    for (let i = 0; i < 20; i++) { resetKickStateForTests(); assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "busy"); }
    assert.equal(sent.length, 1);
  });

  await test("L the lease: a chain whose function died frees it when it lapses; a stale link whose lease was taken ends at once", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_due");
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "sent");
    const first = sent[0].chain!;
    await pool.query(`UPDATE storage_cleanup_locks SET acquired_at = now() - ($1 || ' milliseconds')::interval WHERE lock_key=$2`, [String(CHAIN_LEASE_MS + 1000), CHAIN_LEASE_KEY]);
    resetKickStateForTests();
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "sent", "a lapsed lease is taken by a new chain");
    const second = sent[1].chain!;
    assert.notEqual(first, second);
    let ran = 0;
    const out = await runKickedLink({ hop: 2, chain: first, startedAt: Date.now(), jobTypes: [{ jobType: "sk_due", process: async () => { ran++; } }] as never, env: VERCEL, fetchImpl: f });
    assert.equal(out.next, "ended"); assert.equal(ran, 0, "the old chain's link does nothing");
    assert.equal(await holdChainLease(second), true, "the new chain still holds it");
    assert.equal(await holdChainLease(first), false);
    assert.equal(kickChain("not-a-uuid"), null);
  });

  await test("M a queued job of a type the runner never takes starts no chain", async () => {
    const { sent, f } = recorder();
    await enqueue("sk_unknown_type");
    assert.equal(await nextDueInMs(TYPES), null);
    assert.equal(await kickIfPending({ env: VERCEL, fetchImpl: f }), "no_work");
    assert.equal(sent.length, 0);
  });

  await test("H the runner's POST needs the CRON_SECRET and answers at once", async () => {
    process.env.CRON_SECRET = SECRET;
    const { POST } = await import("@/app/api/internal/jobs/run/route");
    const req = (auth?: string) => new NextRequest(`http://localhost${JOB_RUNNER_PATH}`, { method: "POST", headers: auth ? { authorization: auth } : {} });
    assert.equal((await POST(req())).status, 401);
    assert.equal((await POST(req("Bearer wrong"))).status, 401);
    const ok = await POST(req(`Bearer ${SECRET}`));
    assert.equal(ok.status, 202);
    delete process.env.CRON_SECRET;
    assert.equal((await POST(req(`Bearer ${SECRET}`))).status, 503);
  });

  await test("I wiring: the upload's own job, the request drain and the daily run each start a chain when work is due soon", async () => {
    const drain = readFileSync(path.resolve("lib/jobs/request-drain.ts"), "utf8");
    assert.match(drain, /await startJobNow\(\{ jobType, idempotencyKey \}\); await kickSoon\(\);/);
    assert.match(drain, /await drainOnce\(\); await kickSoon\(\);/);
    const route = readFileSync(path.resolve("app/api/internal/jobs/run/route.ts"), "utf8");
    assert.match(route, /runJobBatch\(\{ jobTypes: PRODUCTION_JOB_TYPES \}\);\n\s*\/\/[^\n]*\n\s*await kickIfPending\(\);/);
    assert.match(route, /export async function POST/);
  });

  await test("J reading a document is not limited by cost: the figure check has no spend limit unless the operator sets one", async () => {
    assert.equal(guardCapUsd({} as unknown as NodeJS.ProcessEnv), Infinity);
    assert.equal(guardCapUsd({ DEARPOLICY_FIGURE_GUARD_CAP_USD: "5" } as unknown as NodeJS.ProcessEnv), 5);
    assert.equal(guardCapUsd({ DEARPOLICY_FIGURE_GUARD_CAP_USD: "x" } as unknown as NodeJS.ProcessEnv), Infinity);
  });

  await test("N no request left this machine", async () => assert.equal(outbound, 0));
  globalThis.fetch = realFetch;
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`self kick: ${passed} passed, 0 failed`); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
