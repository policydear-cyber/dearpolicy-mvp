/**
 * Attaches the deterministic fact-finding plan (lib/claims/fact-finding.ts)
 * to a live-chat claim answer: per family member and claim category, the
 * status, the next small group of questions, the documents and reviewer
 * decisions still needed, and which earlier answers are stale, conflicting
 * or uncertain. Contains no amounts; a figure the family stated is listed
 * only as "recorded, not used".
 *
 * Two behaviours come from the household's own data, not a generic list:
 * - It fires on any turn that DESCRIBES an event ("X died in a car
 *   accident"), not only turns the intent classifier labelled a claim, so a
 *   reported death is always met with the questions that decide it.
 * - The plan's questions are enriched from the policies' own STORED
 *   exclusions (read once at upload): if an uploaded policy excludes
 *   alcohol-related events, the chat asks about alcohol; if none does, it
 *   never brings it up. Best-effort -- a failed conditions read only means
 *   fewer questions, never a failed answer.
 */
import { categoriesFor, conditionDrivenQuestions, planFactFinding, type FactFindingPlan, type FactFindingQuestion } from "@/lib/claims/fact-finding";
import { loadCoverConditions } from "@/lib/policies/condition-catalog";
import { describesAScenario } from "@/lib/policies/benefit-catalog";
import { query } from "@/lib/db/client";
import type { CoverCondition } from "@/lib/insurance/cover-conditions";
import type { ChatAnswer } from "@/types";
import type { ConversationState, SubjectFacts } from "./types";

async function householdConditions(accountId: string): Promise<CoverCondition[]> {
  try {
    const policies = await query<{ id: string }>(
      `SELECT id FROM policies WHERE account_id=$1 AND processing_status='ready' AND superseded_at IS NULL AND lifecycle_state='active'`,
      [accountId],
    );
    if (!policies.rows.length) return [];
    return await loadCoverConditions(accountId, policies.rows.map((row) => row.id));
  } catch {
    return []; /* Fewer questions, never a failed answer. */
  }
}

export async function applyFactFinding(
  answer: ChatAnswer,
  state: ConversationState,
  people: { id: string; display_name: string }[],
  opts?: { accountId?: string; question?: string },
): Promise<void> {
  const claimTurn = state.intent === "claim" || answer.mode !== "answer" || (!!opts?.question && describesAScenario(opts.question));
  if (!claimTurn) { delete answer.factFinding; return; }
  const conditions = opts?.accountId ? await householdConditions(opts.accountId) : [];
  const plans: NonNullable<ChatAnswer["factFinding"]> = [];
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    for (const category of categoriesFor(signals, facts)) {
      const plan = planFactFinding({ subjectId: person.id, category, facts });
      if (plan.status === "information_needed" || plan.status === "evidence_needed") {
        const asked = new Set(plan.nextQuestions.map((q) => q.factKey));
        for (const extra of conditionDrivenQuestions({ category, conditions, facts })) {
          if (asked.has(extra.factKey) || plan.nextQuestions.length >= 5) continue;
          asked.add(extra.factKey);
          plan.nextQuestions.push(extra);
        }
      }
      // FactFindingPlanView (types/) lists the categories the UI knows by name;
      // the UI only reads the label, so a newer category renders the same way.
      plans.push({ ...plan, category: plan.category as NonNullable<ChatAnswer["factFinding"]>[number]["category"], subjectName: person.display_name });
    }
  }
  if (plans.length) answer.factFinding = plans.slice(0, 8);
  else delete answer.factFinding;
}

/* ------------------------------------------------------------------------
 * Injury fact-finding turn (deterministic; no model, no amounts).
 *
 * A reported injury to a living person ("Charmaine broke her arm") is met
 * with ONE question at a time, in a fixed order, until the facts that decide
 * which benefits respond are in. The household sees plain categories of
 * cover ("accident medical reimbursement", "hospitalisation") -- never raw
 * schedule rows, rule counts or figures -- because nothing has been decided
 * yet and a row title like "Loss of arm" reads as a verdict.
 * ---------------------------------------------------------------------- */

