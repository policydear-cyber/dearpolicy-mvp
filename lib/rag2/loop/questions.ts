/**
 * Agent F: what a single ask_user question may be (pure; no database access).
 *  - compoundQuestion: two questions in one sentence are caught by STRUCTURE, not by counting "?" -- two interrogative
 *    clauses ("When was he admitted, and when was he discharged?", "Which hospital was it and what time was he
 *    admitted?") or two yes/no clauses joined by "and". One fact asked with an either/or ("was it an accident, or did
 *    it come from an illness?") or one clause naming two parts of one answer ("On what date and at what time ...?")
 *    is one question.
 *  - relevantEvidence: the cited "why" must be about the fact asked -- it shares the fact's subject (its own words,
 *    or the vocabulary of that kind of fact: admission / discharge / stay times with confinement and day-count
 *    wording, how it happened with accident / illness wording, a bill with expense / reimbursement wording).
 */
import { contentWords } from "./facts";
import { factConcept } from "./facts";

const WH = "(?:when|what|which|where|who|whom|whose|how|why)";
const AUX = "(?:was|were|is|are|am|did|does|do|will|would|can|could|has|have|had|should)";
/** An interrogative clause: a wh-word, at most two words, then an auxiliary verb ("what time was", "how did", "when was"). */
const WH_CLAUSE = new RegExp(`\\b${WH}(?:\\s+(?!and\\b|or\\b)[a-z'’-]+){0,2}?\\s+${AUX}\\b`, "gi");
/** A yes/no clause after "and": ", and was he discharged", "and did she stay". */
const AND_AUX = new RegExp(`(?:,\\s*|\\s)and\\s+${AUX}\\s+(?:he|she|they|it|you|we|i|there|[A-Z][a-z]+)\\b`, "g");
const LEAD_AUX = new RegExp(`^\\s*${AUX}\\s+(?:he|she|they|it|you|we|i|there|[A-Z][a-z]+)\\b`, "i");

export function compoundQuestion(question: string): string | null {
  const q = question.replace(/\s+/g, " ").trim();
  const wh = q.match(WH_CLAUSE) ?? [];
  if (wh.length >= 2) return `two questions in one ("${wh[0]!.trim()} …" and "${wh[1]!.trim()} …"): ask exactly one question`;
  const andAux = q.match(AND_AUX) ?? [];
  if (andAux.length && (wh.length || LEAD_AUX.test(q))) return "two questions joined by \"and\": ask exactly one question";
  return null;
}

const GENERIC = new Set(["what", "when", "which", "where", "who", "how", "why", "time", "date", "day", "was", "were", "did", "does", "the", "about", "tell", "please", "know", "need", "exactly", "around", "approximately", "roughly", "much", "many"].map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
const STAY = ["hospital", "hospitali", "admi", "admission", "admitted", "discharg", "confin", "inpatient", "hour", "day", "night", "stay", "ward", "period", "noon", "full day", "24"];
const VOCAB: Record<string, string[]> = {
  admission: STAY, discharge: STAY, stay_length: STAY,
  cause: ["accident", "accidental", "illness", "sickness", "disease", "injur", "caused", "cause", "degenerative", "gradual", "external", "violent"],
  bill: ["bill", "expense", "reimburs", "medical", "charge", "cost", "incurred", "limit", "excess", "deductible", "co-insurance", "receipt", "invoice"],
  hospital: ["hospital", "panel", "network", "private", "public", "ward", "restructured"],
};

/** True when the cited passage(s) are about the fact the question asks for. `names` are household names (never a
 * shared subject on their own). */
export function relevantEvidence(question: string, factKey: string, evidenceTexts: string[], names: string[] = []): boolean {
  const text = evidenceTexts.join("\n").toLowerCase();
  if (!text.trim()) return false;
  const c = factConcept(factKey);
  const vocab = VOCAB[c.concept];
  if (vocab && vocab.some((w) => text.includes(w))) return true;
  const nameWords = new Set(names.flatMap((n) => contentWords(n)));
  const useful = (ws: string[]) => ws.filter((w) => !GENERIC.has(w) && !nameWords.has(w));
  const asked = useful(contentWords(question));
  const want = new Set(asked.length ? asked : useful(contentWords(factKey.replace(/_/g, " "))));
  if (!want.size) return false;
  const have = new Set(contentWords(text));
  return [...want].some((w) => have.has(w));
}
