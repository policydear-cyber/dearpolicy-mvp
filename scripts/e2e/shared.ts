/**
 * Checkpoint 14g (claude/v1-launch-hardening): shared plumbing for the
 * 9-stage multi-process authenticated E2E journey
 * (scripts/full-household-e2e-orchestrator.mjs). Each stage in
 * scripts/e2e/stages/*.ts runs as its OWN separate `npx tsx` child process
 * (spawned by the orchestrator), specifically so this sandbox's ~985MiB
 * ceiling sees each stage's memory fully released by the OS when that
 * process exits, rather than accumulating across 9 stages the way a
 * single-process journey would (the exact constraint
 * scripts/full-household-e2e-regressions.ts's own header already
 * documents for lib/lifecycle/coordinator.ts's deletion paths).
 *
 * Fixture persistence: @electric-sql/pglite (already a devDependency, used
 * by every PGlite-backed regression suite in this repo) supports a real
 * filesystem-backed data directory (`new PGlite('/path/to/dir')`, per its
 * own README) as an alternative to its default in-memory mode. Every stage
 * opens the SAME on-disk data directory (process.env.E2E_FIXTURE_DIR,
 * set once by the orchestrator and inherited by every child process), so
 * household/family/policy/claim/evidence state a real route handler wrote
 * in stage N is still there -- read by the real database, not replayed
 * from a JSON snapshot -- when stage N+1 opens a fresh process against
 * that same directory. This was verified directly before building the 9
 * stages on it: a throwaway two-process smoke test (process 1 opens the
 * dir, inserts a row, closes; process 2 opens the SAME dir fresh and reads
 * it back) confirmed the row survives across the process boundary. A
 * small JSON handoff file in the same directory carries only the specific
 * ROW IDS (householdId, policyId, etc.) each next stage needs to look up
 * in that real, persisted database -- never a substitute for the database
 * itself.
 *
 * PGlite is documented as single-user/single-connection: each stage's
 * `finally` block always calls db.close() before the process exits, which
 * is what lets the NEXT stage's process open the same directory without
 * a stale lock.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NextRequest } from "next/server";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

// Checkpoint 14g: the SAME core SQL_FILES list scripts/full-household-
// e2e-regressions.ts (Checkpoint 12) already established and proved
// reliable in this sandbox. A first attempt at widening this to the
// union of every sql/*.sql file any reused suite touches (so ONE list
// covered all 9 stages) reliably OOM-killed even stage 1 under this
// sandbox's real, tight memory ceiling -- reverted. Each stage instead
// applies only the extra files IT specifically needs, via
// applyExtraSql() below, right before the code path that needs them --
// smaller, targeted SQL_FILES per stage, not one maximal list every
// stage pays for. sql/lifecycle.sql stays last -- its ALTERs target
// tables every file before it creates.
export const SQL_FILES = [
  "sql/schema.sql",
  "sql/claim-evidence.sql",
  "sql/claim-composition.sql",
  "sql/benefit-catalog.sql",
  "sql/model-usage.sql",
  "sql/coverage-ledger.sql",
  "sql/household-rls.sql",
  "sql/background-jobs.sql",
  "sql/lifecycle.sql",
  "sql/model-provenance.sql",
];

/** Applies extra sql/*.sql files a specific stage needs beyond the core
 * SQL_FILES list, e.g. sql/critical-illness.sql + sql/disability.sql for
 * stage 6's coordinator-level evidence deletion (claim_disability_
 * definition_matches / claim_ci_definition_matches), or sql/rate-
 * limit.sql for stage 8's real invitation routes (lib/http/db-rate-
 * limit.ts has no lazy schema creator of its own, unlike
 * ensureClaimEvidenceSchema()/ensureChatSchema()). Every CREATE TABLE in
 * every sql/*.sql file in this repo already uses IF NOT EXISTS, so this
 * is safe to call more than once and safe regardless of what the core
 * list already applied. sql/storage-rls.sql is never a valid argument
 * here -- it targets Supabase Storage's own storage.objects/
 * storage.buckets schema, which does not exist in a disposable PGlite
 * instance (confirmed directly: "relation storage.objects does not
 * exist" the one time this was tried).
 */
export async function applyExtraSql(files: string[]): Promise<void> {
  for (const file of files) {
    await pool.query(await readFile(path.resolve(file), "utf8"));
  }
}

