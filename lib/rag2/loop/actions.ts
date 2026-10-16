/**
 * Conversational RAG (Prompt 2): the loop's own actions, offered to the model beside the lib/rag2 tools.
 *  - note_facts:   record facts the household stated about the event (a correction replaces the old value).
 *  - ask_user:     end the turn with ONE question (who is meant, or one fact that changes eligibility or amount),
 *                  optionally after statements (the identified benefit, conditionally) composed like final_answer.
 *  - final_answer: end the turn with the answer, as sentences each citing the evidence it rests on.
 * The visible reply is composed only from ask_user / final_answer (compose.ts); free text from the model is never shown.
 */
import type { JsonSchema } from "../tools";
import type { LoopToolSpec } from "./types";

const str = (description: string): JsonSchema => ({ type: "string", description });
const ids = (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description });

export const NOTE_FACTS: LoopToolSpec = {
  name: "note_facts",
  description: "Record facts the household has stated about the event (what happened and how, nights in hospital, admission / discharge dates and times, amounts billed...), each quoting their own words verbatim from this conversation; the value must be what those words say. Refused: a policy-defined classification they did not state in those terms (cause=accident, illness, a diagnosis -- record how_it_happened in their words instead), a quantity the policy works out (payable days, claimable amounts), a count in another unit than they used (nights are not days). A paraphrase is kept but marked unconfirmed and cannot be used in a calculation. A fact printed in a document may be recorded with evidence_ids instead of words. Giving a key that is already recorded replaces it only when the household corrects it (they say \"actually\", \"sorry\", \"not ...\", \"I meant\", or a count, amount, date or yes/no changes); anything worked out from the old value is then withdrawn. A further detail about something already recorded (\"transverse fracture\" after \"broke his leg\") is new information: give it its own key (e.g. fracture_pattern); if you reuse the key it is kept beside the first report as <key>_detail, never shown as a correction. Never record a guess.",
  parameters: { type: "object", properties: {
    subject_id: str("The household member the event is about (from resolve_person)."),
    facts: { type: "array", items: { type: "object", properties: {
      key: str("A short stable key, e.g. how_it_happened, injury, admitted, nights_in_hospital, admission_datetime, discharge_datetime, bill_amount."),
      value: { type: "string", description: "The value, as text (a number as digits, e.g. \"3\" or \"2400\"; yes/no as \"yes\"/\"no\")." },
      words: str("The household's own words this comes from, quoted verbatim."),
      evidence_ids: ids("Instead of words: evidence ids of a document passage that prints this fact."),
      currency: str("ISO currency of an amount the household gave, e.g. SGD (only when they gave one)."),
    }, required: ["key", "value"], additionalProperties: false } },
  }, required: ["facts"], additionalProperties: false },
};

/** One sentence of the visible answer and what it rests on (final_answer, and ask_user's statements). */
const SENTENCE: JsonSchema = { type: "object", properties: {
  kind: { type: "string", enum: ["fact", "calculation", "benefit_terms", "uncertainty", "suggestion", "library_status"], description: "What this statement is. calculation: an evaluate_benefit result (give result_id; the server writes the figures, base and source). benefit_terms: a benefit's printed terms (give benefit_id; the server writes them). fact: something a cited passage states. uncertainty: what the documents do not establish (e.g. cover on a later date). suggestion: a general, labelled suggestion (no figures, no requirement the documents do not print). library_status: what documents the household has. One claim per statement: never join two benefits, two insurers or two conditions in one statement." },
  benefit_id: str("kind benefit_terms: the benefit (b...) from person_benefits."),
  text: str("One sentence as the household will read it (no ids: cite with the fields below). For kind calculation / benefit_terms the server writes it; leave it short."),
  evidence_ids: ids("Evidence ids (e1, e2...) the sentence rests on."),
  value_ids: ids("Value ids (v1...) from select_table_value whose figures the sentence states."),
  result_id: str("A result id (r1...) from compute whose result the sentence states."),
  result_ids: ids("Instead of result_id, for one sentence comparing alternatives: two or more calculate result ids of the same person whose amounts the sentence states (e.g. the open and closed illustrations of one row)."),
  benefit: str("The benefit / row the sentence's figure is printed for, as the document words it (when citing a passage rather than a table value)."),
  subject_id: str("Who this sentence is about, if not the answer's subject."),
}, required: ["text"], additionalProperties: false };

