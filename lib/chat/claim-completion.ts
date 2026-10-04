/**
 * The last touches on a claim answer, applied to every answer just before it
 * is saved (lib/chat/workflow.ts, saveTurn), and the follow-ups a family asks
 * once the claim interview is over.
 *
 *  - Employer group cover (lib/claims/group-cover.ts) is added to a concluded
 *    claim answer as its own card, with the booklet page and the HR
 *    confirmation in the documents to send.
 *  - "What documents do I need?", "Is it confirmed we will get paid?" and
 *    "How long do I have to submit?" after the claim has concluded are
 *    answered from the claim itself -- never by searching the policies for
 *    the question's own words ("didn't find i send the insurer").
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { applyGroupCover, groupCoverFor, loadGroupBooklets } from "@/lib/claims/group-cover";
import { addRecordedClaimItems, claimFactsFromSubject, recordClaim } from "@/lib/claims/record";
import { requestedDocumentsFor } from "@/lib/claims/status";
import { reportedEvents } from "@/lib/claims/reported-events";
import { claimEventName, claimEventPhrase, primaryClaimCategory } from "./fact-finding-chat";
import type { ChatAnswer } from "@/types";
import { pagesFor } from "./plain-questions";
import { printedRuleLines } from "./printed-rules";
import type { ConversationState, SubjectFacts } from "./types";

const known = (facts: SubjectFacts, key: string) => facts[key]?.state === "known" ? facts[key].value : null;
const EVENT_DATE_KEYS = ["deathDate", "eventDate", "diagnosisDate", "admissionDate", "disabilityDate"];
type Person = { id: string; display_name: string; preferred_name: string | null; relationship: string | null };

async function personOf(accountId: string, personId: string): Promise<Person | null> {
  try {
    return (await query<Person>("SELECT id::text,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND id=$2 AND " + activePredicate(), [accountId, personId])).rows[0] ?? null;
  } catch { return null; }
}
const calledName = (p: Person) => p.preferred_name?.trim() || p.display_name;

/** Whether this answer is the end of a claim interview (or a restatement of it). */
function concludedClaim(state: ConversationState, answer: ChatAnswer) {
  if (state.intent !== "claim" || !answer.resolvedFamilyMemberId) return false;
  if (answer.mode !== "claim_assessment" || answer.details.some((d) => /\bwhat-if\b/i.test(d))) return false;
  return !answer.questions.some((q) => q.id !== "wording-upload");
}

/** What the person's own policies print about pregnancy and childbirth. */
async function maternityWording(accountId: string, personId: string) {
  const rows = (await query<{ policy_id: string; product_name: string | null; page_number: number; text: string }>(
    `SELECT pp.policy_id::text,p.product_name,pp.page_number,pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE pp.account_id=$1 AND ${activePredicate("p")} AND p.personal_coverage_confirmed=true AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2)
      ORDER BY pp.policy_id,pp.page_number`, [accountId, personId])).rows;
  for (const r of rows) for (const line of r.text.split(/\n+/)) {
    const clean = line.replace(/^\s*[-•]\s*/, "").replace(/\s+/g, " ").trim();
    if (/\b(?:pregnan\w*|childbirth|maternity|delivery)\b/i.test(clean) && clean.length < 220)
      return { product: r.product_name ?? "Your policy", page: r.page_number, line: clean.replace(/\.$/, ""), exclusion: /\bexclu/i.test(r.text),
        citation: { chunkId: "page:" + r.policy_id + ":" + r.page_number, policyId: r.policy_id, policyName: r.product_name ?? "Policy", pageStart: r.page_number, pageEnd: r.page_number } };
  }
  return null;
}

