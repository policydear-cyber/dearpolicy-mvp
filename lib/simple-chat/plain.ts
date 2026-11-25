/**
 * Plain wording for what a household reads (DC, 25 Nov 2026, from the live chat-clarity check). Display-level only:
 * no amount, person, condition or source is added, changed or removed; the same saved answer reads the same when it is
 * reopened. Every rule is general (any insurer, any wording).
 */
import type { AnswerStatement } from "@/components/answer-cards";

/** Marks a document prints after a word to point at a footnote ("Arm#", "Leg^", "Fracture†"). Never part of the words. */
export const stripMarks = (text: string) => text.replace(/(?<=[A-Za-z)])[#^†‡]+(?=[\s,.;:)]|$)/g, "");

const sameCase = (from: string, to: string) => (/^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** "the insurer decides which applies" is a claim decision said about a document question: the household's own case is
 * what decides which printed figure applies. */
const WHICH_APPLIES = /\b(the insurers?|the insurance company) decides which (?:one |figure |amount |benefit )?(?:applies|to use|is used)\b/gi;

/** Words a layman does not use for "premiums stop" and "cover ends". */
const JARGON: [RegExp, string][] = [
  [/\bpremium cessation (age|date)\b/gi, "the $1 premiums stop"],
  [/\bbenefit cessation (age|date)\b/gi, "the $1 cover ends"],
  [/\bpremium cessation\b/gi, "when premiums stop"],
  [/\bbenefit cessation\b/gi, "when cover ends"],
];

export function plainWords(text: string): string {
  let out = text;
  out = out.replace(WHICH_APPLIES, (m) => sameCase(m, "which one applies depends on your case"));
  for (const [re, to] of JARGON) out = out.replace(re, (m, g1) => sameCase(m, to.replace("$1", typeof g1 === "string" ? g1.toLowerCase() : "")));
  return out;
}

/** The label under a benefit's printed terms when nothing has been worked out for the household's case. */
export const TERMS_LABEL = "Depends on your case";

/** A question about what to do now or next: the steps come before the amounts. */
export const asksWhatToDo = (q: string | undefined | null) =>
  !!q && /\b(?:what (?:do|should|can|must) (?:i|we)(?: now)? do|what(?:'s| is) (?:the )?next|next steps?|what now|how (?:do|should|can) (?:i|we) (?:claim|make a claim|file|start|report|get)|what happens (?:now|next|after)|where do (?:i|we) (?:start|begin)|who (?:do|should) (?:i|we) (?:call|contact)|(?:what|which) steps?)\b/i.test(q);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A card's strings with the person's own name words replaced, so two people's cards compare by what they say. */
function withoutName(s: string | null | undefined, name: string): string {
  const words = name.split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  let out = (s ?? "").toLowerCase();
  for (const w of words) out = out.replace(new RegExp(`\\b${escapeRe(w.toLowerCase())}(?:'s|’s)?\\b`, "g"), "{p}");
  return out.replace(/(?:\{p\}\s*)+/g, "{p} ").replace(/\s+/g, " ").trim();
}
/** The card's own words with the first person's name made general, since the card now speaks for each of them. */
function forEach(s: string | null | undefined, name: string): string | null | undefined {
  if (!s) return s;
  const words = name.split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  const parts = [name, ...words].map(escapeRe);
  return s.replace(new RegExp(`(?:${parts.join("|")})(?:'s|’s)?`, "gi"), (m) => (/['’]s$/i.test(m) ? "each person's" : "each person")).replace(/(?:each person(?:'s)?\s+){2,}/g, "each person ");
}
const listNames = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Amount cards that say exactly the same thing for different people (same figure, wording, basis, conditions, page and
 * date once each person's name is set aside) become one card for all of them, in the order they first appear. A card
 * that differs in anything stays its own: a different sum insured, a different condition, a different document.
 */
export function mergeSamePerson(statements: AnswerStatement[]): AnswerStatement[] {
  const key = (s: AnswerStatement) => {
    const n = s.personName ?? "";
    return JSON.stringify([s.kind, s.source?.note ?? null, s.source?.footnote ?? null, s.group ? [s.group.kind, s.group.note] : null, s.amount?.text, s.amount?.currencyResolved, s.amount?.illustration, withoutName(s.text, n), withoutName(s.fullText, n),
      withoutName(s.basis, n), (s.conditions ?? []).map((c) => withoutName(c, n)), s.source?.policyName, s.source?.page, s.source?.rowLabel, s.asOf ?? null, s.table ?? null]);
  };
  const first = new Map<string, AnswerStatement>();
  const names = new Map<string, string[]>();
  const out: AnswerStatement[] = [];
  for (const s of statements) {
    if (!s.amount || !s.personName) { out.push(s); continue; }
    const k = key(s);
    const head = first.get(k);
    if (!head) { first.set(k, s); names.set(k, [s.personName]); out.push(s); continue; }
    const list = names.get(k)!;
    if (!list.includes(s.personName)) list.push(s.personName);
  }
  return out.map((s) => {
    if (!s.amount || !s.personName) return s;
    const list = names.get(key(s));
    return list && list.length > 1 && first.get(key(s)) === s ? { ...s, personName: `${listNames(list)}, each`, text: forEach(s.text, s.personName)!, fullText: forEach(s.fullText, s.personName)!, basis: forEach(s.basis, s.personName),
      conditions: (s.conditions ?? []).map((c) => forEach(c, s.personName!)!) } : s;
  });
}

/** A statement's words without the marks its page prints after a word, unless the statement carries a footnote that
 * those marks point to (then the mark is what links the word to its footnote and stays). */
export const markless = (s: Pick<AnswerStatement, "source">, text: string) => (s.source?.footnote ? text : stripMarks(text));
