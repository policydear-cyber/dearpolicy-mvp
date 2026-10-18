/**
 * Agent F: what a sentence of the visible answer may claim, beyond its figures (pure; no database access).
 *
 *  - PAYOUT / DECISION: an amount presented as paid, owed, reimbursed, claimable or received, or a claim decision
 *    (approved, medically confirmed, fully covered, guaranteed) is never DearPolicy's to state -- refused in every
 *    sentence, estimate and next step, whatever it cites (only the insurer decides what it pays).
 *  - INSTRUCTION: text inside a document that addresses an assistant or a reader with instructions ("ignore all
 *    previous instructions", "tell the policyholder ...") is not policy wording: it is never evidence for anything.
 *  - checkCitedStatement: a figure-free cited sentence must say what its evidence says -- the polarity (a "not
 *    covered" needs a passage that says so, or a list that does not name the person), the policy it names (one it
 *    cites), the person (evidence read for that person) and the benefit (the passage mentions what the sentence is
 *    about).
 *  - unsafeNextStep: a next step never states or promises cover or money.
 *  - INTERNAL ids: the ids the tools hand the model (evidence e1, table value v1, computation r1, calculation k...),
 *    tool / field names and record UUIDs are never household-facing: stripInternalIds removes a cited id list the
 *    model wrote into a sentence ("[e9, e6]", "(evidence e2)") and returns the ids, so the caller keeps them as the
 *    sentence's citations; internalIdsIn is the check that nothing of the kind is left in visible text.
 */
import { contentWords } from "./facts";

export const PAYOUT = /\bpay-?outs?\b|\bwill (?:be )?(?:pa(?:y|id)|reimburs\w*|refund\w*)\b|\b(?:you|we|they|he|she|i)(?:’|')?ll (?:get|receive|be paid|be reimbursed)\b|\b(?:you|we|they|he|she|i|it) will (?:get|receive|be paid|be reimbursed)\b|\bwill receive\b|\breimburses? (?:you|him|her|them|the household|the family)\b|\b(?:gets?|getting|got) (?:\S+ ){0,3}back\b|\bget back\b|\b(?:can|could|may|will be able to) (?:still )?claim\b|\bclaimable\b|\bowes?\b|\bowed\b|\bentitled to (?:receive|get|be paid|claim)\b|\bexpect (?:the |your )?(?:money|payment|payout|cheque|check|reimbursement|refund)\b|\b(?:money|payment|payout) (?:within|in|by)\b/i;
const REQUIREMENT_APPROVAL = /\b(?:must|needs? to|has to|have to|should|to|may need to|requires? (?:it|them)? ?to) be (?:pre-?)?approved\b|\bapproved (?:hospital|provider|panel|doctor|clinic)s?\b/gi;
export const DECISION = /\bpre-?approved\b|\bapproved\b|\b(?:medically|already|officially|formally) (?:confirmed|verified|accepted)\b|\b(?:is|are|was|were|has been|have been) (?:now |already )?(?:confirmed|accepted) (?:as|for) (?:a )?(?:claim|cover|payment)\b|\bfully covered\b|\bcovered in full\b|\bdefinitely covered\b|\bguarantee\w*\b|\bwill (?:definitely |certainly )?be covered\b/i;
/** True when the sentence presents money as paid / owed / claimable, or states a claim decision. */
export function payoutOrDecision(text: string): "payout" | "decision" | null {
  // Round 6c: a decision / payout word in the scope of a negation is the opposite of a decision ("this is a limit,
  // not a guaranteed payment", "is not an approval", "does not guarantee", "not a payout") -- removed before testing.
  const t = withoutNegatedDecisions(text);
  if (PAYOUT.test(t)) return "payout";
  if (DECISION.test(t.replace(REQUIREMENT_APPROVAL, " ")) || ENTITLEMENT.test(t)) return "decision";
  return null;
}
/** "you are entitled to", "is entitled to S$750" -- an entitlement is a claim decision (negated or not: "is not
 * entitled to" is a decision too). */
const ENTITLEMENT = /\bentitled to\b|\bentitlement\b/i;
const NEGATOR = String.raw`(?:not|never|no|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|don['’]t|didn['’]t|won['’]t|wouldn['’]t|cannot|can['’]t|without)`;
const FILLER = String.raw`(?:\s+(?:a|an|the|any|yet|be|been|being|itself|in itself|necessarily|automatically|always|by itself|\w+ly))*`;
const DECIDED = String.raw`(?:pre-?approved|approved|approval|approve|guarantee\w*|fully covered|covered in full|definitely covered|confirmed|accepted|a decision|decision|promise\w*|pay-?outs?|payments?)`;
const NEGATED_DECISION = new RegExp(String.raw`\b${NEGATOR}(?:${FILLER}|(?:\s+(?!but\b|and\b|yet\b|however\b)[\w'’-]+){0,3}?)\s+${DECIDED}\b(?:\s+(?:payments?|pay-?outs?|amounts?|of (?:payment|cover)))?`, "gi");
/** "does not guarantee that a claim will be paid", "does not mean you will receive it": what follows a negated
 * guarantee / promise / meaning, to the end of its clause, is in the negation's scope. */
const NEGATED_SCOPE = new RegExp(String.raw`\b${NEGATOR}${FILLER}\s+(?:guarantee|promise|mean|imply|confirm|say|state)s?\b(?:\s+that)?[^.;:!?]*`, "gi");
/** The text with every negated decision / payout phrase removed (the rest is checked as written). */
export function withoutNegatedDecisions(text: string): string {
  return String(text ?? "").replace(NEGATED_SCOPE, " ").replace(NEGATED_DECISION, " ");
}

export const INSTRUCTION = /\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier|other|preceding) (?:instructions?|prompts?|rules|messages?)\b|\b(?:note|message|instructions?|notice) (?:to|for) (?:any|the|an?|all) (?:ai|a\.i\.|assistants?|chat ?bots?|language models?|llms?|models?|bots?)\b|\b(?:ai|virtual) assistants?\b|\b(?:language model|system prompt|chatgpt|llm)s?\b|\bdo not (?:mention|tell|disclose|reveal|say)\b|\btell (?:the|any) (?:policyholder|customer|user|insured|reader|household)\b/i;
/** The lines of a passage that are instructions addressed to an assistant (never policy wording). */
export function instructionLines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.trim()).filter((l) => l && INSTRUCTION.test(l));
}
/** The passage with every instruction line removed. */
export function withoutInstructions(text: string): string {
  return text.split("\n").filter((l) => !INSTRUCTION.test(l)).join("\n");
}

