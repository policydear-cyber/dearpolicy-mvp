/**
 * Conversational RAG: what a recorded claim fact may say, and where it came from.
 *
 * A fact is recorded only from what the household SAID (or what a document prints), never from what the model
 * concluded. Every fact carries its provenance:
 *  - source  "user_reported" (the household's words, quoted verbatim from this conversation), "document" (a passage a
 *            tool returned prints it) or "medical_evidence" (reviewed claim evidence -- never recorded by the loop);
 *  - basis   "stated" (the value is in the quoted words: the same numbers, the same content words) or "paraphrased"
 *            (the model's wording of what was said, e.g. "arm fracture" for "broke his arm"). A paraphrase is kept as
 *            a report, but it is unconfirmed: it is never a calculation input and never satisfies a question about it.
 * Refused outright:
 *  - a policy-defined classification the household did not say in those terms (cause = "accident", "illness",
 *    "critical illness", a diagnosis): whether an event meets a policy's definition is for the wording and the insurer,
 *    not for the model -- record how it happened instead and, when the cause changes which benefit applies, ask;
 *  - a quantity the policy derives ("payable_days", "claimable_amount", "eligible", "covered"): record what was said
 *    ("warded for 2 nights", admission / discharge dates and times) and let the calculation apply the wording;
 *  - a count recorded in the wrong unit ("days" when the household said "nights", or the reverse).
 * Pure: no database access.
 */

export type FactSource = "user_reported" | "document" | "medical_evidence";
export type FactBasis = "stated" | "paraphrased";
export type FactCheck = { ok: true; basis: FactBasis; source: FactSource } | { ok: false; error: string };

