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
import { activePredicate } from "@/lib/lifecycle/scopes";
import { categoriesFor, conditionDrivenQuestions, FACT_FINDING_SPECS, planFactFinding, type FactFindingCategory, type FactFindingPlan, type FactFindingQuestion } from "@/lib/claims/fact-finding";
import { loadCoverConditions } from "@/lib/policies/condition-catalog";
import { describesAScenario, namesNoBenefit } from "@/lib/policies/benefit-catalog";
import { query } from "@/lib/db/client";
import { dedupeDocuments } from "@/lib/claims/claim-pack";
import { forSeveral, sharedReasonLine } from "@/lib/claims/answer-shape";
import { looksLikeInterviewReply } from "@/lib/claims/event-name";
import { reportedEvents } from "@/lib/claims/reported-events";
import type { CoverCondition } from "@/lib/insurance/cover-conditions";
import type { ChatAnswer, ChatCitation, ClaimItem } from "@/types";
import type { IndicativeEstimateView } from "@/lib/claims/indicative-assessment";
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

const HOSPITAL_CASH = /\bcash\b|daily|per day|a day\b|confinement|allowance|income/i;
/** The benefit names read from this person's own policies (null: unknown). */
async function personBenefitNames(accountId: string, personId: string): Promise<string[] | null> {
  try {
    const rows = await query<{ benefit_name: string }>(
      `SELECT DISTINCT b.benefit_name FROM policy_benefits b JOIN policies p ON p.id=b.policy_id AND p.account_id=b.account_id
        WHERE b.account_id=$1 AND ${activePredicate("p")} AND (p.family_member_id=$2 OR EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2))`,
      [accountId, personId]);
    // A fragment stored as a name ("273,411", "(a)", "and Merdeka") names no benefit (lib/policies/benefit-catalog.ts).
    return rows.rows.map((r) => r.benefit_name).filter((name) => !namesNoBenefit(name));
  } catch { return null; }
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
  const seenDocuments = new Set<string>();
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    // A plan whose benefits this person does not have (hospital cash under a
    // Shield plan that pays none) asks for nothing.
    const benefitNames = opts?.accountId ? await personBenefitNames(opts.accountId, person.id) : null;
    for (const category of categoriesFor(signals, facts)) {
      if (category === "hospital_cash" && benefitNames?.length && !benefitNames.some((n) => HOSPITAL_CASH.test(n))) continue;
      const plan = planFactFinding({ subjectId: person.id, category, facts, home: state.home });
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
      // The same document is asked for once across plans ("Discharge summary"
      // and "Discharge summary showing admission and discharge times").
      const missingDocuments = dedupeDocuments(plan.missingDocuments).filter((d) => {
        const key = dedupeDocuments([d, ...seenDocuments]).length === seenDocuments.size ? null : d;
        if (!key) return false; seenDocuments.add(d); return true;
      });
      plans.push({ ...plan, missingDocuments, category: plan.category as NonNullable<ChatAnswer["factFinding"]>[number]["category"], subjectName: person.display_name });
    }
  }
  // The final answer of a finished interview asks nothing more: optional
  // plan questions are not promoted as a question card underneath it.
  // An evidence-backed estimate settles what the plan was waiting for (the
  // documents were reviewed and decided): no stale "Evidence needed" plan.
  if (ESTIMATE_ANSWERS.has(answer)) { delete answer.factFinding; return; }
  if (FINAL_ANSWERS.has(answer)) for (const plan of plans) plan.nextQuestions = [];
  if (plans.length) answer.factFinding = plans.slice(0, 8);
  else delete answer.factFinding;
}

