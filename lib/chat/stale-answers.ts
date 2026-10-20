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
import { loadDocs, loadLinks } from "@/lib/rag2/store";
import { scopeDocs } from "@/lib/rag2/loop/absence-scope";

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
  const widening = answers.some((a) => (Array.isArray(a?.absenceChecks) ? a!.absenceChecks! : []).some((c) => c?.scope === "library" || c?.scope === "subject"));
  const docs = widening ? await loadDocs(accountId) : [];
  const links = docs.length ? await loadLinks(accountId, docs.map((d) => d.id)) : [];
  const grown = (a: Partial<ChatAnswer> | null | undefined) => (Array.isArray(a?.absenceChecks) ? a!.absenceChecks! : []).some((c) => {
    if (c?.scope !== "library" && c?.scope !== "subject") return false;
    const saved = new Set((c.documents ?? []).map((d) => d.policyId));
    const now = scopeDocs({ docs, links, pages: [] }, { policyIds: null, subjectId: c.scope === "subject" ? c.subjectId ?? null : null }).docs;
    return now.some((d) => !saved.has(d.id));
  });
  return answers.map((a) => {
    const ids = referencedPolicyIds(a);
    if ((ids.length && ids.some((id) => !active.has(id))) || changed(a)) return invalidatedAnswer(a as ChatAnswer) as unknown as T;
    return grown(a) ? (invalidatedAnswer(a as ChatAnswer, "documents_added") as unknown as T) : a;
  });
}
