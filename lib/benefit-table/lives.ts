/** Who a page is about: whether it prints a person's name, and whether it may name a life other than theirs. Shared by
 * the benefit table's checks (a premium is used only on a page about one life) and the simple chat's checks (a sum insured
 * is read as a person's own only on such a page). Pure. */
import { normalizePersonName } from "@/lib/insurance";

export function nameOnPage(person: string, pageText: string) {
  const words = normalizePersonName(person).split(" ").filter((w) => w.length > 1);
  const page = ` ${normalizePersonName(pageText.replace(/,/g, " "))} `;
  return words.length > 0 && words.every((w) => page.includes(` ${w} `));
}

/** Whether a page may name a life other than this person: another household member's name anywhere on it, a word for
 * another insured person (spouse, child, dependant, covered members), a second or joint life, or a life line naming someone
 * else. Fail-safe: a premium on such a page may be the other life's, so it is not used, even when it is in fact this
 * person's (TE #97). */
const LIFE_LINE = /\b(?:(?:joint\s+)?life\s+(?:assured|insured)|assured|insured(?:\s+person)?|policy\s*holder|proposer|owner)\b[^:\t\n/]{0,20}[:\t][ \t]*:?[ \t]*([^\t\n]+)/gi;
const HEADER_WORD = /^(?:premiums?|sum|benefits?|cessation|commencement|date|term|plan|amount|policy|basic|rider|insured|assured)$/;
const OTHER_INSURED = /\b(?:spouses?|wife|husband|child(?:ren)?|sons?|daughters?|dependa?ents?|covered\s+(?:members?|persons?)|insured\s+members?|family\s+members?)\b|\b(?:life\s+(?:assured|insured)|insured(?:\s+person)?|assured)\s*(?:\(?\s*(?:2|3|ii|iii|two)\s*\)?)(?![\d.])|\bsecond\s+(?:life|insured)\b|\bjoint\s+life\b/i;
export function otherLife(pageText: string, person: string, people: string[]): boolean {
  if (OTHER_INSURED.test(pageText)) return true;
  const own = normalizePersonName(person).split(" ").filter((w) => w.length > 1);
  const same = (name: string) => { const n = normalizePersonName(name.replace(/,/g, " ")).split(" ").filter((w) => w.length > 1); return n.every((w) => own.includes(w)) || own.every((w) => n.includes(w)); };
  if (people.some((name) => !same(name) && nameOnPage(name, pageText))) return true;
  return [...pageText.matchAll(LIFE_LINE)].some((m) => {
    const named = normalizePersonName(m[1].replace(/,/g, " ")).split(" ").filter((w) => w.length > 1 && /^[a-z]+$/.test(w));
    // A table header ("Assured/ Premium Cessation …") is column titles, not a name.
    if (named.some((w) => HEADER_WORD.test(w))) return false;
    return named.length > 0 && !named.every((w) => own.includes(w)) && !own.every((w) => named.includes(w));
  });
}