export const normalizeKey = (k: unknown) => String(k ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const norm = (t: string) => t.toLowerCase().normalize("NFKC").replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/^["']+|["'.,!?;:]+$/g, "").trim();

/** True when `words` are a verbatim quote (case, quotes and spacing aside) of one of the household's messages. */
export function quotedFrom(words: string, userTexts: string[]): boolean {
  const w = norm(words);
  return w.length >= 2 && userTexts.some((u) => norm(u).includes(w));
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
/** The numbers a text states (digits with thousands separators, and number words). */
export function numbersIn(t: string): number[] {
  const out = (t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) if (w in NUMBER_WORDS) out.push(NUMBER_WORDS[w]);
  return out;
}
const STOP = new Set("a an the and or of to in on at for with from by his her their its my our your he she they it was were is are be been has had have did do does not no yes this that these those as about after before during per".split(" "));
const stem = (w: string) => w.replace(/'s$/, "").replace(/(?:ing|ed|es|s)$/, "");
export const contentWords = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);

/** Policy-defined classifications: recorded only when the household used the term itself. */
const POLICY_TERM = /\b(?:accident(?:al|ally|s)?|illness(?:es)?|sickness|disease|critical illness|pre-?existing|permanent (?:total )?disab\w*|disablement|diagnos\w*)\b/i;
const POLICY_KEY = /^(?:cause|cause_of_\w+|accident\w*|illness\w*|sickness|disease|diagnosis|diagnosed\w*|condition_type|critical_illness\w*|pre_?existing\w*|disab\w*|claim_type|benefit_type)$/;
/** Quantities and conclusions the policy derives: never household facts. */
const DERIVED_KEY = /(?:^|_)(?:payable|claimable|eligible|eligibility|entitled|entitlement|covered|coverage|benefit_days|payout|reimbursable|admissible)(?:_|$)/;
const YES = /\b(?:yes|yeah|yep|yup|was|were|did|got|has|had|admitted|warded|hospitali[sz]ed|stayed)\b/i;
const NO = /\b(?:no|not|never|nope|didn't|wasn't|weren't|didnt|wasnt)\b/i;

/** Whether `value` under `key` may be recorded from `words` (the household's quoted words, or a document passage when
 * `documentText` is given), and on what basis. */
export function checkFact(f: { key: string; value: string; words: string }, userTexts: string[], documentText?: string | null): FactCheck {
  const key = normalizeKey(f.key), value = String(f.value ?? "").trim(), words = String(f.words ?? "").trim();
  if (!key || !value) return { ok: false, error: "a fact needs a key and a value" };
  if (DERIVED_KEY.test(key)) return { ok: false, error: `${key} is something the policy works out, not something the household said: record what they said (e.g. nights in hospital, admission and discharge dates and times, the bill) and let the calculation apply the policy wording` };
  const source: FactSource = documentText != null ? "document" : "user_reported";
  const said = documentText != null ? documentText : words;
  if (source === "user_reported" && !quotedFrom(words, userTexts)) return { ok: false, error: "words must quote the household's own message verbatim (a fact is recorded only from what they said)" };
  if (source === "document" && !said.trim()) return { ok: false, error: "a document fact needs the passage that prints it" };
  // A count recorded in the wrong unit: nights are not days (whether nights count as payable days is the policy's).
  const nightsSaid = /\bnights?\b|\bovernight\b/i.test(said), daysSaid = /\bdays?\b/i.test(said);
  if (/(?:^|_)days?(?:_|$)/.test(key) && nightsSaid && !daysSaid) return { ok: false, error: `the household said nights, not days: record it as nights (e.g. nights_in_hospital) -- how nights translate into payable days is for the policy wording` };
  if (/(?:^|_)nights?(?:_|$)/.test(key) && daysSaid && !nightsSaid) return { ok: false, error: `the household said days, not nights: record it as days (e.g. days_in_hospital)` };
  // A policy-defined classification: only in the household's own terms.
  if (POLICY_KEY.test(key) || POLICY_TERM.test(value)) {
    const term = value.match(POLICY_TERM)?.[0];
    const saidTerm = term ? new RegExp("\\b" + stem(term.toLowerCase()).replace(/[^a-z ]/g, "") + "\\w*", "i").test(said) : false;
    if (!saidTerm) return { ok: false, error: `${key}=${value} is a policy-defined classification the ${source === "document" ? "passage" : "household"} did not state; record how it happened in their words (key how_it_happened) and, if the cause changes which benefit applies, ask how it happened` };
    return { ok: true, basis: "stated", source };
  }
  const vNums = numbersIn(value);
  if (vNums.length) {
    const have = new Set(numbersIn(said));
    return { ok: true, basis: vNums.every((n) => have.has(n)) ? "stated" : "paraphrased", source };
  }
  if (/^(?:yes|true)$/i.test(value)) return { ok: true, basis: YES.test(said) && !NO.test(said) ? "stated" : "paraphrased", source };
  if (/^(?:no|false)$/i.test(value)) return { ok: true, basis: NO.test(said) ? "stated" : "paraphrased", source };
  const want = contentWords(value), have = new Set(contentWords(said));
  return { ok: true, basis: want.length && want.every((w) => have.has(w)) ? "stated" : "paraphrased", source };
}

/** Keys under which how the event happened is recorded. */
export const CAUSE_KEYS = new Set(["how_it_happened", "cause", "circumstances", "how_injured", "mechanism"]);
/** An event / injury / condition fact (whose cause can decide which benefit applies). */
export const EVENT_KEY = /(?:^|_)(?:injur\w*|fractur\w*|broke\w*|broken|wound\w*|hurt|burn\w*|sprain\w*|cut|bite|illness|sick\w*|symptom\w*|condition|what_happened|incident|event)(?:_|$)/;

type FactLike = { value: unknown; words: string; basis?: FactBasis; source?: FactSource };
/** A fact usable as a calculation input or as an answered question: stated by the household or printed in a
 * document (a paraphrase is a report, not a confirmation). Facts recorded before provenance existed count as stated. */
export const confirmed = (f: FactLike | undefined) => !!f && (f.basis ?? "stated") === "stated";

/** Why a household figure given to compute is not usable: it must be a confirmed recorded fact (same value, its
 * attribution taken from that fact's quoted words). Null when it is. */
export function householdOperandProblem(h: { label?: unknown; attribution?: unknown; amount?: unknown; count?: unknown; percent?: unknown }, facts: Record<string, FactLike>): string | null {
  const want = typeof h.count === "number" ? h.count : typeof h.amount === "number" ? h.amount : typeof h.percent === "number" ? h.percent : null;
  if (want == null) return null;
  const attribution = norm(String(h.attribution ?? ""));
  const matches = Object.entries(facts).filter(([, f]) => numbersIn(String(f.value)).some((n) => Math.abs(n - want) < 1e-9));
  if (!matches.length) return `the household figure ${want} (${String(h.label ?? "figure")}) is not a recorded fact: record what the household said with note_facts first`;
  const usable = matches.filter(([, f]) => confirmed(f) && attribution.length >= 2 && (norm(f.words).includes(attribution) || attribution.includes(norm(f.words))));
  if (!usable.length) {
    const [k, f] = matches[0];
    return confirmed(f) ? `the attribution for ${want} must quote the household's words recorded for ${k} ("${f.words}")` : `${k}=${String(f.value)} is unconfirmed (a paraphrase of "${f.words}"), so it cannot be used in a calculation: ask the household to confirm it`;
  }
  return null;
}
