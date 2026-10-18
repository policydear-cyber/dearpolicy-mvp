/**
 * Death-journey release: retrieval that leaves room to answer.
 *
 * A broad question makes the model search many times; every call re-sends the whole conversation, so the passages it was
 * already given are paid for again on each later call. Three bounded rules, none of which raises a limit or adds a retry:
 *  1. results are COMPACT and NEW: a passage whose span (document version + page + offsets) was already returned this turn
 *     is not returned again, and the hit's ranking details never reach the model;
 *  2. a search is ADMITTED only if, after its result, there is still room for the model call that reads it AND one more call
 *     to compose the answer (the reserve for final composition);
 *  3. a search that follows two searches that added nothing new is not admitted (it cannot add information).
 * When retrieval is closed the model is told so and the turn finishes from what is validated (see loop.ts).
 */

/** Tokens a search result is assumed to add when none has been measured this turn (a result is at most ~6 compact hits). */
export const RESULT_ALLOWANCE = 2600;
/** Consecutive searches adding nothing new after which another is not admitted. */
export const MAX_IDLE_SEARCHES = 2;

export type ShownSpans = Map<string, [number, number][]>;
export type SearchProgress = { hits: number; novel: number; repeated: number; dropped: number; /** evidence of the hits not shown (their ids are still allocated in order, so ids recorded in earlier turns keep their meaning) */ omitted: any[] };

/** Rewrites a search result in place to its compact, new-only form and reports how much was new. A hit that repeats a passage
 * already returned this turn stays in its position as a one-line reference with
 * its evidence id -- citable, never silently absent, and ids keep their positions. `idOf` allocates/returns a hit's evidence id. */
export function compactSearch(res: { ok: boolean; data?: unknown; evidence: unknown }, spans: ShownSpans, idOf: (ref: any) => string): SearchProgress {
  const d = res.data as { hits?: any[]; searchedPolicyIds?: unknown[]; retrieval?: unknown; repeated?: number; note?: string; more_lower_ranked_hits?: number } | undefined;
  if (!res.ok || !d || !Array.isArray(d.hits)) return { hits: 0, novel: 0, repeated: 0, dropped: 0, omitted: [] };
  const out: any[] = [];
  const full: any[] = [];
  let repeated = 0, dropped = 0;
  for (const h of d.hits) {
    const p = h?.evidence?.passage as { start: number; end: number; onPage: number } | undefined;
    if (!p || typeof p.start !== "number") { out.push(h); full.push(h); continue; }
    const key = `${h.evidence.policyId}#${p.onPage}`;
    const seen = spans.get(key) ?? [];
    const len = Math.max(1, p.end - p.start);
    const overlap = seen.reduce((n, [s, e]) => n + Math.max(0, Math.min(e, p.end) - Math.max(s, p.start)), 0);
    const stub = (why: string) => ({ evidence_id: idOf(h.evidence), page: h.page, excerpt: why });
    if (overlap / len >= 0.5) { repeated++; out.push(stub("(overlaps a passage already returned this turn)")); continue; }
    seen.push([p.start, p.end]); spans.set(key, seen);
    const kept = { policyId: h.policyId, productName: h.productName, page: h.page, text: h.text, evidence: h.evidence };
    out.push(kept); full.push(kept);
  }
  const total = d.hits.length;
  d.hits = out;
  delete d.searchedPolicyIds; delete d.retrieval;
  if (repeated) d.repeated = repeated;
  if (!full.length && total) d.note = "every matching passage was already returned earlier in this turn; nothing new was found";
  if (Array.isArray(res.evidence)) res.evidence = full.map((h) => h?.evidence).filter(Boolean);
  return { hits: total, novel: full.length, repeated, dropped, omitted: [] };
}

/** Whether another retrieval call is admitted. `callTokens` = estimated input of the next model call + its output allowance;
 * `resultTokens` = what a result is assumed to add. A search is admitted only when the model call that reads its result still
 * fits (that call can be the answer). If a further call after that one would not fit, this is the LAST retrieval: the model
 * is then offered only what can finish the turn, so the room reserved for the answer is not spent on more searching. */
export function retrievalRoom(a: { used: number; callTokens: number; resultTokens: number; limit: number; idle: number }): { closed: string | null; last: string | null } {
  if (a.idle >= MAX_IDLE_SEARCHES) return { closed: `the last ${a.idle} searches found nothing new in this household's documents, so another search cannot add information`, last: null };
  const after = a.callTokens + a.resultTokens;
  if (a.used + after > a.limit) return { closed: `another search would leave no room to write the answer within this question's model-use limit (${a.used} used of ${a.limit}; reading the result and answering needs about ${after} more)`, last: null };
  if (a.used + 2 * after > a.limit) return { closed: null, last: `the room left in this question's model-use limit (${a.used + after} of ${a.limit} after this search) is kept for writing the answer` };
  return { closed: null, last: null };
}
