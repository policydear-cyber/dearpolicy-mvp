/**
 * Read-side invalidation of saved chat answers whose policy evidence is gone.
 *
 * A saved answer cites the policies it relied on (citations, policy-stated
 * limits). When any of those policies has since been deleted -- or the
 * household itself is gone -- reopening the chat must not present the old
 * answer as current coverage. Every re-served answer (chat history, finished
 * async jobs) passes through here after the monetary boundary: an answer
 * that relied on a policy that is no longer active is replaced by a fixed
 * notice with no benefits, limits, citations, figures or fact-finding plan.
 * Nothing is written; restoring a policy is not possible, so there is no
 * state to reconcile.
 *
 * Two more ways a saved answer stops being true are checked the same way:
 * - the person it was about has since been removed from the document it
 *   worked their figures out from (critic R16-2): it no longer describes
 *   that person's cover;
 * - a later turn of the same chat corrected what it was worked out from (the
 *   person, an amount, which injury): its calculation is marked withdrawn in
 *   the chat's saved state, and the answer is replaced by a pointer to the
 *   corrected answer below, so scrolling back never shows a withdrawn figure.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { ChatAnswer } from "@/types";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";

export const STALE_ANSWER_NOTICE = "This answer relied on a policy document that has since been deleted, so it no longer describes your cover. Ask again to get an answer from the documents you have now.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function referencedPolicyIds(answer: Partial<ChatAnswer> | null | undefined): string[] {
  if (!answer || typeof answer !== "object") return [];
  const ids = new Set<string>();
  for (const c of Array.isArray(answer.citations) ? answer.citations : []) if (c?.policyId && UUID.test(c.policyId)) ids.add(c.policyId);
  for (const l of Array.isArray(answer.policyStatedLimits) ? answer.policyStatedLimits : []) if (l?.citation?.policyId && UUID.test(l.citation.policyId)) ids.add(l.citation.policyId);
  // fx-live-1: "not found in these documents" rests on every document it was checked against, not only the ones it cites.
  for (const a of Array.isArray(answer.absenceChecks) ? answer.absenceChecks : []) for (const d of Array.isArray(a?.documents) ? a.documents : []) if (d?.policyId && UUID.test(d.policyId)) ids.add(d.policyId);
  return [...ids];
}

export const ADDED_DOCUMENTS_NOTICE = "This answer said something was not found in your documents, and documents have been added since, so it may no longer be right. Ask again to get an answer from the documents you have now.";

export const PERSON_UNLINKED_NOTICE = "This answer was about someone who has since been removed from the document it relied on, so it no longer describes their cover. Ask again to get an answer from the documents you have now.";

export const SUPERSEDED_NOTICE = "This earlier answer was replaced by the corrected answer below, because something it was worked out from was corrected later in this chat.";

export type InvalidationReason = NonNullable<ChatAnswer["invalidated"]>["reason"];

const NOTICE: Record<InvalidationReason, string> = {
  policy_deleted: STALE_ANSWER_NOTICE, documents_added: ADDED_DOCUMENTS_NOTICE,
  person_unlinked: PERSON_UNLINKED_NOTICE, superseded: SUPERSEDED_NOTICE,
};

export function invalidatedAnswer(answer: ChatAnswer, reason: InvalidationReason = "policy_deleted"): ChatAnswer {
  return {
    ...answer,
    summary: NOTICE[reason],
    details: [], claimItems: [], citations: [], nextSteps: [], missingFacts: [], questions: [],
    policyStatedLimits: [], potentialPayoutTotals: [], payoutQualifiers: [], absenceChecks: [],
    factFinding: undefined, composition: undefined, assessmentKind: undefined,
    // (what its figures were bound to and worked out from goes too: a page that draws figures from them must find none)
    figureBindings: [], computations: [], calculations: [],
    invalidated: { reason },
  } as ChatAnswer;
}

/** The (person, document) pairs an answer's figures and calculations were worked out for. */
export function personDocumentPairs(answer: Partial<ChatAnswer> | null | undefined): { subjectId: string; policyId: string }[] {
  if (!answer || typeof answer !== "object") return [];
  const out = new Map<string, { subjectId: string; policyId: string }>();
  const add = (x: { subjectId?: unknown; policyId?: unknown } | null | undefined) => {
    if (typeof x?.subjectId === "string" && typeof x.policyId === "string" && UUID.test(x.subjectId) && UUID.test(x.policyId)) out.set(`${x.subjectId}|${x.policyId}`, { subjectId: x.subjectId, policyId: x.policyId });
  };
  for (const b of Array.isArray(answer.figureBindings) ? answer.figureBindings : []) add(b);
  for (const c of Array.isArray(answer.calculations) ? answer.calculations : []) add(c);
  return [...out.values()];
}

/** The calculation ids a later correction withdrew, read from the chat's saved state (the reliable-chat loop keeps
 * them under ragLoop.claim.calcs and ragLoop.otherClaims[*].calcs). Read as plain data: the chat path does not load
 * the loop's modules for this. */
export function withdrawnCalculationIds(conversationState: unknown): Set<string> {
  const out = new Set<string>();
  const loop = (conversationState as { ragLoop?: { claim?: unknown; otherClaims?: Record<string, unknown> } } | null | undefined)?.ragLoop;
  if (!loop || typeof loop !== "object") return out;
  const claims = [loop.claim, ...Object.values(loop.otherClaims && typeof loop.otherClaims === "object" ? loop.otherClaims : {})];
  for (const claim of claims) {
    const calcs = (claim as { calcs?: Record<string, { withdrawn?: unknown }> } | null | undefined)?.calcs;
    if (!calcs || typeof calcs !== "object") continue;
    for (const [id, ref] of Object.entries(calcs)) if (ref && typeof ref === "object" && ref.withdrawn) out.add(id);
  }
  return out;
}

