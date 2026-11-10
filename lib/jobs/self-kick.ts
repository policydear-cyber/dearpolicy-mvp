/** Background work goes on without anyone opening the app (DC, 10 Nov). On Vercel Hobby the Cron runs once a day, and the
 * request drain (request-drain.ts) runs only while someone uses the app, so a long policy's table reading whose first run
 * ended with the rest queued (benefit-table/table-reading-job.ts) waited for the next visit or 03:00Z.
 *
 * When work is queued and due soon, the function that left it sends ONE authenticated POST to this deployment's own job
 * runner (JOB_RUNNER_PATH, `Authorization: Bearer <CRON_SECRET>`, the same check the daily Cron passes). That route answers
 * at once and, after its response, in a function with its own time limit:
 *   1. waits, inside its own time, for the next job when it is due within a few minutes;
 *   2. runs one batch through runJobBatch (the same claim, lease, heartbeat, retry and dead-letter rules as every runner);
 *   3. sends the next POST when work is still due soon: a chain, one link at a time.
 * Bounds:
 * - ONE chain at a time across every instance: a single-row lease (storage_cleanup_locks, key CHAIN_LEASE_KEY) that a
 *   chain's first POST must win and each link renews; the per-function throttle is only a cheap check before it. A chain
 *   whose function died frees the lease when it lapses (CHAIN_LEASE_MS);
 * - only work due within KICK_HORIZON_MS, of a type the runner takes, starts a chain; later work (a reading waiting hours after failed runs) is left to
 *   the drain and the daily Cron;
 * - a link that waited for a job and then found nothing to claim (another runner took it) ends its chain, so chains never
 *   pile up; a chain also ends after MAX_KICK_HOPS links;
 * - a function starts at most one chain per KICK_MIN_INTERVAL_MS;
 * - the address is this deployment's own (VERCEL_PROJECT_PRODUCTION_URL in production, VERCEL_URL elsewhere), never one
 *   taken from a request; off Vercel, or with no CRON_SECRET, or with JOB_DRAIN_ON_REQUEST off, nothing is sent.
 * Never throws; logs an error class only. */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import { MIN_CRON_SECRET_LENGTH } from "@/lib/launch/guards";
import { JOB_RUNNER_PATH, runJobBatch, type JobBatchSummary } from "./cron-runner";
import { FUNCTION_LIMIT_MS } from "./function-time";
import type { WorkerJobTypeConfig } from "./worker-runtime";

type Db = { query: typeof pool.query };
export const KICK_HOP_HEADER = "x-dearpolicy-kick-hop";
export const KICK_CHAIN_HEADER = "x-dearpolicy-kick-chain";
/** Work due within this long starts (or keeps) a chain. */
export const KICK_HORIZON_MS = 15 * 60_000;
export const MAX_KICK_HOPS = 40;
export const KICK_MIN_INTERVAL_MS = 15_000;
/** The one chain's lease: a link's whole function, plus the time to send the next POST. */
export const CHAIN_LEASE_KEY = "background-job-chain";
export const CHAIN_LEASE_MS = FUNCTION_LIMIT_MS + 30_000;
/** A link waits for the next job only while this much of its function's time is left for the batch. */
const BATCH_RESERVE_MS = 200_000;
/** A waiting link looks again this often, so work that becomes due sooner is run sooner. */
const WAIT_SLICE_MS = 10_000;
const KICK_TIMEOUT_MS = 10_000;

const drainOn = (env: NodeJS.ProcessEnv) => !/^(0|false|off|no)$/i.test(env.JOB_DRAIN_ON_REQUEST?.trim() ?? "");
const runnerTypes = async () => (await import("./processors")).PRODUCTION_JOB_TYPES.map((t) => t.jobType);

/** This deployment's own job-runner address, or null off Vercel. */
export function kickUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.VERCEL) return null;
  const host = ((env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : "") || env.VERCEL_URL || "").trim()
    .replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host || /[\s/?#@]/.test(host)) return null;
  return `https://${host}${JOB_RUNNER_PATH}`;
}

/** Milliseconds until the soonest queued job of a type the runner takes is due (0: due now, or a lease has expired), or
 * null when none is due within KICK_HORIZON_MS. */
export async function nextDueInMs(jobTypes: string[], db: Db = pool): Promise<number | null> {
  if (!jobTypes.length) return null;
  const r = await db.query<{ wait_ms: string | number | null }>(
    // GREATEST skips a NULL, so an empty queue is told apart before it (MIN over no rows is NULL).
    `SELECT CASE WHEN MIN(due) IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (MIN(due) - now())) * 1000) END AS wait_ms FROM (
       SELECT available_at AS due FROM background_jobs WHERE job_type = ANY($1::text[]) AND status IN ('queued','failed_retryable') AND NOT cancel_requested
       UNION ALL SELECT now() FROM background_jobs WHERE job_type = ANY($1::text[]) AND status = 'processing' AND lease_expires_at < now()) d`, [jobTypes]);
  const raw = r.rows[0]?.wait_ms;
  if (raw == null) return null;
  const ms = Math.ceil(Number(raw));
  return Number.isFinite(ms) && ms <= KICK_HORIZON_MS ? ms : null;
}

