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
  // Agent F: a date / date-time normalised by the model (2026-10-02 21:30) is stated when the words give the same
  // day, month (year, when they give one) and -- when the value has one -- the same clock time.
  const dt = isoParts(value);
  if (dt) return { ok: true, basis: dateTimeStated(dt, said) ? "stated" : "paraphrased", source };
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

// ------------------------------------------------------------------------------------------------- Agent F additions
/** Words that describe HOW an event happened (an external mechanism), as opposed to the injury itself ("broke his
 * arm") or a classification ("accident"). */
export const MECHANISM = /\b(?:fell|falls?|falling|fallen|slipp?(?:ed|ing)?|slips?|trip(?:ped|ping|s)?|crash(?:ed|ing)?|collid\w*|collision|knocked|hit by|struck|bitten|bit by|stung|burn(?:ed|t) (?:by|on|with)|scald\w*|cut (?:himself|herself|themselves|myself|by|on|with)|twist(?:ed|ing)|landed|jump(?:ed|ing)|tackled|ran into|walked into|car|bike|bicycle|scooter|motorcycle|road|traffic|playground|monkey bars|stairs|sports?|football|soccer|rugby|basketball|swimming|fight)\b/i;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
type DT = { y: number; m: number; d: number; hh: number | null; mm: number | null };
/** The parts of an ISO-like date or date-time value (2026-10-02, 2026-10-02 21:30, 2026-10-02T21:30+08:00). */
export function isoParts(v: string): DT | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\s*$/.exec(v);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], hh: m[4] != null ? +m[4] : null, mm: m[5] != null ? +m[5] : null };
}
/** Dates and clock times the words state ("2 October at about 9.30pm", "Oct 5, 9am", "5/10 21:30", "noon"). */
export function datesTimesIn(t: string): { dates: { d: number; m: number; y: number | null }[]; times: { hh: number; mm: number }[] } {
  const s = t.toLowerCase();
  const dates: { d: number; m: number; y: number | null }[] = [];
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
  for (const x of s.matchAll(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+" + mon + "(?:,?\\s+(\\d{4}))?", "g"))) dates.push({ d: +x[1], m: MONTHS[x[2]], y: x[3] ? +x[3] : null });
  for (const x of s.matchAll(new RegExp("\\b" + mon + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?", "g"))) dates.push({ d: +x[2], m: MONTHS[x[1]], y: x[3] ? +x[3] : null });
  for (const x of s.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b(?!\s*(?:am|pm|a\.m|p\.m))/g)) if (+x[2] >= 1 && +x[2] <= 12 && !/[.:]/.test(x[0].charAt(x[1].length)) ) dates.push({ d: +x[1], m: +x[2], y: x[3] ? (x[3].length === 2 ? 2000 + +x[3] : +x[3]) : null });
  for (const x of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.push({ d: +x[3], m: +x[2], y: +x[1] });
  const times: { hh: number; mm: number }[] = [];
  for (const x of s.matchAll(/\b(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)/g)) { let hh = +x[1] % 12; if (x[3].startsWith("p")) hh += 12; times.push({ hh, mm: x[2] ? +x[2] : 0 }); }
  for (const x of s.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b(?!\s*(?:am|pm|a\.m|p\.m))/g)) times.push({ hh: +x[1], mm: +x[2] });
  if (/\bnoon\b|\bmidday\b/.test(s)) times.push({ hh: 12, mm: 0 });
  if (/\bmidnight\b/.test(s)) times.push({ hh: 0, mm: 0 });
  return { dates, times };
}
/** True when the words state the date (and, when the value has one, the clock time) of `v`. */
export function dateTimeStated(v: DT, words: string): boolean {
  const { dates, times } = datesTimesIn(words);
  if (!dates.some((x) => x.d === v.d && x.m === v.m && (x.y == null || x.y === v.y))) return false;
  if (v.hh == null) return true;
  return times.some((x) => x.hh === v.hh && x.mm === v.mm);
}

/**
 * Agent F (D15): which household fact a key is about, so a fact known under one key is never asked again under
 * another (admitted_at / admission_time / admission_datetime; how_it_happened / cause; bill / bill_amount ...).
 * `grain` is what a question under the key needs: "time" (a clock time), "date", or null (any value).
 */
export type FactConcept = { concept: string; grain: "time" | "date" | null };
export function factConcept(key: string): FactConcept {
  const k = normalizeKey(key);
  const grain = /(?:^|_)(?:time|datetime|at|hour|clock)(?:_|$)/.test(k) ? "time" as const : /(?:^|_)(?:date|on|day)(?:_|$)/.test(k) ? "date" as const : null;
  if (CAUSE_KEYS.has(k) || /^(?:how_|cause|mechanism|circumstance)/.test(k)) return { concept: "cause", grain: null };
  if (/(?:^|_)(?:admi\w*|admitted)(?:_|$)/.test(k) && !/discharg/.test(k)) return { concept: "admission", grain };
  if (/(?:^|_)discharg\w*(?:_|$)/.test(k)) return { concept: "discharge", grain };
  if (/(?:^|_)(?:nights?|stay|length_of_stay|los|days_in_hospital|hospital_days|days_warded|warded_days|duration)(?:_|$)/.test(k)) return { concept: "stay_length", grain: null };
  if (/(?:^|_)(?:bill|bills|billed|invoice|medical_cost|cost|charges?|expenses?)(?:_|$)/.test(k)) return { concept: "bill", grain: null };
  if (/(?:^|_)(?:hospital_name|hospital|which_hospital|facility)(?:_|$)/.test(k)) return { concept: "hospital", grain: null };
  return { concept: "key:" + k, grain: null };
}
type FactLike2 = { value: unknown; words: string; basis?: FactBasis };
/** A confirmed fact that already answers a question under `key` (the same key, or another key for the same fact at
 * the grain the question needs), with the key it is recorded under. Null when none does. */
export function knownFactFor(key: string, facts: Record<string, FactLike2>): { key: string; fact: FactLike2 } | null {
  const k = normalizeKey(key);
  if (facts[k] && confirmed(facts[k])) return { key: k, fact: facts[k] };
  const want = factConcept(k);
  const hasTime = (f: FactLike2) => { const p = isoParts(String(f.value)); return p ? p.hh != null : datesTimesIn(String(f.value) + " " + f.words).times.length > 0; };
  const hasDate = (f: FactLike2) => !!isoParts(String(f.value)) || datesTimesIn(String(f.value) + " " + f.words).dates.length > 0;
  for (const [fk, f] of Object.entries(facts)) {
    if (!confirmed(f)) continue;
    const c = factConcept(fk);
    if (c.concept !== want.concept || want.concept.startsWith("key:")) continue;
    if (want.concept === "admission" || want.concept === "discharge") {
      if (want.grain === "time" && !hasTime(f)) continue;
      if (want.grain !== "time" && !hasDate(f)) continue;
    }
    return { key: fk, fact: f };
  }
  // A length of stay is known once both the admission and the discharge dates are.
  if (want.concept === "stay_length") {
    const adm = knownFactFor("admission_date", facts), dis = knownFactFor("discharge_date", facts);
    if (adm && dis) return { key: `${adm.key}+${dis.key}`, fact: { value: `${String(adm.fact.value)} to ${String(dis.fact.value)}`, words: `${adm.fact.words}; ${dis.fact.words}` } };
  }
  return null;
}