// ---------------------------------------------------------------------
// Fixture directory / handoff file
// ---------------------------------------------------------------------
export function fixtureDir(): string {
  const dir = process.env.E2E_FIXTURE_DIR;
  if (!dir) throw new Error("E2E_FIXTURE_DIR is not set -- this stage must be run via scripts/full-household-e2e-orchestrator.mjs, not directly.");
  return dir;
}
export function pgDataDir(): string {
  return path.join(fixtureDir(), "pgdata");
}
function handoffPath(): string {
  return path.join(fixtureDir(), "handoff.json");
}

export type Handoff = Record<string, string | number | boolean | null>;

export async function readHandoff(): Promise<Handoff> {
  const file = handoffPath();
  if (!existsSync(file)) return {};
  return JSON.parse(await readFile(file, "utf8")) as Handoff;
}

export async function writeHandoff(patch: Handoff): Promise<void> {
  const existing = await readHandoff();
  const merged = { ...existing, ...patch };
  await mkdir(fixtureDir(), { recursive: true });
  await writeFile(handoffPath(), JSON.stringify(merged, null, 2), "utf8");
}

/** Asserts the named fields are present (and truthy) in the handoff read
 * from the PRIOR stage -- a stage that finds one missing fails loudly and
 * immediately, rather than proceeding against undefined state. This is
 * the "validate the prior stage's output" contract for the ids a stage
 * needs before it can even start; each stage ALSO re-validates the prior
 * stage's real database row(s) through a live route call before doing its
 * own new work (see each stage file), which is the substantive check --
 * this one just guards against a missing/corrupt handoff file. */
export function requireHandoff(handoff: Handoff, keys: string[]): void {
  const missing = keys.filter((k) => handoff[k] === undefined || handoff[k] === null || handoff[k] === "");
  if (missing.length) {
    throw new Error(`handoff.json is missing required field(s) from a prior stage: ${missing.join(", ")}. Prior stage did not persist expected state, or stages were run out of order.`);
  }
}

// ---------------------------------------------------------------------
// Memory evidence -- logged by every stage in addition to the
// orchestrator's own free -h capture around each child process, so the
// stage's own log carries its own RSS at start/end independent of the
// orchestrator's external observation.
// ---------------------------------------------------------------------
export function logMemory(label: string): void {
  const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  console.log(`  [memory] ${label}: RSS ${rssMb} MB (pid ${process.pid})`);
}

// ---------------------------------------------------------------------
// Step runner (per-process counter -- each stage is its own process, so a
// fresh module-level counter per stage is correct, not shared mutable
// state across stages).
// ---------------------------------------------------------------------
export function createStepper() {
  let step = 0;
  return async function journeyStep(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      step++;
      console.log(`  [${step}] ${name}`);
    } catch (error) {
      throw new Error(`step ${step + 1} ("${name}") failed`, { cause: error });
    }
  };
}

// ---------------------------------------------------------------------
// Identity / request helpers -- identical to
// scripts/full-household-e2e-regressions.ts's own established pattern.
// ---------------------------------------------------------------------
export function asUser(userId: string) {
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = userId;
}

