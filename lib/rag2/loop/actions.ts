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
  description: "Record facts the household has stated about the event (what happened and how, nights in hospital, admission / discharge dates and times, amounts billed...), each quoting their own words verbatim from this conversation; the value must be what those words say. Refused: a policy-defined classification they did not state in those terms (cause=accident, illness, a diagnosis -- record how_it_happened in their words instead), a quantity the policy works out (payable days, claimable amounts), a count in another unit than they used (nights are not days). A paraphrase is kept but marked unconfirmed and cannot be used in a calculation. A fact printed in a document may be recorded with evidence_ids instead of words. Giving a key that is already recorded replaces it (a correction); anything worked out from the old value is withdrawn. Never record a guess.",
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
  text: str("One sentence as the household will read it (no ids: cite with the fields below)."),
  evidence_ids: ids("Evidence ids (e1, e2...) the sentence rests on."),
  value_ids: ids("Value ids (v1...) from select_table_value whose figures the sentence states."),
  result_id: str("A result id (r1...) from compute whose result the sentence states."),
  benefit: str("The benefit / row the sentence's figure is printed for, as the document words it (when citing a passage rather than a table value)."),
  subject_id: str("Who this sentence is about, if not the answer's subject."),
}, required: ["text"], additionalProperties: false };

export const ASK_USER: LoopToolSpec = {
  name: "ask_user",
  description: "End this turn by asking the household ONE question. kind=person: who they mean, offering the candidates resolve_person returned (option ids). kind=fact: one fact that changes eligibility or the amount under a benefit you have found -- cite the evidence ids that make it matter. Never ask for a fact already recorded. One question only. When you have already identified the benefit and this person's printed figure, give it first in statements -- as printed, with its conditions (\"payable if ...\"), cited -- then ask the one question that is still open; never as an amount they will get.",
  parameters: { type: "object", properties: {
    kind: { type: "string", enum: ["person", "fact"] },
    question: str("The single question, in plain words, ending with a question mark. It is shown once, as the question card."),
    statements: { type: "array", items: SENTENCE, description: "kind=fact, optional: what the documents already say that the household needs before the question -- e.g. the identified benefit for this person, said conditionally and citing its evidence. Checked exactly like final_answer sentences (a figure must be printed in its cited evidence; never a payout or a decision). Statements, not questions." },
    preface: str("Optional short lead-in before the question (e.g. sympathy). A figure or a statement about cover belongs in statements with its evidence."),
    fact_key: str("kind=fact: the key the answer will be recorded under (see note_facts)."),
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
    next_steps: { type: "array", items: { type: "string" }, description: "Optional practical next steps (no figures)." },
  }, required: ["sentences"], additionalProperties: false },
};

export const LOOP_ACTIONS: LoopToolSpec[] = [NOTE_FACTS, ASK_USER, FINAL_ANSWER];
export const TERMINAL = new Set(["ask_user", "final_answer"]);