export const ASK_USER: LoopToolSpec = {
  name: "ask_user",
  description: "End this turn by asking the household ONE question. kind=person: who they mean, offering the candidates resolve_person returned (option ids). kind=fact: one fact that changes eligibility or the amount under a benefit you have found. When evaluate_benefit returned a requirement_id (what it still needs), pass that requirement_id and phrase the question: the server supplies the person, the fact and the evidence. Otherwise give fact_key, subject_id and the evidence ids that make it matter. Never ask for a fact already recorded. One question only. When you have already identified the benefit and this person's printed figure, give it first in statements -- as printed, with its conditions (\"payable if ...\"), cited -- then ask the one question that is still open; never as an amount they will get.",
  parameters: { type: "object", properties: {
    kind: { type: "string", enum: ["person", "fact"] },
    question: str("The single question, in plain words, ending with a question mark. It is shown once, as the question card."),
    statements: { type: "array", items: SENTENCE, description: "kind=fact, optional: what the documents already say that the household needs before the question -- e.g. the identified benefit for this person, said conditionally and citing its evidence. Checked exactly like final_answer sentences (a figure must be printed in its cited evidence; never a payout or a decision). Statements, not questions." },
    preface: str("Optional short lead-in before the question (e.g. sympathy). A figure or a statement about cover belongs in statements with its evidence."),
    requirement_id: str("kind=fact: the requirement_id evaluate_benefit returned for what it still needs (this turn). The server fills in fact_key, subject_id and because_evidence_ids from it."),
    fact_key: str("kind=fact, without requirement_id: the key the answer will be recorded under (see note_facts)."),
    subject_id: str("kind=fact: who the fact is about."),
    because_evidence_ids: ids("kind=fact: evidence ids of the benefit / clause that makes this fact matter."),
    options: ids("kind=person: the candidate member ids (from resolve_person). kind=fact: optional answer choices."),
    mention: str("kind=person: the words the household used (\"my son\")."),
  }, required: ["kind", "question"], additionalProperties: false },
};

export const FINAL_ANSWER: LoopToolSpec = {
  name: "final_answer",
  description: "End this turn with the answer. Each sentence is one sentence. A sentence that states anything about the household's cover, a benefit, a limit, a figure or a condition MUST cite evidence: evidence_ids (passages) and/or value_ids (from select_table_value) and/or result_id (from compute). Every money figure in a sentence must be printed in its cited evidence or be the cited computation's result. A sentence with no evidence may only connect or explain (no figures, no cover statements). An estimate is stated only from a compute result, says 'indicative estimate', and is never called a payout or added into a total.",
  parameters: { type: "object", properties: {
    subject_id: str("The household member the answer is about (when it is about one)."),
    sentences: { type: "array", items: SENTENCE },
    next_steps: { type: "array", items: { type: "string" }, description: "Optional practical next steps (no figures), one action each. To say who to contact about a document, give the step as \"contact:<policy_id>\": the server writes it naming that document's own insurer." },
  }, required: ["sentences"], additionalProperties: false },
};

export const LOOP_ACTIONS: LoopToolSpec[] = [NOTE_FACTS, ASK_USER, FINAL_ANSWER];

const ID_KEY = /^\s*[evr]\d+(?:\s*,\s*[evr]\d+)*\s*$/;
/**
 * V1.4: a citation written as an object KEY instead of in its field ({"e2": ["e2"]}, {"e8,e9": [...]}), in a sentence
 * of final_answer / ask_user: unambiguous (the key is nothing but evidence / value / result ids, and its value adds
 * only the same kind of ids), so the ids are moved into evidence_ids / value_ids / result_ids -- the sentence's text and
 * every other field untouched, and the ids still checked like any citation. Anything else stays an error. Returns what
 * was moved (for the trace).
 */
export function normalizeCitationKeys(sentences: unknown): string[] {
  const moved: string[] = [];
  if (!Array.isArray(sentences)) return moved;
  const allowed = new Set(Object.keys(SENTENCE.properties ?? {}));
  for (const x of sentences) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (allowed.has(k) || !ID_KEY.test(k)) continue;
      const v = o[k];
      const extra = Array.isArray(v) ? v : typeof v === "string" ? [v] : v === true || v == null ? [] : null;
      if (!extra || !extra.every((e) => typeof e === "string" && ID_KEY.test(e))) continue;
      const ids = [...new Set([...k.split(","), ...(extra as string[]).flatMap((e) => e.split(","))].map((e) => e.trim()))];
      const put = (field: string, want: string) => { const add = ids.filter((i) => i.startsWith(want)); if (add.length) o[field] = [...new Set([...((o[field] as string[]) ?? []), ...add])]; };
      put("evidence_ids", "e"); put("value_ids", "v");
      const r = ids.filter((i) => i.startsWith("r"));
      if (r.length === 1 && !o.result_id) o.result_id = r[0]; else if (r.length) o.result_ids = [...new Set([...((o.result_ids as string[]) ?? []), ...r])];
      delete o[k];
      moved.push(`${k} -> citation fields`);
    }
  }
  return moved;
}
export const TERMINAL = new Set(["ask_user", "final_answer"]);