/** A schedule row that pays for permanent loss of a limb, sight or function. */
export const PERMANENT_LOSS = /permanent|dismember|\bloss of (?:the )?(?:use of )?(?:(?:one|two|both|any|an?)\s+)?(?:limbs?|arms?|legs?|hands?|feet|foot|eyes?|sight|hearing|speech|fingers?|thumbs?|toes?)\b|\btpd\b|total\s*(?:and|&)\s*permanent|disablement/i;

export type BenefitCategory =
  | "permanent disability" | "accidental death" | "death" | "critical illness" | "fracture" | "hospital cash"
  | "ambulance" | "outpatient treatment" | "accident medical reimbursement" | "medical reimbursement" | "hospitalisation";

/** The household-friendly category a benefit belongs to, from its own name
 * (and product name for context). Null when it does not fall in a category
 * the chat talks about. */
export function benefitCategory(text: string): BenefitCategory | null {
  const t = text.toLowerCase();
  if (PERMANENT_LOSS.test(t)) return "permanent disability";
  if (/death|funeral|bereave/.test(t)) return /accident/.test(t) ? "accidental death" : "death";
  if (/critical|cancer|dread|major illness/.test(t)) return "critical illness";
  if (/fractur|broken bone|dislocat/.test(t)) return "fracture";
  if (/hospital (?:cash|income|allowance)|daily (?:cash|benefit|allowance|hospital)|per day|recuperat/.test(t)) return "hospital cash";
  if (/ambulance/.test(t)) return "ambulance";
  if (/outpatient|clinic|physio|chiropract|\bgp\b|a\s*&\s*e\b|emergency/.test(t)) return "outpatient treatment";
  if (/medical|reimburs|expense/.test(t)) return /accident/.test(t) ? "accident medical reimbursement" : "medical reimbursement";
  if (/hospital|inpatient|surg|ward|room and board|\bicu\b|intensive care/.test(t)) return "hospitalisation";
  return null;
}
const CATEGORY_ORDER: BenefitCategory[] = ["accident medical reimbursement", "medical reimbursement", "hospitalisation", "fracture", "hospital cash",
  "outpatient treatment", "ambulance", "critical illness", "accidental death", "death", "permanent disability"];
/** Unique categories among the candidate benefit names, in a fixed order. */
export function benefitCategories(names: string[]): BenefitCategory[] {
  const found = new Set(names.map(benefitCategory).filter((c): c is BenefitCategory => !!c));
  return CATEGORY_ORDER.filter((c) => found.has(c));
}
export function joinOr(items: string[], word = "or") {
  return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " " + word + " " + items[items.length - 1];
}

type Person = { id: string; display_name: string; preferred_name?: string | null; relationship?: string | null };
/** The name the family uses ("Charmaine"), not the full legal name on the policy. */
const calledName = (person: Person) => person.preferred_name?.trim() || person.display_name;
const known = (facts: SubjectFacts, key: string) => facts[key]?.state === "known" ? facts[key].value : null;

/** The next open question of the injury plan, for the first person it applies
 * to. Null when no injury is reported or every required fact is in. */
export function nextInjuryQuestion(state: ConversationState, people: Person[]): { subjectId: string; plan: FactFindingPlan; question: FactFindingQuestion } | null {
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    if (!categoriesFor(signals, facts).includes("accidental_injury")) continue;
    const plan = planFactFinding({ subjectId: person.id, category: "accidental_injury", facts });
    if (!plan.missingFacts.length) continue;
    const question = plan.nextQuestions.find((q) => plan.missingFacts.includes(q.factKey)) ?? plan.nextQuestions[0];
    if (question) return { subjectId: person.id, plan, question };
  }
  return null;
}

