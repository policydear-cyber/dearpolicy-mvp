import { createHash } from "node:crypto";
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

export type DefinitionIdentity = { policyId: string; chunkId: string; pageStart: number; pageEnd: number; wordingHash?: string };

/** Fingerprint of the exact definition clause text a decision was made
 * against. A citation alone (policy + pages) is not a wording version: a
 * re-read policy can say something different on the very same pages. */
export function definitionWordingHash(quote: string): string {
  return `sha256:${createHash("sha256").update(quote.replace(/\s+/g, " ").trim()).digest("hex")}`;
}

/** The current definition identity a decision must have been made against:
 * the rule's citation plus the fingerprint of its quoted clause. */
export function currentDefinition(citation: { policyId: string; chunkId: string; pageStart: number; pageEnd: number }, quote: string): DefinitionIdentity {
  return { policyId: citation.policyId, chunkId: citation.chunkId, pageStart: citation.pageStart, pageEnd: citation.pageEnd, wordingHash: definitionWordingHash(quote) };
}

export function definitionIdentityOf(value: unknown): DefinitionIdentity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.policyId !== "string" || typeof v.chunkId !== "string" || typeof v.pageStart !== "number" || typeof v.pageEnd !== "number") return null;
  return { policyId: v.policyId, chunkId: v.chunkId, pageStart: v.pageStart, pageEnd: v.pageEnd, ...(typeof v.wordingHash === "string" ? { wordingHash: v.wordingHash } : {}) };
}

function samePages(x: DefinitionIdentity, y: DefinitionIdentity) {
  return x.policyId === y.policyId && x.chunkId === y.chunkId && x.pageStart === y.pageStart && x.pageEnd === y.pageEnd;
}

/** True for a decision recorded without a wording fingerprint (every
 * decision saved before fingerprints existed, including household-era
 * rows). Such a decision is kept as immutable history but can NEVER be
 * used for money: its citation alone cannot prove which wording it was
 * made against, and no fingerprint is ever backfilled from today's
 * wording. */
export function isLegacyUnverifiedDecision(definitionEvidence: unknown): boolean {
  return !definitionIdentityOf(definitionEvidence)?.wordingHash;
}

/** Same citation AND the same recorded clause wording. A decision without
 * a fingerprint never matches. */
export function sameDefinitionIdentity(decision: unknown, current: unknown): boolean {
  const x = definitionIdentityOf(decision), y = definitionIdentityOf(current);
  if (!x || !y || !samePages(x, y)) return false;
  return !!x.wordingHash && !!y.wordingHash && x.wordingHash === y.wordingHash;
}

/** A decision that may be handed to a calculator even though it is not
 * against the current definition: only a fingerprinted decision whose
 * citation differs, which the calculator's own same-definition check then
 * rejects with its specific reason. Anything with the same citation, and
 * anything without a fingerprint, is never handed over at all. */
function rejectableByCalculator(decision: unknown, current: unknown): boolean {
  const x = definitionIdentityOf(decision), y = definitionIdentityOf(current);
  return !!x && !!x.wordingHash && !!y && !samePages(x, y);
}

function definitionKey(value: unknown): string {
  const d = definitionIdentityOf(value);
  return d ? `${d.policyId}|${d.chunkId}|${d.pageStart}|${d.pageEnd}|${d.wordingHash ?? ""}` : `malformed:${JSON.stringify(value ?? null)}`;
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
  const pool = current.length ? current : candidates.filter((c) => rejectableByCalculator(c.definitionEvidence, currentDefinition));
  if (pool.length === 0) return null;
  const ordered = [...pool].sort((a, b) =>
    (a.reviewedAt < b.reviewedAt ? 1 : a.reviewedAt > b.reviewedAt ? -1 : 0)
    || decisionDocumentId(a).localeCompare(decisionDocumentId(b)));
  return ordered.find((c) => c.result !== "matches") ?? ordered[0];
}