export async function completeClaimAnswer(accountId: string, state: ConversationState, answer: ChatAnswer) {
  try {
    if (!concludedClaim(state, answer)) return;
    const personId = answer.resolvedFamilyMemberId!;
    const facts = state.subjects?.[personId] ?? {};
    const category = primaryClaimCategory(state, personId);
    const outpatient = known(facts, "eventType") === "illness" && /^(?:Outpatient or clinic|Emergency department)$/.test(String(known(facts, "treatmentType")));
    if (!category && !outpatient) return;
    if (answer.mode === "claim_assessment" && !answer.questions.length) {
      state.claimConcluded = true;
      // The answer is final: no plan question is offered under it.
      for (const plan of answer.factFinding ?? []) plan.nextQuestions = [];
    }
    try {
      // Which documents the possible benefits come from, for "who do I send it to?" later.
      const offered = answer.claimItems.some((i) => i.status !== "not_applicable");
      const sources = new Set(offered ? answer.citations.map((c) => c.policyId).filter(Boolean) : []);
      state.claimSources = [...sources];
    } catch { /* follow-ups fall back to general wording */ }
    const person = await personOf(accountId, personId);
    if (!person) return;
    // Childbirth: a hospital plan's own wording on pregnancy decides it, not its hospital rows.
    if (known(facts, "maternity") === true) {
      const wording = await maternityWording(accountId, personId);
      const whose = /^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s";
      answer.claimItems = answer.claimItems.map((i) => i.status === "not_applicable" || /maternity|pregnan|childbirth|deliver/i.test(i.title) ? i
        : { ...i, status: "not_applicable" as const, reason: "Written for hospital treatment generally; childbirth is decided by the plan’s pregnancy wording.", conditions: [] });
      answer.summary = "Congratulations on the new baby. Childbirth isn’t among the benefits found in " + whose + " policies on file." +
        (wording ? " " + wording.product + " lists “" + wording.line + "”" + (wording.exclusion ? " among its general exclusions" : "") + " (page " + wording.page + ")." : "") +
        " If there were complications, ask the insurer whether they are on the plan’s list of covered pregnancy complications.";
      answer.details = []; answer.nextSteps = ["Keep the hospital bill and discharge summary in case the insurer asks about complications."];
      if (wording) answer.citations = [wording.citation];
      answer.mode = "claim_assessment"; answer.questions = []; state.claimConcluded = true;
      return;
    }
    // A claim whose event is known but matched nothing ends plainly, for that
    // event -- not with document excerpts or a request that changes nothing.
    const generic = /^(?:Here is what your documents say that relates to this|I couldn’t find a benefit in your documents that matches what you described)/.test(answer.summary.replace(/^I’m (?:so )?sorry[^.]*\.\s*/, ""));
    const ownCards = answer.claimItems.filter((i) => i.status !== "not_applicable");
    if (generic && !ownCards.length) {
      const whose = /^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s";
      const event = outpatient && !category ? (known(facts, "treatmentType") === "Emergency department" ? "an emergency visit for an illness" : "a clinic visit for an illness") : claimEventPhrase(category, facts);
      answer.summary = "I couldn’t find a benefit for " + event + " in " + whose + " policies on file. That is based on the documents uploaded; the insurer decides any claim.";
      answer.details = answer.details.filter((d) => /[.!?]$/.test(d.trim()) && !/\bfictitious\b|^None of the benefits in\b/i.test(d));
      answer.citations = []; state.claimSources = [];
      // Round 11: what the person's own schedule prints about this kind of event ("Outpatient: Not included in this plan").
      try {
        const pages = await pagesFor(accountId, [personId]);
        const byDoc = new Map<string, { page: number; text: string }[]>();
        for (const pg of pages) (byDoc.get(pg.policyId) ?? byDoc.set(pg.policyId, []).get(pg.policyId)!).push({ page: pg.page, text: pg.text });
        const names = new Map(pages.map((pg) => [pg.policyId, pg.product]));
        const asked = event + (outpatient ? " outpatient doctor clinic" : "");
        const printed = printedRuleLines(asked, "", byDoc, (id) => names.get(id) ?? "Your policy", { sameThingOnly: true, limit: 2 });
        if (printed.length) {
          answer.summary = answer.summary.replace(/\.$/, ". Here is what " + whose + " " + (printed.length === 1 ? "policy prints" : "policies print") + " about it:");
          answer.details = [...printed.map((r) => r.text), ...answer.details];
          answer.citations = printed.map((r) => r.citation);
        }
      } catch { /* the plain sentence stands */ }
      const wording = answer.questions.find((q) => q.id === "wording-upload");
      if (wording) {
        answer.questions = [];
        if (state.pending?.id === "wording-upload") delete state.pending;
        answer.nextSteps.push("If you have the policy wording or benefit summary for " + wording.text.replace(/^Do you have the policy wording or benefit summary for /, "").replace(/\?$/, "") + ", upload it on the Documents page and DearPolicy will check it.");
      }
      answer.mode = "claim_assessment"; state.claimConcluded = true;
      for (const plan of answer.factFinding ?? []) plan.nextQuestions = [];
    }
    const booklets = await loadGroupBooklets(accountId, personId);
    if (!booklets.length) return;
    const eventDate = EVENT_DATE_KEYS.map((k) => known(facts, k)).find((v): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v)) ?? null;
    const cover = groupCoverFor({ booklets, person: { id: personId, name: calledName(person) }, category, facts, eventDate });
    if (!cover.cards.length) return;
    const personal = answer.claimItems.filter((i) => i.status !== "not_applicable" && !/^Possible cover through\b/.test(i.title));
    // The answer is now substantive: the wording request becomes a next step.
    const wording = answer.questions.find((q) => q.id === "wording-upload");
    if (wording) {
      answer.questions = [];
      if (state.pending?.id === "wording-upload") delete state.pending;
      const step = "If you have the policy wording or benefit summary for " + wording.text.replace(/^Do you have the policy wording or benefit summary for /, "").replace(/\?$/, "") + ", upload it on the Documents page and ask again.";
      if (!answer.nextSteps.includes(step)) answer.nextSteps.push(step);
    }
    if (!personal.length && !/None of the benefits in |cover on file doesn’t include the date/.test(answer.summary)) {
      const whose = /^self$/i.test(person.relationship ?? "") ? "your own" : calledName(person) + "’s own";
      const event = outpatient && !category ? (known(facts, "treatmentType") === "Emergency department" ? "an emergency visit for an illness" : "a clinic visit for an illness") : claimEventPhrase(category, facts);
      answer.summary = (answer.summary.match(/^(?:I’m (?:so )?sorry[^.]*\.\s*)/)?.[0] ?? "") +
        "None of the benefits in " + whose + " policies on file responds to " + event + " as described. That is based on the documents uploaded; the insurer decides any claim.";
      answer.details = answer.details.filter((d) => !/^None of the benefits in\b/.test(d));
    }
    if (!personal.length) {
      // The group card is the answer: no sources, renewal or wording steps for policies that offered nothing.
      answer.citations = [];
      answer.nextSteps = answer.nextSteps.filter((n) => !/^(?:Upload the latest premium receipt|If you have the policy wording|When you have the policy wording)/.test(n));
    }
    applyGroupCover(answer, cover);
    // The claim on record (the claim pack, the Claims page) shows the group card too:
    // the record was written before the card was added.
    try {
      const groupCards = answer.claimItems.filter((i) => /^Possible cover through\b/.test(i.title));
      const added = !!state.claimSessionId && await addRecordedClaimItems({ accountId, familyMemberId: personId, sessionId: state.claimSessionId, items: groupCards, citations: answer.citations, documents: cover.documents });
      if (!added) {
        const recorded = await recordClaim({ accountId, familyMemberId: personId, existingId: state.claimSessionId ?? null, facts,
          eventSummary: claimEventName(person, facts, category, "What happened"), conversationId: answer.conversationId ?? null, claimCategory: category,
          items: answer.claimItems, citations: answer.citations, knownFacts: [], missingFacts: [], complete: true, nextSteps: cover.documents.map((d) => "Attach: " + d) });
        state.claimSessionId = recorded.id; answer.claimSessionId = recorded.id;
        const step = "Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.";
        if (!answer.nextSteps.includes(step)) answer.nextSteps.push(step);
      }
    } catch { /* The answer stands; the record keeps what it had. */ }
    state.claimSources = [...new Set([...(state.claimSources ?? []), ...cover.citations.map((c) => c.policyId)])];
    if (!answer.confidence) answer.confidence = "partial_match";
  } catch { /* The answer stands without the group card. */ }
}

