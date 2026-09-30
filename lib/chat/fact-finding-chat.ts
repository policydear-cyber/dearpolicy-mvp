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
import { describesAScenario } from "@/lib/policies/benefit-catalog";
import { query } from "@/lib/db/client";
import { dedupeDocuments } from "@/lib/claims/claim-pack";
import { looksLikeInterviewReply } from "@/lib/claims/event-name";
import type { CoverCondition } from "@/lib/insurance/cover-conditions";
import type { ChatAnswer, ChatCitation } from "@/types";
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
    return rows.rows.map((r) => r.benefit_name);
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
  if (known(facts, "eventType") === "travel_disruption" || known(facts, "flightDelayHours") != null) signals.add("travel");
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
    const plan = planFactFinding({ subjectId: person.id, category, facts: state.subjects[person.id] ?? {} });
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
  answer.details = firstTurn && next.category === "accidental_death" ? [DEATH_FIRST_STEPS] : [];
  answer.questions = [{ id: next.question.id, type: next.question.type, text: next.question.text, why: next.question.why, options: questionOptions(next.question) }];
  state.pending = { ...answer.questions[0], subjectId: next.subjectId, factKey: next.question.factKey };
  answer.confidence = "partial_match";
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
  medical_reimbursement: () => "the hospital stay", hospital_cash: () => "the hospital stay",
  travel: (f) => known(f, "flightDelayHours") != null || /delay/i.test(String(known(f, "travelEventType") ?? "")) ? "the flight delay" : "what happened on the trip",
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
export const DEATH_FIRST_STEPS = "What to do first: get the death certificate (for a death in hospital the hospital issues it; after an accident the police and coroner are involved) and keep the police report number. Nothing needs to be sent to an insurer today; the documents below can follow when you are ready.";
/* Which benefit families an event can trigger. Each event type maps only to
 * its own families: a flight delay is travel delay (not trip cancellation,
 * baggage or overseas medical); a diagnosis is critical-illness cover (not a
 * travel policy's overseas medical). Travel cover additionally needs a trip
 * (lib/claims/event-fit.ts). */
