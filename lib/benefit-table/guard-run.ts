/** Runs the figure guards (guards.ts) on one document's checked reading: the first round, then up to MAX_REREADS re-reads
 * of the figures still not settled. Models are passed in, so tests and replays run with fakes and nothing here calls a
 * model by itself.
 *
 * Spend: before every call its worst case (the whole prompt at the uncached input price plus every output token it may
 * use) is added to what has been spent; a call that could take the run past capUsd is not made, and the figures it was
 * for go to the household to confirm. Time: a call that cannot finish before the deadline is not made, and its figures
 * stay "checking" (never used, never shown as fact). */
import { priceFor } from "@/lib/ai/providers";
import type { CheckedReading, SourceDoc } from "./check";
import { renderDocument } from "./reading";
import type { OnUsage } from "./service";
import type { TableModel, TableReply } from "./model";
import { GUARD_PROMPTS, GUARD_SCHEMA, GUARDS_VERSION, MAX_REREADS, candidatesOf, claimsOf, firstAnswer, judge, readAnswers, renderQuestions,
  type Answer, type Claim, type GuardPrompt, type GuardRecord, type Verdict } from "./guards";

/** One reader: a model and the wording it is given in the first round. readers[0] is reader 1 (the document's own
 * reading model): it reads in the re-reads only, since its first-round answer is the reading itself. */
export type GuardReader = { model: TableModel; prompt: GuardPrompt; onUsage?: OnUsage };
/** previous: an earlier run's record on this same stored reading (a run cut off by its time limit): its settled and
 * confirm verdicts are kept, and only the figures it left "checking" or never reached are checked. Never pass a record
 * made on another reading of the document. */
export type GuardOptions = { capUsd: number; callTime?: () => number | null; minCallMs?: number; now?: () => Date; previous?: GuardRecord | null };

export const READERS = 5;
export const BATCH_CLAIMS = 30;
export const BATCH_CHARS = 30_000;
const OUT_PER_CLAIM = 160;
const OUT_BASE = 400;
/** A model the price table does not list is admitted at this price, so the limit still holds. */
const UNKNOWN_PRICE: { input: number; output: number; cachedInput?: number } = { input: 5, output: 25 };

export function maxTokensFor(claims: number) { return Math.min(16_000, OUT_BASE + OUT_PER_CLAIM * claims); }
function price(m: TableModel) { const p = priceFor(m.choice); return p ?? UNKNOWN_PRICE; }
/** About 3.5 characters a token, rounded up: the uncached worst case. */
export function worstUsd(m: TableModel, promptChars: number, maxTokens: number) {
  const p = price(m);
  return (Math.ceil(promptChars / 3.5) * p.input + maxTokens * p.output) / 1e6;
}
function spentUsd(m: TableModel, r: TableReply) {
  const p = price(m);
  return (r.input * p.input + (r.cacheWrite ?? 0) * p.input * 1.25 + (r.cacheRead ?? 0) * (p.cachedInput ?? p.input) + r.output * p.output) / 1e6;
}

