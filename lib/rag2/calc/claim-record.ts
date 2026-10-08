/**
 * Agent K: the claim record for a conversation-loop claim, through the EXISTING workflow (lib/claims/record.ts
 * recordClaim -> claim_sessions + decision packet), and only when the household is pursuing a claim: a calculate call
 * with purpose "claim" for the person whose event facts the loop has recorded. An ordinary policy question (purpose
 * question / what_if, or no recorded event) never creates or changes a claim.
 *
 * No amount reaches the claim record from here: every item is written with amountText null and no calculatedAmount,
 * so the claim workflow's own monetary gate, reviewed evidence and reviewer decisions (lib/claims/monetary-gate.ts,
 * indicative-assessment.ts) remain the only way a claim amount is shown on the Claims page.
 */
import { recordClaim } from "@/lib/claims/record";
import type { SubjectFacts } from "@/lib/chat/types";
import type { ClaimItem } from "@/types";
import type { CalcOutcome } from "./engine";
import type { RagLoopState } from "../loop/types";

type Calc = CalcOutcome & { purpose?: string };

/** True only when a calculation was made for a claim the household is pursuing, about the person whose event the
 * loop has recorded facts for. */
export function isClaimScenario(state: RagLoopState, calcs: Calc[]): boolean {
  const subject = state.claim?.subjectId;
  if (!subject || !Object.keys(state.claim?.facts ?? {}).length) return false;
  return calcs.some((c) => c.purpose === "claim" && c.subjectId === subject);
}

function subjectFacts(state: RagLoopState): SubjectFacts {
  const out: SubjectFacts = {};
  const put = (key: string, value: string | number | boolean, quote: string, turn: number) => { out[key] = { value, state: "known", quote, recordedAt: `turn ${turn}`, source: "user" }; };
  for (const [key, f] of Object.entries(state.claim?.facts ?? {})) {
    const v = String(f.value);
    if (/^(?:cause|accident)/.test(key)) { put("injured", true, f.words, f.turn); if (/accident|fall|fell|slip/i.test(v + " " + f.words)) put("accidentType", v, f.words, f.turn); }
    if (/^injur/.test(key)) { put("injured", true, f.words, f.turn); put("injuries", v, f.words, f.turn); }
    if (/^admitted$|hospitali[sz]ed|warded/.test(key) && /^(?:yes|true)$/i.test(v)) put("hospitalised", true, f.words, f.turn);
    if (/bill/.test(key)) { const n = Number(v.replace(/[^\d.]/g, "")); if (Number.isFinite(n) && n > 0) put("hospitalBill", n, f.words, f.turn); }
    if (/diagnos/.test(key)) put("diagnosis", v, f.words, f.turn);
    if (/^(?:event_)?date$|accident_date|event_date/.test(key)) put("eventDate", v, f.words, f.turn);
  }
  return out;
}

/** Writes (or updates) the conversation's claim record when -- and only when -- it is a claim scenario. */
export async function syncCalcClaimRecord(args: { accountId: string; conversationId: string; state: RagLoopState; calcs: Calc[]; existingId?: string | null }): Promise<{ id: string } | null> {
  if (!isClaimScenario(args.state, args.calcs)) return null;
  const subject = args.state.claim!.subjectId!;
  const calcs = args.calcs.filter((c) => c.subjectId === subject && c.purpose === "claim");
  const items: ClaimItem[] = calcs.map((c) => ({
    title: `${c.benefit}`,
    status: c.kind === "not_payable" ? "not_applicable" : "potentially_applicable",
    amountText: null,
    reason: c.kind === "unresolved" ? c.unresolvedText : c.kind === "not_payable" ? c.unresolvedText : `Worked out in the chat as ${c.kind === "indicative_estimate" ? "an indicative estimate" : "an illustration"} from the policy wording; the insurer assesses the claim.`,
    conditions: c.conditions.map((x) => `${x.status}: ${x.text}`),
    calculationId: c.calcId,
  }));
  const facts = subjectFacts(args.state);
  const eventWords = Object.values(args.state.claim!.facts).map((f) => f.words).find((w) => w.length > 8) ?? calcs[0]?.benefit ?? "Claim";
  const missing = [...new Set(calcs.flatMap((c) => c.requirements))];
  const recorded = await recordClaim({ accountId: args.accountId, familyMemberId: subject, existingId: args.existingId ?? null, facts, eventSummary: eventWords.slice(0, 120), items, citations: [],
    knownFacts: Object.entries(args.state.claim!.facts).map(([k, f]) => `${k.replace(/_/g, " ")}: ${String(f.value)}`), missingFacts: missing,
    complete: !missing.length, nextSteps: [...new Set(calcs.flatMap((c) => c.evidenceRequirements))].map((d) => "Attach: " + d), conversationId: args.conversationId, claimCategory: null });
  return { id: recorded.id };
}