/* ------------------------------------------------------------------------
 * Injury fact-finding turn (deterministic; no model, no amounts).
 *
 * A reported injury to a living person ("Mei Ling broke her arm") is met
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
/** The name the family uses ("Mei Ling"), not the full legal name on the policy. */
const calledName = (person: Person) => person.preferred_name?.trim() || person.display_name;
const known = (facts: SubjectFacts, key: string) => facts[key]?.state === "known" ? facts[key].value : null;
/** A known value that says something ("not sure" is recorded, but says nothing). */
const said = (facts: SubjectFacts, key: string) => {
  const value = known(facts, key);
  return typeof value === "string" && /^(?:not sure|unsure|unknown|not yet known|don'?t know)$/i.test(value.trim()) ? null : value;
};

/** The next open question of the injury plan, for the first person it applies
 * to. Null when no injury is reported or every required fact is in. */
export function nextInjuryQuestion(state: ConversationState, people: Person[]): { subjectId: string; plan: FactFindingPlan; question: FactFindingQuestion } | null {
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    if (!categoriesFor(signals, facts).includes("accidental_injury")) continue;
    const plan = planFactFinding({ subjectId: person.id, category: "accidental_injury", facts, home: state.home });
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
  // Round 11: what was said is noted, but the question still open is the same one: say so, rather than a bare "noted".
  const sameQuestion = state.pending?.id === next.question.id;
  answer.summary = state.injuryExplained === text.summary ? (sameQuestion ? "Thanks — I’ve noted that. I still need the answer to this one before I go on." : "Thanks, noted.") : text.summary;
  state.injuryExplained = text.summary;
  answer.details = [];
  answer.questions = [{ id: next.question.id, type: next.question.type, text: next.question.text, why: next.question.why, options: questionOptions(next.question) }];
  state.pending = { ...answer.questions[0], subjectId: next.subjectId, factKey: next.question.factKey };
  answer.confidence = "partial_match";
  return text;
}

/* ------------------------------------------------------------------------
 * Every claim category, one question at a time (V1.1 Task 3).
 *
 * The injury interview above is one instance of a general rule: until the
 * facts that decide which benefit and which policy definition apply are in,
 * the answer is the next question. The same deterministic plans
 * (lib/claims/fact-finding.ts) drive death, critical illness, disability,
 * hospitalisation / medical reimbursement and travel. Only the event's own
 * (primary) category is interviewed -- a hospital stay after a fracture is
 * part of the injury interview, not a second one.
 * ---------------------------------------------------------------------- */
const PRIMARY_ORDER: FactFindingCategory[] = ["accidental_death", "accidental_injury", "critical_illness", "disability_tpd", "travel", "medical_reimbursement", "hospital_cash"];
export function primaryClaimCategory(state: ConversationState, personId: string): FactFindingCategory | null {
  const facts = state.subjects[personId] ?? {};
  const signals = new Set<string>((state.scenarios?.[personId] ?? []).flatMap((s) => [...s.traits, s.family]));
  if (known(facts, "eventType") === "travel_disruption" || known(facts, "flightDelayHours") != null || known(facts, "travelEventType") != null) signals.add("travel");
  if (known(facts, "disabled") === true || known(facts, "eventType") === "disability") signals.add("disability");
  const found = categoriesFor(signals, facts);
  // Being unable to work is the event even when the model also tagged an
  // injury: the disability definition decides it, not an injury schedule.
  if (found.includes("disability_tpd") && (known(facts, "disabled") === true || known(facts, "eventType") === "disability") && !found.includes("accidental_death")) return "disability_tpd";
  return PRIMARY_ORDER.find((c) => found.includes(c)) ?? null;
}
export function nextClaimInterviewQuestion(state: ConversationState, people: Person[]): { subjectId: string; plan: FactFindingPlan; question: FactFindingQuestion; category: FactFindingCategory } | null {
  for (const person of people) {
    const category = primaryClaimCategory(state, person.id);
    if (!category) continue;
    if (category === "accidental_injury") {
      const injury = nextInjuryQuestion(state, [person]);
      if (injury) return { ...injury, category };
      continue;
    }
    const plan = planFactFinding({ subjectId: person.id, category, facts: state.subjects[person.id] ?? {}, home: state.home });
    if (!plan.missingFacts.length) continue;
    const question = plan.nextQuestions.find((q) => plan.missingFacts.includes(q.factKey)) ?? plan.nextQuestions[0];
    if (question) return { subjectId: person.id, plan, question, category };
  }
  return null;
}
const CATEGORY_EVENT: Record<FactFindingCategory, string> = {
  accidental_death: "a death", accidental_injury: "an injury", critical_illness: "a diagnosis", disability_tpd: "a disability",
  medical_reimbursement: "a hospital stay", hospital_cash: "a hospital stay", travel: "a problem on a trip",
};
/** The explanation above a non-injury interview question: plain, no amounts,
 * no row titles; said once, then "Thanks, noted." */
export function applyClaimInterviewTurn(args: { answer: ChatAnswer; state: ConversationState; person: Person;
  next: { subjectId: string; question: FactFindingQuestion; category: FactFindingCategory } }) {
  const { answer, state, person, next } = args;
  const self = /^self$/i.test(person.relationship ?? "");
  const whose = self ? "your" : calledName(person) + "’s";
  const lead = next.category === "accidental_death" ? "I’m so sorry for your loss."
    : known(state.subjects[person.id] ?? {}, "maternity") === true ? "Congratulations on the new baby."
    : self ? "I’m sorry you’re dealing with this." : "I’m sorry " + calledName(person) + " is dealing with this.";
  const summary = lead + " To check " + whose + " policies for " + CATEGORY_EVENT[next.category] + ", I need a few details first, one at a time.";
  answer.mode = "fact_finding";
  answer.claimItems = [];
  delete answer.potentialPayoutTotals;
  delete answer.payoutQualifiers;
  const firstTurn = state.injuryExplained !== summary;
  answer.summary = firstTurn ? summary : "Thanks, noted.";
  state.injuryExplained = summary;
  // After a death, what to do first comes before the questions.
  answer.details = firstTurn && next.category === "accidental_death" ? [deathFirstSteps(state.subjects[person.id] ?? {})] : [];
  answer.questions = [{ id: next.question.id, type: next.question.type, text: personalQuestion(next.question.text, person), why: next.question.why, options: questionOptions(next.question) }];
  state.pending = { ...answer.questions[0], subjectId: next.subjectId, factKey: next.question.factKey };
  answer.confidence = "partial_match";
}
/** "Is the insured person still alive today?" reads as a form; the family
 * knows the person by name. */
export function personalQuestion(text: string, person: Person) {
  const self = /^self$/i.test(person.relationship ?? "");
  const name = calledName(person);
  return text
    .replace(/\bIs the insured person still alive today\?/, "Is " + (self ? "the person who was diagnosed" : name) + " still alive today?")
    .replace(/\bthe insured person\b/g, self ? "you" : name)
    .replace(/\bthe patient\b/g, self ? "you" : name)
    .replace(/\bthe person\b/g, self ? "you" : name)
    .replace(/\bhas you been\b/g, "have you been").replace(/\bwas you\b/g, "were you");
}

/* ------------------------------------------------------------------------
 * The final response of a claim conversation.
 *
 * After the last question the household gets a direct answer: the benefits
 * that MAY respond, each with its document page, what decides them (the
 * policy definition a reviewer checks, where the category has one), and the
 * documents to send. No estimate -- live chat has no reviewed claim evidence
 * (lib/chat/monetary-boundary.ts) -- no promise, and none of the internal
 * notes the assessment paths used to append.
 * ---------------------------------------------------------------------- */
const FINAL_ANSWERS = new WeakSet<ChatAnswer>();
const ESTIMATE_ANSWERS = new WeakSet<ChatAnswer>();
const EVENT_PHRASE: Record<FactFindingCategory, (facts: SubjectFacts) => string> = {
  accidental_death: (f) => said(f, "causeOfDeath") ? "the death (" + String(said(f, "causeOfDeath")) + ")" : "the death",
  accidental_injury: (f) => {
    const part = known(f, "fractureBodyPart") ?? known(f, "injuryBodyPart");
    return known(f, "injuryKind") === "fracture" || known(f, "fractureBodyPart") != null ? "the broken " + String(part ?? "bone").replace(/^(?:left|right)\s+/i, "") : "the injury";
  },
  critical_illness: (f) => said(f, "diagnosis") ? "the diagnosis of " + String(said(f, "diagnosis")) : "the diagnosis",
  disability_tpd: () => "being unable to work",
  medical_reimbursement: (f) => known(f, "daySurgery") === true ? "the day surgery" : "the hospital stay",
  hospital_cash: (f) => known(f, "daySurgery") === true ? "the day surgery" : "the hospital stay",
  travel: (f) => {
    const kind = String(known(f, "travelEventType") ?? "");
    return (known(f, "flightDelayHours") != null || /delay/i.test(kind)) && !/baggage|luggage/i.test(kind) ? "the flight delay"
      : /baggage|luggage/i.test(kind) && /delay/i.test(kind) ? "the delayed baggage"
      : /^lost baggage$/i.test(kind) ? "the lost baggage"
      : /baggage|luggage/i.test(kind) ? "the lost or damaged baggage"
      : /cut short|curtail/i.test(kind) ? "the trip cut short"
      : /passport|travel documents?/i.test(kind) ? "the lost passport"
      : /medical|sick|ill/i.test(kind) ? "the treatment abroad"
      : /cancel/i.test(kind) ? "the cancelled trip"
      : "what happened on the trip";
  },
};
/** The claim event's name, from what happened -- never from the last reply. */
export function claimEventName(person: Person, facts: SubjectFacts, category: FactFindingCategory | null, fallback: string) {
  const who = calledName(person);
  if (category === "accidental_death") return "Death of " + who + (said(facts, "causeOfDeath") ? " (" + String(said(facts, "causeOfDeath")) + ")" : "");
  if (category) return who + ": " + EVENT_PHRASE[category](facts).replace(/^the /, "");
  // No recognised category: the opening message may name the event, but a
  // reply to an interview question never does ("Has a doctor said ...: No").
  const text = fallback.trim().replace(/\s+/g, " ");
  return text.length > 3 && !looksLikeInterviewReply(text) ? text.slice(0, 120) : who + ": claim check";
}
const ACTIVE_STATUS = /^Active status not recently verified\b/i;
export const DEATH_FIRST_STEPS = "What to do first: get the death certificate and keep the police report number (after an accident the police and coroner are involved). Nothing has to go to an insurer today.";
/** After a death from an illness there is no police report to keep. */
export const DEATH_FIRST_STEPS_ILLNESS = "What to do first: get the death certificate (the hospital issues it, or the family doctor for a death at home). Nothing has to go to an insurer today.";
export function deathFirstSteps(facts: SubjectFacts) { return known(facts, "accidentalDeath") === false ? DEATH_FIRST_STEPS_ILLNESS : DEATH_FIRST_STEPS; }
/** How the chat names the event ("the hospital stay", "the broken wrist"). */
export function claimEventPhrase(category: FactFindingCategory | null, facts: SubjectFacts) { return category ? EVENT_PHRASE[category](facts) : "what happened"; }
/* Which benefit families an event can trigger. Each event type maps only to
 * its own families: a flight delay is travel delay (not trip cancellation,
 * baggage or overseas medical); a diagnosis is critical-illness cover (not a
 * travel policy's overseas medical). Travel cover additionally needs a trip
 * (lib/claims/event-fit.ts). */
const FAMILY = {
  travelDelay: /\b(?:travel|flight|trip|journey|departure)\s+delay|\bdelay(?:ed)?\s+(?:departure|flight)|\bmissed (?:connection|departure)/i,
  baggage: /baggage|luggage|personal belongings|personal effects/i,
  curtailment: /curtail|cut short|shorten|interrupt|early return|return early/i,
  cancellation: /cancel|curtail|postpone|disruption|shorten/i,
  medical: /medical|hospital|evacuat|repatriat|\bdental\b|treatment|covid/i,
  accidentDeath: /accident|death|disablement|dismember/i,
  criticalIllness: /critical|illness|cancer|\bci\b|dread|carcinoma|tumou?r|heart attack|stroke|early[- ]stage|intermediate|major illness|accelerat/i,
  death: /death|life|funeral|bereave|terminal|disablement|dismember|compassionate/i,
  hospital: /hospital|room|board|ward|surg|\bcash\b|daily|icu|intensive|confinement|medical|ambulance|inpatient|outpatient/i,
  notHospital: /\bdeath\b|critical illness|cancer|disab|dismember|loss of|fracture|baggage|luggage|flight|delay|cancel|maturity|surrender/i,
  notInjury: /critical illness|\bcancer\b|maturity|surrender|baggage|luggage|flight delay|travel delay|trip cancel/i,
  travelDocuments: /passport|travel documents?|personal money/i,
};
function travelKind(facts: SubjectFacts): keyof typeof FAMILY | null {
  const kind = String(known(facts, "travelEventType") ?? "").toLowerCase();
  if (/baggage|luggage/.test(kind)) return "baggage";
  if (known(facts, "flightDelayHours") != null || known(facts, "delayHours") != null || /delay/.test(kind)) return "travelDelay";
  if (/curtail|cut short|shorten/.test(kind)) return "curtailment";
  if (/cancel/.test(kind)) return "cancellation";
  if (/passport|travel documents?/.test(kind)) return "travelDocuments";
  if (/medical|hospital|sick|ill/.test(kind)) return "medical";
  if (/accident|death/.test(kind)) return "accidentDeath";
  return null;
}
/** Whether a benefit (by its title) belongs to a family this event can trigger. */
export function benefitFitsEvent(category: FactFindingCategory | null, facts: SubjectFacts, title: string, stillAsking = false) {
  // The benefit's own name: "Person · Product — Benefit" -> "Benefit" (a
  // product called "... Critical Illness" says nothing about its hospital row).
  const afterPerson = title.split(" · ").slice(1).join(" · ") || title;
  const name = afterPerson.includes(" — ") ? afterPerson.split(" — ").slice(1).join(" — ") : afterPerson;
  // An illness is never an accident claim.
  if (known(facts, "eventType") === "illness" && /\baccident/i.test(name)) return false;
  switch (category) {
    case "disability_tpd": return /disab|\btpd\b|total and permanent|income|waiver/i.test(name) && !/\bloss of (?!use)/i.test(name);
    case "accidental_injury": return !FAMILY.notInjury.test(name) && (known(facts, "permanentImpairment") === true || !PERMANENT_LOSS.test(name));
    // An illness with a hospital stay (dengue, admitted) is also a hospital claim.
    // While the facts are still being asked for, a hospital benefit stays a
    // candidate until a stay is ruled out (the stay is what gets asked).
    case "critical_illness": return FAMILY.criticalIllness.test(name) || ((stillAsking ? known(facts, "hospitalised") !== false : known(facts, "hospitalised") === true) && FAMILY.hospital.test(name) && !FAMILY.notHospital.test(name));
    case "accidental_death": return FAMILY.death.test(name);
    case "medical_reimbursement": case "hospital_cash": return !FAMILY.notHospital.test(name);
    case "travel": {
      const kind = travelKind(facts);
      if (!kind) return true;
      if (kind === "travelDelay") return FAMILY.travelDelay.test(name) || (/\bdelay\b/i.test(name) && !FAMILY.baggage.test(name));
      // Being treated abroad for an illness is not an accident claim.
      if (kind === "medical" && /\baccident/i.test(name) && known(facts, "eventType") !== "accident" && known(facts, "injured") !== true) return false;
      // A bag that arrived late is the baggage-delay benefit; a lost bag is the loss benefit.
      // "Lost or damaged baggage" (the card's own option) may be either, so both stay.
      if (kind === "baggage") {
        const said = String(known(facts, "travelEventType") ?? "");
        if (/delay/i.test(said)) return FAMILY.baggage.test(name) && /delay/i.test(name);
        if (/^(?:lost|damaged) baggage$/i.test(said)) return FAMILY.baggage.test(name) && !/delay/i.test(name);
        return FAMILY.baggage.test(name);
      }
      return FAMILY[kind].test(name) && !FAMILY.baggage.test(name);
    }
    default: return true;
  }
}
/** A caveat that sits under several cards is one line for the answer, and
 * "as charged" is explained once. */
export function collapseSharedConditions(answer: Pick<ChatAnswer, "claimItems" | "details">) {
  const shownCards = answer.claimItems.filter((item) => item.status !== "not_applicable");
  if (shownCards.length > 1) {
    const counts = new Map<string, number>();
    for (const item of shownCards) for (const c of new Set(item.conditions)) counts.set(c, (counts.get(c) ?? 0) + 1);
    // What a card's own figure rests on ("Assumes the standard rule …",
    // "Not yet verified …") stays on the card.
    const shared = [...counts].filter(([c, n]) => n > 1 && !/^(?:Still needed:|Assumes the standard|Not yet verified)/.test(c)).map(([c]) => c);
    if (shared.length) {
      for (const item of answer.claimItems) item.conditions = item.conditions.filter((c) => !shared.includes(c));
      for (const c of shared.map(forSeveral)) if (!answer.details.includes(c)) answer.details.push(c);
    }
  }
  // A sentence every card's reason repeats ("Read from your policy wording
  // (page 3) and checked against the page.") is said once.
  if (shownCards.length > 1) {
    const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    const counts = new Map<string, number>();
    for (const item of shownCards) for (const s of new Set(sentencesOf(item.reason))) counts.set(s, (counts.get(s) ?? 0) + 1);
    const shared = [...counts].filter(([s, n]) => n > 1 && s.length >= 25).map(([s]) => s);
    for (const item of shownCards) {
      const rest = sentencesOf(item.reason).filter((s) => !shared.includes(s));
      if (rest.length) item.reason = rest.join(" ");
    }
    const stillShared = shared.filter((s) => shownCards.filter((item) => sentencesOf(item.reason).includes(s)).length > 1);
    const moved = shared.filter((s) => !stillShared.includes(s));
    const line = sharedReasonLine(moved);
    if (line && !answer.details.includes(line)) answer.details.push(line);
  }
  // Round 9: a sentence a card still says is not said again below the cards.
  const onCards = new Set(shownCards.flatMap((item) => String(item.reason ?? "").split(/(?<=[.!?])\s+/).map((x) => x.trim().toLowerCase())));
  answer.details = answer.details.filter((d) => !onCards.has(d.trim().toLowerCase()));
  const asCharged = "“Pays as charged” means the eligible bill is paid after the plan’s deductible and co-insurance.";
  if (shownCards.some((item) => /^Pays as charged\b/.test(item.reason)) && !answer.details.includes(asCharged)) answer.details.push(asCharged);
}
/** The closing caveat of a claim answer, said once. */
export const CLAIM_NOT_A_PROMISE = "This is not a promise of payment: the insurer decides.";
/** The active-status note without the ownership sentence (ownership is not what the claim answer is about). */
export function compactStatus(note: string) {
  return note.replace(/\s*Ownership stays confirmed[^.]*\.(?:[^.]*\bunconfirmed\.)?/, "")
    .replace("DearPolicy has no premium receipt or renewal notice for this policy, so it can’t yet confirm the cover is still being paid for.", "no premium receipt or renewal notice is on file to confirm the cover is still being paid for.").trim();
}
/** How directly a benefit answers the event, for the lead's "most relevant". */
const LEAD_RELEVANCE: Partial<Record<FactFindingCategory, RegExp>> = {
  accidental_death: /\bdeath\b|\blife\b/i, critical_illness: /critical|cancer|illness|\bci\b/i, disability_tpd: /\btpd\b|disab/i,
  accidental_injury: /fracture|medical expenses|accident/i, medical_reimbursement: /room|board|ward|hospital(?!isation (?:treatment|extension))/i, hospital_cash: /cash|daily|per day/i,
  travel: /delay|cancel|baggage|medical/i,
};
function leadRank(category: FactFindingCategory | null, facts: SubjectFacts, item: ClaimItem) {
  const name = item.title.split(" · ").slice(1).join(" · ") || item.title;
  const status = item.status === "likely_applicable" ? 3 : item.status === "potentially_applicable" ? 2 : 1;
  const fits = category && LEAD_RELEVANCE[category]?.test(name) ? 4 : 0;
  const open = item.conditions.some((c) => /^Still needed:/.test(c)) ? 0 : 1;
  void facts;
  return fits + status + open;
}
export function finalizeClaimAnswer(args: { answer: ChatAnswer; state: ConversationState; person: Person | null;
  requestedDocuments: string[]; eventLead?: string }) {
  const { answer, state, person } = args;
  FINAL_ANSWERS.add(answer);
  const facts = person ? state.subjects[person.id] ?? {} : {};
  const category = person ? primaryClaimCategory(state, person.id) : null;
  const eventPhrase = category ? EVENT_PHRASE[category](facts) : "what happened";
  const pages = new Map(answer.citations.map((c) => [c.chunkId, c]));
  const named: string[] = [];
  const statuses = new Set<string>();
  // Only benefits of the kind this event can trigger are named: a stroke
  // that stops someone working is not a fracture or a loss-of-limb claim,
  // and a fracture is not a permanent loss unless one was reported.
  const relevant = (title: string) => benefitFitsEvent(category, facts, title);
  // A benefit ruled out on these facts (a delay below the threshold) keeps
  // its card -- it says why -- but is not named as a possible benefit.
  // A hospital plan's rows for care nobody mentioned (intensive care, a community
  // hospital, a ward for a day case) are not offered for this stay.
  if (category === "medical_reimbursement" || category === "hospital_cash") {
    const said = JSON.stringify(Object.values(facts).map((f) => f?.quote ?? "")).toLowerCase();
    answer.claimItems = answer.claimItems.filter((item) => {
      const name = item.title.toLowerCase();
      if (/intensive care|\bicu\b/.test(name) && known(facts, "icuStay") !== true && !/\bicu\b|intensive care/.test(said)) return false;
      if (/community hospital/.test(name) && !/community hospital/.test(said)) return false;
      if (known(facts, "daySurgery") === true && /room, board|room and board|daily room/.test(name)) return false;
      return true;
    });
  }
  // "Travel delay - maximum per person" is the cap of "Travel delay (for every
  // full 6 hours ...)", not a second benefit: one card, with the cap noted on it.
  {
    const base = (title: string) => (title.split(" · ").slice(1).join(" · ") || title).replace(/^.*? — /, "").replace(/\s*\(.*\)\s*$/, "").replace(/\s+-\s+maximum.*$/i, "").trim().toLowerCase();
    const caps = answer.claimItems.filter((i) => /\s-\s*maximum\b|\bmaximum per (?:person|family|trip)\b/i.test(i.title));
    for (const cap of caps) {
      const main = answer.claimItems.find((i) => i !== cap && !caps.includes(i) && base(i.title) === base(cap.title));
      if (!main) continue;
      const page = cap.reason.match(/\(page (\d+)\)/)?.[1];
      main.conditions = [...new Set([...main.conditions, "The policy also sets a maximum per person for this benefit" + (page ? " (page " + page + ")" : "") + "."])];
      answer.claimItems = answer.claimItems.filter((i) => i !== cap);
    }
  }
  answer.claimItems = answer.claimItems.filter((item) => relevant(item.title)).map((item) => {
    if (item.status === "not_applicable") return item;
    const cited = item.calculationId ? pages.get(item.calculationId.includes(":") ? item.calculationId : "benefit:" + item.calculationId) : undefined;
    const page = cited?.pageStart ?? Number(item.reason.match(/\(page (\d+)\)/)?.[1] ?? NaN);
    const title = item.title.split(" · ").slice(1).join(" · ") || item.title;
    named.push(title);
    // What the benefit pays, in words (no figure before the claim evidence is
    // reviewed) and where it is printed; the caveat that the insurer decides
    // is said once in the summary, not under every card.
    const text = [item.reason, item.amountText ?? "", ...item.conditions].join(" ");
    const pays = /\bas charged\b/i.test(text) ? "Pays as charged"
      : item.calculationKind === "daily" || /per (?:day|night)/i.test(text) ? "Pays a set amount for each day in hospital"
      : item.calculationKind === "expense_cap" || /reimburs|actual cost/i.test(text) || /\bexpenses\b/i.test(title) ? "Reimburses the actual cost, up to the limit in the policy"
      : item.calculationKind === "sum_insured" || /% of the sum insured/i.test(text) ? "Pays a share of the sum insured"
      : item.calculationKind === "fixed" || /lump sum/i.test(text) ? "Pays a set amount"
      : "Listed in the policy";
    // A late-stage-only benefit for an early-stage diagnosis: said on its card.
    const stageNote = /\bearly[- ]stage\b/i.test(String(known(facts, "diagnosis") ?? "")) && /\blate[- ]stage\b/i.test(item.title)
      ? ["This benefit is written for late-stage conditions; an early-stage diagnosis may not meet its definition. The insurer decides."] : [];
    return { ...item,
      // Where the rule is printed stays on the card (V1.1 Task 4).
      reason: pays + (Number.isFinite(page) && page > 0 ? " (page " + page + ")" : "") + ".",
      // DearPolicy's own checking work is said once, plainly -- never as a
      // task for the household ("confirm the heading", "re-read").
      conditions: [...new Set([...stageNote, ...item.conditions]
        // The printed formula, once amounts are hidden, reads as nonsense
        // ("an amount that is only shown after ... per accident"); the card
        // already says it is listed in the policy.
        .filter((c) => !/^The policy states this benefit as\b/i.test(c))
        // Said once for the whole answer, not under every benefit.
        .filter((c) => !(ACTIVE_STATUS.test(c) && statuses.add(c)))
        .map((c) => /Coverage page|Benefits page|second read|heading|double-checked|reader could not|re-?read|re-?index/i.test(c)
        ? "DearPolicy still has to check this benefit’s wording against the policy page." : c))] };
  });
  // Benefits that no event in the conversation touches (an ambulance nobody used) are not named.
  if (known(facts, "ambulanceUsed") === false) answer.claimItems = answer.claimItems.filter((item) => !/ambulance/i.test(item.title));
  const detailsBefore = new Set(answer.details);
  collapseSharedConditions(answer);
  const whose = person ? (/^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s") : "your family’s";
  const event = category ? EVENT_PHRASE[category](facts) : "what happened";
  // Round 13: the lead names the one possible benefit, or with several the most
  // relevant one and how many there are -- every benefit has its own card.
  const shownNow = answer.claimItems.filter((i) => i.status !== "not_applicable");
  const leadName = (item: ClaimItem) => item.title.split(" · ").slice(1).join(" · ") || item.title;
  const ranked = [...shownNow].sort((a, b) => leadRank(category, facts, b) - leadRank(category, facts, a));
  const list = named.length > 1 ? leadName(ranked[0] ?? shownNow[0]) : named[0];
  // Asked again once the interview is over ("How much can she claim?"), the
  // answer says where the claim stands rather than thanking for answers.
  // Nothing was asked when the first message already said it all: no thanks for answers never given.
  const opening = state.claimConcluded ? "Here is where this claim stands. " : state.injuryExplained || state.pending ? "Thanks — that’s what I need for now. " : "";
  state.claimConcluded = true;
  const condolence = category === "accidental_death" && !/sorry for your loss/i.test(args.eventLead ?? "") ? "I’m so sorry for your loss. " : "";
  // A policy whose dates do not cover the event is said out loud, once: the
  // card that says so is not shown as a possible benefit.
  const dateIssues = [...new Set(answer.claimItems.filter((i) => i.status === "not_applicable" && /^Not a possible benefit(?: on the document on file)?: .*(?:cover ended on|cover on file starts on)/.test(i.reason))
    .map((i) => i.reason.replace(/^Not a possible benefit(?: on the document on file)?: /, "").replace(/^./, (c) => c.toUpperCase())))];
  // The single next action: after a death, getting the death certificate (said in the first steps below); otherwise the claim form.
  // A lead that already says what happened ("I’ve noted the reported death of Wei Jie") is not said again.
  const leadSaysEvent = /\bI’ve noted the (?:reported death|diagnosis)\b|\bI’ve noted your diagnosis\b/.test(args.eventLead ?? "");
  const nextAction = category === "accidental_death" ? "" : " Next: send the insurer’s claim form with the documents listed below.";
  answer.summary = condolence + (args.eventLead ? args.eventLead + " " : "") + (named.length
    ? opening + (leadSaysEvent ? whose.replace(/^./, (c) => c.toUpperCase()) : "For " + event + ", " + whose) + " policies have " + (named.length === 1 ? "a possible benefit: " : named.length + " possible benefits — the most relevant is ") + list + ". " +
      CLAIM_NOT_A_PROMISE + nextAction
    : opening + (dateIssues.length ? "None of " + whose + " policies on file can be offered for " + event + ": the cover on file doesn’t include the date it happened. The insurer decides any claim."
      : "None of the benefits in " + whose + " policies on file responds to " + event + " as described. That is based on the documents uploaded; the insurer decides any claim.")).trim();
  // The accidental-death definition decides only a death that may have been an accident.
  const accidentalDefinition = category !== "accidental_death" || known(facts, "accidentalDeath") === true;
  const definitions = category && accidentalDefinition ? FACT_FINDING_SPECS[category].reviewers.map((r) => r.label.replace(/^A reviewer checks/, "A DearPolicy reviewer checks") + ".") : [];
  // Whether the cover is still being paid for is one line for the answer;
  // that ownership itself is not in doubt is the policy table's to say.
  const status = statuses.size ? [compactStatus(statuses.size === 1 ? [...statuses][0]
    : "Active status not recently verified for some of these policies: DearPolicy has no recent premium receipt or renewal notice for them.")] : [];
  // A death: condolence and what to do first come before any policy detail.
  const firstSteps = category === "accidental_death" ? [deathFirstSteps(facts)] : [];
  // "Before you claim": what applies to the whole claim, each said once (the
  // caveats several cards shared were moved here by collapseSharedConditions).
  const notPayable = answer.details.filter((d) => /is not payable on these facts/i.test(d));
  const shared = answer.details.filter((d) => !detailsBefore.has(d) && !notPayable.includes(d) && !/^(?:What to do first|A DearPolicy reviewer checks|Active status not recently verified)/.test(d) && !dateIssues.includes(d));
  answer.details = [...firstSteps, ...dateIssues, ...definitions, ...status, ...notPayable, ...shared].slice(0, 5);
  answer.questions = [];
  delete answer.scenarioClassifications;
  const packStep = answer.nextSteps.find((s) => /claim pack/i.test(s));
  answer.nextSteps = [
    ...(args.requestedDocuments.length ? ["Send these documents for the claim: " + dedupeDocuments(args.requestedDocuments).join("; ") + "."] : []),
    ...(packStep ? [packStep] : []),
  ];
  answer.mode = "claim_assessment";
  delete state.pending;
}

/* ------------------------------------------------------------------------
 * Once the claim's documents have been reviewed and the evidence-gated
 * engine has an indicative estimate (lib/claims/indicative-assessment.ts),
 * the chat's answer about that claim IS that estimate: the same engine
 * output the claim page shows (one source, the same gates), labelled
 * indicative, totals per currency and never added across currencies. It
 * does not fall back to a preliminary assessment, and it does not re-ask
 * for what the reviewed documents already settled.
 * ---------------------------------------------------------------------- */
export function applyIndicativeEstimateAnswer(args: { answer: ChatAnswer; state: ConversationState; person: Person;
  estimate: IndicativeEstimateView; eventLead?: string }) {
  const { answer, state, person, estimate } = args;
  if (!estimate.hasEstimate || !estimate.composition) return false;
  FINAL_ANSWERS.add(answer);
  const facts = state.subjects[person.id] ?? {};
  const category = primaryClaimCategory(state, person.id);
  const event = category ? EVENT_PHRASE[category](facts) : "this claim";
  const whose = /^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s";
  const currencies = estimate.totalsByCurrency.length;
  answer.mode = "claim_assessment";
  answer.composition = estimate.composition;
  // The estimate itself (answer.composition) carries every included benefit
  // with its amount per currency and its page; they are not repeated as
  // cards. Benefits without an amount are said once each, in plain words.
  answer.claimItems = [];
  ESTIMATE_ANSWERS.add(answer);
  delete answer.potentialPayoutTotals;
  delete answer.payoutQualifiers;
  const citations: ChatCitation[] = [];
  for (const policy of estimate.composition.policies) for (const benefit of policy.benefits) for (const ref of benefit.evidenceReferences)
    if (!citations.some((c) => c.chunkId === ref.chunkId && c.pageStart === ref.pageStart))
      citations.push({ chunkId: ref.chunkId, policyId: ref.policyId, policyName: policy.policyLabel, pageStart: ref.pageStart, pageEnd: ref.pageEnd });
  answer.citations = citations;
  const included = estimate.benefits.filter((b) => b.status === "included");
  const page = (b: IndicativeEstimateView["benefits"][number]) => b.citations[0] ? ", wording page " + b.citations[0].pageStart : "";
  const policy = (b: IndicativeEstimateView["benefits"][number]) => b.policyNumber ? ", policy " + b.policyNumber : "";
  const decided = [...new Set(included.map((b) => b.title + (b.currency ? ", " + b.currency + " cover" : "") + policy(b) + page(b) +
    ": a reviewer matched the reviewed medical evidence to this policy’s definition."))];
  // Benefits with no amount are said once, in plain words: every benefit of
  // a cover whose currency the policy doesn't state is ONE line (however many
  // of its rules matched); anything else not yet matched is one line each.
  const withoutAmount = estimate.benefits.filter((b) => b.status !== "included");
  const unstatedByProduct = new Map<string, typeof withoutAmount>();
  const pending = new Set<string>();
  for (const b of withoutAmount) {
    if (b.currencyNotStated) { const key = b.productName ?? b.title; unstatedByProduct.set(key, [...(unstatedByProduct.get(key) ?? []), b]); }
    else pending.add("No amount is shown yet for " + b.title + (b.policyNumber ? " under policy " + b.policyNumber : "") + ": it has not been matched against reviewed evidence.");
  }
  // A cover with an unstated currency: its other unmatched rules are the same cover, not separate benefits.
  const unstatedPolicies = new Set([...unstatedByProduct.values()].flat().map((b) => b.policyNumber).filter(Boolean));
  for (const b of withoutAmount) if (!b.currencyNotStated && b.policyNumber && unstatedPolicies.has(b.policyNumber))
    pending.delete("No amount is shown yet for " + b.title + " under policy " + b.policyNumber + ": it has not been matched against reviewed evidence.");
  const unstated = [...unstatedByProduct.values()].map((group) => {
    const named = group.find((b) => b.citations.length) ?? group[0];
    const number = group.map((b) => b.policyNumber).find(Boolean);
    return "The policy doesn’t state the currency for " + named.title + (number ? " under policy " + number : "") + ", so no amount is shown for it.";
  });
  answer.summary = (args.eventLead ? args.eventLead + " " : "") + "The claim documents reviewed so far give an indicative estimate for " + event +
    " under " + whose + " policies, shown below" + (currencies > 1 ? " per currency (amounts in different currencies are not added together)" : "") + ". " +
    "It is indicative only: the insurer decides eligibility and the final amount.";
  answer.details = [...decided, ...new Set(unstated), ...pending];
  answer.questions = [];
  answer.nextSteps = ["Open this claim on the Claims page to see the reviewed documents and the same indicative estimate."];
  answer.confidence = "strong_match";
  delete answer.scenarioClassifications;
  delete state.pending;
  return true;
}

/** "How much can she claim?", "What can we get for it?", "How much can we
 * claim now?" -- a question about what a claim pays. It belongs to the claim
 * flow (the event's interview, its possible benefits, or its indicative
 * estimate), never to a policy-topic lookup that searches the documents for
 * the question's own words. A what-if ("if she dies") is not one. */
const CLAIM_MONEY_ASK = [
  /\bhow much\b[^.?!]*\b(?:can|could|will|would|should|do|did|am|are|is|may|might)\b[^.?!]*\b(?:claim|get|receive|be paid|get back|recover)\b/i,
  /\bwhat\b[^.?!]*\b(?:can|could|will|would|should|may|might)\s+(?:i|we|she|he|they|you|[a-z][\w'’-]*)\s+(?:claim|get|receive|recover)\b/i,
  /\bhow much is (?:the|her|his|my|our|their) (?:payout|claim)\b/i,
];
export function isClaimMoneyQuestion(text: string) {
  const t = (text ?? "").trim();
  if (!t || /\b(?:if|suppose|supposing|what if|were to|in case)\b/i.test(t)) return false;
  // Round 11: "how much will he get when it matures?" asks what a savings plan prints, not about a claim.
  if (/\b(?:matur\w*|surrender\w*|endowment|fund value|cash value|ilps?|invest-?link\w*|bonus\w*)\b/i.test(t)) return false;
  // "Irfan lost his thumb in an accident, how much can we claim?": the event is in the same message -- that is the claim to start, not a question for one.
  if (reportedEvents(t).length || /\b(?:lost (?:his|her|my|a|an|one|both) \w+|had (?:an? )?(?:angioplasty|operation|surgery|stroke|heart attack)|was (?:admitted|warded|hospitali[sz]ed|diagnosed)|(?:broke|fractured|sprained|injured|hurt) (?:his|her|my|a)\b)/i.test(t)) return false;
  // Round 7 (port): what a plan pays at maturity, what it is worth or what it pays
  // per visit are policy facts, not a claim for an event ("How much will Jun
  // Hao get at maturity?", "How much can I claim for scaling and polishing?").
  if (/\b(?:matur\w*|surrender\w*|cash value|account value|worth|per visit|per year|per day|limit|maximum|max)\b/i.test(t)) return false;
  return CLAIM_MONEY_ASK.some((re) => re.test(t));
}
