/**
 * Conversational RAG (Prompt 2): turns the model's final_answer into the visible answer's sentences with their
 * per-sentence FigureBindings (lib/rag2/evidence.ts toFigureBinding) and ComputationRecords (from compute), ready for
 * the existing save-time gate (lib/chat/answer-verification.ts verifyAnswerFigures, run inside saveTurn).
 *
 * Deterministic, and conservative: a sentence is kept only when everything it states can be tied to evidence a tool
 * returned this conversation. A sentence citing evidence no tool returned, a figure printed in none of its cited
 * evidence, an estimate not from a compute result (or from a household figure that is no longer the recorded one) is
 * dropped here -- with an honest note -- before the gate ever sees it. Nothing is added: no figure is ever written by
 * this code, only bound.
 */
import type { BoundFigure, CalculationRecord, ComputationOperand, ComputationRecord, FigureBinding, FigurePeriod } from "@/types";
import { calcOutcomes } from "../calc/tool";
import { dayRuleFromWording } from "@/lib/claims/day-count";
import type { CalcOutcome } from "../calc/engine";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { STATES_REMOVAL_LIMITATION } from "@/lib/claims/person";
import { benefitWords, namesBenefit, printedPeriodsOf } from "@/lib/chat/assertions";
import { evidenceKey, toFigureBinding, type EvidenceRef } from "../evidence";
import { parseTables } from "../tables";
import type { ComputeOk, TableValueOperand } from "../compute";
import type { ToolContext } from "../tools";
import type { RagLoopState } from "./types";
import { CAUSE_KEYS, confirmed, contentWords, EVENT_KEY, factConcept, numbersIn } from "./facts";
import { checkCitedStatement, instructionLines, internalIdsIn, payoutOrDecision, stripInternalIds, unsafeNextStep, withoutInstructions, withoutNegatedDecisions, PAYOUT as PAYOUT_WORDS } from "./statements";

export type ComputeCall = { operation: string; operands: Record<string, unknown>[] };
export type ComposedSentence = { text: string; evidenceIds: string[]; estimate: boolean; factKeys: string[]; kind?: "printed" | "conditional_illustration" | "indicative_estimate" | "requirement";
  /** Agent P: the position of the model's sentence this came from (final_answer order). */
  at?: number;
  /** Agent P: for a requirement, the fact concepts it asks the household for (admission, discharge, bill, ...). */
  asks?: string[];
  /** Agent P: the condition clause appended to a printed benefit whose conditions are not established. */
  condition?: string;
  /** Round 7: the table-value ids the sentence cites, and the benefit as the model named it (a passage figure's label). */
  valueIds?: string[]; benefit?: string | null };
export type Composed = {
  sentences: ComposedSentence[]; nextSteps: string[];
  figureBindings: BoundFigure[]; computations: ComputationRecord[];
  /** Agent K: benefit calculations bound to the sentences that state them (re-run by the save-time gate). */
  calculations: CalculationRecord[];
  /** Agent K: the calculate outcomes the answer used (for the claim record, only in a claim scenario). */
  calcs: (CalcOutcome & { purpose?: string })[];
  dropped: { sentence: string; reason: string }[];
  /** Agent F (D24): what the household is told about what was left out and why (specific, figure-free). */
  notes: string[];
  evidenceIds: string[]; subjectId: string | null;
};
/** Agent P: what the household is told when NOTHING of the answer could be kept and no requirement or caveat applies
 * (accurate for every verification failure: the answer could not be confirmed from their documents). Never shown
 * beside kept sentences. */
export const DROPPED_NOTE = "I couldn’t confirm an answer to that from your documents.";
/** Agent P: user-facing caveats (facts about insurance, never commentary on what was removed). The payout / decision /
 * sum caveats are shown whenever the model tried to state such a thing, because the household may have asked it. */
export const PAYOUT_NOTE = "Only the insurer decides whether an amount is paid, owed or claimable, after it reviews the claim.";
export const DECISION_NOTE = "Only the insurer makes a decision on the claim, after reviewing it and its evidence.";
export const SUM_NOTE = "Printed limits added together aren’t an amount the insurer would pay.";
/** Agent P: shown only when nothing else can be said (accurate to the rejection reason). */
export const INSTRUCTION_NOTE = "Some text in your document reads as an instruction rather than policy wording, so I haven’t treated it as part of your policy.";
export const CALC_NOTE = "I couldn’t check that figure against the policy’s own calculation, so I haven’t given one.";
export const INCOMPLETE_NOTE = "This may not be everything your documents say about it.";
/** Round 7: what still remains once the household has told us a fact a benefit's condition turns on -- their report is
 * not a reviewed record, the insurer checks the documents and decides -- and the practical next step. Medical wording
 * when the condition is medical (a doctor's diagnosis or certification, an X-ray / MRI / scan). Figure-free; never a
 * decision, a payment or an entitlement. */
