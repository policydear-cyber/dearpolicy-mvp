/**
 * The household-facing INDICATIVE claim estimate (V1 product decision,
 * "3. Indicative claim estimate"): computed only through the evidence-gated
 * deterministic path -- confirmed ownership, verified policy wording and
 * currency, reviewed evidence with verified model provenance, an authorised
 * reviewer's decision against the policy's own definition, the deterministic
 * calculators, the monetary gate and the composition engine. It is the same
 * pipeline the reviewer end-to-end suite drives (scripts/fixtures/
 * reviewer-harness.ts), now reachable from the Claims page.
 *
 * Read-only: it records nothing and never reuses a stored decision packet,
 * so deleted, replaced or rejected evidence and deleted policies stop
 * counting the next time it is read. Anything not fully evidenced is shown
 * without an amount, with the reason; totals are per currency and never
 * added across currencies.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimFacts } from "./types";
import { assessClaim } from "./rules";
import { enforceMonetarySafety } from "./monetary-gate";
import { loadDeathEvidence } from "./death-evidence";
import { loadCIEvidence } from "./ci-evidence";
import { loadDisabilityEvidence } from "./disability-evidence";
import { loadMedicalEvidence } from "./medical-evidence";
import { loadTravelEvidence } from "./travel-evidence";
import { loadVerifiedMedicalBillFacts } from "./evidence/medical-bill-evidence";
import { loadCauseDefinitionMatchesForFacts } from "./evidence/session-matches";
import { loadCIDefinitionMatchesForFacts } from "./evidence/ci-session-matches";
import { loadDisabilityDefinitionMatchesForFacts } from "./evidence/disability-session-matches";
import { composeClaim } from "./composition/engine";
import { toClaimCompositionView } from "./composition/view";
import { INDICATIVE_ESTIMATE_NOTICE } from "@/lib/chat/monetary-boundary";

export type IndicativeBenefitView = {
  title: string;
  status: "included" | "no_amount";
  amountText: string | null;
  currency: string | null;
  reason: string;
  conditions: string[];
  citations: { policyName: string; pageStart: number; pageEnd: number }[];
};
export type IndicativeEstimateView = {
  claimSessionId: string;
  eventType: string | null;
  notice: string;
  hasEstimate: boolean;
  benefits: IndicativeBenefitView[];
  totalsByCurrency: { currency: string; amountText: string }[];
  outstandingQuestions: string[];
};

function citationsFor(item: ClaimAssessmentItem): IndicativeBenefitView["citations"] {
  const e = item.ruleEvidence;
  return e?.policyId && e.pageStart > 0 ? [{ policyName: e.policyName, pageStart: e.pageStart, pageEnd: e.pageEnd }] : [];
}

export async function computeIndicativeEstimate(accountId: string, claimSessionId: string, now = new Date()): Promise<IndicativeEstimateView | null> {
  const row = (await query<{ family_member_id: string; facts: Partial<ClaimFacts> | null }>(
    `SELECT cs.family_member_id::text, cs.facts FROM claim_sessions cs
       JOIN family_members f ON f.id=cs.family_member_id AND f.account_id=cs.account_id AND ${activePredicate("f")}
      WHERE cs.id=$1 AND cs.account_id=$2`, [claimSessionId, accountId])).rows[0];
  if (!row) return null;
  const memberId = row.family_member_id;
  const stored = row.facts ?? {};
  const facts: ClaimFacts = {
    ...EMPTY_CLAIM_FACTS, ...stored,
    injuries: Array.isArray(stored.injuries) ? stored.injuries : [],
    uncertainFacts: Array.isArray(stored.uncertainFacts) ? stored.uncertainFacts : [],
  };
  // Reviewer decisions and verified bill facts are always reloaded from their
  // own tables -- never trusted from the stored session JSON.
  if (facts.eventType === "death") facts.causeDefinitionMatches = await loadCauseDefinitionMatchesForFacts(accountId, memberId, claimSessionId);
  if (facts.eventType === "diagnosis") facts.ciDefinitionMatches = await loadCIDefinitionMatchesForFacts(accountId, memberId, claimSessionId);
  if (facts.eventType === "disability") facts.disabilityDefinitionMatches = await loadDisabilityDefinitionMatchesForFacts(accountId, memberId, claimSessionId);
  if (facts.eventType === "hospitalisation") facts.verifiedMedicalBillFacts = await loadVerifiedMedicalBillFacts(accountId, memberId, claimSessionId);
  const coverages = await confirmedOwnedCoverages(accountId, memberId);
  const empty = { rules: [], gaps: [], pages: [] };
  const deathEvidence = facts.eventType === "death" ? await loadDeathEvidence(accountId, memberId, coverages) : empty;
  const ciEvidence = facts.eventType === "diagnosis" ? await loadCIEvidence(accountId, memberId, coverages) : empty;
  const disabilityEvidence = facts.eventType === "disability" ? await loadDisabilityEvidence(accountId, memberId, coverages) : empty;
  const medicalEvidence = facts.eventType === "hospitalisation" ? await loadMedicalEvidence(accountId, memberId, coverages) : { cashRules: [], reimbursementRules: [], planProvisions: [], gaps: [], pages: [] };
  const travelEvidence = (facts.eventType === "death" || facts.eventType === "hospitalisation") && coverages.some((c) => c.category === "Travel")
    ? await loadTravelEvidence(accountId, memberId, coverages) : empty;
  const raw = facts.eventType === "death" ? assessClaim(facts, coverages, deathEvidence.rules, deathEvidence.gaps, claimSessionId, [], [], undefined, undefined, travelEvidence)
    : facts.eventType === "diagnosis" ? assessClaim(facts, coverages, [], [], claimSessionId, ciEvidence.rules, ciEvidence.gaps)
    : facts.eventType === "hospitalisation" ? assessClaim(facts, coverages, [], [], claimSessionId, [], [], medicalEvidence, undefined, travelEvidence)
    : facts.eventType === "disability" ? assessClaim(facts, coverages, [], [], claimSessionId, [], [], undefined, disabilityEvidence)
    : [];
  const assessments = enforceMonetarySafety(raw, facts, coverages, { householdId: accountId, resourceId: claimSessionId });
  const composition = composeClaim({
    claimEventId: claimSessionId, familyMemberId: memberId, facts, coverages, assessments, accountId, now,
    wordingPages: [...deathEvidence.pages, ...ciEvidence.pages, ...disabilityEvidence.pages, ...medicalEvidence.pages, ...travelEvidence.pages] as { policy_id: string; page_number: number; text: string }[],
  });
  const view = toClaimCompositionView(composition);
  const byCalculation = new Map(view.policies.flatMap((p) => p.benefits).map((b) => [b.calculationId, b]));
  const benefits: IndicativeBenefitView[] = assessments.filter((a) => a.status !== "not_applicable").map((a) => {
    const composed = a.calculationId ? byCalculation.get(a.calculationId) : undefined;
    const included = composed?.status === "included" && composed.payableAmount > 0;
    return {
      title: a.title,
      status: included ? "included" : "no_amount",
      amountText: included ? composed!.payableAmountText : null,
      currency: included ? composed!.currency : null,
      reason: included ? a.reason : [a.reason, ...(composed?.blockedReasons ?? [])].filter(Boolean).join(" "),
      conditions: a.conditions,
      citations: citationsFor(a),
    };
  });
  const hasEstimate = benefits.some((b) => b.status === "included");
  return {
    claimSessionId, eventType: facts.eventType ?? null, notice: INDICATIVE_ESTIMATE_NOTICE, hasEstimate, benefits,
    totalsByCurrency: hasEstimate ? view.totalsByCurrency : [],
    outstandingQuestions: view.outstandingQuestions,
  };
}