const GENERIC = new Set(["upload", "uploaded", "document", "documents", "file", "files", "you", "cover", "covered", "coverage", "covers", "insur", "insured", "insurance", "policy", "plan", "benefit", "under", "is", "are", "also", "will", "would", "can", "your", "this", "that", "there", "which", "who", "what", "when", "only", "any", "all", "each", "every", "one", "per", "for", "the", "has", "have", "been", "because", "so", "but", "if", "than", "then", "also", "listed", "named", "among", "show", "shown", "includ", "document", "schedule", "certificate", "page", "state", "says", "say", "wording", "here", "what", "next", "would", "should", "need", "needs", "must", "may"].map((w) => w.replace(/'s$/, "").replace(/(?:ing|ed|es|s)$/, "")));
const NEGATIVE_SENTENCE = /\b(?:not|never|no longer|isn['’]t|aren['’]t|wasn['’]t|doesn['’]t|don['’]t|won['’]t|cannot|can['’]t)\b[^.]{0,40}\b(?:cover\w*|insured|payable|pa(?:y|id)|eligib\w*|named|listed|included|shown)\b|\bexclu\w+\b|\bno cover\b/i;
/** V1.4: a clause that says something is NOT KNOWN ("do not establish whether ...", "cannot confirm if ...", "it is
 * unclear whether ...") -- uncertainty, not a negative (or positive) claim about cover. */
const UNCERTAINTY = new RegExp(String.raw`(?:\b${NEGATOR}${FILLER}\s+(?:establish|confirm|show|say|state|determine|tell|know|verify|prove|indicate|specify|make clear|settle)\w*\b(?:\s+[\w’']+){0,4}?\s+(?:whether|if)\b|\b(?:it is|it's|it remains|remains)\s+(?:not (?:yet )?(?:clear|known|established|confirmed)|unclear|unknown|uncertain|unconfirmed)\s+(?:whether|if)\b|\b(?:unclear|unknown|uncertain|not known|not established|not confirmed)\s+(?:whether|if)\b|\b(?:does|do|did)\s+not\s+(?:document|show|establish|evidence|record|prove)\s+(?:any\s+)?(?:[\w’']+\s+){0,2}?cover(?:age)?\b|\b(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t|cannot|can['’]t)\s+(?:establish|confirm|specify|determine|prove|evidence)\b)(?:(?!,?\s+(?:but|however|yet|although|though|while)\b)[^.;:!?])*`, "gi");
// V1.5 (PR #51 review, the live death turn 2: "the uploaded documents do not establish Adrian’s applicable Sum Insured or
// scheme enrollment for this benefit" names WHAT is not established, not "whether ..."; it was left in the asserted
// text, where "not ... Insured" read as an exclusion): "do not establish / confirm / specify / determine / prove <it>"
// is a statement that something is not known, set aside like "does not establish whether".
// V1.5 (review of the s52 travel conclusion): "does not document / show cover for X" says cover is NOT PROVEN -- an
// uncertainty, not an exclusion -- and is set aside like "does not establish whether".
// Death-journey live repair (dj-live-1 D2): two more ways of saying "this is not known" were read as exclusions, so the
// Compassionate Death Allowance and Repatriation sentences ("the document does not say which currency) ... if an insured
// person dies") and "a dated amount is not confirmation of current cover" were dropped whole:
//  - silence about the currency of a printed amount ("does not say / state / print which currency");
//  - "is not confirmation / proof / evidence of (current) cover": a dated amount is not proof of cover now.
const CURRENCY_SILENCE = /\b(?:do|does|did)\s+not\s+(?:say|state|print|name|give|identify|show|specify)\s+(?:which|what|the)\s+currency\b[^;.):!?]*\)?/gi;
const NOT_PROOF_OF_COVER = /\b(?:is|are|was|were)\s+not\s+(?:a\s+|any\s+)?(?:confirmation|proof|evidence|guarantee)\s+of\s+(?:\w+\s+){0,2}?(?:cover|coverage|enrol?lment)\b/gi;
export function withoutUncertainty(text: string): string { return String(text ?? "").replace(UNCERTAINTY, " ").replace(CURRENCY_SILENCE, " ").replace(NOT_PROOF_OF_COVER, " "); }
/** V1.4: an affirmative claim that cover IS / WAS in force (or active / current). */
const IN_FORCE_CLAIM = /\b(?:is|was|were|are|remains?|remained|has been|had been)\s+(?:still\s+|then\s+)?(?:in force|in effect|active|current)\b/i;
const VALIDITY_PASSAGE = /\bperiod of (?:insurance|cover)\b|\bvalid (?:from|until|till|to)\b|\bin force\b|\bexpir\w*\b|\brenew\w*\b|\b(?:from|commencing)\s+\d{1,2}[\s\/.-]\w+[\s\/.-]\d{2,4}\s+(?:to|until|-)\s+\d/i;
const NEGATIVE_PASSAGE = /\bnot\b|\bexclu\w+\b|\bno (?:benefit|cover)\b|\bshall not\b|\bdoes not\b|\bunless\b|\bonly if\b/i;
const MEMBERSHIP = /\b(?:named|listed|included|shown|among|on the (?:list|schedule|certificate))\b/i;
/** A list of the people a document insures. */
const INSURED_LIST = /\b(?:insured (?:persons|members|children|lives)|lives? assured|persons? insured|insured child(?:ren)?:|covered persons)\b/i;
const POSITIVE_COVER = /\b(?:is|are|was|were)\s+(?:\w+\s+)?(?:covered|insured|eligible)\b|\bcovers\b|\bis payable\b/i;
const COVER_PASSAGE = /\bcover\w*|\binsured\b|\bassured\b|\bpay\w*|\bbenefits?\b|\bentitle\w*/i;

export type CitedEvidence = { policyId: string; subjectId?: string | null; text: string };
export type StatementCtx = {
  /** Household members: id, the names a sentence may use for them. */
  people: { id: string; names: string[] }[];
  /** Readable documents: id -> product name. */
  policyNames: Map<string, string>;
  /** V1.1: what each document states on its face (product, insurer, numbers, amendment role). */
  docFacts?: Map<string, string>;
  /** Who the sentence is about (resolved), when known. */
  subjectId: string | null;
  /** V1.5: a trip conclusion ("does not cover a trip to Japan in October 2026") already checked against the person's
   * own cited schedule -- a printed exclusion naming the place, or a printed period the trip falls outside. */
  negativeVerified?: boolean;
};
const tokensOf = (name: string) => (name.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? []);
/** Words every insurance document title shares: never the distinctive word of a product name. */
const GENERIC_TITLE_WORDS = new Set(["insurance", "group", "benefit", "benefits", "summary", "policy", "wording", "schedule", "certificate", "document", "scheme", "plan", "booklet", "table", "the", "and", "for", "of"]);
/** The distinctive word of a product name ("KidSafe" in "KidSafe Family Accident Plan"). PR #54: a title made only of
 * generic words ("Insurance Benefits Summary") has none, and is then named only by its whole title -- otherwise any
 * sentence saying "Insurance" (e.g. "Group Insurance Benefits Booklet") would name it. */
const productKey = (name: string) => (tokensOf(name).find((w) => /[A-Z].*[A-Z]|[a-z][A-Z]/.test(w)) ?? tokensOf(name).find((w) => !GENERIC_TITLE_WORDS.has(w.toLowerCase())) ?? "").toLowerCase();
const namesProduct = (text: string, name: string) => {
  const key = productKey(name);
  if (key) return new RegExp("\\b" + key.replace(/[^a-z0-9]/g, "") + "\\b", "i").test(text);
  const words = tokensOf(name);
  return words.length > 0 && new RegExp("\\b" + words.map((w) => w.replace(/[^A-Za-z0-9]/g, "")).join("\\W+") + "\\b", "i").test(text);
};

/** Why a figure-free cited sentence is not supported by what it cites (null when it is). */
export function checkCitedStatement(text: string, cited: CitedEvidence[], ctx: StatementCtx): string | null {
  if (!cited.length) return null;
  const all = cited.map((c) => withoutInstructions(c.text)).join("\n");
  const lower = all.toLowerCase();
  if (!all.trim()) return "its cited passage is an instruction inside the document, not policy wording";
  // Policy: a product the sentence names must be one it cites.
  const citedPolicies = new Set(cited.map((c) => c.policyId));
  const citedKeys = new Set([...citedPolicies].map((id) => productKey(ctx.policyNames.get(id) ?? "")).filter(Boolean));
  for (const [id, name] of ctx.policyNames) {
    const key = productKey(name);
    if (citedPolicies.has(id) || (key && citedKeys.has(key))) continue;
    if (namesProduct(text, name)) return `it names ${name} but cites another document`;
  }
  // Person: a member named in the sentence whose evidence was all read for another member.
  const named = ctx.people.filter((p) => p.names.some((n) => n && new RegExp("\\b" + n.replace(/[^A-Za-z' -]/g, "") + "\\b", "i").test(text)));
  const readFor = new Set(cited.map((c) => c.subjectId).filter(Boolean) as string[]);
  // V1.1: evidence read once for one member and reused for another is still theirs when the passage itself names them.
  const inPassage = (p: { names: string[] }) => p.names.some((n) => n && n.length >= 3 && new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(all));
  for (const p of named) if (readFor.size && !readFor.has(p.id) && !inPassage(p) && ![...readFor].some((r) => named.some((q) => q.id === r))) return `it is about ${p.names[0]} but its evidence was read for someone else`;
  // Polarity -- of what the sentence ASSERTS: a statement of uncertainty ("the documents do not establish whether the
  // cover was in force", "it is not clear whether ...") asserts neither cover nor its absence, so its clause is set
  // aside first (V1.4).
  const asserted = withoutUncertainty(text);
  if (IN_FORCE_CLAIM.test(asserted) && !VALIDITY_PASSAGE.test(all)) return "it states that cover was / is in force, but its evidence prints no period or status that establishes it (a dated amount is not proof of cover on a later date)";
  if (NEGATIVE_SENTENCE.test(asserted) && !ctx.negativeVerified) {
    const membership = MEMBERSHIP.test(text);
    const absent = membership && named.length > 0 && named.every((p) => !p.names.some((n) => n && lower.includes(n.toLowerCase())));
    if (!NEGATIVE_PASSAGE.test(all) && !absent) return "it says something is not covered / not included, but its evidence says nothing of the kind";
  } else if (POSITIVE_COVER.test(asserted)) {
    if (!COVER_PASSAGE.test(all)) return "it states cover, but its evidence is not about cover";
    for (const p of named) if (INSURED_LIST.test(all) && !p.names.some((n) => n && lower.includes(n.toLowerCase()))) return `it says ${p.names[0]} is covered, but the cited list of insured persons does not name them`;
  }
  // Benefit / topic: the passage mentions what the sentence is about.
  const nameWords = new Set(ctx.people.flatMap((p) => p.names.flatMap((n) => contentWords(n))));
  const productWords = new Set([...ctx.policyNames.values()].flatMap((n) => contentWords(n)));
  const specific = contentWords(asserted).filter((w) => !GENERIC.has(w) && !nameWords.has(w) && !productWords.has(w));
  // (A verified trip conclusion's place and month are the trip asked about, already checked against the schedule.)
  if (specific.length && !ctx.negativeVerified) {
    const face = [...new Set(cited.map((c) => c.policyId))].map((id) => ctx.docFacts?.get(id) ?? "").join(" ");
    const have = new Set([...contentWords(all), ...contentWords(face)]);
    const hit = specific.filter((w) => have.has(w) || lower.includes(w) || face.toLowerCase().includes(w));
    if (!hit.length) return `its evidence does not mention what it is about (${specific.slice(0, 4).join(", ")})`;
  }
  return null;
}

const STEP_COVER = /\b(?:you are|you['’]re|he is|he['’]s|she is|she['’]s|they are|they['’]re|it is|it['’]s|this is|is|are)\s+(?:\w+\s+)?(?:covered|insured|eligible|entitled)\b|\bcover(?:s|ed)? (?:this|it|that|the (?:cost|bill|claim|stay))\b|\bwill (?:be )?(?:cover|pay|reimburs)\w*\b/i;
/** Why a next step may not be shown (null when it may): it states or promises cover, a payment or a decision. */
export function unsafeNextStep(step: string): string | null {
  const p = payoutOrDecision(step);
  if (p) return p === "payout" ? "a next step that promises money" : "a next step that states a claim decision";
  if (STEP_COVER.test(step) && !/\b(?:whether|if|check|ask|confirm with|find out)\b/i.test(step)) return "a next step that states cover without evidence";
  return null;
}

const ID = String.raw`(?:[evr]\d{1,4}|k[0-9a-f]{10})`;
/** An internal id, tool or field name, or record UUID in household-facing text. */
export const INTERNAL_ID = new RegExp(String.raw`\b${ID}\b|\b(?:evidence_ids?|value_ids?|result_ids?|subject_id|policy_id|fact_key|select_table_value|search_passages|policies_for|resolve_person|read_page|final_answer|ask_user|note_facts)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`);
/** Every internal id / name left in the text (empty when it is household-facing). */
export function internalIdsIn(text: string): string[] {
  return [...String(text ?? "").matchAll(new RegExp(INTERNAL_ID.source, "g"))].map((m) => m[0]);
}
const ID_LIST = new RegExp(String.raw`\s*[\[(]\s*(?:(?:evidence|values?|results?|sources?|ids?|refs?|see|cf\.?)\s*:?\s*)*${ID}(?:\s*(?:,|;|/|&|and)\s*${ID})*\s*[\])]`, "g");
const LEAD_LIST = new RegExp(String.raw`\s*\b(?:evidence|value|result|source)s?\s*:?\s*${ID}(?:\s*(?:,|;|/|&|and)\s*${ID})*\b`, "gi");
/** A model's own inline citation marker (private-use delimiters: U+E200 "cite" U+E202 id [U+E202 id ...] U+E201), as
 * gpt-6-luna writes it into final_answer text -- its ids are the sentence's citations, never shown. */
const MODEL_CITE = new RegExp(String.raw`\s*\uE200\s*cite\s*(?:\uE202\s*${ID}\s*)+\uE201`, "g");
/** The text without the internal ids the model wrote into it, and those ids (to be kept as its citations). */
export function stripInternalIds(text: string): { text: string; ids: string[] } {
  const ids: string[] = [];
  const take = (m: string) => { for (const x of m.match(new RegExp(ID, "g")) ?? []) if (!ids.includes(x)) ids.push(x); return ""; };
  const out = String(text ?? "").replace(MODEL_CITE, take).replace(/[\uE200-\uE2FF]/g, "").replace(ID_LIST, take).replace(LEAD_LIST, take)
    .replace(/\s+([.,;:!?])/g, "$1").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").trim();
  return { text: out, ids };
}