function possessive(person: Person) {
  if (/^self$/i.test(person.relationship ?? "")) return "your";
  return calledName(person) + "’s";
}
function injuryPhrase(facts: SubjectFacts) {
  const kind = known(facts, "injuryKind");
  const part = known(facts, "fractureBodyPart") ?? known(facts, "injuryBodyPart");
  const site = typeof part === "string" && part.trim() ? part.trim().toLowerCase() : null;
  if (kind === "fracture") return site ? "A broken " + site : "A broken bone";
  if (kind === "wound") return site ? "A cut or wound to the " + site : "A cut or wound";
  if (kind === "burn") return site ? "A burn to the " + site : "A burn";
  return site ? "An injury to the " + site : "An injury like this";
}

/** The explanation shown above the single question while an injury claim is
 * still being fact-found. Built from the person's own facts and the
 * categories of cover that actually exist among their (compatibility
 * filtered) candidate benefits; contains no amounts, no row titles and no
 * rule counts. */
export function injuryFactFindingText(args: { person: Person; facts: SubjectFacts; candidateNames: string[]; permanentLossOnFile: boolean }): { summary: string; categories: BenefitCategory[] } {
  const { person, facts } = args;
  const fracture = known(facts, "injuryKind") === "fracture";
  const lasting = known(facts, "permanentImpairment") === true;
  const categories = benefitCategories(args.candidateNames).filter((c) =>
    c !== "accidental death" && c !== "death" && c !== "critical illness" && (c !== "permanent disability" || (lasting && !fracture)));
  const self = /^self$/i.test(person.relationship ?? "");
  const lead = self ? "I’m sorry you’re dealing with this." : "I’m sorry " + calledName(person) + " is dealing with this.";
  const phrase = injuryPhrase(facts);
  const labels = categories.map((c) => c === "fracture" ? "fracture" : c);
  // Until the cause is known, which benefits can respond is not known either
  // (accident-only cover depends on it), so no categories are named yet.
  const causeKnown = known(facts, "eventType") != null || known(facts, "accidentalCause") != null;
  const relates = labels.length && causeKnown
    ? phrase + " may relate to " + joinOr(labels) + " benefits in " + possessive(person) + " policies, depending on the answers."
    : phrase + " can involve several kinds of cover, so I need a few details before I check " + possessive(person) + " policies.";
  const permanent = fracture && args.permanentLossOnFile && causeKnown
    ? " It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available."
    : "";
  return { summary: lead + " " + relates + permanent, categories };
}

/** Answer options for a single promoted question, always including a way to
 * say "Not sure" so the interview can move on. */
export function questionOptions(question: { type: string; options?: string[] }) {
  if (question.type === "yes_no") return ["Yes", "No", "Not sure"];
  if (question.type === "choice" && question.options?.length) return [...new Set([...question.options, "Not sure"])];
  return ["Not sure"];
}

/** Turns an injury fact-finding step into the chat answer: fact_finding mode,
 * no claim items, no totals, exactly one question, and the pending question
 * set so the next short reply is captured against it. */
export function applyInjuryFactFindingTurn(args: {
  answer: ChatAnswer; state: ConversationState; person: Person;
  next: { subjectId: string; question: FactFindingQuestion };
  candidateNames: string[]; permanentLossOnFile: boolean;
}) {
  const { answer, state, person, next } = args;
  const facts = state.subjects[person.id] ?? {};
  const text = injuryFactFindingText({ person, facts, candidateNames: args.candidateNames, permanentLossOnFile: args.permanentLossOnFile });
  answer.mode = "fact_finding";
  answer.claimItems = [];
  delete answer.potentialPayoutTotals;
  delete answer.payoutQualifiers;
  // Said once per chat. Repeating the same paragraph above every question
  // buries the question; a later turn acknowledges the answer instead, and
  // the explanation returns only when what it says has changed.
  answer.summary = state.injuryExplained === text.summary ? "Thanks, noted." : text.summary;
  state.injuryExplained = text.summary;
  answer.details = [];
  answer.questions = [{ id: next.question.id, type: next.question.type, text: next.question.text, why: next.question.why, options: questionOptions(next.question) }];
  state.pending = { ...answer.questions[0], subjectId: next.subjectId, factKey: next.question.factKey };
  answer.confidence = "partial_match";
  return text;
}