/** Takes or renews the one chain's lease for `chain`: true when it is free, lapsed, or already this chain's. */
export async function holdChainLease(chain: string, db: Db = pool): Promise<boolean> {
  const r = await db.query<{ holder: string }>(
    `INSERT INTO storage_cleanup_locks(lock_key, holder, acquired_at) VALUES ($1, $2, now())
     ON CONFLICT (lock_key) DO UPDATE SET holder = EXCLUDED.holder, acquired_at = now()
       WHERE storage_cleanup_locks.holder = EXCLUDED.holder OR storage_cleanup_locks.acquired_at < now() - ($3 || ' milliseconds')::interval
     RETURNING holder`, [CHAIN_LEASE_KEY, chain, String(CHAIN_LEASE_MS)]);
  return r.rows[0]?.holder === chain;
}
/** Frees the lease when `chain` still holds it (its chain has ended). */
export async function releaseChainLease(chain: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM storage_cleanup_locks WHERE lock_key = $1 AND holder = $2`, [CHAIN_LEASE_KEY, chain]);
}

let lastKickAt = Number.NEGATIVE_INFINITY;
export function resetKickStateForTests() { lastKickAt = Number.NEGATIVE_INFINITY; }

export type KickOutcome = "sent" | "off" | "no_work" | "throttled" | "busy" | "last_hop" | "failed";
type KickParams = { hop?: number; chain?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; db?: Db; now?: () => number; jobTypes?: string[] };
/** Sends one POST to the job runner when work is due soon. `hop` 0 starts a chain: it must win the one chain's lease
 * ("busy" when another chain holds it), after a per-function throttle. A chain's next link passes its hop and chain. */
export async function kickIfPending(params: KickParams = {}): Promise<KickOutcome> {
  const env = params.env ?? process.env, now = params.now ?? Date.now, hop = params.hop ?? 0, db = params.db ?? pool;
  const chain = params.chain ?? randomUUID();
  try {
    const url = kickUrl(env), secret = env.CRON_SECRET?.trim() ?? "";
    if (!url || !drainOn(env) || secret.length < MIN_CRON_SECRET_LENGTH) return "off";
    if (hop >= MAX_KICK_HOPS) {
      await releaseChainLease(chain, db);
      console.warn(`job kick: chain ended after ${hop} links (the drain and the daily run go on with it)`);
      return "last_hop";
    }
    if (hop === 0 && now() - lastKickAt < KICK_MIN_INTERVAL_MS) return "throttled";
    if (hop === 0) lastKickAt = now();
    if ((await nextDueInMs(params.jobTypes ?? await runnerTypes(), db)) == null) { if (hop) await releaseChainLease(chain, db); return "no_work"; }
    if (!(await holdChainLease(chain, db))) return "busy";
    const res = await (params.fetchImpl ?? fetch)(url, { method: "POST", headers: { authorization: `Bearer ${secret}`,
      [KICK_HOP_HEADER]: String(hop + 1), [KICK_CHAIN_HEADER]: chain }, signal: AbortSignal.timeout(KICK_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) { await releaseChainLease(chain, db); console.error(`job kick: runner answered ${res.status}`); return "failed"; }
    return "sent";
  } catch (error) {
    await releaseChainLease(chain, db).catch(() => undefined);
    console.error(`job kick: failed (${error instanceof Error ? error.name : "unknown"})`);
    return "failed";
  }
}

export function kickHop(header: string | null): number {
  const n = Number(header ?? "");
  return Number.isInteger(n) && n >= 1 && n <= MAX_KICK_HOPS ? n : 1;
}
/** The chain a link belongs to (a UUID), or null. */
export function kickChain(header: string | null): string | null {
  const v = (header ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
}

export type KickedRun = { waitedMs: number; summary: JobBatchSummary | null; next: KickOutcome | "ended" };
/** One link of the chain, run after the runner's POST has answered (app/api/internal/jobs/run/route.ts). A link whose
 * chain no longer holds the lease (another chain took it after this one's lapsed) ends at once. */
export async function runKickedLink(params: { hop: number; chain: string | null; startedAt: number; jobTypes: WorkerJobTypeConfig[]; env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; db?: Db }): Promise<KickedRun> {
  const now = params.now ?? Date.now, db = params.db ?? pool, sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const types = params.jobTypes.map((t) => t.jobType);
  if (!params.chain) return { waitedMs: 0, summary: null, next: "ended" };
  const chain = params.chain;
  const end = async (waitedMs: number, summary: JobBatchSummary | null): Promise<KickedRun> => { await releaseChainLease(chain, db); return { waitedMs, summary, next: "ended" }; };
  const next = (hop: number) => kickIfPending({ hop, chain, env: params.env, fetchImpl: params.fetchImpl, db, now, jobTypes: types });
  try {
    if (!(await holdChainLease(chain, db))) return { waitedMs: 0, summary: null, next: "ended" };
    let due = await nextDueInMs(types, db);
    if (due == null) return end(0, null);
    let waitedMs = 0;
    const room = () => params.startedAt + FUNCTION_LIMIT_MS - BATCH_RESERVE_MS - now();
    while (due != null && due > 0 && room() > 0) {
      const step = Math.min(due, room(), WAIT_SLICE_MS);
      await sleep(step); waitedMs += step;
      // Another chain took the lease (this one's lapsed): this link ends, so only one chain ever runs.
      if (!(await holdChainLease(chain, db))) return { waitedMs, summary: null, next: "ended" };
      due = await nextDueInMs(types, db);
    }
    if (due == null) return end(waitedMs, null);
    // Not due yet within this function's time: the next link waits on.
    if (due > 0) return { waitedMs, summary: null, next: await next(params.hop) };
    const summary = await runJobBatch({ jobTypes: params.jobTypes, workerId: `kick-${params.hop}-${Math.random().toString(36).slice(2, 10)}` });
    // Nothing to claim after all: another runner has it, and this chain ends.
    if (!summary.claimed) return end(waitedMs, summary);
    return { waitedMs, summary, next: await next(params.hop) };
  } catch (error) {
    await releaseChainLease(chain, db).catch(() => undefined);
    console.error(`job kick: link failed (${error instanceof Error ? error.name : "unknown"})`);
    return { waitedMs: 0, summary: null, next: "failed" };
  }
}