export function requestFor(url: string, opts: { household?: string; method?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.household) headers["cookie"] = `${ACTIVE_HOUSEHOLD_COOKIE}=${opts.household}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.form ? { body: opts.form } : {}),
  });
}

export const STUB_PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.4\n%stub, rejected by scan before parsing\n%%EOF\n", "latin1"));

export function pdfFormData(filename: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([STUB_PDF_BYTES], filename, { type: "application/pdf" }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

/** Checkpoint 14f (claude/v1-launch-hardening) changed
 * enqueuePolicyProcessing()/enqueueClaimEvidenceProcessing() to
 * enqueue-only -- a real, separate worker process (scripts/worker.ts,
 * lib/jobs/worker-runtime.ts's runWorkerLoop()) is now the only thing
 * that ever claims and runs the job. scripts/full-household-e2e-
 * regressions.ts (Checkpoint 12) predates that change and still just
 * waitFor()-polls the read route expecting INLINE completion, which no
 * longer happens -- reproduced directly while building this stage
 * (timed out after 5s with the job still 'queued'; see this
 * checkpoint's PR comment). This runs exactly one real
 * claimAndProcessOne() pass, the same primitive scripts/worker.ts's own
 * poll loop calls, so this journey proves the ACTUAL current production
 * topology (separate producer and consumer) rather than a stale
 * assumption -- genuinely new coverage the superseded single-process
 * suite never had. */
export async function runWorkerOnce(jobType: string): Promise<"empty" | "succeeded" | "failed"> {
  const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
  const { PRODUCTION_JOB_TYPES } = await import("@/lib/jobs/processors");
  const config = PRODUCTION_JOB_TYPES.find((t) => t.jobType === jobType);
  if (!config) throw new Error(`runWorkerOnce: no processor configured for job type "${jobType}"`);
  return claimAndProcessOne({ jobType, workerId: `e2e-stage-${process.pid}`, process: config.process });
}

export async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 5000, intervalMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------
// Fixture database: opens the SAME on-disk PGlite data directory every
// stage shares, re-applies the (idempotent -- every CREATE TABLE in
// sql/schema.sql already uses IF NOT EXISTS, and sql/lifecycle.sql's own
// ALTERs are all ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS)
// schema files, and patches lib/db/client.ts's pool exactly the way every
// existing PGlite-backed suite in this repo already does.
// ---------------------------------------------------------------------
export async function openFixtureDb() {
  const db = new PGlite(pgDataDir(), { extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  // Checkpoint 14g, stage 7 discovery: a table-level GRANT alone is not
  // enough for an INSERT into a table with a `serial`/identity primary key
  // (e.g. policy_document_audit_log) under `SET LOCAL ROLE authenticated`
  // (lib/db/authz-client.ts's createUserSupabaseClient()) -- Postgres also
  // requires USAGE+SELECT on the underlying sequence to call nextval() for
  // that column, which this real, production-shaped RLS-scoped role never
  // had in this fixture until now. Real production Supabase project setup
  // presumably grants this at the schema/role level already (or every
  // serial-PK insert under RLS would fail there too); this fixture's own
  // bootstrap simply never granted it, and no earlier stage's
  // authenticated-role write happened to hit a serial (vs. app-generated
  // uuid) primary key until stage 7's requestPolicyDeletion() -> its
  // policy_document_audit_log insert -- confirmed by the real error this
  // produced before this GRANT was added: `permission denied for sequence
  // policy_document_audit_log_id_seq` (Postgres code 42501).
  await db.exec("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;");

  // Two independent layers keep this shim both deadlock-free (stage 7)
  // and corruption-free (stage 3) against PGlite's single, non-concurrent
  // session:
  //
  // Layer 1 (`acquire()`/`tail`, admission): a strict FIFO mutex that
  // orders pool.connect()/pool.query() callers relative to each other.
  // pool.connect() holds this lock for its whole checked-out-client
  // lifetime (until .release()); a genuinely separate top-level
  // pool.query() call still queues behind it exactly as before.
  //
  // Layer 2 (`dbTail`, execution): a SEPARATE, always-on FIFO queue
  // directly around the only two calls that ever touch the real db
  // engine (db.exec/db.query). No admission decision above this layer
  // can ever let two engine calls run concurrently, no matter how they
  // got here.
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  let dbTail = Promise.resolve();
  const execute = async (text: string, params: unknown[] = []) => {
    const previousDb = dbTail;
    let releaseDb!: () => void;
    dbTail = new Promise<void>((resolve) => {
      releaseDb = resolve;
    });
    await previousDb;
    try {
      if (params.length === 0) {
        const results = await db.exec(text);
        const last = results[results.length - 1];
        return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
      }
      const result = await db.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    } finally {
      releaseDb();
    }
  };

  // Checkpoint 14g, stage 7 discovery: a real Postgres `pg.Pool` has many
  // physical connections, so lib/db/authz-client.ts's createUserSupabaseClient()
  // checking out ONE connection via pool.connect() (held open across a whole
  // request's BEGIN..COMMIT) never blocks a DIFFERENT, unrelated pool.query()
  // call some other code path makes while that connection is held -- it just
  // runs on another connection, autocommitted independently. That is exactly
  // what lib/lifecycle/coordinator.ts's requestPolicyDeletion() relies on:
  // it runs createOrGetDeletionRequest(pool, ...) -- deliberately against the
  // raw `pool`, NOT the caller-supplied scoped `client` -- from INSIDE the
  // very transaction createUserSupabaseClient() is already holding open via
  // its own pool.connect(), so that the deletion-request bookkeeping row is
  // not entangled with (or rolled back by) the caller's transaction.
  //
  // This fixture has only ONE real connection (PGlite is single-user), so
  // the original version of this shim serialized pool.query()/pool.connect()
  // through one strict FIFO mutex (layer 1 alone). That is correct for
  // genuinely separate top-level callers, but it deadlocked this exact
  // nested pattern: pool.connect()'s acquire() never resolves its `tail`
  // until the checked-out client's .release() runs, and .release() can't
  // run until requestPolicyDeletion()'s own pool.query() (queued behind
  // that same unresolved `tail`) returns -- a real, reproducible hang (not
  // OOM) discovered while building stage 7's real DELETE /api/policies/[id]
  // route call, confirmed by adding step-by-step debug breadcrumbs: the
  // process consistently stopped forever between "request built" and "got
  // response", with steady ~94MB RSS and no crash/signal, across every
  // invocation strategy tried (npx tsx, direct `node --import tsx/esm`,
  // foregrounded, backgrounded) -- the signature of a stuck promise chain,
  // not a resource limit.
  //
  // First fix attempted (reverted): let pool.query() bypass layer 1
  // entirely whenever a connect() was open, tracked first with a plain
  // global boolean, then with AsyncLocalStorage (entered on
  // pool.connect(), restored on .release()) to scope the bypass to only
  // the SAME logical call chain. Both were found to be genuinely unsafe
  // here, not just theoretically: lib/chat/jobs.ts's runAfterResponse()
  // schedules its fire-and-forget job-runner microtask
  // (`Promise.resolve().then(task)`) from INSIDE the same POST /api/chat
  // request that also holds a createUserSupabaseClient() connect() --
  // that scheduling point is itself inside the connect()'s ALS scope, so
  // the microtask's *captured* AsyncLocalStorage context still says
  // "connect held" even after the real connect() is released (in a
  // different, later continuation). Reproduced directly: the background
  // job's own queries then bypassed layer 1 and ran concurrently against
  // whatever else was touching db.exec/db.query at that moment, and
  // twice produced genuine engine-level corruption -- `permission denied
  // for table chat_analysis_jobs` even with `current_user = postgres`
  // (a bypass-RLS role that should never see that error), and, in a
  // later run, the stage 3 waitFor() polling loop itself permanently
  // observed a stale "connect held" context on every single poll -- both
  // symptoms only appeared when stage 3 was chained as the 3rd stage
  // spawned from one parent process (confirmed with a minimal standalone
  // reproduction outside the real orchestrator), never when run alone.
  //
  // Actual fix: stop trying to track "is this call logically nested
  // inside that connect()" at all (the thing both the boolean and the
  // ALS version got wrong). Instead, let layer-1 admission be permissive
  // (bypass the FIFO mutex whenever ANY connect() is currently open --
  // a plain, synchronous, non-context-propagating counter, so it cannot
  // leak into unrelated continuations the way ALS did) and make layer 2
  // the actual safety net: dbTail above serializes every real db.exec/
  // db.query call, unconditionally, regardless of which layer-1 path
  // admitted it. A bypassed nested call (stage 7's
  // createOrGetDeletionRequest(pool,...)) and a genuinely concurrent
  // unrelated call (stage 3's background job vs. its own polling loop)
  // both still only ever touch the PGlite engine one at a time -- the
  // property that was actually missing -- so neither can corrupt the
  // other's session/role/transaction state, and stage 7's nested
  // statement lands in the SAME still-open PGlite session/transaction
  // (committed together when the outer transaction commits) rather than
  // a separate autocommitted one, exactly as before, but now without any
  // risk of a second, unrelated caller racing the engine itself.
  // Checkpoint 14g, stage 3 correction (found AFTER the "bypass whenever
  // a connect is open" fix above already stopped the deadlock/corruption
  // symptoms): a bypassed nested query does not just skip the FIFO mutex
  // -- since this fixture has only ONE real PGlite session, it also
  // silently runs inside whatever role the CURRENTLY-open connect()
  // happens to have SET LOCAL (createUserSupabaseClient() always sets
  // `authenticated`, a real RLS-restricted role). A caller that
  // deliberately queries through the raw `pool` specifically WANTS
  // bypass-RLS access (that's the entire reason
  // lib/lifecycle/coordinator.ts's requestPolicyDeletion() and
  // lib/chat/jobs.ts's runJob()/getConversation() use it, not the
  // caller-scoped client) -- in real production this is exactly what
  // happens, since pool.query() runs on a genuinely separate physical
  // connection, still authenticated as the pool's own unrestricted login
  // role. Confirmed as the real cause of stage 3's remaining failure
  // (found only after the mockAnthropicFetch() 400-vs-500 timing fix
  // eliminated the red herring of a merely-slow run): with diagnostic
  // logging, lib/chat/jobs.ts's runJob() -> check() -> getConversation()
  // was seen entering its bypassed SELECT against chat_conversations and
  // then throwing (no further progress, no error surfaced to this
  // script -- swallowed by runJob()'s own catch block, which then wrote
  // a 'failed'/'cancelled' status update that itself ALSO ran under the
  // same wrong role and got rolled back with the outer transaction on
  // its next error) -- the same shape as the very first `permission
  // denied for table chat_analysis_jobs` symptom this checkpoint's
  // history above describes, now traced to its real mechanism rather
  // than guessed at.
  //
  // Fix: a bypassed nested query explicitly escapes to the session's
  // original (bypass-RLS) authorization for just that one statement via
  // RESET ROLE, then restores whatever role the still-open connect() had
  // set, so that connect()'s OWN subsequent queries keep behaving
  // exactly as before. The role to restore is tracked, not assumed: the
  // client pool.connect() returns has its own query() wrapped just
  // enough to notice a `SET LOCAL ROLE x` statement the caller issues
  // (createUserSupabaseClient()'s own BEGIN/SET LOCAL ROLE/set_config
  // sequence) and remember it.
  let openConnects = 0;
  let heldRole: string | null = null;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => {
    if (openConnects > 0) {
      await execute("RESET ROLE", []);
      try {
        return await execute(text, params);
      } finally {
        if (heldRole) await execute(`SET LOCAL ROLE ${heldRole}`, []);
      }
    }
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    openConnects++;
    return {
      query: async (text: string, params: unknown[] = []) => {
        const roleMatch = /^\s*SET\s+LOCAL\s+ROLE\s+(\w+)/i.exec(text);
        if (roleMatch) heldRole = roleMatch[1];
        return execute(text, params);
      },
      release: () => {
        openConnects--;
        heldRole = null;
        release();
      },
    } as any;
  }) as typeof pool.connect;

  // claim_evidence_documents is created lazily by
  // lib/claims/evidence/schema.ts's ensureClaimEvidenceSchema() (not part
  // of sql/schema.sql), so sql/lifecycle.sql's ALTER for that table was a
  // no-op above the first time it ever runs against this fixture -- same
  // fix and ordering every other suite in this repo that touches claim
  // evidence already establishes. Safe to redo on every stage: both calls
  // are idempotent.
  const { ensureClaimEvidenceSchema } = await import("@/lib/claims/evidence/schema");
  await ensureClaimEvidenceSchema();
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

  const restorePool = () => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  };
  return { db, restorePool };
}

/** Runs one stage's body against the shared fixture, with memory logging,
 * pool patch/restore and db.close() always applied, and a real nonzero
 * exit code on any failure (assertion or otherwise) -- never a silent
 * partial failure. */
export async function runStage(stageName: string, fn: (ctx: { pool: typeof pool; handoff: Handoff; step: ReturnType<typeof createStepper> }) => Promise<void>) {
  console.log(`\n=== Stage: ${stageName} (pid ${process.pid}) ===`);
  logMemory("start");
  const { setTelemetryAdapter } = await import("@/lib/telemetry");
  const { NoopTelemetryAdapter } = await import("@/lib/telemetry/adapters");
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const { db, restorePool } = await openFixtureDb();
  const handoff = await readHandoff();
  const step = createStepper();
  try {
    await fn({ pool, handoff, step });
    console.log(`=== Stage OK: ${stageName} ===`);
  } catch (error) {
    console.error(`=== Stage FAILED: ${stageName} ===`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    restorePool();
    await db.close();
    logMemory("end");
  }
}
