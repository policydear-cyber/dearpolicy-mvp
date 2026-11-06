/**
 * Whether a figure a page prints is the person's own cover, and whether a person a page names is the person the page is
 * about. Shared by intake (lib/documents/fact-check) and the benefit table (lib/benefit-table/check). Pure.
 *
 * A page about one policy also prints figures that are not that policy's cover for this person: what another scheme or
 * plan pays ("This plan works with MediBase, which pays up to S$150,000 a year", "less any payout from CarePledge Life
 * (currently S$662)"), a total with another plan ("Total monthly payout with CarePledge Life: S$1,862"), a worked example
 * or a projection ("rises by 2% each year, to S$806 in 2036"), and a premium. Each is a closed shape on the figure's own
 * sentence; a figure printed only in such shapes is never shown as cover. A page marked as a sample or specimen gives no
 * one cover, and a person counts as the page's own only where the page prints them as particulars (a labelled line, a
 * table cell, a name line), never only inside a sentence (a brochure's example person, a letter's greeting).
 */
import { normalizePersonName } from "@/lib/insurance";

/** Another payer: a scheme or plan the policy works with, pays on top of, or deducts. */
const OTHER_PAYER: RegExp[] = [
  /\bworks?\s+(?:together\s+)?(?:with|alongside)\b/i,
  /\b(?:on\s+top\s+of|in\s+addition\s+to|over\s+and\s+above)\b/i,
  /\bwhich\s+(?:currently\s+|now\s+|also\s+)?pays\b/i,
  /\b(?:currently|now)\s+pays\b/i,
  /\b(?:less|minus|net\s+of|after\s+deducting|deducting|reduced\s+by|offset\s+(?:by|against))\b[^.;]{0,60}\b(?:payouts?|payments?|benefits?|amounts?|claims?)\b[^.;]{0,40}\b(?:from|under|by|paid)\b/i,
  /\bnational\s+(?:[a-z-]+\s+){0,3}scheme\b/i,
];
/** A total with another plan or scheme ("Total monthly payout with CarePledge Life", "combined payout including ..."). */
const COMBINED = /\b(?:total|combined|together)\b[^.;\n]{0,60}\b(?:with|including|plus)\b/i;
/** A worked example, a sample or an illustration. */
const EXAMPLE = /\b(?:for\s+example|example|e\.g\.|for\s+instance|illustration|illustrative|hypothetical|sample|specimen)\b/i;
/** A figure the page projects for later ("rises ... to S$806 in 2036", "will be S$717"). */
const PROJECTION = /\b(?:rises?|increases?|grows?|goes\s+up)\b[^.;]{0,50}\bto\s*$|\bwill\s+(?:be|rise|increase|grow|become)\b|\bprojected\b/i;
/** The words before a figure that make it a premium or a payment ("Annual premium:", "will be deducted"); "payable" alone is not one ("Sum assured payable on death"). */
const PREMIUM_LABEL = /\b(?:premiums?|instal+ments?|deducted|amount\s+due|giro)\b/i;

export type FigureContext = "other_payer" | "combined_total" | "example" | "projection" | "premium";
const WHY: Record<FigureContext, string> = {
  other_payer: "what another scheme or plan pays",
  combined_total: "a total with another plan",
  example: "an example or illustration",
  projection: "a projected figure",
  premium: "a premium",
};
export const figureContextWords = (c: FigureContext) => WHY[c];

