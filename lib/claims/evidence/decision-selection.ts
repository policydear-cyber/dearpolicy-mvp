/**
 * Identity and selection rules for reviewer policy-definition decisions
 * (the cause, critical-illness and disability *_definition_matches tables).
 *
 * A decision's REVIEW SUBJECT is the complete tuple
 *   household, family member, claim event, contract, coverage,
 *   evidence document, decision kind (+ benefit code and illness name /
 *   match key where the kind has them), and the exact policy-definition
 *   citation (policy, chunk and pages) the reviewer decided against.
 * A new decision supersedes an earlier one ONLY for the identical subject
 * (lib/claims/evidence/store.ts's record*DefinitionMatch()). A decision on
 * document B never supersedes, hides or alters a decision on document A.
 *
 * Reading them back is fail-closed:
 *  - more than one ACTIVE decision for the same subject (possible only in
 *    historical data written before this rule) is ambiguous, so every
 *    decision for that subject is ignored (activeDecisionsWithoutAmbiguity);
 *  - a calculator is given at most one decision per benefit, chosen by
 *    selectApplicableDecision(): only decisions against the CURRENT
 *    definition citation are preferred; when documents disagree, the
 *    non-"matches" decision wins (no amount); ties are broken
 *    deterministically by review time and then document id.
 */

export type DefinitionIdentity = { policyId: string; chunkId: string; pageStart: number; pageEnd: number };

export function definitionIdentityOf(value: unknown): DefinitionIdentity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.policyId !== "string" || typeof v.chunkId !== "string" || typeof v.pageStart !== "number" || typeof v.pageEnd !== "number") return null;
  return { policyId: v.policyId, chunkId: v.chunkId, pageStart: v.pageStart, pageEnd: v.pageEnd };
}

export function sameDefinitionIdentity(a: unknown, b: unknown): boolean {
  const x = definitionIdentityOf(a), y = definitionIdentityOf(b);
  return !!x && !!y && x.policyId === y.policyId && x.chunkId === y.chunkId && x.pageStart === y.pageStart && x.pageEnd === y.pageEnd;
}

function definitionKey(value: unknown): string {
  const d = definitionIdentityOf(value);
  return d ? `${d.policyId}|${d.chunkId}|${d.pageStart}|${d.pageEnd}` : `malformed:${JSON.stringify(value ?? null)}`;
}

type SubjectRow = {
  account_id: string; family_member_id: string; claim_session_id: string; contract_id: string; coverage_id: string | null;
  evidence_document_id: string; definition_evidence: unknown; benefit_code?: string; illness_name?: string; match_key?: string;
};

export function reviewSubjectKey(row: SubjectRow): string {
  return [
    row.account_id, row.family_member_id, row.claim_session_id, row.contract_id, row.coverage_id ?? "", row.evidence_document_id,
    row.benefit_code ?? "", row.illness_name ?? "", (row.match_key ?? "").trim().toLowerCase(), definitionKey(row.definition_evidence),
  ].join("\u0001");
}

/** Drops every active decision whose review subject has more than one
 * active decision -- ambiguity never resolves to an arbitrary pick. */
export function activeDecisionsWithoutAmbiguity<T extends SubjectRow>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(reviewSubjectKey(row), (counts.get(reviewSubjectKey(row)) ?? 0) + 1);
  return rows.filter((row) => counts.get(reviewSubjectKey(row)) === 1);
}

type Selectable = { result: string; reviewedAt: string; definitionEvidence: unknown; causeEvidence?: unknown; medicalEvidence?: unknown };

export function decisionDocumentId(decision: Selectable): string {
  const evidence = (decision.causeEvidence ?? decision.medicalEvidence) as { documentId?: unknown } | null | undefined;
  return typeof evidence?.documentId === "string" ? evidence.documentId : "";
}

/** The single decision a calculator may consume for one benefit, from the
 * candidates already filtered to that exact member, claim, contract,
 * coverage and benefit. Deterministic and fail-closed -- see this module's
 * doc comment. A decision against a different (older) definition citation
 * is used only when no decision against the current citation exists, and
 * then the calculator's own same-definition check blocks it. */
export function selectApplicableDecision<T extends Selectable>(candidates: T[], currentDefinition: unknown): T | null {
  if (candidates.length === 0) return null;
  const current = candidates.filter((c) => sameDefinitionIdentity(c.definitionEvidence, currentDefinition));
  const pool = current.length ? current : candidates;
  const ordered = [...pool].sort((a, b) =>
    (a.reviewedAt < b.reviewedAt ? 1 : a.reviewedAt > b.reviewedAt ? -1 : 0)
    || decisionDocumentId(a).localeCompare(decisionDocumentId(b)));
  return ordered.find((c) => c.result !== "matches") ?? ordered[0];
}