/** Replaces every answer that cites a policy which is no longer active in
 * this household, was about a person since removed from the document it
 * relied on, or (given the chat's saved state) was worked out from something
 * corrected later in the chat. `answers` are already monetary-boundary-sanitised. */
export async function invalidateAnswersWithDeletedPolicies<T extends Partial<ChatAnswer> | null | undefined>(accountId: string, answers: T[], options?: { conversationState?: unknown }): Promise<T[]> {
  const withdrawn = withdrawnCalculationIds(options?.conversationState);
  const superseded = (a: Partial<ChatAnswer> | null | undefined) => withdrawn.size > 0 && (Array.isArray(a?.calculations) ? a!.calculations! : []).some((c) => typeof c?.id === "string" && withdrawn.has(c.id));
  const wanted = [...new Set(answers.flatMap((a) => referencedPolicyIds(a)))];
  if (!wanted.length) return withdrawn.size ? answers.map((a) => (superseded(a) ? (invalidatedAnswer(a as ChatAnswer, "superseded") as unknown as T) : a)) : answers;
  const rows = (await query<{ id: string; file_hash: string | null }>(
    `SELECT id::text, to_jsonb(policies)->>'file_hash' AS file_hash FROM policies WHERE account_id=$1 AND id = ANY($2::uuid[]) AND ${activePredicate()}`, [accountId, wanted])).rows;
  const active = new Set(rows.map((r) => r.id));
  const hashOf = new Map(rows.map((r) => [r.id, r.file_hash]));
  // A "not found" statement was true of the document VERSION it read: a document replaced since (its file changed) no longer supports it.
  const changed = (a: Partial<ChatAnswer> | null | undefined) => (Array.isArray(a?.absenceChecks) ? a!.absenceChecks! : []).some((c) => (c?.documents ?? []).some((d) => d.fileHash != null && active.has(d.policyId) && (hashOf.get(d.policyId) ?? null) !== d.fileHash));
  // PR #57 follow-up (critic M4): "your documents do not describe X" over the person's or the whole library's documents was true of the
  // documents there were then. A document added to that scope since (an upload, or one newly linked to the person) may describe it.
  // (read here, not through the reliable-chat loop's modules: the chat path must not depend on them when the loop is off -- the same
  // readable-document rule as the loop store's queryDocs, and the same scope as its absence check's scopeDocs: the person's linked documents plus any
  // document linked to nobody, or the whole library)
  const widening = answers.some((a) => (Array.isArray(a?.absenceChecks) ? a!.absenceChecks! : []).some((c) => c?.scope === "library" || c?.scope === "subject"));
  const readable = widening ? (await query<{ id: string; members: string[] | null }>(
    `SELECT p.id::text AS id, array_remove(array_agg(pm.family_member_id::text), NULL) AS members
       FROM policies p LEFT JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
        AND EXISTS (SELECT 1 FROM family_members f WHERE f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")})
      WHERE p.account_id=$1 AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} AND p.processing_status='ready'
      GROUP BY p.id`, [accountId])).rows : [];
  const grown = (a: Partial<ChatAnswer> | null | undefined) => (Array.isArray(a?.absenceChecks) ? a!.absenceChecks! : []).some((c) => {
    if (c?.scope !== "library" && c?.scope !== "subject") return false;
    const saved = new Set((c.documents ?? []).map((d) => d.policyId));
    const mine = c.scope === "subject" && c.subjectId ? readable.filter((d) => !(d.members ?? []).length || (d.members ?? []).includes(c.subjectId!)) : [];
    const now = c.scope === "subject" && mine.length ? mine : readable;
    return now.some((d) => !saved.has(d.id));
  });
  // R16-2: a person still counts as covered by a document while any link joins them (policy_members, whatever its
  // source) or they are its upload profile -- the same people the chat itself treats as covered.
  const pairs = [...new Map(answers.flatMap((a) => personDocumentPairs(a)).filter((p) => active.has(p.policyId)).map((p) => [`${p.subjectId}|${p.policyId}`, p])).values()];
  const covered = new Set(pairs.length ? (await query<{ k: string }>(
    `SELECT p.family_member_id::text||'|'||p.id::text AS k FROM policies p WHERE p.account_id=$1 AND p.id=ANY($2::uuid[]) AND p.family_member_id IS NOT NULL AND ${activePredicate("p")}
     UNION SELECT pm.family_member_id::text||'|'||pm.policy_id::text FROM policy_members pm WHERE pm.account_id=$1 AND pm.policy_id=ANY($2::uuid[])`,
    [accountId, [...new Set(pairs.map((p) => p.policyId))]])).rows.map((r) => r.k) : []);
  const unlinked = (a: Partial<ChatAnswer> | null | undefined) => personDocumentPairs(a).some((p) => active.has(p.policyId) && !covered.has(`${p.subjectId}|${p.policyId}`));
  return answers.map((a) => {
    const ids = referencedPolicyIds(a);
    if ((ids.length && ids.some((id) => !active.has(id))) || changed(a)) return invalidatedAnswer(a as ChatAnswer) as unknown as T;
    if (unlinked(a)) return invalidatedAnswer(a as ChatAnswer, "person_unlinked") as unknown as T;
    if (superseded(a)) return invalidatedAnswer(a as ChatAnswer, "superseded") as unknown as T;
    return grown(a) ? (invalidatedAnswer(a as ChatAnswer, "documents_added") as unknown as T) : a;
  });
}
