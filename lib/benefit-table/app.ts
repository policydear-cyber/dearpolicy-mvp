/** The benefit table wired to the app's database, model key and usage ledger. service.ts takes these as arguments so
 * its tests run with fakes; this file is the only place the real ones are passed in. */
import { pool, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { overSpendCap, recordUsage } from "@/lib/ai/ledger";
import type { ModelChoice } from "@/lib/ai/providers";
import { benefitTableModel, benefitTableStatus, benefitTableStrongModel } from "./flag";
import { costUsd } from "@/lib/ai/providers";
import { ledgerUsage } from "@/lib/simple-chat/model";
import { anthropicTableModel, type TableModel } from "./model";
import { policyJobLive, tableReadingJobLive, tableReadingJobPending } from "@/lib/rag/live-job";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { MIN_CALL_MS, OPERATOR_FLAG_AFTER, SAVE_MARGIN_MS, linkRetryDelayMs, readingRetryDelayMs, guardStoredReading, noteUnreadTable, readDocument, relink, tableReady, type Db, type GuardSetup, type OnUsage, type ReadTime, type ReadingProgress } from "./service";
import { MAX_FIGURE_CHECK_RUNS, enqueueFigureCheck, figureCheckPayload } from "./figure-check-job";
import { MAX_TABLE_READING_RUNS, enqueueTableLink, enqueueTableReading, tableReadingPayload } from "./table-reading-job";
import { checkingCount } from "./guards";
import { figureCheckMode, guardCapUsd, guardRoster, imageCheckModels, supportsEffort } from "./guard-flag";
import { pageSourceFor, realPageFileTools } from "./page-source";

export const appDb: Db = async (sql, params) => (await query(sql, params)).rows;

/** Switched on for this account (DEARPOLICY_ALPHA_ACCOUNTS), and the additive tables (sql/benefit-table.sql) exist. */
export async function benefitTableLive(accountId: string): Promise<boolean> {
  return benefitTableLiveFor(appDb, process.env, accountId);
}

/** The same decision for any database (tests pass a fake). For a household the all-accounts switch reaches (not on the
 * alpha list):
 *   1. a household with a table reading for any current document is on the table, and stays there;
 *   2. otherwise one that already has documents read the existing way (a ready current cover document that is not being
 *      read right now, or rows in coverage_rules) keeps its existing Coverage page and reading: its documents were read
 *      before the table existed, so the table would show it no covers until each one was read again;
 *   3. otherwise (new, nothing read yet) it gets the table.
 * Table readings are checked first, so a household on the table never moves off it because the existing reading wrote
 * rows for it. If a check cannot answer, the household is kept on the existing Coverage for this request only: nothing
 * is stored, and the next request decides again. */
export async function benefitTableLiveFor(db: Db, env: NodeJS.ProcessEnv, accountId: string): Promise<boolean> {
  const status = benefitTableStatus(env, accountId);
  if (!status.enabled) return false;
  if (!(await tableReady(db).catch(() => false))) return false;
  if (status.scope !== "all") return true;
  try {
    const onTable = await db(`SELECT 1 FROM benefit_readings r JOIN policies p ON p.id=r.policy_id
      WHERE r.account_id=$1 AND p.account_id=$1 AND p.lifecycle_state='active' AND p.superseded_at IS NULL LIMIT 1`, [accountId]);
    if (onTable.length) return true;
    // A document is marked ready just before it is read into the table, so one whose reading job is still live is not
    // "read before"; nor is a receipt, statement or letter, which is never read into the table.
    // A table reading carried over runs (TABLE_PROGRESS_KEY, its continuation queued or running) is being read too: a new
    // household whose first document is carried stays on the table, so its continuation goes on (TE #404).
    const readBefore = await db(`SELECT 1 FROM policies WHERE account_id=$1 AND lifecycle_state='active' AND superseded_at IS NULL
      AND processing_status='ready' AND COALESCE(document_role,'') <> ALL($2::text[]) AND NOT (${policyJobLive("policies")})
      AND NOT (${tableReadingJobLive("policies")}) AND NOT (COALESCE(extracted_json,'{}'::jsonb) ? '${TABLE_PROGRESS_KEY}') LIMIT 1`,
      [accountId, [...NO_COVER_READING_ROLES]]);
    if (readBefore.length) return false;
    const ledger = await db("SELECT to_regclass('public.coverage_rules') IS NOT NULL AS ok", []);
    if (ledger[0]?.ok !== true) return true;
    return (await db("SELECT 1 FROM coverage_rules WHERE account_id=$1 LIMIT 1", [accountId])).length === 0;
  } catch { return false; }
}

/** Priced at the configured model (the reply may name a dated version the price table does not list). Cache reads and
 * writes are booked the way the simple chat books them (ledgerUsage), so the ledger counts every prompt token. */
function usage(accountId: string, choice: ModelChoice): OnUsage {
  return (_what, reply) => recordUsage({ accountId, role: "reading", choice,
    ...ledgerUsage({ input: reply.input, output: reply.output, cacheRead: reply.cacheRead ?? 0, cacheWrite: reply.cacheWrite ?? 0 }),
    durationMs: reply.ms, ok: reply.json != null });
}

/** The key in policies.extracted_json that says a table reading of the document started and has not ended. It is kept
 * when the document's own reading rewrites extracted_json (lib/rag/ingest.ts), so a retried job can see it. */
export const TABLE_READING_MARK = "benefitTableReadingStarted";
/** Whether a reading of this document started and never ended: its run was stopped mid-reading. */
export async function tableReadingCutOff(db: Db, accountId: string, policyId: string): Promise<boolean> {
  const rows = await db(`SELECT (extracted_json ? '${TABLE_READING_MARK}') AS cut FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [policyId, accountId]);
  return rows[0]?.cut === true;
}
/** The key in policies.extracted_json that holds a table reading carried over runs (service.ts ReadingProgress). Kept, like
 * TABLE_READING_MARK, when the document's own reading rewrites extracted_json (lib/rag/ingest.ts), so a retried job can go
 * on with it. */
export const TABLE_PROGRESS_KEY = "benefitTableProgress";
export async function tableReadingProgress(db: Db, accountId: string, policyId: string): Promise<ReadingProgress | null> {
  const rows = await db(`SELECT extracted_json->'${TABLE_PROGRESS_KEY}' AS progress FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()} AND superseded_at IS NULL`, [policyId, accountId]);
  const raw = rows[0]?.progress;
  const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as ReadingProgress | null | undefined;
  return p && typeof p.id === "string" && typeof p.fp === "string" && Array.isArray(p.queue) && Array.isArray(p.done) ? p : null;
}
/** `continuing`: the run goes on with a saved reading, so it saves only over that same reading: when a fresh reading (Read
 * again) replaced it meanwhile, the run stops here and never overwrites the fresh one. */
async function saveTableProgress(db: Db, accountId: string, policyId: string, p: ReadingProgress | null, continuing = false, only?: string) {
  if (!p) {
    // `only`: cleared only while it is still that reading, so a fresh one (Read again) started meanwhile is kept.
    await db(`UPDATE policies SET extracted_json=extracted_json - '${TABLE_PROGRESS_KEY}' WHERE id=$1 AND account_id=$2 AND extracted_json ? '${TABLE_PROGRESS_KEY}'
      ${only ? `AND extracted_json->'${TABLE_PROGRESS_KEY}'->>'id'=$3` : ""}`, only ? [policyId, accountId, only] : [policyId, accountId]);
    return;
  }
  const stamped = JSON.stringify({ ...p, at: new Date().toISOString() });
  const saved = await db(`UPDATE policies SET extracted_json=jsonb_set(coalesce(extracted_json,'{}'::jsonb),'{${TABLE_PROGRESS_KEY}}',$3::jsonb) WHERE id=$1 AND account_id=$2
      ${continuing ? `AND extracted_json->'${TABLE_PROGRESS_KEY}'->>'id'=$4` : ""} RETURNING id`, continuing ? [policyId, accountId, stamped, p.id] : [policyId, accountId, stamped]);
  if (continuing && !saved.length) throw new Error("the table reading was replaced by a fresh one; this run stops");
}
async function markTableReading(db: Db, accountId: string, policyId: string, started: boolean) {
  await db(started
    ? `UPDATE policies SET extracted_json=jsonb_set(coalesce(extracted_json,'{}'::jsonb),'{${TABLE_READING_MARK}}',to_jsonb(now()::text)) WHERE id=$1 AND account_id=$2`
    : `UPDATE policies SET extracted_json=extracted_json - '${TABLE_READING_MARK}' WHERE id=$1 AND account_id=$2 AND extracted_json ? '${TABLE_READING_MARK}'`, [policyId, accountId]);
}
/** On upload and on Read again: reads the document into the table, then re-links the household's sections to covers.
 * - `deadline`: when the run that reads must have saved (a serverless function's time limit). The reading stops in time
 *   to save its "could not be read" note (readDocument), and the sections are not re-linked when too little time is left.
 * - `retry`: this run is a retry of a job whose earlier attempt failed. It makes no model call at all: the stored reading
 *   is kept, or the document says its table could not be read, and Read again starts a fresh one (5 Nov: a 47-page
 *   wording cut off at the time limit was read again by each retry of its job, about US$0.58 a time, and none could
 *   finish). */
export async function readIntoBenefitTable(accountId: string, policyId: string, opts: { deadline?: number; retry?: boolean; continuation?: { id: string; run: number } } = {}) {
  // Reading is never stopped by the household's spend limit (DC, 10 Nov), but every call is booked in the usage ledger: when
  // this month's usage cannot be read, nothing is sent (SpendCheckUnavailable; Critic #405).
  await overSpendCap(accountId);
  const model = anthropicTableModel(benefitTableModel());
  // Reading is not limited by cost (DC, 10 Nov: accuracy first): what each run spends on the document is logged for the
  // operator instead.
  let spent = 0, calls = 0;
  const priced = (book: OnUsage, choice: ModelChoice): OnUsage => async (what, reply) => {
    calls++; spent += costUsd(choice, { input: reply.input + (reply.cacheWrite ?? 0), output: reply.output, cached: reply.cacheRead ?? 0 }) ?? 0;
    await book(what, reply);
  };
  const onUsage = priced(usage(accountId, model.choice), model.choice);
  const strongChoice = benefitTableStrongModel();
  const strongModel = anthropicTableModel(strongChoice, undefined, { effort: supportsEffort(strongChoice.model) });
  const strong = { model: strongModel, onUsage: priced(usage(accountId, strongChoice), strongChoice) };
  const mode = figureCheckMode(process.env, accountId);
  const guarded = mode != null;
  const result = await readIntoTable(appDb, model, accountId, policyId, { ...opts, strong, continueLater: (id, run, delayMs) => enqueueTableReading(pool, accountId, policyId, id, run, delayMs).then(() => undefined),
    linkLater: (id, attempt, delayMs) => enqueueTableLink(pool, accountId, policyId, id, attempt, delayMs).then(() => undefined),
    ...(mode ? { guards: figureCheckSetup(mode, accountId, model, onUsage) } : {}) }, onUsage);
  // A figure check the time limit cut off is finished by a background job (figure-check-job.ts).
  if (guarded && result.figuresChecking && result.guardsAt) await enqueueFigureCheck(pool, accountId, policyId, result.guardsAt, 1);
  if (calls) console.info(`benefit table reading for policy ${policyId}: this run made ${calls} call(s), about US$${spent.toFixed(2)}${result.carried ? " (goes on next run)" : ""}`);
  return result;
}
/** The figure check's continuation job (figure-check-job.ts): checks what the last run left "checking", and queues the next
 * run while anything is left. With the guards or the table off, or the reading replaced, it makes no model call. */
export const processFigureCheckJob = async (job: { account_id: string | null; payload: unknown }) => {
  const p = figureCheckPayload(job.payload);
  const accountId = job.account_id;
  const mode = accountId ? figureCheckMode(process.env, accountId) : null;
  if (!accountId || !mode || !(await benefitTableLive(accountId))) return;
  const model = anthropicTableModel(benefitTableModel());
  const { functionDeadline } = await import("@/lib/jobs/function-time");
  const r = await guardStoredReading(appDb, accountId, p.policyId, figureCheckSetup(mode, accountId, model, usage(accountId, model.choice)), { deadline: functionDeadline(Date.now()) }, p.at, p.run >= MAX_FIGURE_CHECK_RUNS);
  if (r.record && checkingCount(r.record) > 0) await enqueueFigureCheck(pool, accountId, p.policyId, p.at, p.run + 1);
};
/** A table reading's continuation job (table-reading-job.ts): goes on with the reading the payload names, in a run of its
 * own. With the table off it makes no model call; readIntoTable makes none when that reading was replaced or is gone. */
export const processTableReadingJob = async (job: { account_id: string | null; payload: unknown }) => {
  const p = tableReadingPayload(job.payload);
  const accountId = job.account_id;
  if (!accountId || !(await benefitTableLive(accountId))) return;
  const { functionDeadline } = await import("@/lib/jobs/function-time");
  await readIntoBenefitTable(accountId, p.policyId, { deadline: functionDeadline(Date.now()), continuation: { id: p.id, run: p.run } });
};
/** How the stuck-work sweep queues a run again: `link` a link run (enqueueTableLink), `read` a reading's continuation
 * (enqueueTableReading with its own `again` key). */
export type RequeueTableWork = { link: (policyId: string, id: string, attempt: number, delayMs: number) => Promise<void>;
  read?: (policyId: string, id: string, run: number, again: number, delayMs: number) => Promise<void> };
/** At most this many documents are queued again by one sweep. */
export const REQUEUE_MAX = 20;
/** At most this many households are looked at by one sweep of every household. */
const REQUEUE_SCAN_MAX = 500;
/** A reading saved this recently may still be queuing its next run: it is not stuck yet. */
const REQUEUE_AFTER = "2 minutes";
/** A table reading carried over runs, or a stored reading waiting for its link run, that nothing will go on with: no table
 * job is queued, running or to be retried for it (its run died, was dead-lettered, or stopped before queuing the next),
 * and no intake job is reading the document. Each is queued again, each time later than the last, and is never given up
 * on (DC, 10 Nov); after a few times the operator is told in the logs. A link run reads nothing; a reading's run reads only
 * what is left, so queuing either again pays for no part twice (TE and Critic #404). Run from Coverage, from the request
 * drain (every route that schedules it, the chat's included) and from the daily run (requeueStuckTableWorkEverywhere). */
export async function requeueStuckTableWork(db: Db, accountId: string, later: RequeueTableWork): Promise<number> {
  const stuck = await db(`SELECT id, extracted_json->'${TABLE_PROGRESS_KEY}' AS progress FROM policies WHERE account_id=$1 AND ${activePredicate()} AND superseded_at IS NULL
      AND extracted_json ? '${TABLE_PROGRESS_KEY}' AND NOT (${tableReadingJobPending("policies")}) AND NOT (${policyJobLive("policies")})
      AND COALESCE((extracted_json->'${TABLE_PROGRESS_KEY}'->>'at')::timestamptz, '-infinity'::timestamptz) < now() - interval '${REQUEUE_AFTER}'
      ${later.read ? "" : `AND COALESCE(extracted_json->'${TABLE_PROGRESS_KEY}'->>'linkOnly','')='true'`}
      ORDER BY id LIMIT ${REQUEUE_MAX}`, [accountId]);
  let queued = 0;
  for (const row of stuck) {
    const policyId = String(row.id);
    const p = (typeof row.progress === "string" ? JSON.parse(row.progress) : row.progress) as ReadingProgress | null;
    if (!p?.id) continue;
    const link = p.linkOnly === true;
    if (!link && !later.read) continue;
    const next: ReadingProgress = link ? { ...p, linkAttempts: (p.linkAttempts ?? 1) + 1 } : { ...p, requeues: (p.requeues ?? 0) + 1 };
    try {
      await saveTableProgress(db, accountId, policyId, next, true);
    } catch (error) {
      // A fresh reading replaced it meanwhile (the guarded save refuses): that reading goes on by itself.
      if (error instanceof Error && /replaced/.test(error.message)) continue;
      throw error;
    }
    if (link) {
      const attempt = next.linkAttempts!;
      if (attempt > OPERATOR_FLAG_AFTER) console.warn(`benefit table link for policy ${policyId} keeps failing: link run ${attempt} queued (operator: check it)`);
      await later.link(policyId, p.id, attempt, linkRetryDelayMs(attempt - 1));
    } else {
      const again = next.requeues!;
      if (again >= OPERATOR_FLAG_AFTER) console.warn(`benefit table reading for policy ${policyId} keeps stopping: queued again ${again} time(s) (operator: check it)`);
      await later.read!(policyId, p.id, (p.run ?? 0) + 1, again, linkRetryDelayMs(again));
    }
    queued++;
  }
  return queued;
}
/** The link runs only (requeueStuckTableWork with no reading queued). */
export async function requeueStuckLinks(db: Db, accountId: string, linkLater: (policyId: string, id: string, attempt: number, delayMs: number) => Promise<void>): Promise<number> {
  return requeueStuckTableWork(db, accountId, { link: linkLater });
}
/** requeueStuckTableWork on the app's database and queue. */
export async function requeueStuckTableReadings(accountId: string): Promise<number> {
  return requeueStuckTableWork(appDb, accountId, {
    link: (policyId, id, attempt, delayMs) => enqueueTableLink(pool, accountId, policyId, id, attempt, delayMs).then(() => undefined),
    read: (policyId, id, run, again, delayMs) => enqueueTableReading(pool, accountId, policyId, id, run, delayMs, again).then(() => undefined),
  });
}
/** requeueStuckTableReadings for every household with carried table work whose table is on (benefitTableLive), at most
 * REQUEUE_MAX households a sweep. Never throws: the request drain and the daily run go on whatever happens here. */
export async function requeueStuckTableWorkEverywhere(db: Db = appDb, live: (accountId: string) => Promise<boolean> = benefitTableLive,
  sweep: (accountId: string) => Promise<number> = requeueStuckTableReadings): Promise<number> {
  try {
    // Households whose table is off are skipped before the limit counts, so their stale progress never crowds out the rest.
    const accounts = await db(`SELECT DISTINCT account_id FROM policies WHERE ${activePredicate()} AND superseded_at IS NULL AND extracted_json ? '${TABLE_PROGRESS_KEY}'
        AND NOT (${tableReadingJobPending("policies")}) ORDER BY account_id LIMIT ${REQUEUE_SCAN_MAX}`, []);
    let queued = 0, swept = 0;
    for (const row of accounts) {
      if (swept >= REQUEUE_MAX) break;
      const accountId = String(row.account_id);
      try { if (await live(accountId)) { swept++; queued += await sweep(accountId); } }
      catch (error) { console.warn(`benefit table: could not queue stuck table work again (${error instanceof Error ? error.name : "unknown"})`); }
    }
    return queued;
  } catch (error) {
    console.warn(`benefit table: stuck table work sweep failed (${error instanceof Error ? error.name : "unknown"})`);
    return 0;
  }
}
/** The figure guards (guard-flag.ts): reader 1 is the reading model, then the four guards, each booked at its own price. */
export function guardSetup(accountId: string, reader: TableModel, onUsage: OnUsage, env: NodeJS.ProcessEnv = process.env): GuardSetup {
  const guards = guardRoster(env).map((g) => { const m = anthropicTableModel(g.choice, undefined, { effort: supportsEffort(g.choice.model) }); return { model: m, prompt: g.prompt, onUsage: usage(accountId, m.choice) }; });
  return { readers: [{ model: reader, prompt: "direct", onUsage }, ...guards], capUsd: guardCapUsd(env) };
}
/** The page-image figure check (image-check.ts): Sonnet 5.5 first, Opus 5.5 on a figure it did not confirm, each booked
 * at its own price; the page comes from the stored file. */
export function imageCheckSetup(accountId: string, env: NodeJS.ProcessEnv = process.env): GuardSetup {
  const [a, b] = imageCheckModels(env).map((c) => anthropicTableModel(c, undefined, { effort: supportsEffort(c.model) }));
  return { kind: "image", first: { model: a, onUsage: usage(accountId, a.choice) }, second: { model: b, onUsage: usage(accountId, b.choice) }, capUsd: guardCapUsd(env),
    source: (policyId) => pageSourceFor(appDb, accountId, policyId, realPageFileTools) };
}
export function figureCheckSetup(mode: "image" | "guards", accountId: string, reader: TableModel, onUsage: OnUsage, env: NodeJS.ProcessEnv = process.env): GuardSetup {
  return mode === "image" ? imageCheckSetup(accountId, env) : guardSetup(accountId, reader, onUsage, env);
}
/** Whether a document job's run is a retry for the table reading: attempt 2 or later of its job, or the deferred re-read a
 * reading-service failure schedules (a fresh job at attempt 1, lib/rag/ingest.ts). Neither pays for a table reading. */
export function tableReadingRetry(args: { attempt?: { number: number } | null; deferredRetry?: boolean | null }): boolean {
  return (args.attempt?.number ?? 1) > 1 || args.deferredRetry === true;
}
/** What a run of readIntoTable did. `relinked`: the household's sections were re-linked after this document's reading. */
export type TableReadResult = { read: boolean; why?: string; pagesReread: number; linked: number; relinked?: boolean; carried?: boolean; skipped?: number[];
  parts?: number; figuresChecking?: number; guardsAt?: string };
/** readIntoBenefitTable with its database and model passed in (tests pass fakes).
 * - `continuation`: this run is continuation `run` of the carried reading `id` (table-reading-job.ts). It goes on with
 *   that reading only; with that reading gone or replaced (a fresh reading started since) it does nothing and pays nothing.
 * - `continueLater`: queues the next run of a carried reading. Without it a reading is not carried over runs: a reading
 *   that runs out of time says its table could not be read, as before.
 * A retried job (`retry`) never starts a fresh reading: it goes on with a carried reading the earlier attempt saved, and
 * otherwise keeps what is stored, as before. */
export async function readIntoTable(db: Db, model: TableModel, accountId: string, policyId: string, opts: { deadline?: number; retry?: boolean; now?: () => number; guards?: GuardSetup;
  continuation?: { id: string; run: number }; strong?: ReadTime["strong"]; continueLater?: (id: string, run: number, delayMs?: number) => Promise<void>; linkLater?: (id: string, attempt: number, delayMs?: number) => Promise<void>; } = {}, onUsage?: OnUsage): Promise<TableReadResult> {
  const now = opts.now ?? Date.now;
  const run = (opts.continuation?.run ?? 0) + 1;
  const carried = opts.continueLater && (opts.retry || opts.continuation) ? await tableReadingProgress(db, accountId, policyId) : null;
  if (opts.continuation && (!carried || carried.id !== opts.continuation.id))
    return { read: false, why: "the reading this run goes on with was finished or replaced", pagesReread: 0, linked: 0 };
  // A retry of a job (attempt 2 or later) never calls the table model for a fresh reading, whatever happened to the attempt
  // before it: only a fresh job (an upload, or the household's Read again) pays for one. With a carried reading it goes on
  // with what is left; otherwise it keeps the reading already stored, and when there is none, or the earlier attempt's
  // reading was cut off, the document says its table could not be read.
  if (opts.retry && !carried) {
    const cutOff = await tableReadingCutOff(db, accountId, policyId);
    const stored = (await db("SELECT 1 FROM benefit_readings WHERE policy_id=$1 AND account_id=$2", [policyId, accountId])).length > 0;
    if (cutOff || !stored) await noteUnreadTable(db, accountId, policyId, true);
    if (cutOff) await markTableReading(db, accountId, policyId, false);
    return { read: false, why: "a retried job does not read the table again; Read again starts a fresh reading", pagesReread: 0, linked: 0 };
  }
  // A reading stored by a run that had no time left to link its sections: this run links them only, and pays for no
  // reading (TE #404: a 64-page reading finished near the end of its run showed "read" as one unlinked section, 0 rows).
  if (carried?.linkOnly) {
    const left = opts.deadline == null ? null : opts.deadline - SAVE_MARGIN_MS - now();
    const linked = await relink(db, model, accountId, onUsage, left ?? undefined, policyId);
    await saveTableProgress(db, accountId, policyId, null, true, carried.id);
    await markTableReading(db, accountId, policyId, false);
    return { read: true, why: "the stored reading's sections were linked", pagesReread: 0, linked: linked.proposed, relinked: true };
  }
  // The mark is cleared only once the reading and the re-link have both returned. A run that throws or is stopped at any
  // point in between (an API error, a database error while saving, the time limit during the re-link) leaves it set, so
  // a retry of the job never pays for the whole reading again by itself.
  await markTableReading(db, accountId, policyId, true);
  // A fresh reading drops any carried one (its continuation then finds it replaced) and is named by when it started.
  const id = carried?.id ?? new Date(now()).toISOString();
  if (opts.continueLater && !carried) await saveTableProgress(db, accountId, policyId, null);
  const carry = opts.continueLater ? { id, from: carried, save: (p: ReadingProgress) => saveTableProgress(db, accountId, policyId, { ...p, run: run - 1 }, !!carried) } : undefined;
  const read = await readDocument(db, model, accountId, policyId, onUsage, { deadline: opts.deadline, now, ...(carry ? { carry } : {}), ...(opts.strong ? { strong: opts.strong } : {}) }, opts.guards);
  if (read.carried) {
    // The run ran out of time with the reading saved: the next run goes on with it. After the last run it says its table
    // could not be read, and Read again starts a fresh one.
    // It is never given up on (DC, 10 Nov): the next run goes on with what is left, later each time a run paid for a call
    // and read nothing. A slow or failing reading is reported to the operator; the household sees it still being read.
    const stalls = read.stalls ?? 0;
    if (stalls >= OPERATOR_FLAG_AFTER || run > MAX_TABLE_READING_RUNS)
      console.warn(`benefit table reading for policy ${policyId} is still going on: run ${run}, ${stalls} run(s) in a row read nothing (${read.why ?? ""}) (operator: check it)`);
    await opts.continueLater!(id, run, readingRetryDelayMs(stalls));
    return { ...read, linked: 0 };
  }
  const left = opts.deadline == null ? null : opts.deadline - SAVE_MARGIN_MS - now();
  const timeToLink = left == null || left >= MIN_CALL_MS;
  if (read.read && !timeToLink && carry) {
    // Stored with no time left to link its sections: one more run links them, so the document is never left "read"
    // with its whole table unlinked. The mark stays set until that run has linked.
    await saveTableProgress(db, accountId, policyId, { id, fp: "", queue: [], done: [], headings: [], columns: [], calls: 0, limit: 0, outputLimit: 0, linkOnly: true, linkAttempts: 1 }, !!carried);
    await (opts.linkLater ?? ((i: string) => opts.continueLater!(i, run)))(id, 1);
    return { ...read, linked: 0, relinked: false };
  }
  if (carry) await saveTableProgress(db, accountId, policyId, null, false, id);
  const linked = read.read && timeToLink ? await relink(db, model, accountId, onUsage, left ?? undefined, policyId) : { proposed: 0 };
  await markTableReading(db, accountId, policyId, false);
  return { ...read, linked: linked.proposed, relinked: read.read && timeToLink };
}
