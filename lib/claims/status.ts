/**
 * The ONE source of a claim's household-facing status (shared interface 4).
 *
 * The claims list, the claim detail page and the "what to send" text all read
 * this, so they cannot disagree: the list used to say "Assessment ready" for
 * any claim whose chat interview had finished, while the detail page -- which
 * asks the evidence-gated engine -- said "No estimate yet"; and every claim's
 * list action named death documents, a fracture included.
 *
 *  - "ready" only when the evidence-gated engine has produced an indicative
 *    estimate (lib/claims/indicative-assessment.ts, hasEstimate). A finished
 *    interview is not an estimate.
 *  - requestedDocuments come from what actually happened (the claim's facts
 *    and its category's required documents), never a fixed list.
 */
import { claimCategoryFromFacts, claimDocuments } from "./claim-pack";
import type { FactFindingCategory } from "./fact-finding";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "./types";

export type ClaimDisplayTone = "info" | "waiting" | "ready";
export type ClaimDisplayStatus = { label: string; tone: ClaimDisplayTone; hasEstimate: boolean; requestedDocuments: string[]; detail: string };
export type ClaimForDisplay = {
  /** Claim rows carry other columns (id, event_summary, decision_packet…); only the fields below are read. */
  [otherColumn: string]: unknown;
  status?: string | null;
  event_type?: string | null;
  /** Stored with the claim when the chat records it (lib/claims/record.ts). */
  claim_category?: string | null;
  facts?: Partial<ClaimFacts> | Record<string, unknown> | null;
  /** From computeIndicativeEstimate(...).hasEstimate -- the evidence-gated engine. */
  hasEvidenceBackedEstimate?: boolean;
  /** A question the interview is still waiting on. */
  pending_question?: unknown;
};

function normalized(facts: ClaimForDisplay["facts"]): ClaimFacts {
  const stored = (facts ?? {}) as Partial<ClaimFacts>;
  return { ...EMPTY_CLAIM_FACTS, ...stored,
    injuries: Array.isArray(stored.injuries) ? stored.injuries : [], uncertainFacts: Array.isArray(stored.uncertainFacts) ? stored.uncertainFacts : [] };
}
/** The claim's category, from what happened (not from which benefit matched). */
export function claimCategory(claim: ClaimForDisplay): FactFindingCategory | null {
  return claimCategoryFromFacts(normalized(claim.facts) as ClaimFacts & Record<string, unknown>, claim.event_type, claim.claim_category);
}
/** What to send for this claim (the same list the claim pack prints, less
 * the insurer's own form and the schedule, which every claim needs). */
export function requestedDocumentsFor(claim: ClaimForDisplay): string[] {
  return claimDocuments(normalized(claim.facts), claimCategory(claim)).filter((d) => !/claim form|policy schedule or certificate/i.test(d));
}
export function claimDisplayStatus(claim: ClaimForDisplay): ClaimDisplayStatus {
  const requestedDocuments = requestedDocumentsFor(claim);
  if (claim.hasEvidenceBackedEstimate === true)
    return { label: "Indicative estimate ready", tone: "ready", hasEstimate: true, requestedDocuments,
      detail: "An indicative estimate is available from the documents reviewed so far. The insurer decides the final amount." };
  const interviewing = claim.status !== "complete" || !!claim.pending_question;
  if (interviewing)
    return { label: "Questions to answer", tone: "info", hasEstimate: false, requestedDocuments,
      detail: "A few questions about what happened are still open. No estimate yet." };
  return { label: "Documents needed", tone: "waiting", hasEstimate: false, requestedDocuments,
    detail: "No estimate yet. DearPolicy shows an indicative amount only after the claim documents have been reviewed." };
}