/* ------------------------------------------------------------------------
 * Follow-ups after the claim interview has concluded.
 * ---------------------------------------------------------------------- */
function eventOf(category: ReturnType<typeof primaryClaimCategory>, facts: SubjectFacts) {
  if (category) return claimEventPhrase(category, facts);
  if (known(facts, "eventType") === "illness" && known(facts, "treatmentType") === "Emergency department") return "the emergency visit";
  if (known(facts, "eventType") === "illness" && known(facts, "treatmentType") === "Outpatient or clinic") return "the clinic visit";
  return "what happened";
}
export type ClaimFollowUp = "documents" | "confirmed" | "deadline" | "next" | "several" | "send" | "amount";
export function claimFollowUpKind(message: string): ClaimFollowUp | null {
  const t = message.trim();
  if (reportedEvents(t).length || /\b(?:died|passed away|admitted|hospitali[sz]ed|broke|diagnosed|fell|injur\w*)\b/i.test(t)) return null;
  if (/\b(?:what|which)\b[^?]{0,40}\b(?:documents?|papers?|send|submit|attach|bring|prepare|keep)\b|\bwhat (?:do|should) i (?:send|submit|give)\b|\bdocuments? (?:do i|i) need\b|\bwhat to (?:send|submit)\b/i.test(t)) return "documents";
  if (/\b(?:confirm(?:ed)?|guarantee\w*|sure|definitely|for sure|100%|will (?:they|the insurer|we|i) (?:pay|get paid)|get paid|approved?)\b/i.test(t) && /\b(?:paid|pay|payout|claim|get|approve\w*|covered)\b/i.test(t)) return "confirmed";
  if (/\bhow much\b[^?]{0,30}\b(?:can|could|will|do|would)\b[^?]{0,20}\b(?:claim|get|receive)\b|^\s*how much (?:can )?claim\b/i.test(t)) return "amount";
  if (/\b(?:more than one|several|two|both|all (?:the|my|our)?\s*)\s*(?:policies|policy|plans?|insurers?)\b|\bclaim (?:from )?(?:both|each|every)\b|\bdouble claim\b/i.test(t)) return "several";
  if (/\b(?:how long|deadline|by when|time limit|when (?:must|should|do) (?:i|we) (?:submit|claim|send|file))\b/i.test(t)) return "deadline";
  if (/\b(?:who do (?:i|we) (?:send|give|submit)|where (?:do|should|can) (?:i|we) (?:send|submit)|send (?:it|them|the forms?) to|call the insurer)\b/i.test(t)) return "send";
  if (/\b(?:anything else|what else|what (?:should|do|must) (?:i|we) do(?: now| next)?|next steps?|what now|what(?:'s| is) next)\b/i.test(t)) return "next";
  return null;
}

/** The answer to a follow-up, from the concluded claim; null when it is not one. */
export async function claimFollowUpAnswer(args: { accountId: string; state: ConversationState; personId: string; message: string }): Promise<Pick<ChatAnswer, "summary" | "details" | "nextSteps" | "citations"> | null> {
  const { state, personId } = args;
  if (state.intent !== "claim" || !state.claimConcluded || state.pending) return null;
  const kind = claimFollowUpKind(args.message);
  if (!kind) return null;
  const facts = state.subjects?.[personId] ?? {};
  const category = primaryClaimCategory(state, personId);
  const person = await personOf(args.accountId, personId);
  if (!person) return null;
  const event = eventOf(category, facts);
  const nothingOffered = !(state.claimSources ?? []).length;
  const documents = requestedDocumentsFor({ facts: claimFactsFromSubject(facts), claim_category: category });
  const booklets = await loadGroupBooklets(args.accountId, personId);
  const eventDate = EVENT_DATE_KEYS.map((k) => known(facts, k)).find((v): v is string => typeof v === "string") ?? null;
  const group = booklets.length ? groupCoverFor({ booklets, person: { id: personId, name: calledName(person) }, category, facts, eventDate }) : null;
  const outpatientVisit = !category && /^(?:Outpatient or clinic|Emergency department)$/.test(String(known(facts, "treatmentType")));
  const allDocuments = [...documents, ...(outpatientVisit && group?.cards.length ? ["The clinic’s receipt and the doctor’s memo or medical certificate"] : []), ...(group?.documents ?? [])];
  const whoseOwn = /^self$/i.test(person.relationship ?? "") ? "your own" : calledName(person) + "’s own";
  if (kind === "amount") return category ? null : {
    summary: group?.cards.length ? "There’s no amount I can work out: " + whoseOwn + " policies have no benefit for " + event + ", and what the group plan pays depends on the employer’s scheme — HR can confirm it."
      : "From the documents on file, I couldn’t find a benefit for " + event + " in " + whoseOwn + " policies, so there is no amount to work out. The insurer can confirm if you want it checked.", details: [], nextSteps: [], citations: [] };
  if (nothingOffered && !group?.cards.length && (kind === "next" || kind === "send" || kind === "confirmed")) return {
    summary: kind === "confirmed" ? "No benefit was found for " + event + " in the documents on file, so DearPolicy can’t point to a payment for it — only the insurer can say for sure."
      : "Nothing is needed right now — no benefit was found for " + event + " in the documents on file, so there’s no claim form to send. If anything changes (a hospital admission, a new diagnosis or a new bill), tell me and I’ll check again.",
    details: [], nextSteps: [], citations: [] };
  if (kind === "documents" && nothingOffered && !group?.cards.length) return {
    summary: "No benefit was found for " + event + " in the documents on file, so there may be nothing to send. If you’d like the insurer to check anyway, send its claim form with the bill and the doctor’s report or memo.",
    details: [], nextSteps: [], citations: [] };
  if (kind === "documents") return {
    summary: allDocuments.length ? "For " + event + ", these are the documents to gather: " + allDocuments.join("; ") + "." : "For " + event + ", the insurer’s claim form and the bills or reports for what happened are the place to start; the insurer will say if it needs more.",
    details: ["Keep the originals; insurers usually accept clear copies or scans first and ask for originals only if they need them."],
    nextSteps: ["Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach."], citations: [] };
  if (kind === "several") return {
    summary: "Usually yes — each policy is claimed separately, with its own form. A benefit that reimburses a bill is coordinated between insurers so the same bill is not paid twice; a benefit that pays a set amount for the event is decided by each policy on its own terms.",
    details: ["Send each insurer copies of the documents and tell them about the other claims; the first insurer’s settlement letter is often asked for by the second."],
    nextSteps: [], citations: [] };
  // Who each claim goes to: the insurer of each document the possible benefits came from.
  let insurers: string[] = [];
  try {
    if (state.claimSources?.length) insurers = (await query<{ product_name: string | null; insurer: string | null; group_doc: boolean }>(
      `SELECT product_name,insurer,(personal_coverage_confirmed=false AND (policy_type ILIKE '%group%' OR product_name ILIKE '%group%')) AS group_doc FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`,
      [args.accountId, state.claimSources])).rows.filter((r) => !r.group_doc && r.insurer && r.product_name).map((r) => r.product_name + " goes to " + r.insurer);
  } catch { insurers = []; }
  const routes = [...new Set(insurers)];
  if (kind === "next") return {
    summary: "Nothing else is needed for DearPolicy right now. Gather the documents, fill in the claim form" + (routes.length > 1 || group?.cards.length ? "s" : "") + " and submit " + (routes.length > 1 || group?.cards.length ? "them" : "it") + "." +
      " If anything changes — a new bill, a doctor’s report, or a date you weren’t sure of — tell me and I’ll update the claim.",
    details: [], nextSteps: ["Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach."], citations: [] };
  if (kind === "send" && !routes.length && group?.cards.length) return {
    summary: "The possible cover here is the group plan, so start with HR at " + group.cards.map((c) => c.title.replace(/^Possible cover through /, "")).join(" and ") + " — they submit group claims to the insurer and will tell you which form to use.",
    details: allDocuments.length ? ["Documents to attach: " + allDocuments.join("; ") + "."] : [], nextSteps: [], citations: [] };
  if (kind === "send") return {
    summary: (routes.length ? "The claim " + (routes.length === 1 ? "under " + routes[0] : "under " + routes.slice(0, -1).join(", ") + " and " + routes.at(-1)) + ": fill in the insurer’s claim form (on its website or app, or through your agent), attach the documents and submit it."
      : "From here, the claim goes to the insurer: fill in its claim form (on its website or app, or from your agent), attach the documents, and submit it.") + (group?.cards.length ? " For the group cover, start with HR — they submit group claims to the insurer." : ""),
    details: allDocuments.length ? ["Documents to attach: " + allDocuments.join("; ") + "."] : [],
    nextSteps: ["Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach."], citations: [] };
  if (kind === "confirmed") return {
    summary: "Not yet — nothing is confirmed until the insurer has assessed the claim. DearPolicy can show which benefits may apply to " + event + " and what to send, but only the insurer decides whether it pays and how much.",
    details: ["Sending complete documents early is the best way to avoid delays; the insurer may ask follow-up questions or for more reports."],
    nextSteps: allDocuments.length ? ["Send these documents for the claim: " + allDocuments.join("; ") + "."] : [], citations: [] };
  // Deadline: what the person's own documents print about when to claim.
  try {
    const rows = (await query<{ policy_id: string; product_name: string | null; page_number: number; text: string }>(
      `SELECT pp.policy_id::text,p.product_name,pp.page_number,pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
        WHERE pp.account_id=$1 AND ${activePredicate("p")} AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2)`, [args.accountId, personId])).rows;
    const found: { line: string; citation: ChatAnswer["citations"][number] }[] = [];
    // Headings ("6. Claims", "SECTION 4 - HOW TO CLAIM") are not part of the sentence quoted.
    const prose = (text: string) => text.split(/\n+/).filter((line) => !(line.trim().length < 45 && !/[.;:]$/.test(line.trim()) && /^(?:\d+\.\s*)?[A-Z]/.test(line.trim()) && (line === line.toUpperCase() || line.trim().split(/\s+/).length <= 4))).join(" ").replace(/\s+/g, " ");
    for (const r of rows) for (const sentence of prose(r.text).split(/(?<=[.])\s+/)) {
      if (/\b(?:claims?|notif\w*|submit\w*)\b[^.]{0,90}\bwithin \d+ days\b/i.test(sentence) && found.length < 3 && !found.some((f) => f.line === sentence))
        found.push({ line: (r.product_name ?? "Your policy") + ": “" + sentence.trim() + "” (page " + r.page_number + ").", citation: { chunkId: "page:" + r.policy_id + ":" + r.page_number, policyId: r.policy_id, policyName: r.product_name ?? "Policy", pageStart: r.page_number, pageEnd: r.page_number } });
    }
    if (found.length) return { summary: "Here is what " + (/^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s") + " documents say about when to claim. Claiming early is safest.", details: found.map((f) => f.line), nextSteps: [], citations: found.map((f) => f.citation) };
  } catch { /* fall through */ }
  return { summary: "I couldn’t find a claim deadline printed in " + (/^self$/i.test(person.relationship ?? "") ? "your" : calledName(person) + "’s") + " documents. Most insurers ask to be told as soon as reasonably possible, so it is safest to start the claim now; the insurer can confirm any time limit.", details: [], nextSteps: [], citations: [] };
}

/** Damage at home or to a car, for someone with no home or motor policy on
 * file: said plainly, without running a hospital interview for it. */
export async function propertyClaimReply(args: { accountId: string; person: { id: string; display_name: string; preferred_name: string | null; relationship: string | null }; message: string }) {
  const event = reportedEvents(args.message).find((e) => e.kind === "property" || e.kind === "motor");
  if (!event) return null;
  const motor = event.kind === "motor";
  let held: { product_name: string | null; policy_type: string | null }[] = [];
  try {
    held = (await query<{ product_name: string | null; policy_type: string | null }>(
      `SELECT p.product_name,p.policy_type FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")}
         AND (p.family_member_id=$2 OR EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2))`, [args.accountId, args.person.id])).rows;
  } catch { return null; }
  const kind = motor ? /motor|car|vehicle/i : /home|house|contents|fire|property|household/i;
  if (held.some((p) => kind.test((p.policy_type ?? "") + " " + (p.product_name ?? "")))) return null;
  const self = /^self$/i.test(args.person.relationship ?? "");
  const whose = self ? "your" : (args.person.preferred_name?.trim() || args.person.display_name) + "’s";
  const names = [...new Set(held.map((p) => p.product_name).filter((n): n is string => !!n))];
  return { property: event.kind as "property" | "motor",
    summary: "I couldn’t find a " + (motor ? "motor (car) insurance" : "home insurance") + " policy among " + whose + " documents, so there is nothing on file to check this against." +
      (names.length ? " The policies on file (" + names.join(", ") + ") are for people, not " + (motor ? "vehicles" : "property") + "." : ""),
    details: [motor ? "A car claim goes to the car’s own insurer (or the other driver’s insurer if they were at fault). Report the accident to your insurer within 24 hours, and keep photos and the other party’s details."
      : "If there is home or fire insurance (sometimes arranged with a home loan, or by the condo management for the building), its insurer is the one to claim from. Take photos of the damage and keep repair quotes and receipts."],
    nextSteps: ["If you have a " + (motor ? "motor" : "home") + " policy, upload it on the Documents page and ask again."],
  };
}

/** A person whose only documents could not be read (password-protected):
 * "I don't know the password", "what should I do now?" get an answer of
 * their own instead of the same locked-document sentence again. */
export async function lockedDocumentsReply(args: { accountId: string; person: { id: string; display_name: string; preferred_name: string | null; relationship: string | null }; state: ConversationState; message: string }) {
  let counts: { ready: number; locked: number; file: string | null } = { ready: 0, locked: 0, file: null };
  try {
    const row = (await query<{ ready: string; locked: string; file: string | null }>(
      `SELECT count(*) FILTER (WHERE p.processing_status='ready')::text AS ready,count(*) FILTER (WHERE p.processing_error ILIKE '%password%')::text AS locked,
              max(p.original_filename) FILTER (WHERE p.processing_error ILIKE '%password%') AS file
         FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")}
          AND (p.family_member_id=$2 OR EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2))`, [args.accountId, args.person.id])).rows[0];
    counts = { ready: Number(row?.ready ?? 0), locked: Number(row?.locked ?? 0), file: row?.file ?? null };
  } catch { return null; }
  if (counts.ready || !counts.locked) return null;
  const name = args.person.preferred_name?.trim() || args.person.display_name;
  const died = known(args.state.subjects?.[args.person.id] ?? {}, "death") === true;
  const t = args.message.trim();
  if (/\bpassword\b/i.test(t)) return { summary: "Insurers usually say what the password is in the email or letter the statement came with — often an ID number or a date of birth in a set format. If it can’t be found, the insurer can send an unlocked copy. Once it’s uploaded, I’ll read it straight away.", details: [], nextSteps: ["Upload the unlocked copy of “" + counts.file + "” on the Documents page."] };
  if (/\b(?:can (?:i|we|she|he) (?:claim|get)|claim anything|anything to claim)\b/i.test(t)) return { summary: "I can’t tell yet — the only document on file for " + name + ", “" + counts.file + "”, is locked with a password. Keep the bills and the discharge summary; once an unlocked copy is uploaded, I’ll check what it covers for this.", details: [], nextSteps: [] };
  if (/\b(?:bill|cost|how much|expensive|afford)\b/i.test(t)) return { summary: "I can’t estimate the bill. The hospital’s financial counsellor can give an estimate, and for Singapore citizens and PRs MediShield Life and MediSave usually help with hospital bills.", details: [], nextSteps: [] };
  if (/\b(?:nursing home|long[- ]term care|caregiver|care home|eldercare|disab\w*)\b/i.test(t)) return { summary: "If " + name + " needs long-term care later, a long-term care scheme such as CareShield Life or ElderShield may help — the locked file’s name suggests an ElderShield statement, and once it’s unlocked I can check what it says.", details: [], nextSteps: [] };
  if (/\b(?:is|now|still)\s+(?:in|at)\b|\bwarded\b|\badmitted\b/i.test(t)) return { summary: "Noted, thank you. Keep the hospital bills and the discharge summary — once the locked statement is uploaded unlocked, I’ll check it against this stay.", details: [], nextSteps: [] };
  if (/\b(?:what (?:should|do|can) (?:i|we) (?:do|keep)|what now|what next|anything else|next steps?|who should i call|call first)\b/i.test(t)) return died
    ? { summary: "For now, the most important thing is the death certificate — the hospital or the family doctor issues it. Then contact " + name + "’s insurers (or agent): they will say what to send, and nothing has to be done today.", details: ["When you can, upload an unlocked copy of “" + counts.file + "” and I’ll check what it covers."], nextSteps: [] }
    : { summary: "Keep the bills, the discharge summary and any doctor’s reports, and contact " + name + "’s insurer or agent to start the claim. When you can, upload an unlocked copy of “" + counts.file + "” and I’ll check what it covers.", details: [], nextSteps: [] };
  if (/\b(?:medishield|medisave|careshield|eldershield|integrated shield|hospital plan|insurance|polic(?:y|ies)|cover)\b/i.test(t)) return { summary: "I can only read what’s uploaded for " + name + ", and the one document on file, “" + counts.file + "”, is locked with a password. If " + name + " had other plans (for example MediShield Life through CPF, or a hospital plan with an insurer), the insurer or CPF Board can confirm them.", details: [], nextSteps: ["Upload an unlocked copy of “" + counts.file + "” on the Documents page."] };
  return null;
}

/** Questions after a home or car claim with no home or motor policy on file. */
export function propertyFollowUp(kind: "property" | "motor", message: string) {
  const t = message.trim();
  if (/^(?:ok(?:ay)?|thanks?|thank you|noted|alright|got it)\b[\s!.,]*(?:thanks?|thank you)?[\s!.]*$/i.test(t)) return null;
  const say = (summary: string, details: string[] = []) => ({ summary, details, nextSteps: [] as string[] });
  if (/\b(?:hurt|injur\w*)\b/i.test(t) && !/\b(?:no ?one|nobody|not)\b/i.test(t)) return say("If someone was hurt, tell me who it was and what happened, and I’ll check their own policies for the injury.");
  if (/\b(?:shield|hospital plan|travel|company|group|work)\b/i.test(t)) return say("Those policies cover people — hospital stays, trips abroad or cover through work — not " + (kind === "motor" ? "cars" : "homes or belongings") + ", so they won’t pay for this damage.");
  if (kind === "motor") {
    if (/\bpolice\b|drove off|hit and run|hit-and-run/i.test(t)) return say("Yes — for a hit-and-run, make a police report as soon as you can, and note anything you saw (plate number, time, nearby cameras). The police report helps the insurer too.");
    if (/\bhow long|deadline|when (?:must|should|do)|report\b/i.test(t)) return say("Motor insurers in Singapore generally expect an accident to be reported within 24 hours or by the next working day, even if you don’t end up claiming — the car’s insurer can confirm.");
    if (/\b(?:no one|nobody) (?:was )?(?:injured|hurt)\b|just the car/i.test(t)) return say("Thanks — with nobody hurt, it’s a claim on the car’s own insurance (or the other driver’s, if they were at fault). Photos of the damage and the other party’s details will help.");
    if (/\bphoto|picture|video|evidence\b/i.test(t)) return say("Take photos of the damage up close and from further back, of where the car was parked, and of anything that shows the other car; keep the repair quote and any carpark camera details.");
    if (/\b(?:claim|insurer|insurance|workshop|repair)\b/i.test(t)) return say("For damage to the car, the car’s own insurer (or the other driver’s, if they were at fault) is the place to claim. If you upload the motor policy, I can check it.");
    return null;
  }
  if (/\bcondo|mcst|management|building\b/i.test(t)) return say("A condo’s management (MCST) usually insures the building and common areas, not your own renovations or belongings — the managing agent can share what its policy covers.");
  if (/\bneighbou?r\b/i.test(t)) return say("Damage to a neighbour’s unit is usually sorted out between the two owners, and a home policy with personal liability cover can help. If the leak came from a common pipe, tell the managing agent.");
  if (/\bphoto|picture|video|evidence\b/i.test(t)) return say("Take photos and videos of the damage before cleaning up, of where the water came from, and of damaged items; keep the repair quotes and receipts.");
  if (/\bplumber|fix|repair|first\b/i.test(t)) return say("Stop the damage first — turn off the water and get it repaired. Keep the plumber’s report and invoice, since insurers usually ask what caused it.");
  if (/\bwater damage|usually|normally|claimable\b/i.test(t)) return say("Many home policies cover sudden water damage, such as a burst pipe, but not gradual leaks or wear and tear — the policy’s own wording decides.");
  if (/\bcontents?|belongings|furniture|appliances?\b/i.test(t)) return say("Belongings are covered only by a home contents policy. I couldn’t find one among your documents — if you have one, upload it and I’ll check it.");
  return null;
}