/** The pages a batch of claims needs: each claim's page and the page before it (where a table's headings may be). */
function pagesFor(doc: SourceDoc, claims: Claim[]) {
  const want = new Set<number>();
  for (const c of claims) { want.add(c.page); want.add(c.page - 1); }
  return doc.pages.filter((p) => want.has(p.page));
}
/** Claims in page order, in batches of at most BATCH_CLAIMS claims and about BATCH_CHARS characters of pages. */
export function batches(doc: SourceDoc, claims: Claim[]): Claim[][] {
  const out: Claim[][] = [];
  let cur: Claim[] = [];
  for (const c of [...claims].sort((a, b) => a.page - b.page)) {
    const next = [...cur, c];
    const chars = pagesFor(doc, next).reduce((n, p) => n + p.text.length, 0);
    if (cur.length && (next.length > BATCH_CLAIMS || chars > BATCH_CHARS)) { out.push(cur); cur = [c]; } else cur = next;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runGuards(doc: SourceDoc, checked: CheckedReading, readers: GuardReader[], o: GuardOptions): Promise<GuardRecord> {
  if (readers.length !== READERS) throw new Error(`the figure check needs ${READERS} readers, not ${readers.length}`);
  // A resumed check keeps its start time (what a continuation job checks it is still on the same reading) and counts what
  // was spent before, so the spend limit holds for the reading as a whole, not per run.
  const record: GuardRecord = { version: GUARDS_VERSION, at: o.previous?.at ?? (o.now?.() ?? new Date()).toISOString(), verdicts: {},
    spentUsd: o.previous?.spentUsd ?? 0, calls: o.previous?.calls ?? 0, stopped: null };
  const all = claimsOf(checked);
  for (const c of all) {
    const v = o.previous?.verdicts?.[c.key];
    if (v && v.status !== "checking") record.verdicts[c.key] = v;
  }
  const claims = all.filter((c) => !record.verdicts[c.key]);
  const history = new Map<string, Answer[][]>(claims.map((c) => [c.key, []]));
  const pageText = (n: number) => doc.pages.find((p) => p.page === n)?.text ?? "";
  const minCall = o.minCallMs ?? 45_000;
  const state: { stop: "spend" | "time" | null } = { stop: null };

  /** One round over the claims: each reader in `who` answers every batch; returns each claim's answers in reader order. */
  const round = async (pending: Claim[], who: { reader: GuardReader; prompt: GuardPrompt }[]): Promise<Map<string, (Answer | null)[]>> => {
    const got = new Map<string, (Answer | null)[]>(pending.map((c) => [c.key, who.map(() => null)]));
    for (const batch of batches(doc, pending)) {
      const user = renderDocument({ name: doc.name, pages: pagesFor(doc, batch) }) + "\n" + renderQuestions(batch);
      const maxTokens = maxTokensFor(batch.length);
      const worst = who.reduce((n, w) => n + worstUsd(w.reader.model, user.length + GUARD_PROMPTS[w.prompt].length, maxTokens), 0);
      if (record.spentUsd + worst > o.capUsd) { state.stop = "spend"; break; }
      const left = o.callTime?.() ?? null;
      if (left != null && left < minCall) { state.stop = "time"; break; }
      const replies = await Promise.all(who.map(async (w) => {
        const reply = await w.reader.model.call({ system: GUARD_PROMPTS[w.prompt], user, schema: GUARD_SCHEMA, maxTokens, ...(left != null ? { timeoutMs: left } : {}) });
        record.calls++;
        record.spentUsd += spentUsd(w.reader.model, reply);
        await w.reader.onUsage?.("figure check", reply);
        return reply;
      }));
      replies.forEach((reply, i) => {
        const answers = readAnswers(reply.json, batch);
        batch.forEach((c, j) => { got.get(c.key)![i] = answers[j]; });
      });
    }
    return got;
  };
  const settle = (c: Claim, answers: Answer[], rounds: number): boolean => {
    history.get(c.key)!.push(answers);
    const j = judge(c, answers, READERS);
    if (!j.settled) return false;
    const status = Math.abs((j.value ?? NaN) - c.value) < 0.005 ? "agreed" : "corrected";
    record.verdicts[c.key] = { status, value: j.value, per: j.per, page: c.page, line: c.excerpt, candidates: [], rounds };
    return true;
  };

  // Round 0: reader 1's reading and the four guards, each with its own wording.
  let pending = claims;
  if (pending.length) {
    const got = await round(pending, readers.slice(1).map((reader) => ({ reader, prompt: reader.prompt })));
    pending = pending.filter((c) => {
      const answers = got.get(c.key)!;
      if (answers.some((a) => a == null)) return true;
      return !settle(c, [firstAnswer(c), ...answers as Answer[]], 0);
    });
  }
  // Re-reads: all five, blind, with the slower wording.
  for (let r = 1; r <= MAX_REREADS && pending.length && !state.stop; r++) {
    const got = await round(pending, readers.map((reader) => ({ reader, prompt: "reread" as const })));
    pending = pending.filter((c) => {
      const answers = got.get(c.key)!;
      if (answers.some((a) => a == null)) return true;
      return !settle(c, answers as Answer[], r);
    });
  }
  for (const c of pending) {
    const answered = history.get(c.key)!;
    const status: Verdict["status"] = state.stop === "time" ? "checking" : "confirm";
    record.verdicts[c.key] = { status, value: null, per: null, page: c.page, line: c.excerpt, candidates: candidatesOf(answered, c, pageText(c.page)), rounds: answered.length };
  }
  record.stopped = state.stop;
  record.spentUsd = Math.round(record.spentUsd * 1e6) / 1e6;
  return record;
}
