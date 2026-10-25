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
import { factConcept, MECHANISM } from "./facts";

const WH = "(?:when|what|which|where|who|whom|whose|how|why)";
const AUX = "(?:was|were|is|are|am|did|does|do|will|would|can|could|has|have|had|should)";
/** An interrogative clause: a wh-word, at most two words, then an auxiliary verb ("what time was", "how did", "when was"). */
const WH_CLAUSE = new RegExp(`\\b${WH}(?:\\s+(?!and\\b|or\\b)[a-z'’-]+){0,2}?\\s+${AUX}\\b`, "gi");
/** A yes/no clause after "and": ", and was he discharged", "and did she stay". */
/** (V1.2: also a determiner after the auxiliary -- ", and had any benefit already been paid".) */
const AND_AUX = new RegExp(`(?:,\\s*|\\s)and\\s+${AUX}\\s+(?:he|she|they|it|you|we|i|there|any|anything|anyone|the|his|her|their|a|an|this|that|[A-Z][a-z]+)\\b`, "g");
const LEAD_AUX = new RegExp(`^\\s*${AUX}\\s+(?:he|she|they|it|you|we|i|there|[A-Z][a-z]+)\\b`, "i");

/** V1.2: a wh-question with a yes/no clause joined by "and" (\"What were the admission and discharge times, and had any
 * benefit already been paid?\") asks its first clause only; the second is its own question, asked later. Null when the
 * question is not of that shape (two wh-clauses stay refused: which one is meant is the model's choice). */
export function firstClauseOnly(question: string): string | null {
  const q = question.replace(/\s+/g, " ").trim();
  if ((q.match(WH_CLAUSE) ?? []).length !== 1) return null;
  AND_AUX.lastIndex = 0;
  const m = AND_AUX.exec(q); AND_AUX.lastIndex = 0;
  if (!m || m.index < 8) return null;
  const head = q.slice(0, m.index).replace(/[\s,;:]+$/, "");
  return WH_CLAUSE.test(head) && (WH_CLAUSE.lastIndex = 0, true) ? head + "?" : null;
}

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
const TIME_LIMIT = /\bwithin\s+\d+\s*(?:calendar\s+)?(?:days?|weeks?|months?|years?|hours?)\b|\b\d+\s*(?:days?|months?|years?)\s+(?:of|from|after|before)\b|\bcover\s+(?:for\s+[^.]{0,40}\s+)?(?:ends|starts|begins|ceases)\b|\bperiod of (?:insurance|cover)\b|\bin force\b/i;
export function relevantEvidence(question: string, factKey: string, evidenceTexts: string[], names: string[] = []): boolean {
  const text = evidenceTexts.join("\n").toLowerCase();
  if (!text.trim()) return false;
  const c = factConcept(factKey);
  const vocab = VOCAB[c.concept];
  if (vocab && vocab.some((w) => text.includes(w))) return true;
  // Round 9: the date of an event matters to a clause that counts time from it or limits cover in time ("within 365
  // days of the Accident", "cover ends on the date ...").
  if ((c.grain === "date" || c.grain === "time" || /(?:^|_)(?:date|datetime|when)(?:_|$)/.test(factKey)) && TIME_LIMIT.test(text)) return true;
  const nameWords = new Set(names.flatMap((n) => contentWords(n)));
  const useful = (ws: string[]) => ws.filter((w) => !GENERIC.has(w) && !nameWords.has(w));
  const asked = useful(contentWords(question));
  const want = new Set(asked.length ? asked : useful(contentWords(factKey.replace(/_/g, " "))));
  if (!want.size) return false;
  const have = new Set(contentWords(text));
  return [...want].some((w) => have.has(w));
}


/**
 * Production fracture conversation (19 Oct 2026): "Was Mei Ling's fracture confirmed by X-ray and certified by a
 * registered medical practitioner?" passed relevantEvidence because ONE word ("fracture") was shared with the cited
 * clause, although neither cited page prints an X-ray or a practitioner's certificate for that benefit. A question that
 * asks for a requirement is justified only by wording that prints it. Returns the asked words the cited wording does not
 * contain when the question is mostly such words (a long question of which under a third is in the cited wording);
 * null when the wording supports the question or the question is too short to judge (never refuses a short question).
 */