export const REPORTED_MEDICAL_NOTE = "What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor’s report and the test or scan results) and decides the claim after reviewing them.";
export const REPORTED_NOTE = "What you’ve told me is your own account: the insurer will check it against the documents it asks for and decides the claim after reviewing them.";
export const REPORTED_MEDICAL_STEP = "When you make the claim, include the doctor’s report and the test or scan results that show the policy’s condition is met, with the insurer’s claim form.";
export const REPORTED_STEP = "When you make the claim, include the documents that show the policy’s condition is met, with the insurer’s claim form.";
const MEDICAL_CONDITION = /\b(?:medical practitioner|doctor|physician|specialist|x-?rays?|mri|scans?|ultrasound|diagnos\w*|certif\w*|medical report)\b/i;
export function reportedFactFollowUp(conditionTexts: string[]): { note: string; step: string } {
  const medical = conditionTexts.some((t) => MEDICAL_CONDITION.test(t));
  return medical ? { note: REPORTED_MEDICAL_NOTE, step: REPORTED_MEDICAL_STEP } : { note: REPORTED_NOTE, step: REPORTED_STEP };
}
/** Round 7: the household's own words for a fact, said back as theirs (\"You told me ...\") -- null when nothing is left. */
export function sayBack(words: string): string | null {
  let w = String(words ?? "").replace(/\s+/g, " ").trim().replace(/^(?:yes|yeah|yep|yup|no|nope)\b[,.!]?\s*/i, "").replace(/[.!;,\s]+$/, "");
  if (!w) return null;
  if (/^(?:i|i['’]m|i['’]ve|we|we['’]re|my|our|me|us)\b/i.test(w)) return `You told me: “${w}”.`;
  if (/^(?:The|A|An|He|She|They|It|This|That|There|Her|His|Their|Both|Yes|No)\b/.test(w)) w = w[0].toLowerCase() + w.slice(1);
  // V1.2: a bare phrase ("Transverse fracture") is quoted, not run into the sentence.
  else if (/^[A-Z]/.test(w) && !/\b(?:is|was|were|are|had|has|have|broke|fell|got|went|did)\b/i.test(w)) return `You told me: “${w}”.`;
  return `You told me ${w}.`;
}

/** Internal markers (trace / categorisation only; never shown to the household). */
export const UNSUPPORTED_NOTE = "unsupported";
export const STEP_NOTE = "step";
export const UNRESOLVED_NOTE = "unresolved";
export const MISSING_FACT_NOTE = "missing_fact";
/** True when two texts share a content word (stemmed). */
const sharesWords = (a: string, b: string) => { const x = new Set(contentWords(a)); return contentWords(b).some((w) => x.has(w)); };
/** A clause's own label for a figure: the model's label only when the line that prints the figure carries it. */
function passageLabel(passage: string, value: number, wanted: string, sentence = ""): string {
  const want = contentWords(wanted);
  const lines = withoutInstructions(passage).split(/\n+/).filter((l) => numbersIn(l).some((n) => same(n, value)));
  // V1.2: a clause that prints its benefit's name before the figure ("Accident Hospital Income: S$100 for each ...")
  // names the figure itself: when the sentence names that benefit, the line's own label is the benefit -- never the
  // model's -- and a sentence that names another benefit is not bound.
  if (!want.length) {
    const said = new Set(contentWords(sentence));
    for (const l of lines) {
      const label = /^\s*([A-Za-z][A-Za-z ()'’/-]{2,60}?)\s*:\s/.exec(l)?.[1]?.trim() ?? "";
      const words = contentWords(label);
      if (words.length && words.length <= 8 && words.every((w) => said.has(w))) return label;
    }
    return "";
  }
  return lines.some((l) => { const have = new Set(contentWords(l)); return want.every((w) => have.has(w)); }) ? wanted.trim() : "";
}

/** Statements that need evidence even without a figure. */
/** A sentence that says the household's documents are silent on something (round 9). */
const NOT_STATED = /^(?:(?:the|your)\s+)?(?:uploaded\s+)?(?:policy\s+)?documents?\s+(?:you(?:['’]ve| have) uploaded\s+)?(?:do(?:es)?(?:n['’]t| not))\s+(?:say|state|mention|cover the question of|address)\b|^(?:i\s+)?(?:couldn['’]t|could not|can['’]t|cannot)\s+find\s+anything\s+(?:in|about)\b|\bis\s+not\s+(?:stated|mentioned)\s+(?:anywhere\s+)?in\s+(?:the|your)\s+(?:uploaded\s+)?documents\b/i;
/** V1.1: the wider ways a reply says a document is silent, or that a version is no longer read -- "the schedule does
 * not state how many visits", "none of your documents mentions dental", "Cai is not listed", "the 2022 certificate
 * was replaced". Kept without a citation only when it states no amount and no cover verdict, and (for a person said
 * not to be listed) only when the document it names was read and does not name them. */
const ABSENCE = /\b(?:do(?:es)?n['’]t|do(?:es)? not)\s+(?:say|state|show|mention|list|name|specify|include|set out|print)\b|\b(?:is|are)\s+not\s+(?:stated|mentioned|listed|named|shown|specified|printed)\b|\b(?:isn['’]t|aren['’]t)\s+(?:stated|mentioned|listed|named|shown|specified|printed)\b|\bnone of (?:your|the|our)\b[^.]*\bmentions?\b|\b(?:has been|have been|was|were)\s+(?:replaced|superseded)\b|\bnot (?:stated|listed|named|shown|mentioned) (?:in|on|anywhere)\b|\b(?:is|are)\s+not\s+(?:in|among)\s+(?:your|the)\s+(?:uploaded\s+)?(?:documents|library|files)\b|\b(?:isn['’]t|aren['’]t)\s+(?:in|among)\s+(?:your|the)\s+(?:uploaded\s+)?(?:documents|library|files)\b/i;
/** Digits that are an amount, count or rate -- not a year, a date or a policy number ("HL-TL-3302", "2022"). */
const amountDigits = (t: string) => /\d/.test(t.replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[A-Za-z0-9][\w-]*\b/g, " ").replace(/\b(?:19|20)\d\d\b/g, " ").replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/gi, " "));
const SAYS_NOT_LISTED = /\b(?:is|are)\s+not\s+(?:listed|named|insured|included|shown)\b|\b(?:isn['’]t|aren['’]t)\s+(?:listed|named|insured|included|shown)\b|\bnot (?:listed|named|insured|included)\b|\bonly (?:names|lists)\b/i;
/** Why an uncited absence sentence is contradicted by, or not grounded in, what was read (null when it stands). */
/** The documents an absence sentence names (by product name, or enough of its distinctive words). */
function namedDocs(text: string, ctx: Ctx): string[] {
  const lowerText = text.toLowerCase();
  return [...(ctx.policyNames ?? new Map<string, string>())].filter(([, n]) => { const words = contentWords(n).filter((w) => w.length >= 4 && !/^(?:polic|plan|schedul|certificat|document|wording|scanned)/.test(w)); const hits = words.filter((w) => lowerText.includes(w)); return words.length > 0 && hits.length >= Math.min(2, words.length); }).map(([id]) => id);
}
/** Why an uncited absence sentence is contradicted by, or not grounded in, what was read (null when it stands), and
 * the read evidence of the documents it names (cited with it, so the household sees which document was checked). */
/** V1.1 (grounded negatives): words that say what is absent, not which thing -- left out of the topic check. */
const ABSENCE_FILLER = new Set(["uploaded", "document", "documents", "schedule", "certificate", "wording", "policy", "policies", "plan", "plans", "insurance", "cover", "covers", "covered", "coverage", "benefit", "benefits", "state", "states", "stated", "say", "says", "show", "shows", "shown", "mention", "mentions", "mentioned", "list", "lists", "listed", "name", "names", "named", "specify", "include", "print", "how", "many", "much", "when", "whether", "which", "what", "who", "any", "your", "their", "our", "his", "her", "its", "the", "that", "this", "these", "those", "there", "does", "not", "none", "only", "also", "can", "could", "would", "will", "full", "contract", "claim", "claims", "each", "per", "for", "with", "from", "about", "into", "under", "itself", "too"]);
/** The household's library text, by document (all stored pages of every readable document), when loaded. */
function libraryDoc(ctx: Ctx, id: string): string | null { return ctx.libraryText?.get(id) ?? null; }
/** V1.2: the product heading a roster row sits under -- the nearest single-cell, figure-free line above it in the stored
 * document (the save-time gate reads the same heading the same way). Null when none is printed. */
export function rosterHeading(ref: EvidenceRef, ctx: Pick<Ctx, "libraryText">): string | null {
  const text = ctx.libraryText?.get(ref.policyId) ?? null;
  if (!text) return null;
  const sq = (x: string) => x.replace(/\s+/g, " ").trim();
  const lines = text.split(/\n/);
  const row = sq(ref.passage.text.split(/\n/).find((l) => /\d/.test(l) && (!ref.table?.rowPerson?.text || l.includes(ref.table.rowPerson.text))) ?? ref.passage.text);
  const at = lines.findIndex((l) => sq(l).includes(row.slice(0, 60)));
  for (let i = at - 1; i >= 0 && i >= at - 40; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    const cells = l.split(/\t+| {3,}/).filter(Boolean);
    if (cells.length === 1 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\s?\d/.test(l) && l.length <= 80 && !/[.:]$/.test(l)) return l;
    if (cells.length >= 2 && !/\d/.test(l)) return null;
  }
  return null;
}
/** V1.3: a label as the household reads it -- the policy number and other parenthetical detail of a heading left out. */
const tidyLabel = (l: string) => l.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").replace(/^[\d.]+\s+/, "").trim();
/** A line's own label ("Daily Hospital Income: S$150 for ...") or, failing that, the heading it is printed under on its
 * stored page (a certificate roster's product heading). */
function lineLabel(policyId: string, line: string, ctx: Pick<Ctx, "libraryText">): string | null {
  const own = /^\s*([A-Za-z][A-Za-z ()'’/-]{2,60}?)\s*:\s/.exec(line)?.[1]?.trim();
  if (own) return own;
  // A table row's own first cell names it ("Daily hospital cash   S$150"), unless it is an identifier (a masked ID).
  const first = line.trim().split(/\t+| {3,}/)[0] ?? "";
  if (first && first !== line.trim() && !/\d/.test(first) && benefitWords(first).size > 0) return first;
  return rosterHeading({ policyId, passage: { text: line, start: 0, end: line.length, onPage: 0 }, page: { start: 0, end: 0 }, documentHash: null } as EvidenceRef, ctx);
}
/** Every label a document prints: its headings and its "Label:" lines. */
function documentLabels(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\n/)) {
    const l = raw.trim(); if (!l) continue;
    const own = /^\s*([A-Za-z][A-Za-z ()'’/-]{2,60}?)\s*:\s/.exec(l)?.[1]?.trim();
    if (own) { out.add(tidyLabel(own)); continue; }
    const cells = l.split(/\t+| {3,}/).filter(Boolean);
    if (cells.length === 1 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\s?\d/.test(l) && l.length <= 80 && !/[.:,]$/.test(l)) out.add(tidyLabel(l));
  }
  return [...out].filter((x) => benefitWords(x).size > 0);
}
const wordScore = (clause: string, label: string) => { const have = new Set(contentWords(clause)); return [...benefitWords(label)].filter((w) => have.has(w)).length; };
/**
 * V1.3: the benefit a passage figure is bound to by the source's own identity -- the label of the line printing it (its
 * "Label:" or the heading it is printed under) -- never by the model reproducing that label word for word. The
 * clause stating the figure must name that benefit (one distinctive word, as the save-time gate requires) and must not
 * name another benefit the same document prints more closely ("your Personal Accident cover is S$400,000" when
 * S$400,000 is printed under Group Term Life is refused). Several lines printing the figure under different labels: the
 * one the clause names; none or a tie: not bound.
 */
function identityLabel(ref: EvidenceRef, value: number, currency: string, clause: string, ctx: Pick<Ctx, "libraryText">): { label: string } | { conflict: string } | null {
  const all = withoutInstructions(evidenceTextOf(ref)).split(/\n+/).filter((l) => numbersIn(l).some((n) => same(n, value)));
  // The amount as printed: in the currency the sentence states it in, never another one.
  const lines = all.filter((l) => moneyFiguresIn(l).some((m) => same(m.value, value) && m.currency === currency));
  if (all.length && !lines.length) return { conflict: `printed in another currency than the sentence states` };
  // A row printing several amounts (one per column, person or tier) is bound by its column, not by its label.
  if (lines.some((l) => moneyFiguresIn(l).length > 1)) return null;
  const labels = [...new Set(lines.map((l) => lineLabel(ref.policyId, l, ctx)).filter((x): x is string => !!x).map(tidyLabel).filter((x) => benefitWords(x).size > 0))];
  if (!labels.length) return null;
  const named = labels.filter((l) => namesBenefit(clause, l));
  const pick = labels.length === 1 ? labels[0] : named.length === 1 ? named[0] : null;
  if (!pick) return null;
  const others = documentLabels(ctx.libraryText?.get(ref.policyId) ?? evidenceTextOf(ref)).filter((o) => o.toLowerCase() !== pick.toLowerCase() && !labels.some((l) => l.toLowerCase() === o.toLowerCase()));
  const better = others.filter((o) => wordScore(clause, o) > wordScore(clause, pick)).sort((a, b) => wordScore(clause, b) - wordScore(clause, a))[0];
  if (!namesBenefit(clause, pick)) return better ? { conflict: `printed under “${pick}”, but the sentence states it for “${better}”` } : null;
  if (better) return { conflict: `printed under “${pick}”, but the sentence states it for “${better}”` };
  return { label: pick };
}
/** V1.3: a sentence whose figure could not be verified, cut into parts that can each be checked on their own: its
 * clauses at "; ", or -- for one clause -- the part before the comma-delimited phrase stating that figure (the
 * document, insurer, person and date facts). Null when no self-standing part remains. */
function verifiableParts(text: string, failedRaw: string | null): string[] | null {
  const tidy = (x: string) => { const t = x.trim().replace(/[,;:\s]+$/, ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };
  const enough = (x: string) => (x.match(/[A-Za-z]{2,}/g) ?? []).length >= 4;
  if (/;\s+/.test(text)) { const parts = text.split(/;\s+/).map(tidy).filter(enough); return parts.length >= 2 ? parts : null; }
  if (!failedRaw) return null;
  const segs = text.split(/,\s+/);
  const at = segs.findIndex((x) => x.includes(failedRaw));
  if (at <= 0) return null;
  const head = tidy(segs.slice(0, at).join(", "));
  return enough(head) && !/\b(?:if|unless|when|provided|subject to)\b/i.test(segs.slice(at).join(" ")) ? [head] : null;
}
/** Whether one line of `text` carries every topic word (each word, or a word starting with its first 5 letters). */
function lineCarries(text: string, words: string[]): boolean {
  return text.split(/\n+/).some((line) => { const have = contentWords(line); return words.every((w) => have.includes(w) || new RegExp("\\b" + w.replace(/[^a-z0-9]/g, ""), "i").test(line) || have.some((h) => h.length >= 5 && w.length >= 5 && h.slice(0, 5) === w.slice(0, 5))); });
}
/** Why an uncited absence sentence is not grounded in the household's library (null when it is), and the evidence of
 * the documents it names (cited with it, so the household sees which document was checked). A negative is checked
 * against the FULL stored text of the documents it names (or of the whole library for "none of your documents"),
 * never against a retrieved passage alone. */
function absenceCheck(text: string, ctx: Ctx): { problem: string | null; evidenceIds: string[] } {
  const docs = namedDocs(text, ctx);
  const read = Object.values(ctx.state.evidence).filter((e) => docs.includes(e.policyId) && !ctx.stale?.has(e.id));
  const evidenceIds = docs.flatMap((d) => { const r = read.filter((e) => e.policyId === d); return r.length ? [r[r.length - 1].id] : []; });
  if (/\b(?:has been|have been|was|were)\s+(?:replaced|superseded)\b/i.test(text) && !SAYS_NOT_LISTED.test(text) && !/\b(?:do(?:es)?n['’]t|do(?:es)? not)\s+(?:say|state|show|mention|list|name|specify|include|print)\b|\bnone of\b/i.test(text)) return { problem: null, evidenceIds };
  // A missing source ("the FamilyShield policy wording is not in your uploaded documents"): no readable document is
  // that source -- its distinctive words and its kind (wording / schedule / certificate / endorsement) in one name.
  const missing = /^(.*?)\b(?:is|are)\s+not\s+(?:in|among)\s+(?:your|the)\s+(?:uploaded\s+)?(?:documents|library|files)\b|^(.*?)\b(?:isn['’]t|aren['’]t)\s+(?:in|among)\s+(?:your|the)\s+(?:uploaded\s+)?(?:documents|library|files)\b/i.exec(text);
  if (missing) {
    if (!ctx.libraryText) return { problem: "says a document is missing, but the library was not checked", evidenceIds };
    const subject = (missing[1] ?? missing[2] ?? "").toLowerCase();
    const kind = /\bwording\b/.test(subject) ? /wording/i : /\bschedule\b/.test(subject) ? /schedule/i : /\bcertificate\b/.test(subject) ? /certificate/i : /\bendorsement\b/.test(subject) ? /endorsement/i : null;
    const distinct = contentWords(subject).filter((w) => w.length >= 4 && !ABSENCE_FILLER.has(w));
    const present = [...ctx.libraryText.keys()].some((id) => { const n = (ctx.policyNames?.get(id) ?? "").toLowerCase(); return (!kind || kind.test(n)) && distinct.length > 0 && distinct.every((w) => n.includes(w.slice(0, 5))); });
    return { problem: present ? "says a document is missing, but the library holds it" : null, evidenceIds: [] };
  }
  if (!ctx.libraryText) return { problem: "says something is absent, but the library was not checked", evidenceIds };
  // "none of your documents ..." / "the uploaded documents don't ..." are about the whole library.
  const whole = /\bnone of (?:your|the|our)\b|^(?:the|your)\s+(?:uploaded\s+)?(?:policy\s+)?documents?\b|\b(?:your|the)\s+uploaded\s+documents\s+(?:do(?:es)?n['’]t|do(?:es)? not)\b/i.test(text);
  if (!whole && !docs.length) return { problem: "says something is absent without naming the document it was checked against", evidenceIds };
  // The documents it names when it names any; otherwise ("none of your documents") the whole library.
  const scope = (docs.length ? docs : [...ctx.libraryText.keys()]).map((id) => libraryDoc(ctx, id) ?? "");
  if (scope.some((t) => !t.trim())) return { problem: "says something is absent from a document whose text is not stored", evidenceIds };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = (t: string, n: string) => n.length >= 3 && new RegExp("\\b" + esc(n) + "\\b", "i").test(t);
  // A person said not to be listed / named / insured: no page of the named documents names them.
  if (SAYS_NOT_LISTED.test(text)) {
    const named = (ctx.people ?? []).filter((p) => p.names.some((n) => mentions(text, n)));
    const negated = named.filter((p) => { const at = Math.min(...p.names.filter((n) => mentions(text, n)).map((n) => text.search(new RegExp("\\b" + esc(n) + "\\b", "i")))); const after = text.slice(at).split(/[;,.]|\b(?:and|but|so)\b/i)[0]; return SAYS_NOT_LISTED.test(after) && !/\bonly (?:names|lists)\b/i.test(after); });
    for (const p of negated) if (scope.some((t) => p.names.some((n) => mentions(t, n)))) return { problem: `says ${p.names[0]} is not listed, but the document names them`, evidenceIds };
  }
  // A topic said not to be stated / mentioned: no single line of the scoped documents carries all of its words.
  const m = /\b(?:do(?:es)?n['’]t|do(?:es)? not)\s+(?:say|state|show|mention|list|name|specify|include|set out|print)\b(.*)|\bnone of (?:your|the|our)\b[^.]*?\bmentions?\b(.*)|\b(?:is|are)\s+not\s+(?:stated|mentioned|shown|specified|printed)\b|\b(?:isn['’]t|aren['’]t)\s+(?:stated|mentioned|shown|specified|printed)\b/i.exec(text);
  if (m) {
    const clause = (m[1] ?? m[2] ?? text.slice(0, m.index)).split(/[;.]|\b(?:so|but)\b/i)[0];
    const people = new Set((ctx.people ?? []).flatMap((p) => p.names.flatMap((n) => contentWords(n))));
    const product = new Set(docs.flatMap((id) => contentWords(ctx.policyNames?.get(id) ?? "")));
    const words = [...new Set(contentWords(clause))].filter((w) => w.length >= 3 && !ABSENCE_FILLER.has(w) && !people.has(w) && !product.has(w) && !/^\d/.test(w));
    if (!words.length) return { problem: "says something is absent without saying what", evidenceIds };
    if (scope.some((t) => lineCarries(t, words))) return { problem: `says the documents do not state it, but a stored line mentions ${words.join(", ")}`, evidenceIds };
  }
  return { problem: null, evidenceIds };
}
/** Whether a sentence is an absence statement (the loop loads the library text before composing one). */
export const mentionsAbsence = (t: string) => ABSENCE.test(t);
/** A verdict on cover (never allowed without its clause). */
const COVER_VERDICT = /\b(?:is|are|was|were|isn['’]t|aren['’]t)\s+(?:not\s+)?(?:covered|excluded|payable|insured)\b|\bexclud\w*\b|\bnot covered\b|\bwill (?:not )?(?:pay|be paid)\b/i;
const COVERISH = /\b(?:cover\w*|insur\w*|pays?|payable|benefits?|limits?|capped|maximum|excluded|exclusions?|not covered|eligib\w*|claim\w*|deductible|co-?insurance|sum assured|premiums?|waiting period|days?|nights?)\b/i;
/** Agent F (D2): the full payout wording (statements.ts) -- will reimburse, gets back, can claim, owes you, ... */
const PAYOUT = PAYOUT_WORDS;
const FIG_PERIOD: Record<string, FigurePeriod> = { day: "day", night: "day", week: "week", month: "month", quarter: "quarter", half_year: "half_year", year: "year", policy_year: "year", event: "event", lifetime: "lifetime" };
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The id under which `ref` was registered in the loop's evidence table (registered on the fly if it was not). */
export function evidenceIdOf(state: RagLoopState, ref: EvidenceRef, via = "compose"): string {
  const key = evidenceKey(ref);
  for (const e of Object.values(state.evidence)) if (evidenceKey(e) === key) return e.id;
  const id = "e" + (Object.keys(state.evidence).length + 1);
  state.evidence[id] = { ...ref, id, via };
  return id;
}

function gateOperand(o: TableValueOperand, subjectId: string): ComputationOperand | null {
  if (o.valueKind !== "money" || o.cents == null || !o.currency) return null;
  const value = o.cents / 100;
  const binding = toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, wordedBenefit(o.benefit, evidenceTextOf(o.evidence), o.evidence.table?.cell?.text), value, o.currency);
  if (!binding) return null;
  const printed = printedPeriodsOf(value, o.currency, o.evidence.passage.text).find((p) => p != null) ?? null;
  return { value, currency: o.currency, period: printed ? (FIG_PERIOD[printed] ?? (printed as FigurePeriod)) : (o.period ? FIG_PERIOD[o.period] ?? null : null), role: "benefit", binding };
}

type Ctx = {
  state: RagLoopState; tools: ToolContext; computeCalls: Map<string, ComputeCall>; householdIds: Set<string>; userText: string;
  /** Every household message of this conversation (earlier user turns + this one); defaults to [userText]. */
  userTexts?: string[];
  /** Household members' names (a sentence saying back what the household said may name the person). */
  names?: string[];
  /** Agent F (D6): evidence ids that can no longer be used (document deleted, replaced, or not this household's),
   * with the household-facing reason. Re-checked every turn by the loop. */
  stale?: Map<string, string>;
  /** Agent F (D7): household members (id + the names a sentence may use) and readable documents (id -> product). */
  people?: { id: string; names: string[] }[];
  policyNames?: Map<string, string>;
  /** V1.1: what each readable document states on its face (product, insurer, numbers, amendment role). */
  docFacts?: Map<string, string>;
  /** V1.1: every readable document's full stored text (all pages), loaded when the answer states an absence. */
  libraryText?: Map<string, string>;
};

const sq = (t: string) => t.toLowerCase().normalize("NFKC").replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/^["']+|["'.,!?;:]+$/g, "").trim();
/** The household's words for a figure match a recorded fact's quoted words (one contains the other). */
const wordsMatch = (attribution: string, factWords: string) => { const a = sq(attribution), w = sq(factWords); return a.length >= 2 && w.length >= 2 && (w.includes(a) || a.includes(w)); };

/** Integration (agent C's request 2): a sentence that only says back what the household told us -- it begins with an
 * attribution ("You said / told me / mentioned ..."), every number and content word in it comes from the household's
 * own messages (names of household members and relation words aside), and it states no cover, benefit, limit, payment
 * or approval. Such a sentence needs no document citation and is never a cover statement. */
const ATTRIBUTED_START = /^(?:you(?:['’]ve| have)? (?:said|told (?:me|us)|mentioned|wrote|reported|let me know)|as you (?:said|mentioned|told me))\b[\s,:]*(?:that\s+)?/i;
const NEVER_SAID_BACK = /\b(?:cover\w*|insur\w*|pays?|paid|payable|pay-?outs?|benefits?|limits?|capped|maximum|excluded|exclusions?|eligib\w*|claimable|entitle\w*|reimburs\w*|deductible|co-?insurance|sum assured|premiums?|approv\w*|confirm\w*|guarantee\w*|qualif\w*|accept\w*|will (?:get|receive))\b/i;
const RELATION_WORDS = new Set(["son", "daughter", "child", "children", "kid", "wife", "husband", "spouse", "partner", "mother", "father", "mum", "mom", "dad", "stepson", "stepdaughter", "brother", "sister", "told", "said", "mentioned", "you", "your", "she", "her", "him", "his", "they", "them"].map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
function saidBackOnly(text: string, ctx: Ctx): boolean {
  const m = text.match(ATTRIBUTED_START); if (!m) return false;
  if (sentencesOf(text).length !== 1) return false;
  const rest = text.slice(m[0].length);
  if (!rest.trim() || NEVER_SAID_BACK.test(rest) || PAYOUT.test(rest)) return false;
  const said = (ctx.userTexts?.length ? ctx.userTexts : [ctx.userText]).join("\n");
  const saidNums = new Set(numbersIn(said));
  if (!numbersIn(rest).every((n) => saidNums.has(n))) return false;
  if (moneyFiguresIn(rest).some((f) => !moneyFiguresIn(said).some((u) => same(u.value, f.value) && u.currency === f.currency))) return false;
  // V1.1: one stem for a word and its inflections ("fracture" said back for "fractured").
  const stem = (w: string) => w.replace(/(?:ing|ed|es|e|s)$/, "");
  const saidWords = new Set(contentWords(said).map(stem));
  const nameWords = new Set((ctx.names ?? []).flatMap((n) => contentWords(n)));
  return contentWords(rest).every((w) => saidWords.has(stem(w)) || nameWords.has(w) || RELATION_WORDS.has(w));
}

/** Round 7 (A3): words that claim cover, a payment or an amount the policy sets (these always need evidence). */
const COVER_CLAIM = /\b(?:covers?|covered|coverage|insures?|insured for|pays?|paid|payable|pay-?outs?|benefits?|limits?|capped|maximum|max\b|excluded|exclusions?|eligib\w*|entitle\w*|claimable|deductible|co-?insurance|sum assured|premiums?|reimburs\w*|waiting period|approved|guarantee\w*|refund\w*)\b/i;
/** A sentence explaining that something cannot be worked out yet, or what is needed and why. */
const EXPLAINS_NEED = /\b(?:can(?:no|['’])t|cannot|unable to|not able to|couldn['’]t|could not)\s+(?:yet\s+)?(?:determine|work out|calculate|tell|confirm|say|estimate|count|know)\b|\b(?:I|we)\s+(?:still\s+|also\s+|first\s+)?need\b|\bto work (?:it|this|that|the \w+) out\b|\bdepends on\b|\bwithout (?:the|your|his|her|their|those|these)\b|\bbefore I can\b/i;
/** Round 7 (A3): an uncited sentence that explains why a fact is needed, mentioning only the household's own numbers
 * (\"I can't determine the amount from 'exactly 3 days' alone because ... counts from the admission and discharge
 * times\"): no money figure, no number the household did not give, and no cover / payment / amount claim. */
function explainsNeedOnly(text: string, ctx: Ctx): boolean {
  if (!EXPLAINS_NEED.test(text) || moneyFiguresIn(text).length || COVER_CLAIM.test(text) || payoutOrDecision(text)) return false;
  const said = (ctx.userTexts?.length ? ctx.userTexts : [ctx.userText]).join("\n");
  const saidNums = new Set(numbersIn(said));
  return numbersIn(text).every((n) => saidNums.has(n));
}

/** Round 7 (A3): a table row's benefit as printed: its row label, or -- when that label is only an item code ("A",
 * "B", "5") -- the longest worded cell of the row (the benefit's name), so a figure is bound to the benefit the
 * sentence names. */
export function wordedBenefit(label: string, rowText: string, cellText?: string | null): string {
  if ((String(label ?? "").match(/[A-Za-z]{3,}/g) ?? []).length >= 1 && String(label).trim().length > 3) return String(label).trim();
  const line = rowText.split("\n").find((l) => (cellText && l.includes(cellText)) || (l.split(/\t+| {2,}/)[0] ?? "").trim() === String(label ?? "").trim()) ?? rowText;
  const worded = line.split(/\t+| {2,}/).map((c) => c.trim()).filter((c) => c !== cellText && (c.match(/[A-Za-z]{3,}/g) ?? []).length >= 2 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\s?\d/.test(c)).sort((a, b) => b.length - a.length);
  return worded[0] ?? String(label ?? "").trim();
}
/**
 * Round 7 (A3): everything an evidence entry carries for reading its figures and wording -- the passage, the exact
 * supporting span, the context it needs (the table's header row, a continued header, a footnote; the whole row for a
 * selected cell, as lib/rag2/evidence.ts provides it), the row label and the selected cell. Shared EvidenceRef shape.
 */
export function evidenceTextOf(ref: EvidenceRef): string {
  const parts = [ref.passage?.text, ref.support?.text, ...(ref.context ?? []).map((c) => c.text), ref.table?.rowLabel, ref.table?.cell?.text];
  return [...new Set(parts.filter((x): x is string => typeof x === "string" && !!x.trim()))].join("\n");
}
/** A gate record for an indicative per-day / multiple estimate: a printed per-period amount times a whole count the
 * household gave (after any printed day cap). The gate recomputes it and checks the sentence states the count. */
function estimateRecord(result: ComputeOk, call: ComputeCall | undefined, ctx: Ctx, subjectId: string): { record: Omit<ComputationRecord, "sentence">; operand: ComputationOperand } | null {
  if (!call || (call.operation !== "per_day" && call.operation !== "product")) return null;
  const [moneyArg, countArg, capArg] = call.operands;
  const money = typeof moneyArg?.value_id === "string" ? ctx.tools.values.get(moneyArg.value_id)?.operand : null;
  if (!money) return null;
  const countOf = (a: Record<string, unknown> | undefined): number | null => {
    if (!a) return null;
    if (typeof a.value_id === "string") { const v = ctx.tools.values.get(a.value_id)?.operand; return v?.valueKind === "count" ? v.count ?? null : null; }
    const h = a.household as Record<string, unknown> | undefined;
    return h && typeof h.count === "number" ? h.count : null;
  };
  const n = countOf(countArg); if (n == null) return null;
  const cap = capArg ? countOf(capArg) : null; if (capArg && cap == null) return null;
  const used = cap != null ? Math.min(n, cap) : n;
  if (!(used >= 2 && used <= 100)) return null;
  const op = gateOperand(money, subjectId); if (!op) return null;
  if (!same(op.value * used, result.amount)) return null;
  return { operand: op, record: { result: { value: result.amount, currency: result.currency }, operation: "product", operands: [op], factor: used, period: op.period, currency: result.currency, rounding: { mode: "half_up", precision: 2 }, scope: "person" } };
}

/** Which recorded claim facts a computation's household figures are, or why one is not (missing / since corrected).
 * Integration (agent C's request 1): only a confirmed fact (stated by the household, not a paraphrase) whose value is
 * the figure AND whose quoted words the figure's attribution comes from -- never any fact that happens to share the
 * number. (The loop already refuses such a compute call before it runs; this is defence in depth.) */
function householdInputs(result: ComputeOk, ctx: Ctx): { keys: string[]; problem: string | null } {
  const facts = ctx.state.claim?.facts ?? {};
  const keys: string[] = [];
  for (const h of result.householdFigures) {
    const want = h.count != null ? h.count : h.cents != null ? h.cents / 100 : h.ppm != null ? h.ppm / 10000 : null;
    const hit = want == null ? undefined : Object.entries(facts).find(([, f]) => confirmed(f) && numbersIn(String(f.value)).some((n) => same(n, want)) && wordsMatch(h.attribution ?? "", f.words));
    if (!hit) return { keys, problem: `the estimate uses ${h.label} = ${want}, which is not a fact the household has given (or it has since been corrected, or the words it is attributed to are not the ones recorded for it)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}

/** Round 8 (F1): the reason a sentence claiming a printed date is absent is left out (the loop's gate repair keys on it). */
export const DATE_ABSENCE_REASON = "says a date is not stated or confirmed";
const DATE_WORD = String.raw`(?:effective|start|starting|commencement|end|expiry|renewal)?\s*dates?`;
const NOT_GIVEN = String.raw`(?:(?:is|are|was|were)\s+)?(?:not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|never|nowhere)\s+(?:been\s+)?(?:clearly\s+)?(?:stated|confirmed|printed|given|shown|specified|mentioned|listed|known|clear)`;
/** "the effective date is not confirmed", "its start date isn't stated anywhere", "no date is given for ...". */
export function dateAbsenceClaim(text: string): boolean {
  return new RegExp(String.raw`\b${DATE_WORD}\b[^.;]{0,40}?\b${NOT_GIVEN}\b`, "i").test(text)
    || new RegExp(String.raw`\b(?:no|without an?|without any)\s+${DATE_WORD}\b[^.;]{0,20}\b(?:is|was|are)?\s*(?:stated|given|printed|shown|specified|confirmed)\b`, "i").test(text)
    || new RegExp(String.raw`\bnot (?:confirmed|stated|printed|specified) when\b[^.;]{0,40}\b(?:starts?|applies|takes effect|begins?)\b`, "i").test(text);
}
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
/** The first calendar date printed in a text ("1 July 2026", "July 1, 2026", "2026-07-01", "01/07/2026"), or null. */
export function printedDateIn(text: string): string | null {
  const m = new RegExp(String.raw`\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\.?,?\s+\d{4}|(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b`, "i").exec(text);
  return m ? m[0] : null;
}
/** Round 8b: a figure-free sentence saying an amendment document was removed (so the current amount may differ) stays
 * in the same paragraph as the figure sentence right after it, which it qualifies -- shown together, and checked by
 * the save-time gate as that figure's limitation. */
export function keepLimitationWithFigure(body: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const s = body[i], next = body[i + 1];
    if (next != null && STATES_REMOVAL_LIMITATION.test(s) && !moneyFiguresIn(s).length && moneyFiguresIn(next).length) { out.push(s + " " + next); i++; continue; }
    out.push(s);
  }
  return out;
}

/** The column of the one value cell, in the tables of a cited passage, that prints `value` (null when none or several). */
function printedColumn(ref: EvidenceRef, value: number): string | null {
  const hits = new Set<string>();
  let cells = 0;
  for (const t of parseTables(ref.policyId, [{ page: ref.page.start, text: evidenceTextOf(ref) }])) for (const r of t.rows) r.cells.forEach((c, i) => {
    const col = t.columns[i];
    if (!c || !col || col.kind === "label" || !numbersIn(c.text).some((n) => same(n, value))) return;
    cells++; hits.add(col.header || col.leaf);
  });
  return cells === 1 && hits.size === 1 ? [...hits][0] : null;
}
export function composeFinal(args: { sentences: Record<string, unknown>[]; nextSteps?: unknown; subjectId?: string | null }, ctx: Ctx): Composed {
  const out: Composed = { sentences: [], nextSteps: [], figureBindings: [], computations: [], calculations: [], calcs: [], dropped: [], notes: [], evidenceIds: [], subjectId: args.subjectId && ctx.householdIds.has(args.subjectId) ? args.subjectId : ctx.state.subjectId };
  // Agent P: every drop is categorised (for an accurate, user-facing outcome) and placed (for meaning checks).
  const drops: DropInfo[] = [];
  let cur = -1, curEstimate = false;
  const staleNotes = new Set([...(ctx.stale?.values() ?? [])]);
  const drop = (sentence: string, reason: string, householdNote?: string) => {
    out.dropped.push({ sentence, reason });
    const cat: DropCat = cur < 0 ? "step" : householdNote === PAYOUT_NOTE || /\bpayout\b/.test(reason) ? "payout" : householdNote === DECISION_NOTE || /\bdecision\b/.test(reason) ? "decision"
      : householdNote === INSTRUCTION_NOTE ? "instruction" : householdNote === SUM_NOTE ? "sum" : householdNote === UNRESOLVED_NOTE ? "unresolved" : householdNote === MISSING_FACT_NOTE ? "missing"
      : householdNote && staleNotes.has(householdNote) ? "stale" : /(?:calculation|computation)[’']s result|arithmetic/.test(reason) ? "calc" : "verify";
    const need = cat === "missing" ? (/uses (?:the household[’']s )?(.+?)(?: = | \(“)/.exec(reason)?.[1] ?? null) : null;
    drops.push({ at: cur, cat, sentence, estimate: curEstimate || /\bestimat\w*\b/i.test(sentence), need, note: cat === "stale" ? householdNote ?? null : null });
  };
  const conditioned: { at: number; words: string[] }[] = [];
  const people = peopleFromLabels(ctx.names ?? []);
  const sentencesIn = [...(args.sentences ?? [])];
  for (let i = 0; i < sentencesIn.length; i++) {
    for (const x of out.sentences) x.at ??= cur;
    cur = i;
    const s = sentencesIn[i];
    // Agent P: names as the household uses them; never "Full Name (Short)'s", never a full name twice in a sentence.
    // Round 6 (A3): ids the model wrote into the sentence ("[e9, e6]") are never shown; the ones a tool returned are
    // kept as the sentence's citations (the household sees them as its page links), checked like any other.
    const inline = stripInternalIds(String(s.text ?? "").replace(/\s+/g, " ").trim());
    let text = tidyNames(inline.text, people);
    if (!text) continue;
    let evIds = [...new Set([...((s.evidence_ids as string[]) ?? []).filter(Boolean), ...inline.ids.filter((id) => /^e\d/.test(id) && ctx.state.evidence[id])])];
    const valIds = [...new Set([...((s.value_ids as string[]) ?? []).filter(Boolean), ...inline.ids.filter((id) => /^v\d/.test(id) && ctx.tools.values.has(id))])];
    const inlineResult = inline.ids.find((id) => /^r\d/.test(id) && (ctx.tools.results.has(id) || calcOutcomes(ctx.tools).has(id))) ?? null;
    const oneOf = Array.isArray(s.result_ids) && (s.result_ids as unknown[]).length === 1 && typeof (s.result_ids as unknown[])[0] === "string" ? (s.result_ids as string[])[0] : null;
    const resultId = typeof s.result_id === "string" && s.result_id ? s.result_id : oneOf ?? inlineResult;
    curEstimate = !!resultId;
    const leak = internalIdsIn(text);
    if (leak.length) { drop(text, `shows an internal id (${leak.slice(0, 3).join(", ")})`); continue; }
    const subjectId = typeof s.subject_id === "string" && ctx.householdIds.has(s.subject_id) ? s.subject_id : out.subjectId;
    // Round 8d: the person a sentence explicitly says it is about (its own subject_id) is the person its figures are
    // bound to -- not whoever a cited passage was searched for (a comparison cites one table row for two people). The
    // save-time check then tests that person against the document's members and the column the figure is printed in.
    const explicitSubject = typeof s.subject_id === "string" && ctx.householdIds.has(s.subject_id) ? s.subject_id : null;
    const unknownEv = evIds.filter((id) => !ctx.state.evidence[id]);
    if (unknownEv.length) { drop(text, `cites evidence no tool returned (${unknownEv.join(", ")})`); continue; }
    // Agent F (D6): evidence remembered from an earlier turn is usable only while its document is still this
    // household's current, active version -- with or without a figure in the sentence.
    const staleEv = evIds.filter((id) => ctx.stale?.has(id));
    if (staleEv.length) { drop(text, `cites evidence from a document that is no longer available (${staleEv.join(", ")})`, ctx.stale!.get(staleEv[0])); continue; }
    // Agent F (D2 / D7): money presented as paid / owed / claimable, or a claim decision, is never stated.
    const pd = payoutOrDecision(text);
    if (pd) { drop(text, pd === "payout" ? "calls an amount a payout (paid, owed, reimbursed, received or claimable)" : "states a claim decision (approved / confirmed / fully covered) only the insurer can make", pd === "payout" ? PAYOUT_NOTE : DECISION_NOTE); continue; }
    // Agent F (D1): a sentence resting on an instruction inside a document (not policy wording) is never stated.
    const injected = evIds.filter((id) => instructionLines(ctx.state.evidence[id].passage.text).length && !withoutInstructions(ctx.state.evidence[id].passage.text).split(/\n+/).some((l) => sharesWords(l, text)));
    if (injected.length) { drop(text, "cites text inside a document that is an instruction, not policy wording", INSTRUCTION_NOTE); continue; }
    const values = valIds.map((id) => ctx.tools.values.get(id));
    if (values.some((v) => !v)) { drop(text, "cites a table value that was not read in this turn"); continue; }
    // V1.1 (evidence contract): a value's amendment relationship (the schedule row an endorsement amends, an
    // endorsement not yet in force on the date) is cited with it.
    evIds = [...new Set([...evIds, ...values.flatMap((v) => (v!.selected.related ?? []).map((e) => evidenceIdOf(ctx.state, e)))])];
    // Round 8 (F1): a sentence saying a date is not stated / confirmed, when the evidence it cites prints a date, says
    // something its evidence contradicts.
    const absentDate = dateAbsenceClaim(text) ? printedDateIn([...evIds.map((id) => ctx.state.evidence[id]?.passage.text ?? ""), ...values.map((v) => JSON.stringify(v))].join("\n")) : null;
    if (absentDate) { drop(text, `${DATE_ABSENCE_REASON} -- its cited evidence prints “${absentDate}”`); continue; }
    // V1.2: one sentence may compare alternatives -- several calculations of the same person ("If it is the lower leg:
    // S$18,000 if compound (open), S$9,000 if simple (closed)"). Each result is composed and checked exactly as on its
    // own; the sentence is kept only if every one of them is.
    const resultIds = Array.isArray(s.result_ids) ? [...new Set((s.result_ids as unknown[]).filter((x): x is string => typeof x === "string" && !!x))] : [];
    if (resultIds.length >= 2) {
      const calcs = resultIds.map((id) => calcOutcomes(ctx.tools).get(id) ?? null);
      if (calcs.some((c) => !c || (c.kind !== "conditional_illustration" && c.kind !== "indicative_estimate"))) { drop(text, "a comparison cites a calculation that is not a resolved illustration or estimate made in this conversation"); continue; }
      const tmp: Composed = { ...out, sentences: [], figureBindings: [], computations: [], calculations: [], calcs: [], dropped: [], notes: [], evidenceIds: [] };
      ONCE.set(tmp, onceFor(out));
      let t = text; const why: string[] = [];
      for (const c of calcs) { composeCalcSentence(t, c!, evIds, values.map((v) => v!.operand), subjectId, ctx, tmp, (_x, reason) => { why.push(reason); }); if (why.length) break; t = tmp.sentences.at(-1)!.text; }
      if (why.length) { drop(text, why[0]); continue; }
      const parts = sentencesOf(t);
      for (const r of tmp.calculations) { const fig = moneyFiguresIn(t).find((f) => same(f.value, r.result.value) && f.currency === r.currency); r.sentence = (fig && parts.find((x) => x.includes(fig.raw))) ?? t; }
      const ids = [...new Set(tmp.sentences.flatMap((x) => x.evidenceIds))];
      out.calculations.push(...tmp.calculations); out.calcs.push(...tmp.calcs);
      out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
      out.sentences.push({ text: t, evidenceIds: ids, estimate: tmp.sentences.some((x) => x.estimate), factKeys: [...new Set(tmp.sentences.flatMap((x) => x.factKeys))], kind: tmp.sentences[0].kind });
      continue;
    }
    const calc = resultId ? calcOutcomes(ctx.tools).get(resultId) ?? null : null;
    if (calc) { composeCalcSentence(text, calc, evIds, values.map((v) => v!.operand), subjectId, ctx, out, drop); continue; }
    const result = resultId ? ctx.tools.results.get(resultId) ?? null : null;
    if (resultId && !result) { drop(text, "cites a computation that was not made in this turn"); continue; }
    const figures = moneyFiguresIn(text);
    if (!evIds.length && !values.length && !result) {
      if (saidBackOnly(text, ctx)) { out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] }); continue; }
      // Round 7 (A3): a sentence that only refers to the household's own stated facts, or explains why a fact is
      // still needed, makes no cover or amount claim and needs no document citation.
      if (explainsNeedOnly(text, ctx)) { out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] }); continue; }
      // Round 9: "the uploaded documents don't say whether X is covered" is an absence of evidence, not a cover claim --
      // kept when it says exactly that (no figure, no "is / isn't covered", no exclusion claim). An exclusion is only
      // ever stated with the clause that says so.
      if (NOT_STATED.test(text) && !figures.length && !/\d/.test(text) && !COVER_VERDICT.test(text.replace(/\b(?:whether|if)\b[^.]*/i, " "))) { out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] }); continue; }
      if (ABSENCE.test(text) && !figures.length && !amountDigits(text) && !COVER_VERDICT.test(text.replace(/\b(?:whether|if)\b[^.]*/i, " "))) {
        const chk = absenceCheck(text, ctx);
        if (chk.problem) { drop(text, chk.problem); continue; }
        out.evidenceIds.push(...chk.evidenceIds.filter((x) => !out.evidenceIds.includes(x)));
        out.sentences.push({ text, evidenceIds: chk.evidenceIds, estimate: false, factKeys: [] }); continue;
      }
      if (figures.length || /\d/.test(text) || COVERISH.test(text)) { drop(text, "states cover or a figure without citing evidence"); continue; }
      out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] });
      continue;
    }
    // Agent F (D7): a cited sentence without a figure must say what its evidence says (polarity, policy, person,
    // benefit); "medically confirmed" / "approved" were refused above.
    if (!figures.length && !result && evIds.length && COVERISH.test(text)) {
      const why = checkCitedStatement(text, evIds.map((id) => ({ policyId: ctx.state.evidence[id].policyId, subjectId: ctx.state.evidence[id].subjectId ?? null, text: [ctx.state.evidence[id].table?.rowLabel ?? "", ctx.state.evidence[id].label ?? "", evidenceTextOf(ctx.state.evidence[id])].filter(Boolean).join("\n") })), { people: ctx.people ?? [], policyNames: ctx.policyNames ?? new Map(), docFacts: ctx.docFacts, subjectId });
      if (why) { drop(text, "not supported by its evidence: " + why, UNSUPPORTED_NOTE); continue; }
    }
    // Agent F (D3): a sum of printed limits is only ever said as the limits added together -- never as a total
    // anyone can claim, get or be paid.
    if (result && result.operation === "sum" && result.kind === "printed_limit" && (!/\blimits?\b/i.test(text) || /\b(?:claim\w*|receiv\w*|gets?|paid|payable|reimburs\w*|owe\w*|entitle\w*)\b/i.test(text))) { drop(text, "presents a sum of printed limits as an amount that can be claimed", SUM_NOTE); continue; }
    // Agent P (task 6): a printed benefit whose recorded conditions are not established is said as conditional.
    if (figures.length && !result) {
      const benefits = [...values.map((v) => ({ label: v!.operand.benefit, policyId: v!.operand.evidence.policyId })), ...evIds.map((id) => ctx.state.evidence[id]).filter((e) => e.table?.rowLabel).map((e) => ({ label: e.table!.rowLabel, policyId: e.policyId }))];
      const cond = conditionalFraming(text, benefits, ctx);
      if (cond) { text = cond.text; evIds = [...new Set([...evIds, ...cond.evidenceIds])]; conditioned.push({ at: i, words: cond.words }); }
    }
    const refs: EvidenceRef[] = [...evIds.map((id) => ctx.state.evidence[id]), ...values.map((v) => v!.operand.evidence), ...(result?.evidence ?? [])];
    const bindings: BoundFigure[] = [], records: ComputationRecord[] = [];
    let factKeys: string[] = [];
    let covered = new Set<number>();
    const partOf = (raw: string) => sentencesOf(text).find((p) => p.includes(raw)) ?? text;
    if (result) {
      if (result.kind === "indicative_estimate") {
        if (PAYOUT.test(text)) { drop(text, "calls an estimate a payout"); continue; }
        if (!/\bindicative estimate\b/i.test(text)) { text = "Indicative estimate: " + text; }
        const hh = householdInputs(result, ctx);
        if (hh.problem) { drop(text, hh.problem, MISSING_FACT_NOTE); continue; }
        factKeys = hh.keys;
      }
      const fig = moneyFiguresIn(text).findIndex((f) => same(f.value, result.amount) && f.currency === result.currency);
      if (fig < 0) { drop(text, "does not state the computation's result"); continue; }
      const f = moneyFiguresIn(text)[fig];
      const sentence = partOf(f.raw);
      if (result.record) records.push({ ...result.record, sentence });
      else {
        const est = estimateRecord(result, ctx.computeCalls.get(resultId!), ctx, subjectId ?? "");
        if (est) records.push({ ...est.record, sentence });
        else {
          // The result is one of its own printed operands (a cap that applies): bind it to that printed figure.
          const printed = [...ctx.tools.values.values()].map((v) => v.operand).find((o) => o.valueKind === "money" && o.cents === result.cents && o.currency === result.currency && result.evidence.some((e) => evidenceKey(e) === evidenceKey(o.evidence)));
          const b = printed && subjectId ? toFigureBinding({ ...printed.evidence, subjectId: printed.evidence.subjectId ?? subjectId }, printed.benefit, result.amount, result.currency) : null;
          if (!b) { drop(text, "the estimate's arithmetic is not one the save-time gate can check"); continue; }
          bindings.push({ ...b, sentence, value: result.amount, currency: result.currency });
        }
      }
      covered = new Set([fig]);
    }
    const figs = moneyFiguresIn(text);
    let failed: string | null = null, failedRaw: string | null = null, conflictWhy: string | null = null;
    figs.forEach((f, i) => {
      if (failed || covered.has(i)) return;
      const sentence = partOf(f.raw);
      conflictWhy = null;
      // A printed table value the sentence (or its computation) cites.
      const ops: TableValueOperand[] = [...values.map((v) => v!.operand), ...(result ? [...ctx.tools.values.values()].map((v) => v.operand).filter((o) => result.evidence.some((e) => evidenceKey(e) === evidenceKey(o.evidence))) : [])];
      const op = ops.find((o) => o.valueKind === "money" && o.cents != null && same(o.cents / 100, f.value) && o.currency === f.currency);
      let b: FigureBinding | null = op && subjectId ? toFigureBinding({ ...op.evidence, subjectId: explicitSubject ?? op.evidence.subjectId ?? subjectId }, wordedBenefit(op.benefit, evidenceTextOf(op.evidence), op.evidence.table?.cell?.text), f.value, f.currency) : null;
      // V1.3: a table value's own benefit decides what it is; the clause stating it must not attribute it to another
      // benefit the same document prints ("your Personal Accident cover is S$400,000" for the Term Life row).
      if (b && op) {
        const clause = sentence.split(/;\s+/).find((c) => c.includes(f.raw)) ?? sentence;
        const own = tidyLabel(op.benefit);
        const better = documentLabels(ctx.libraryText?.get(op.evidence.policyId) ?? "").find((o) => o.toLowerCase() !== own.toLowerCase() && wordScore(clause, o) > wordScore(clause, own) && !namesBenefit(clause, own));
        if (better) { failedRaw = f.raw; failed = `${f.raw} is printed under “${own}”, but the sentence states it for “${better}”`; return; }
      }
      // Round 7 (A3): the passages a figure may be printed in are the cited evidence AND the evidence of the table
      // values the sentence cites -- each read with its row context (the whole row, its headers), so a figure printed
      // beside the selected cell (an endorsement's earlier "Existing" amount) is found.
      const refsForFigure: EvidenceRef[] = [...evIds.map((id) => ctx.state.evidence[id] as EvidenceRef), ...values.map((v) => v!.operand.evidence)];
      if (!b && subjectId) for (const ref of refsForFigure) {
        // Agent F (D1): the benefit a passage figure is bound to is the passage's OWN label -- its table row, the
        // label a tool gave it, or (for a clause) the model's label only when the line printing the figure says it.
        // A line that is an instruction inside the document is never evidence for a figure.
        // V1.2: a certificate roster row (one insured person per row under a product heading) is bound to the product
        // heading it is printed under -- never to a cell of the row (the person's name) or to the sentence's own label.
        // No heading found: not bound from this passage.
        const roster = ref.table?.layout === "person_row";
        const heading = roster ? rosterHeading(ref, ctx) : null;
        if (roster && !heading) continue;
        let benefit = heading ?? ((ref.table?.rowLabel ? wordedBenefit(ref.table.rowLabel, evidenceTextOf(ref), ref.table.cell?.text) : "") || (ref as { label?: string | null }).label || passageLabel(evidenceTextOf(ref), f.value, typeof s.benefit === "string" ? s.benefit : "", text));
        // V1.3: not named word for word -- bound by the source's own label of the line printing it, when the clause
        // stating the figure names that benefit and no other benefit of the document more closely.
        if (!benefit && !roster && !ref.table?.rowLabel) {
          const clause = sentence.split(/;\s+/).find((c) => c.includes(f.raw)) ?? sentence;
          const idl = identityLabel(ref, f.value, f.currency, `${clause} ${typeof s.benefit === "string" ? s.benefit : ""}`, ctx);
          if (idl && "label" in idl) {
            // A roster line names the person it is for: the figure is that person's, never another member's.
            const who = explicitSubject ?? ref.subjectId ?? subjectId;
            const namesOf = (id: string | null | undefined) => (ctx.people ?? []).find((p) => p.id === id)?.names ?? [];
            const printing = withoutInstructions(evidenceTextOf(ref)).split(/\n+/).filter((l) => numbersIn(l).some((n) => same(n, f.value)));
            const nameIn = (l: string, names: string[]) => names.some((n) => n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(l));
            const other = (ctx.people ?? []).find((p) => p.id !== who && printing.every((l) => nameIn(l, p.names)));
            if (other && !printing.some((l) => nameIn(l, namesOf(who)))) { conflictWhy = `${f.raw} is printed on ${other.names[0]}'s row, not for this person`; continue; }
            benefit = idl.label;
          }
          else if (idl && "conflict" in idl) { conflictWhy = `${f.raw} is ${idl.conflict}`; continue; }
        }
        const policyText = withoutInstructions(evidenceTextOf(ref));
        const inCell = !!ref.table?.cell && numbersIn(ref.table.cell.text).some((n) => same(n, f.value));
        // A figure printed elsewhere in the row than the selected cell is bound to the row, not to that cell's column.
        b = benefit && numbersIn(policyText).some((n) => same(n, f.value)) ? toFigureBinding({ ...ref, ...(ref.table && !inCell ? { table: null } : {}), subjectId: explicitSubject ?? ref.subjectId ?? subjectId }, benefit, f.value, f.currency) : null;
        // Round 8d: a figure cited from a table passage (not from select_table_value) is bound to the column its row prints
        // it in, when exactly one value cell holds it -- the save-time check then tests that column against the person,
        // as for a selected value. Otherwise it stays unbound and an unbound person column is refused.
        if (b && !b.column) { const col = printedColumn(ref, f.value); if (col) b = { ...b, column: col }; }
        if (b) break;
      }
      if (b) { bindings.push({ ...b, sentence, value: f.value, currency: f.currency }); return; }
      // The household's own figure, said back to them: the gate decides (attribution, never as cover or a total).
      if (moneyFiguresIn(ctx.userText).some((u) => same(u.value, f.value) && u.currency === f.currency)) return;
      // V1.2: say precisely why: printed in a cited passage but not under the benefit the sentence names, or not printed.
      const printedThere = refsForFigure.some((ref) => numbersIn(withoutInstructions(evidenceTextOf(ref))).some((n) => same(n, f.value)));
      failedRaw = f.raw;
      failed = conflictWhy ?? (printedThere ? `${f.raw} is printed in the cited passage, but the sentence does not name the benefit as the line printing it words it (give that benefit's name in the sentence and in benefit)` : `${f.raw} is printed in none of the evidence the sentence cites`);
    });
    if (failed) {
      // V1.3: the parts of the sentence that can stand on their own are checked on their own (once); only the part
      // whose figure is unsupported is left out, never the supported document, person and date facts with it.
      const parts = !(s as { _part?: boolean })._part ? verifiableParts(text, failedRaw) : null;
      if (parts) { out.dropped.push({ sentence: text, reason: failed }); sentencesIn.splice(i + 1, 0, ...parts.map((p) => ({ ...s, text: p, _part: true }))); continue; }
      drop(text, failed); continue;
    }
    out.figureBindings.push(...bindings); out.computations.push(...records);
    const ids = [...new Set([...evIds, ...refs.map((r) => evidenceIdOf(ctx.state, r))])];
    out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
    out.sentences.push({ text, evidenceIds: ids, estimate: result?.kind === "indicative_estimate", factKeys, ...(valIds.length ? { valueIds: valIds } : {}), ...(typeof s.benefit === "string" && s.benefit.trim() ? { benefit: s.benefit.trim() } : {}), ...(conditioned.some((c) => c.at === i) ? { condition: conditioned.find((c) => c.at === i)!.words.join(" ") } : {}) });
  }
  for (const x of out.sentences) x.at ??= cur;
  cur = -1;
  for (const step of Array.isArray(args.nextSteps) ? args.nextSteps : []) {
    const t = stripInternalIds(String(step ?? "")).text;
    if (!t) continue;
    if (moneyFiguresIn(t).length) { drop(t, "a next step may not state a figure"); continue; }
    if (internalIdsIn(t).length) { drop(t, "a next step may not show an internal id", STEP_NOTE); continue; }
    // Agent F (D8): a next step never states or promises cover, money or a decision.
    const bad = unsafeNextStep(t);
    if (bad) { drop(t, bad, STEP_NOTE); continue; }
    out.nextSteps.push(t);
  }
  settleAnswer(out, drops, conditioned, ctx);
  return out;
}

// ------------------------------------------------------------------------------------------- Agent K: calculations
const ILLUSTRATION_IF = /\bif\b/i;
/** Which recorded claim facts a calculation's household inputs are (by value, or by the household's words). */
function calcFactKeys(c: CalcOutcome, ctx: Ctx): { keys: string[]; problem: string | null } {
  const facts = ctx.state.claim?.facts ?? {};
  const keys: string[] = [];
  for (const o of c.record?.operands ?? []) {
    if (o.source !== "household") continue;
    // Integration (agent C's request 1): a confirmed fact, the household's words for this input matching the words
    // recorded for it, and -- for a number -- the same value.
    const hit = Object.entries(facts).find(([, f]) => confirmed(f) && wordsMatch(o.attribution, f.words) && (typeof o.value !== "number" || numbersIn(String(f.value)).some((n) => same(n, o.value as number)) || String(f.value) === String(o.value)));
    if (!hit) return { keys, problem: `the calculation uses the household’s ${o.label} (“${o.attribution}”), which is not a fact the household has given (or it has since been corrected)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}
/** Integration (S7): an estimate sentence that states the household's own bill figure says it is theirs ("the S$1,500
 * bill you mentioned") -- the composer words it; the gate is not relaxed. Only the household's money operands are
 * attributed, and only where the sentence does not already attribute them. */
const SAID_BACK = /\byou(?:['’]ve| have)? (?:asked about|mentioned|said|told (?:me|us)|wrote|reported|gave|quoted|entered|typed|noted|stated|put)\b|\baccording to you\b|\byour (?:own )?(?:figures?|bill|amount)\b/i;
export function attributeHouseholdFigures(text: string, c: Pick<CalcOutcome, "record">): string {
  if (SAID_BACK.test(text)) return text;
  const own = (c.record?.operands ?? []).filter((o) => o.source === "household" && o.unit === "money" && typeof o.value === "number");
  let t = text;
  for (const f of moneyFiguresIn(text)) {
    if (!own.some((o) => same(o.value as number, f.value))) continue;
    const raw = f.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = new RegExp(String.raw`\b(?:an?|the|your)\s+` + raw + String.raw`\s+(bill|invoice|claim|amount)\b`, "i");
    const after = new RegExp(String.raw`\b(?:an?|the|your)\s+(bill|invoice|amount)\s+of\s+` + raw + String.raw`\b`, "i");
    if (before.test(t)) t = t.replace(before, (_m, n: string) => `the ${f.raw} ${n} you mentioned`);
    else if (after.test(t)) t = t.replace(after, (_m, n: string) => `the ${f.raw} ${n} you mentioned`);
    else t = t.replace(f.raw, `${f.raw} (the figure you mentioned)`);
  }
  return t;
}
/** Integration (r6): the estimate sentence (the one stating the result) carries the record's assumption. */
/** Round 8 (F1): the conditions a conditional illustration is stated with (each only when not already said): the rate
 * as amended by an endorsement, the assumption about earlier use of a capped allowance the record made, and the cause
 * limit its own document prints (quoted, cited). Figure-free, so nothing is added the save-time gate would check. */
/** V1.2: what is said once per composed answer (an illustration's cause limit). */
const ONCE = new WeakMap<Composed, { cause?: boolean }>();
const onceFor = (out: Composed) => { let o = ONCE.get(out); if (!o) { o = {}; ONCE.set(out, o); } return o; };
export function illustrationConditions(text: string, c: CalcOutcome, ctx: Pick<Ctx, "state" | "stale" | "policyNames">, once: { cause?: boolean } = {}): { text: string; evidenceIds: string[] } {
  const rec = c.record;
  if (!rec) return { text, evidenceIds: [] };
  const plain = (x: string) => x.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  const add: string[] = [], ids: string[] = [];
  if (rec.unitTerms?.amendingDocumentIds?.length && !/\bendorse|\bamend|\brevis/i.test(text)) add.push("using the daily rate as revised by the endorsement");
  const assumed = /\bassuming\b.*$/i.exec(rec.assumption ?? "")?.[0]?.trim();
  if (assumed && !plain(text).includes(plain(assumed))) add.push(assumed);
  const names = [...(ctx.policyNames?.values() ?? []), ...Object.values(ctx.state.docNames ?? {}), rec.benefit].filter(Boolean).sort((a, b) => b.length - a.length);
  let bare = text;
  for (const n of names) bare = bare.split(n).join(" ");
  // V1.2: the cause limit is said once per answer, with its first illustration -- not repeated on every one.
  if (!/\baccident/i.test(bare) && !once.cause) {
    const own = Object.values(ctx.state.evidence).filter((e) => e.policyId === rec.policyId && !ctx.stale?.has(e.id) && !e.table);
    // V1.2: a schedule row ("Death due to Accident     100%": laid out in columns, or ending in its percentage) is a
    // benefit, not a clause limiting cover to accidents.
    const linesOf = (e: (typeof own)[number]) => withoutInstructions(e.passage.text).split(/(?<=[.;])\s+|\n+/).filter((l) => !/\S {3,}\S|\t/.test(l.trim())).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 20 && l.length <= 200 && /\baccident/i.test(l) && !moneyFiguresIn(l).length && !/\d+(?:\.\d+)?\s*%\s*$/.test(l));
    // The clause that limits cover to accidents ("caused solely by an accident"), else one that says accident only.
    let pick: { e: (typeof own)[number]; line: string } | null = null;
    for (const test of [(l: string) => CAUSE_LIMIT.test(l), (l: string) => /\bonly\b/i.test(l)]) {
      for (const e of own) { const line = linesOf(e).find(test); if (line) { pick = { e, line }; break; } }
      if (pick) break;
    }
    if (pick) {
      add.push(`and only for ${rec.calculator === "hospital_cash" ? "a stay" : "an injury"} the insurer accepts as caused by an accident (the policy says “${pick.line.replace(/[;:,.\s]+$/, "")}”)`);
      ids.push(evidenceIdOf(ctx.state, pick.e));
      once.cause = true;
    }
  }
  if (!add.length) return { text, evidenceIds: [] };
  const amount = c.amount != null ? moneyFiguresIn(text).find((f) => same(f.value, c.amount!)) : undefined;
  const parts = sentencesOf(text);
  const i = amount ? parts.findIndex((p) => p.includes(amount.raw)) : parts.length - 1;
  if (i < 0) return { text, evidenceIds: [] };
  parts[i] = parts[i].replace(/[.!]?\s*$/, `, ${add.join(", ")}.`);
  return { text: parts.join(" "), evidenceIds: ids };
}
export function withAssumption(text: string, assumption: string, amount: number, currency: string): string {
  const plain = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (plain(text).includes(plain(assumption))) return text;
  const f = moneyFiguresIn(text).find((x) => same(x.value, amount) && x.currency === currency);
  const parts = sentencesOf(text);
  const i = f ? parts.findIndex((p) => p.includes(f.raw)) : -1;
  if (i < 0) return text;
  parts[i] = parts[i].replace(/[.!]?\s*$/, `, ${assumption}.`);
  return parts.join(" ");
}
function composeCalcSentence(text0: string, c: CalcOutcome & { purpose?: string }, evIds: string[], valueOps: TableValueOperand[], subjectId: string | null, ctx: Ctx, out: Composed, drop: (s: string, r: string, note?: string) => void): void {
  let text = text0;
  const pd = payoutOrDecision(text);
  if (pd) { drop(text, pd === "payout" ? "calls a calculated benefit a payout (paid / owed / reimbursed / claimable)" : "states a claim decision only the insurer can make", pd === "payout" ? PAYOUT_NOTE : DECISION_NOTE); return; }
  const sid = subjectId ?? c.subjectId;
  if (sid !== c.subjectId) { drop(text, "the sentence is about another person than the calculation"); return; }
  const partOf = (raw: string) => sentencesOf(text).find((p) => p.includes(raw)) ?? text;
  const evidenceIds = () => [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e)), ...recordRuleEvidence(c, ctx)])];
  if (c.kind === "indicative_estimate" || c.kind === "conditional_illustration") {
    if (!c.record || c.amount == null || !c.currency) { drop(text, "the calculation has no result"); return; }
    // A negated payout word ("this is not a confirmed payout") says the opposite of a payout (as payoutOrDecision reads it).
    if (PAYOUT.test(withoutNegatedDecisions(text))) { drop(text, "calls a calculated benefit a payout"); return; }
    let factKeys: string[] = [];
    if (c.kind === "indicative_estimate") {
      if (!/\bindicative estimate\b/i.test(text)) text = "Indicative estimate: " + text;
      const hh = calcFactKeys(c, ctx); if (hh.problem) { drop(text, hh.problem, MISSING_FACT_NOTE); return; }
      factKeys = hh.keys;
    } else if (!ILLUSTRATION_IF.test(text)) { drop(text, "an illustration must state its what-if (“if …”)"); return; }
    if (c.kind === "indicative_estimate") text = attributeHouseholdFigures(text, c);
    // Integration (r6): an estimate that assumes earlier use of a capped allowance leaves what this stay needs states
    // that assumption in its own sentence (the save-time gate rejects it otherwise).
    if (c.kind === "indicative_estimate" && c.record.assumption?.trim()) text = withAssumption(text, c.record.assumption.trim(), c.amount, c.currency);
    // Round 8 (F1): a what-if says what else it assumes and what it turns on -- the rate as amended, earlier use of a
    // capped allowance, and the document's cause limit -- so it is never read as the amount for the actual stay.
    let extraIds: string[] = [];
    if (c.kind === "conditional_illustration") { const w = illustrationConditions(text, c, ctx, onceFor(out)); text = w.text; extraIds = w.evidenceIds; }
    const fig = moneyFiguresIn(text).find((f) => same(f.value, c.amount!) && f.currency === c.currency);
    if (!fig) { drop(text, "does not state the calculation’s result"); return; }
    out.calculations.push({ ...c.record, sentence: partOf(fig.raw) });
    out.calcs.push(c);
    const ids = [...new Set([...evidenceIds(), ...extraIds])];
    out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
    out.sentences.push({ text, evidenceIds: ids, estimate: c.kind === "indicative_estimate", factKeys, kind: c.kind });
    return;
  }
  // unresolved / not_payable: the printed figures may be stated (each bound to its own printed value), then the
  // specific missing information -- never an estimate.
  const printed = [...c.printed, ...valueOps.map((o) => ({ label: o.benefit, value: (o.cents ?? 0) / 100, unit: o.valueKind, currency: o.currency ?? null, evidence: o.evidence, binding: toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? c.subjectId }, o.benefit, (o.cents ?? 0) / 100, o.currency ?? "") }))];
  const bindings: BoundFigure[] = [];
  for (const f of moneyFiguresIn(text)) {
    const p = printed.find((x) => x.unit === "money" && x.currency === f.currency && same(x.value, f.value) && x.binding);
    if (!p) {
      drop(text, `${f.raw} is not a printed figure of this benefit (no estimate is possible yet: ${c.requirements.join("; ") || c.reason || "unresolved"})`, UNRESOLVED_NOTE);
      // Agent F (D24): the household is told exactly what is still needed (the calculator's own requirement).
      requirementOf(c, ctx, out, evIds);
      return;
    }
    bindings.push({ ...p.binding!, sentence: partOf(f.raw), value: f.value, currency: f.currency });
  }
  if (/\bindicative estimate\b|\bestimate\b/i.test(text)) { drop(text, "states an estimate where the calculation is unresolved", UNRESOLVED_NOTE); requirementOf(c, ctx, out, evIds); return; }
  out.figureBindings.push(...bindings);
  out.calcs.push(c);
  const ids = evidenceIds();
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text, evidenceIds: ids, estimate: false, factKeys: [], kind: "printed" });
  requirementOf(c, ctx, out, evIds);
}

/**
 * Round 6c (A3): the passages a calculation's own rules rest on, cited with the sentence that states its result -- the
 * wording of the benefit that states the day-count / duration rule the record applied (\"Hospital cash is payable for
 * each complete period of 24 hours ...\"), and every document passage a record condition quotes. Only passages a tool
 * returned this conversation, of the calculation's own document, about its own benefit (the benefit is what the
 * sentence is about, before its \"is payable\" / \"pays\").
 */
function recordRuleEvidence(c: CalcOutcome, ctx: Ctx): string[] {
  const out: string[] = [];
  const rec = c.record as (CalcOutcome["record"] & { unitTerms?: { durationRule?: { rule?: string } | null } }) | null;
  const rule = rec?.unitTerms?.durationRule?.rule ?? (rec?.steps ?? []).map((st) => (st as { rule?: string }).rule).find(Boolean) ?? null;
  const keyWords = contentWords(String(c.benefit ?? "").replace(/\([^)]*\)/g, " ")).filter((w) => !BENEFIT_GENERIC.has(w));
  const quoted = (c.conditions ?? []).filter((x) => x.basis === "document" && x.passage?.text && x.passage.policyId === c.policyId).map((x) => x.passage!.text.replace(/\s+/g, " ").trim());
  for (const e of Object.values(ctx.state.evidence)) {
    if (e.policyId !== c.policyId || ctx.stale?.has(e.id) || e.table) continue;
    const text = withoutInstructions(e.passage.text).replace(/\s+/g, " ").trim();
    let hit = quoted.some((q) => q.length >= 12 && (text.includes(q) || q.includes(text)));
    if (!hit && rule && keyWords.length) for (const sentence of text.split(/(?<=[.;])\s+/)) {
      const subject = sentence.split(/\b(?:is|are) (?:payable|paid)\b|\bpays?\b/i)[0] ?? "";
      if (subject === sentence) continue;
      const have = new Set(contentWords(subject));
      if (keyWords.every((w) => have.has(w)) && dayRuleFromWording(sentence)?.rule === rule) { hit = true; break; }
    }
    if (hit) out.push(e.id);
  }
  return out;
}
/** Agent F (D24): an unresolved calculation's specific requirement (figure-free), said once. */
function requirementOf(c: CalcOutcome, ctx: Ctx, out: Composed, evIds: string[]): void {
  if ((c.kind !== "unresolved" && c.kind !== "not_payable") || !c.unresolvedText) return;
  const text = tidyNames(c.unresolvedText, peopleFromLabels(ctx.names ?? []));
  if (out.sentences.some((x) => x.text === text)) return;
  const ids = [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e))])];
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text, evidenceIds: ids, estimate: false, factKeys: [], kind: "requirement", asks: c.kind === "unresolved" ? requirementConcepts(c) : [] });
}

// ------------------------------------------------------------------------------- Agent P: presenting the answer
type DropCat = "payout" | "decision" | "instruction" | "sum" | "unresolved" | "missing" | "stale" | "calc" | "verify" | "step";
type DropInfo = { at: number; cat: DropCat; sentence: string; estimate: boolean; need?: string | null; note?: string | null };

/** A household member as a sentence may name them: the full (display) name and the short name the household uses. */
export type NamedPerson = { full: string; short: string | null };
/** "Ethan Tan Jun Kai (Ethan)" -> { full: "Ethan Tan Jun Kai", short: "Ethan" }; "Rohan Nair" -> { full, short: null }. */
export function peopleFromLabels(labels: string[]): NamedPerson[] {
  return labels.map((l) => { const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(l.trim()); return m ? { full: m[1].trim(), short: m[2].trim() } : { full: l.trim(), short: null }; }).filter((p) => p.full.length >= 2);
}
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Agent P (task 2): names as the household uses them. "Full Name (Short)" becomes the short name (so never
 * "Full Name (Short)'s"); within one sentence a full name is said once -- a later possessive mention becomes "the"
 * ("I still need Rohan Nair's admission" -> "I still need the admission"), a later plain mention the short name. */
export function tidyNames(text: string, people: NamedPerson[]): string {
  let t = text;
  for (const p of people) if (p.short && p.short !== p.full) t = t.replace(new RegExp(esc(p.full) + String.raw`\s*\(\s*` + esc(p.short) + String.raw`\s*\)`, "g"), p.short);
  return t.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((sentence) => {
    let x = sentence;
    for (const p of people) {
      if (p.full === p.short || p.full.split(/\s+/).length < 2) continue;
      let n = 0;
      x = x.replace(new RegExp(String.raw`\b` + esc(p.full) + String.raw`(['’]s\b)?`, "g"), (m: string, poss?: string) => { n++; return n === 1 ? m : poss ? "the" : p.short ?? m; });
    }
    return x;
  }).join(" ");
}

/** The fact concepts a sentence asks the household for, when it is a request for information (null otherwise). */
const ASKING = /\?\s*$|\bI(?:['’]d| would| will|['’]ll)? (?:still |also |first )?need\b|\b(?:please|could you|can you|would you) (?:tell|let me know|give|send|share|confirm)\b|\blet me know\b|\btell me\b/i;
const CONCEPT_WORDS: [string, RegExp][] = [
  ["admission", /\badmi(?:t|ssion|tted|tting)\w*/i],
  ["discharge", /\bdischarg\w*/i],
  ["bill", /\b(?:bills?|invoices?|receipts?)\b|\bhow much (?:was|did) (?:it|the \w+) cost\b/i],
  ["cause", /\bhow (?:it|this|that|the \w+(?: \w+)?) happened\b|\b(?:accident|illness|sickness)\b/i],
  ["stay_length", /\bhow many (?:nights|days)\b|\bhow long\b|\blength of (?:the )?stay\b/i],
  ["hospital", /\bwhich hospital\b|\bhospital(?:['’]s)? name\b/i],
];
export function askedConcepts(text: string): string[] | null {
  if (!ASKING.test(text) || moneyFiguresIn(text).length) return null;
  const c = CONCEPT_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
  return c.length ? c : null;
}
/** Agent P (task 1): the fact keys an unresolved calculation still needs from the household, as fact concepts
 * (admission_datetime -> admission, bill_amount -> bill, an open condition -> its own key). */
export function requirementConcepts(c: Pick<CalcOutcome, "requirements" | "conditions" | "calculator">): string[] {
  const keys: string[] = [];
  for (const r of c.requirements) {
    if (/\badmi(?:ssion|tted)\b/i.test(r)) keys.push("admission_datetime");
    if (/\bdischarg/i.test(r)) keys.push("discharge_datetime");
    if (/\bbill\b|\bcurrency\b/i.test(r)) keys.push("bill_amount");
  }
  for (const x of c.conditions) if (x.status === "unresolved" && x.needs && x.kind !== "minimum_stay") keys.push(x.id);
  return [...new Set(keys.map((k) => factConcept(k).concept))];
}

/** Agent P (task 6): the policy's condition for paying a printed benefit, from the passages read in this conversation. */
const BENEFIT_GENERIC = new Set(["benefit", "daily", "per", "each", "max", "maximum", "limit", "amount", "sum", "cover", "plan", "insured", "payable", "total", "year", "day", "days", "complete", "hour", "hours", "policy", "child", "adult", "the"].map((w) => contentWords(w)[0] ?? w));
const CONDITION = /\b(?:only if|if|provided(?: that)?|subject to|as long as|on condition that)\b|\b(?:must|has to|have to|needs? to|shall)\s+be\b|\b(?:confirmed|certified|diagnosed|verified|supported)\s+by\b/i;
/** Wording that limits cover by what caused the event (accident-only cover, an illness exclusion). */
const CAUSE_WORDING = /\baccident(?:al|ally|s)?\b|\b(?:illness|sickness|disease|degenerative)\b/i;
/** The cause is what the wording turns on: caused by / solely / directly / due to / arising from / resulting from. */
const CAUSE_LIMIT = /\b(?:caused|solely|directly|due to|arising (?:from|out of)|resulting from|as a result of|attributable to)\b/i;
/** A policy-level statement of what the document covers ("This policy covers ...", "The plan does not cover ..."). */
const COVER_SCOPE = /\b(?:this|the) (?:policy|plan|certificate|cover|insurance)\b[^.]{0,60}\b(?:covers?|insures?)\b|\bis not covered\b|\bare not covered\b/i;
/**
 * Round 6c (A3): every unestablished material condition the selected benefit's own passages (read this conversation,
 * same document) impose on it, appended to a sentence that states the benefit's printed figure:
 *  - the benefit's own conditions (\"payable once per fracture confirmed by X-ray and certified by ...\"), unless the
 *    sentence already carries them or reviewed medical evidence on the claim establishes them;
 *  - while the claim records an event but not how it happened, the document's cause condition: a cover-scope or
 *    benefit sentence that limits cover by cause (accident-only cover, an illness exclusion).
 * Null when there is nothing to add.
 */
export function conditionalFraming(text: string, benefits: { label: string; policyId: string }[], ctx: Pick<Ctx, "state" | "stale"> & Partial<Pick<Ctx, "policyNames">>): { text: string; evidenceId: string; evidenceIds: string[]; words: string[] } | null {
  if (!benefits.length || /\bnot\b|\bexclu/i.test(text)) return null;
  const claim = ctx.state.claim;
  const facts = Object.values(claim?.facts ?? {});
  const keys = Object.keys(claim?.facts ?? {});
  const causeUnknown = !!claim && keys.some((k) => EVENT_KEY.test(k)) && !keys.some((k) => CAUSE_KEYS.has(k) && confirmed(claim.facts[k]));
  const own = new Set(contentWords(text));
  // Whether the sentence itself already says the cause condition -- not counting a product's name or a benefit's
  // printed label that merely contains the word ("Family Accident Guard", "Accidental dental treatment").
  const names = [...(ctx.policyNames?.values() ?? []), ...Object.values(ctx.state.docNames ?? {}), ...benefits.map((b) => b.label)].filter(Boolean).sort((a, b) => b.length - a.length);
  let plain = text;
  for (const n of names) plain = plain.split(n).join(" ");
  const saysCause = CAUSE_WORDING.test(plain);
  const alreadyConditional = /\b(?:if|provided|subject to|as long as|only when|on condition|unless)\b/i.test(text);
  const clauses: string[] = [], ids: string[] = [], causeQuotes: string[] = [];
  const seen = new Set<string>();
  for (const b of benefits) {
    const label = b.label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const keyWords = contentWords(label).filter((w) => !BENEFIT_GENERIC.has(w));
    if (!keyWords.length) continue;
    const noun = /\b([A-Za-z-]+)\s+benefit\b/i.exec(label)?.[1]?.toLowerCase() ?? null;
    for (const e of Object.values(ctx.state.evidence)) {
      if (e.policyId !== b.policyId || ctx.stale?.has(e.id) || e.table) continue;
      for (const line of withoutInstructions(e.passage.text).split(/(?<=[.;])\s+|\n+/)) {
        const sentence = line.replace(/\s+/g, " ").trim();
        if (!sentence || seen.has(sentence) || moneyFiguresIn(sentence).length) continue;
        const have = new Set(contentWords(sentence));
        const aboutBenefit = keyWords.every((w) => have.has(w));
        // The cause condition, while how it happened is not known.
        if (causeUnknown && CAUSE_WORDING.test(sentence) && CAUSE_LIMIT.test(sentence) && (aboutBenefit || COVER_SCOPE.test(sentence))) {
          seen.add(sentence);
          if (!saysCause) { causeQuotes.push(sentence.replace(/[;:\s]+$/, "")); ids.push(evidenceIdOf(ctx.state, e)); }
          continue;
        }
        // The benefit's own condition: a sentence the model already wrote as conditional keeps its own wording.
        if (alreadyConditional || !aboutBenefit || !CONDITION.test(sentence) || /\bnot (?:covered|payable)\b|\bexclu/i.test(sentence)) continue;
        seen.add(sentence);
        const words = contentWords(sentence).filter((w) => !keyWords.includes(w));
        // Established only by reviewed medical evidence recorded for the claim -- never by the household's report.
        if (facts.some((f) => f.source === "medical_evidence" && contentWords(f.words).filter((w) => words.includes(w)).length >= 2)) continue;
        // The sentence already carries the condition.
        if (words.length && words.filter((w) => own.has(w)).length / words.length >= 0.6) continue;
        const body = sentence.replace(/[.;:\s]+$/, "");
        let clause: string | null = null;
        const part = /\b(?:confirmed|certified|diagnosed|verified|supported)\s+by\b.*$/i.exec(body)?.[0];
        const must = /\b(?:must|has to|have to|needs? to|shall)\s+be\s+(.+)$/i.exec(body)?.[1];
        const iff = /\b(?:only if|if|provided(?: that)?|as long as|on condition that)\s+(.+)$/i.exec(body)?.[1];
        const subj = /\bsubject to\s+(.+)$/i.exec(body)?.[1];
        if (part && noun) clause = `payable if the ${noun} is ${part}`;
        else if (must && noun) clause = `payable only if the ${noun} is ${must}`;
        else if (iff) clause = `payable only if ${iff}`;
        else if (subj) clause = `subject to ${subj}`;
        if (!clause || clause.length > 200) clause = `payable only if the policy’s conditions for it are met (“${body}”)`;
        clauses.push(clause); ids.push(evidenceIdOf(ctx.state, e));
      }
    }
  }
  if (causeQuotes.length) clauses.push(`${clauses.length ? "and " : ""}only for what the policy covers, which depends on how it happened: “${causeQuotes.map((q) => q.replace(/[.\s]+$/, "")).join(". ")}.”`);
  if (!clauses.length) return null;
  const framed = text.replace(/[.!\s]+$/, "") + ", " + clauses.join(", ") + (clauses.at(-1)!.endsWith("”") ? "" : ".");
  return { text: framed, evidenceId: ids[0], evidenceIds: [...new Set(ids)], words: contentWords(clauses.join(" ")) };
}

const QUALIFIER_START = /^(?:however|but|except|unless|only (?:if|when|after|for)|(?:this|that|it) (?:does not|doesn['’]t|only|is only|excludes|won['’]t)|not\b|note that|although|though|provided|subject to|(?:this|that|the) limit)\b/i;
const DEPENDENT_START = /^(?:this|that|these|those|it|its|they|their|however|but|so|therefore|also|in addition|then|after that|as a result|because of (?:this|that)|which|otherwise|together|in total|altogether)\b/i;
const INTRO = /:\s*$|\b(?:here (?:is|are)|the following|as follows|below)\b/i;
/**
 * Agent P (task 3): the answer as the household sees it, once sentences have been checked. Never commentary on what
 * was removed or why. A kept sentence whose meaning depended on a removed one is withdrawn too (a removed qualifier of
 * the sentence before it, a sentence that refers back to a removed one, an estimate's label left without its
 * estimate, a list introduction whose list lost an item); a model sentence asking for what an unresolved
 * calculation's requirement already asks (same fact concepts) is not repeated; a separate sentence repeating a
 * condition now carried by its benefit's sentence is not repeated. Notes are user-facing caveats; when nothing at all
 * can be kept, one accurate explanation of why.
 */
function settleAnswer(out: Composed, drops: DropInfo[], conditioned: { at: number; words: string[] }[], ctx: Ctx): void {
  const removed = drops.filter((d) => d.at >= 0).map((d) => ({ at: d.at, estimate: d.estimate }));
  const withdrawn: ComposedSentence[] = [];
  let changed = true, incomplete = false;
  const content = () => out.sentences.filter((x) => x.kind !== "requirement" && !withdrawn.includes(x));
  while (changed) {
    changed = false;
    for (const k of content()) {
      const at = k.at ?? -1;
      const startsDependent = DEPENDENT_START.test(k.text) && removed.some((r) => r.at === at - 1) && !out.sentences.some((x) => x !== k && x.at === at - 1 && !withdrawn.includes(x));
      const qualifierLost = drops.some((d) => d.at === at + 1 && QUALIFIER_START.test(d.sentence)) || withdrawn.some((w) => (w.at ?? -9) === at + 1 && QUALIFIER_START.test(w.text));
      const labelLeft = !k.estimate && k.kind !== "indicative_estimate" && /\bestimat\w*\b/i.test(k.text) && removed.some((r) => r.estimate) && !out.sentences.some((x) => x.estimate && !withdrawn.includes(x));
      // A list introduction whose list lost an item, or that now introduces nothing at all.
      const intro = INTRO.test(k.text) && !moneyFiguresIn(k.text).length && (removed.some((r) => r.at > at) || (removed.length > 0 && !content().some((x) => (x.at ?? -1) > at)));
      if (startsDependent || qualifierLost || labelLeft || intro) {
        withdrawn.push(k); removed.push({ at, estimate: k.estimate }); changed = true;
        if (intro && content().some((x) => (x.at ?? -1) > at)) incomplete = true;
        out.dropped.push({ sentence: k.text, reason: intro ? "introduces a list that lost an item" : labelLeft ? "refers to an estimate that was removed" : qualifierLost ? "its qualification was removed" : "refers to a sentence that was removed" });
      }
    }
  }
  // A model sentence asking for what a requirement already asks.
  const asked = new Set(out.sentences.filter((x) => x.kind === "requirement").flatMap((x) => x.asks ?? []));
  for (const k of content()) {
    const c = askedConcepts(k.text);
    if (c && c.every((x) => asked.has(x))) { withdrawn.push(k); out.dropped.push({ sentence: k.text, reason: "repeats the missing-information requirement" }); }
  }
  // A separate sentence repeating a condition its benefit's sentence now carries.
  for (const c of conditioned) for (const k of content()) {
    if (k.at === c.at || moneyFiguresIn(k.text).length) continue;
    const w = contentWords(k.text);
    const have = new Set(c.words);
    if (w.length && w.filter((x) => have.has(x)).length / w.length >= 0.85) { withdrawn.push(k); out.dropped.push({ sentence: k.text, reason: "repeats the condition stated with the benefit" }); }
  }
  if (withdrawn.length) {
    const gone = (sentence: string) => withdrawn.some((w) => w.text.includes(sentence) || sentence.includes(w.text));
    out.sentences = out.sentences.filter((x) => !withdrawn.includes(x));
    out.figureBindings = out.figureBindings.filter((b) => !gone(b.sentence));
    out.computations = out.computations.filter((r) => !gone(r.sentence));
    const keptCalc = out.calculations.filter((r) => !gone(r.sentence));
    const lostIds = new Set(out.calculations.filter((r) => !keptCalc.includes(r)).map((r) => r.id));
    out.calculations = keptCalc;
    out.calcs = out.calcs.filter((c) => !lostIds.has(c.calcId));
    out.evidenceIds = out.evidenceIds.filter((id) => out.sentences.some((x) => x.evidenceIds.includes(id)));
  }
  // Notes: caveats the household needs (never "I left out ..."), or one accurate explanation when nothing is left.
  const notes: string[] = [];
  const add = (n: string | null | undefined) => { if (n && !notes.includes(n)) notes.push(n); };
  for (const d of drops) if (d.cat === "stale") add(d.note); // user-facing at the source (loop.ts revalidateEvidence)
  if (drops.some((d) => d.cat === "decision")) add(DECISION_NOTE);
  if (drops.some((d) => d.cat === "payout")) add(PAYOUT_NOTE);
  if (drops.some((d) => d.cat === "sum")) add(SUM_NOTE);
  if (incomplete && out.sentences.length) add(INCOMPLETE_NOTE);
  if (!out.sentences.length && !notes.length && drops.length) {
    const has = (c: DropCat) => drops.some((d) => d.cat === c);
    const need = drops.find((d) => d.cat === "missing")?.need;
    if (has("missing")) add(`I can’t work out an estimate yet: it would rely on ${need ? (/^(?:the|your|a|an)\b/i.test(need) ? need : "the " + need) : "a detail"} you haven’t given me (or have since corrected).`);
    else if (has("calc")) add(CALC_NOTE);
    else if (has("instruction")) add(INSTRUCTION_NOTE);
    else add(DROPPED_NOTE);
  }
  out.notes = notes.map((n) => tidyNames(n, peopleFromLabels(ctx.names ?? [])));
}