const FAMILY = {
  travelDelay: /\b(?:travel|flight|trip|journey|departure)\s+delay|\bdelay(?:ed)?\s+(?:departure|flight)|\bmissed (?:connection|departure)/i,
  baggage: /baggage|luggage|personal belongings|personal effects/i,
  cancellation: /cancel|curtail|postpone|disruption|shorten/i,
  medical: /medical|hospital|evacuat|repatriat|dental|treatment|covid/i,
  accidentDeath: /accident|death|disablement|dismember/i,
  criticalIllness: /critical|illness|cancer|\bci\b|dread|carcinoma|tumou?r|heart attack|stroke|early[- ]stage|intermediate|major illness|accelerat/i,
  death: /death|life|funeral|bereave|terminal|disablement|dismember|compassionate/i,
  hospital: /hospital|room|board|ward|surg|\bcash\b|daily|icu|intensive|confinement|medical|ambulance|inpatient|outpatient/i,
  notHospital: /\bdeath\b|critical illness|cancer|disab|dismember|loss of|fracture|baggage|luggage|flight|delay|cancel|maturity|surrender/i,
  notInjury: /critical illness|\bcancer\b|maturity|surrender|baggage|luggage|flight delay|travel delay|trip cancel/i,
};
function travelKind(facts: SubjectFacts): keyof typeof FAMILY | null {
  const kind = String(known(facts, "travelEventType") ?? "").toLowerCase();
  if (known(facts, "flightDelayHours") != null || known(facts, "delayHours") != null || /delay/.test(kind)) return "travelDelay";
  if (/baggage|luggage/.test(kind)) return "baggage";
  if (/cancel|curtail/.test(kind)) return "cancellation";
  if (/medical|hospital|sick|ill/.test(kind)) return "medical";
  if (/accident|death/.test(kind)) return "accidentDeath";
  return null;
}
/** Whether a benefit (by its title) belongs to a family this event can trigger. */
export function benefitFitsEvent(category: FactFindingCategory | null, facts: SubjectFacts, title: string) {
  // The benefit's own name: "Person · Product — Benefit" -> "Benefit" (a
  // product called "... Critical Illness" says nothing about its hospital row).
  const afterPerson = title.split(" · ").slice(1).join(" · ") || title;
  const name = afterPerson.includes(" — ") ? afterPerson.split(" — ").slice(1).join(" — ") : afterPerson;
  switch (category) {
    case "disability_tpd": return /disab|\btpd\b|total and permanent|income|waiver/i.test(name) && !/\bloss of (?!use)/i.test(name);
    case "accidental_injury": return !FAMILY.notInjury.test(name) && (known(facts, "permanentImpairment") === true || !PERMANENT_LOSS.test(name));
    // An illness with a hospital stay (dengue, admitted) is also a hospital claim.
    case "critical_illness": return FAMILY.criticalIllness.test(name) || (known(facts, "hospitalised") === true && FAMILY.hospital.test(name) && !FAMILY.notHospital.test(name));
    case "accidental_death": return FAMILY.death.test(name);
    case "medical_reimbursement": case "hospital_cash": return !FAMILY.notHospital.test(name);
    case "travel": {
      const kind = travelKind(facts);
      if (!kind) return true;
      if (kind === "travelDelay") return FAMILY.travelDelay.test(name) || (/\bdelay\b/i.test(name) && !FAMILY.baggage.test(name));
      return FAMILY[kind].test(name) && (kind === "baggage" || !FAMILY.baggage.test(name));
    }
    default: return true;
  }
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
  answer.claimItems = answer.claimItems.filter((item) => relevant(item.title)).map((item) => {
    if (item.status === "not_applicable") return item;
    const cited = item.calculationId ? pages.get(item.calculationId.includes(":") ? item.calculationId : "benefit:" + item.calculationId) : undefined;
    const page = cited?.pageStart ?? Number(item.reason.match(/\(page (\d+)\)/)?.[1] ?? NaN);
    const title = item.title.split(" · ").slice(1).join(" · ") || item.title;
    named.push(title + (Number.isFinite(page) && page > 0 ? " (page " + page + ")" : ""));
    return { ...item,
      reason: "Listed in the policy" + (Number.isFinite(page) && page > 0 ? " on page " + page : "") + ". It may respond to " + eventPhrase +
        "; whether it pays depends on the claim documents and the insurer’s assessment.",
      // DearPolicy's own checking work is said once, plainly -- never as a
      // task for the household ("confirm the heading", "re-read").
      conditions: [...new Set(item.conditions
        // The printed formula, once amounts are hidden, reads as nonsense
        // ("an amount that is only shown after ... per accident"); the card
        // already says it is listed in the policy.
        .filter((c) => !/^The policy states this benefit as\b/i.test(c))
        // Said once for the whole answer, not under every benefit.
        .filter((c) => !(ACTIVE_STATUS.test(c) && statuses.add(c)))
        .map((c) => /Coverage page|Benefits page|second read|heading|double-checked|reader could not|re-?read|re-?index/i.test(c)
        ? "DearPolicy still has to check this benefit’s wording against the policy page." : c))] };
  });
  const whose = person ? (/^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s") : "your family’s";
  const event = category ? EVENT_PHRASE[category](facts) : "what happened";
  const list = named.length > 1 ? named.slice(0, -1).join(", ") + " and " + named[named.length - 1] : named[0];
  // Asked again once the interview is over ("How much can she claim?"), the
  // answer says where the claim stands rather than thanking for answers.
  const opening = state.claimConcluded ? "Here is where this claim stands." : "Thanks — that’s what I need for now.";
  state.claimConcluded = true;
  const condolence = category === "accidental_death" && !/sorry for your loss/i.test(args.eventLead ?? "") ? "I’m so sorry for your loss. " : "";
  answer.summary = condolence + (args.eventLead ? args.eventLead + " " : "") + (named.length
    ? opening + " For " + event + ", " + whose + " policies have " + (named.length === 1 ? "a possible benefit: " : "possible benefits: ") + list + ". " +
      "This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed."
    : opening + " None of the benefits in " + whose + " policies on file responds to " + event + " as described. That is based on the documents uploaded; the insurer decides any claim.");
  const definitions = category ? FACT_FINDING_SPECS[category].reviewers.map((r) => r.label.replace(/^A reviewer checks/, "A DearPolicy reviewer checks") + ".") : [];
  // Whether the cover is still being paid for is one line for the answer.
  const status = statuses.size ? [statuses.size === 1 ? [...statuses][0]
    : "Active status not recently verified for some of these policies: DearPolicy has no recent premium receipt or renewal notice for them. Ownership stays confirmed by the personalised evidence."] : [];
  // A death: condolence and what to do first come before any policy detail.
  const firstSteps = category === "accidental_death" ? [DEATH_FIRST_STEPS] : [];
  answer.details = [...firstSteps, ...definitions, ...status, ...answer.details.filter((d) => /is not payable on these facts/i.test(d))].slice(0, 3);
  answer.questions = [];
  delete answer.scenarioClassifications;
  const packStep = answer.nextSteps.find((s) => /claim pack/i.test(s));
  answer.nextSteps = [
    ...(args.requestedDocuments.length ? ["Send these documents for the claim: " + args.requestedDocuments.join("; ") + "."] : []),
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
  return CLAIM_MONEY_ASK.some((re) => re.test(t));
}
