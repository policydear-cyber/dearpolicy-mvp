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

export function invalidatedAnswer(answer: ChatAnswer, reason: "policy_deleted" | "documents_added" = "policy_deleted"): ChatAnswer {
  return {
    ...answer,
    summary: reason === "documents_added" ? ADDED_DOCUMENTS_NOTICE : STALE_ANSWER_NOTICE,
    details: [], claimItems: [], citations: [], nextSteps: [], missingFacts: [], questions: [],
    policyStatedLimits: [], potentialPayoutTotals: [], payoutQualifiers: [], absenceChecks: [],
    factFinding: undefined, composition: undefined, assessmentKind: undefined,
    invalidated: { reason },
  } as ChatAnswer;
}

/** Replaces every answer that cites a policy which is no longer active in
 * this household. `answers` are already monetary-boundary-sanitised. */
export async function invalidateAnswersWithDeletedPolicies<T extends Partial<ChatAnswer> | null | undefined>(accountId: string, answers: T[]): Promise<T[]> {
  const wanted = [...new Set(answers.flatMap((a) => referencedPolicyIds(a)))];
  if (!wanted.length) return answers;
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
  return answers.map((a) => {
    const ids = referencedPolicyIds(a);
    if ((ids.length && ids.some((id) => !active.has(id))) || changed(a)) return invalidatedAnswer(a as ChatAnswer) as unknown as T;
    return grown(a) ? (invalidatedAnswer(a as ChatAnswer, "documents_added") as unknown as T) : a;
  });
}