export function unprintedAsk(question: string, factKey: string, evidenceTexts: string[], names: string[] = []): string[] | null {
  const c = factConcept(factKey);
  if (VOCAB[c.concept]) return null; // admission / discharge / cause / bill / hospital facts have their own vocabulary check
  // Only a question asserting a condition for a yes/no answer ("Was it confirmed by ...?"): one choosing among printed cases
  // ("Which bone ...?") is answered by the printed list.
  if (/^\s*(?:which|what|when|where|who|whom|whose|how|why|on\s+what|in\s+which)\b/i.test(question)) return null;
  const nameWords = new Set(names.flatMap((n) => contentWords(n)));
  const useful = (ws: string[]) => [...new Set(ws.filter((w) => !GENERIC.has(w) && !nameWords.has(w)))];
  const have = new Set(contentWords(evidenceTexts.join("\n")));
  // (1) A question that asserts a PROCEDURE or proof ("confirmed by X-ray", "certified by a registered medical practitioner") is a
  // requirement the wording either prints or does not, however short the question is: it is supported when the cited wording prints
  // anything of that procedure (what is done, or by whom), and not asked when it prints none of it.
  const proc = PROCEDURE.exec(question);
  if (proc) {
    const terms = useful(contentWords(question.slice(proc.index)));
    return terms.length && !terms.some((w) => have.has(w)) ? terms : null;
  }
  // (2) Otherwise word overlap is only a heuristic. A question phrased differently from the print ("Did the stay run through a whole
  // day?") is still about the printed requirement when the fact the model keyed it under is named in the cited wording
  // (continuous_confinement: "confined ... continuous period"): that question is asked. Only a long question that shares under a
  // third of its words with the wording, under a key the wording does not print either, is not asked.
  const keyWords = useful(contentWords(factKey.replace(/_/g, " ")));
  const printed = (w: string) => have.has(w) || (w.length >= 5 && [...have].some((h) => h.length >= 5 && h.slice(0, 5) === w.slice(0, 5)));
  if (keyWords.length && keyWords.every(printed)) return null;
  const asked = useful(contentWords(question));
  if (asked.length < 4) return null;
  const missing = asked.filter((w) => !have.has(w));
  return (asked.length - missing.length) / asked.length < 1 / 3 ? missing : null;
}
/** A question asserting that something was done or proved by someone or something. */
const PROCEDURE = /\b(?:confirm\w*|certif\w*|verif\w*|prov(?:ed|en)|diagnos\w*|document\w*|attest\w*|witness\w*|sign(?:ed)?|approv\w*|author[ie]s?d|endors\w*|referr?ed|prescrib\w*)\b[^?]{0,60}\b(?:by|with|from|through)\b/i;

/**
 * Agent P (task 5): the words of the household's message that already give the fact a question would ask for (null
 * when the message does not give it). Admission / discharge: the keyword with a date or time in the same clause;
 * a bill: a money figure next to bill / invoice / cost wording; how it happened: an accident mechanism in their words.
 * The loop's ask_user can refuse a question this returns words for ("record it with note_facts instead").
 */
const MONTHS = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WHEN = new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTHS}\b|\b${MONTHS}\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b|\b\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}[:.]\d{2}\b|\b(?:yesterday|today|last night|this morning|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\bnoon\b|\bmidnight\b`, "i");
const STATED: Record<string, { kw: RegExp; value: RegExp }> = {
  admission: { kw: /\b(?:admitted|admission|admit|checked in|went into hospital|was warded|got warded)\b/i, value: WHEN },
  discharge: { kw: /\b(?:discharged|discharge|checked out|came home|went home|left (?:the )?hospital)\b/i, value: WHEN },
  bill: { kw: /\b(?:bill|invoice|cost|charged|came to|paid)\b/i, value: /S\$\s?\d|\$\s?\d|\bSGD\s?\d|\d\s?(?:dollars|SGD)\b/i },
};
export function statedInMessage(factKey: string, message: string): string | null {
  const c = factConcept(factKey).concept;
  if (c === "cause") { const m = MECHANISM.exec(message); return m ? message.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim() : null; }
  const spec = STATED[c];
  if (!spec) return null;
  const others = Object.entries(STATED).filter(([k]) => k !== c).map(([, o]) => o.kw);
  for (const m of message.matchAll(new RegExp(spec.kw.source, "gi"))) {
    const at = m.index ?? 0;
    // After the keyword: up to the clause end or the next other fact's keyword.
    let after = message.slice(at, at + 80);
    const end = after.search(/[.;!?](?:\s|$)/); if (end > 0) after = after.slice(0, end);
    for (const o of others) { const k = after.slice(m[0].length).search(o); if (k >= 0) after = after.slice(0, m[0].length + k); }
    // Before it: back to the clause start or the previous other fact's keyword ("On 2 October he was admitted").
    let before = message.slice(Math.max(0, at - 40), at);
    const cut = Math.max(before.search(/[.;!?]\s[^.;!?]*$/), ...others.map((o) => { let last = -1; for (const x of before.matchAll(new RegExp(o.source, "gi"))) last = (x.index ?? 0) + x[0].length; return last; }));
    if (cut >= 0) before = before.slice(cut + 1);
    if (spec.value.test(after)) return after.trim();
    if (spec.value.test(before)) return (before + after).trim();
  }
  return null;
}

/**
 * PR #54 follow-up (rc-live-5 BKL1: "Does Daniel's diagnosis meet the booklet's definition of “Hip” ..., as determined by
 * the insurer's medical assessment?"): who can resolve what a question asks. The household reports what happened and
 * what they can observe or were told (which bone, closed or open, dates, what the doctor said); whether that satisfies
 * the policy's terms -- meets a definition, qualifies, is accepted or approved -- is the insurer's assessment. Used at the
 * requirement / ask_user boundary: an insurer requirement is stated as a condition, never asked.
 */
const JUDGEMENT = /\b(?:meets?|met|satisf(?:y|ies|ied)|qualif(?:y|ies|ied)|falls? (?:with)?in|counts? as|(?:be|is|are|was|were|been) (?:classed|classified|treated|considered|regarded|accepted|approved|assessed|deemed|recognised|recognized|admitted)|eligib\w*|approv\w*|accept\w*|assess\w*|determin\w*|deem\w*|decid\w*|decision|adjudicat\w*)\b/i;
const TERMS = /\b(?:definitions?|defined|policy|policies|booklet|wording|terms?|criteria|benefits?|insurer\w*|claims?|cover(?:ed|age)?|payable|underwrit\w*)\b/i;
export function resolverOf(question: string, factKey = ""): "household" | "insurer" {
  const t = `${question} ${factKey.replace(/_/g, " ")}`;
  if (/\binsurer\b/i.test(factKey)) return "insurer";
  return JUDGEMENT.test(t) && TERMS.test(t) ? "insurer" : "household";
}