/** A money figure, to part one figure's words from another's on a line. */
const MONEY_FIGURE = /(?:S\$|US\$|A\$|HK\$|\$|SGD|USD|MYR|RM|£|€)\s?\d[\d,]*(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{2}\b/gi;
/** The words a line prints before a span: `sentence`, from the last full stop or semicolon (a decimal point is not one)
 * or the last money figure before it; `clause`, from there or the last comma, whichever is later. */
function wordsBefore(line: string, start: number) {
  // The figure's own currency sign is not a word before it.
  const head = line.slice(0, start).replace(/(?:S\$|US\$|A\$|HK\$|\$|SGD|USD|MYR|RM|£|€)\s?$/i, "");
  const stops = [...head.matchAll(/(?<!\d)[.;](?!\d)|[.;](?=\s)/g)].map((m) => m.index! + 1);
  const figures = [...head.matchAll(MONEY_FIGURE)].map((m) => m.index! + m[0].length);
  const from = Math.max(0, ...stops, ...figures);
  const commas = [...head.matchAll(/,(?!\d{3})/g)].map((m) => m.index! + 1).filter((i) => i > from);
  return { sentence: head.slice(from), clause: head.slice(Math.max(from, ...commas)) };
}

/** Why a figure printed at this span of a line is not the person's own cover, or null when it may be. Read from the words
 * before it: the clause for another payer, a total or a premium ("..., which pays up to S$150,000", "less any payout from
 * CarePledge Life (currently S$662)", "Total monthly payout with CarePledge Life: S$1,862"); the sentence for an example
 * or a projection ("Example: Ahmad ... receives S$717", "rises by 2% each year, to S$806"). `premium`: whether a premium
 * label makes it not cover (intake's cover amounts and the table's sums insured; not benefit rows). */
export function figureContext(line: string, start: number, _end: number, o: { premium?: boolean } = {}): FigureContext | null {
  const b = wordsBefore(line, start);
  if (OTHER_PAYER.some((re) => re.test(b.clause))) return "other_payer";
  if (COMBINED.test(b.clause)) return "combined_total";
  if (EXAMPLE.test(b.sentence)) return "example";
  if (PROJECTION.test(b.sentence)) return "projection";
  if (o.premium && PREMIUM_LABEL.test(b.clause)) return "premium";
  return null;
}

/** The spans of a text where it prints this amount as a whole figure ("S$1,200", "1,200.00", "SGD 1200"). */
function amountSpans(text: string, amount: number): { line: string; start: number; end: number }[] {
  const out: { line: string; start: number; end: number }[] = [];
  for (const line of text.split("\n")) for (const m of line.matchAll(/(?<![\d.,])\d[\d,]*(?:\.\d+)?(?![\d,]*\d)/g)) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v) && Math.abs(v - amount) < 0.005) out.push({ line, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Why an amount is not the person's own cover on this text: it is printed, and every place that prints it is one of the
 * shapes above. Null when it is printed somewhere as it may be cover, or not printed at all (other checks decide that). */
export function amountOnlyInContext(text: string, amount: number, o: { premium?: boolean } = {}): FigureContext | null {
  const spans = amountSpans(text, amount);
  if (!spans.length) return null;
  let first: FigureContext | null = null;
  for (const s of spans) {
    const c = figureContext(s.line, s.start, s.end, o);
    if (!c) return null;
    first ??= c;
  }
  return first;
}

/** A page that says it is a sample or specimen ("SAMPLE STATEMENT", "Specimen policy schedule", "This is a sample"). Only
 * the words sample, specimen and dummy: a disclaimer such as "not a real policy" is not one (made-up test documents print it). */
const SPECIMEN = /\b(?:sample|specimen|dummy)\s+(?:statement|schedule|certificate|policy|letter|document|copy|notice|card)\b|^\s*(?:sample|specimen)\s*$|\bthis\s+is\s+(?:a|an)\s+(?:sample|specimen)\b/im;
export function specimenPage(text: string) { return SPECIMEN.test(text); }

/** Lower-case words that are part of a name ("binti", "a/l", "van", "de"). */
const NAME_PARTICLE = /^(?:bin|binti|binte|bte|bt|b\.|bint|ibn|d\/o|s\/o|a\/l|a\/p|ap|van|von|der|den|de|da|das|do|dos|du|del|della|di|la|le|al|el|y|e)$/i;
const HONORIFIC = /^(?:mr|mrs|ms|mdm|miss|dr|madam|mister|mx)\.?$/i;
/** Words that may sit in a name cell without being part of the name: an identity number or a date of birth label. */
const ID_TOKEN = /^(?:[stfgm]\d{4,}[a-z]?|x{3,}\d*[a-z]?|\*{2,}\d*[a-z]?|\(.*\)|nric|fin|id|passport)$/i;
/** A label that never introduces the page's own person ("Example:", "Dear", "Meet"). */
// Word edges by letters of any script: "hi" is no word of "hiểm".
const NOT_A_PERSON_LABEL = /(?<!\p{L})(?:example|e\.g|sample|specimen|illustration|dear|meet|hi|hello|story|case\s+study|testimonial)(?!\p{L})/iu;
/** Whether the page prints this person as its particulars: a cell of the page (a line, or a part of one set off by a tab, a
 * colon or a run of spaces) that is the person's name and nothing else but an honorific or an identity number, and whose
 * label (the cell before it on its line) is not an example's or a greeting's. A name only inside a sentence ("Meet Mdm
 * Rosalind Teo, 58", "Dear Mr Daniel Ong", "Example: Ahmad bin Yusof claims in 2030") is not. */
export function personAsParticulars(person: string, pageText: string): boolean {
  const want = normalizePersonName(person).split(" ").filter((w) => w.length > 0 && !HONORIFIC.test(w));
  if (!want.length) return false;
  for (const raw of pageText.split("\n")) {
    // A name printed in capitals is how a schedule or certificate prints its insured, even inside a sentence ("This is
    // to certify that LIM WEI JIE is insured"); a brochure's example person is printed in ordinary case.
    const capitals = raw.match(/\b[A-Z][A-Z'.-]+(?:[ \t]+(?:[A-Z][A-Z'.-]+|BIN|BINTI|BINTE|BTE|BT|D\/O|S\/O|A\/L|A\/P))+\b/g) ?? [];
    if (!NOT_A_PERSON_LABEL.test(raw) && capitals.some((run) => { const n = normalizePersonName(run).split(" "); return want.every((w) => n.includes(w)) && n.length <= want.length + 2; })) return true;
    // Cells: parts of the line set off by a tab, a colon, a bar or a run of spaces, and names joined by "and" or "&"; a
    // bracket ("(NRIC S1234567A)", "(the Life Assured)") and an age, date of birth or identity number after a comma are
    // not part of a name.
    const cells = raw.replace(/\([^)]*\)/g, " ")
      .replace(/,\s*(?:age[d]?\b|dob\b|date\s+of\s+birth\b|nric\b|fin\b|id\b|passport\b|[stfg]\d{7}[a-z]\b)[^\t|]*/gi, " ")
      .split(/\t|:|\s{2,}|\||\s+(?:and|&)\s+/).map((c) => c.trim());
    for (const [i, cell] of cells.entries()) {
      if (!cell) continue;
      const words = cell.replace(/[,;]+/g, " ").split(/\s+/).filter(Boolean);
      const name = words.filter((w) => !HONORIFIC.test(w) && !ID_TOKEN.test(w));
      const norm = normalizePersonName(name.join(" ")).split(" ").filter(Boolean);
      if (!want.every((w) => norm.includes(w))) continue;
      // The cell holds the name and at most two more name words (a middle name the reading left out); no digits, no
      // lower-case word other than a name particle ("bin", "binte", "d/o", "van").
      const extra = name.filter((w) => !want.includes(normalizePersonName(w)));
      if (extra.length > 2 || name.some((w) => /\d/.test(w)) || name.some((w) => /^[a-z]/.test(w) && !NAME_PARTICLE.test(w))) continue;
      if (NOT_A_PERSON_LABEL.test(words[0] ?? "")) continue;
      const label = cells.slice(0, i).filter(Boolean).pop() ?? "";
      if (NOT_A_PERSON_LABEL.test(label)) continue;
      return true;
    }
  }
  return false;
}
