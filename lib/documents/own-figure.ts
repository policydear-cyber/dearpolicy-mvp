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

/** The own-figure checks (a scheme's or example's figure is not cover, a sample page gives no one cover, a person named only
 * as an example holds no cover, a statement of coverage is a personal schedule) are OFF: with it off every caller behaves
 * exactly as before #377. They set aside real covers on live data (#377's regression), so they stay off until an attempt
 * passes both reviewers' shape files (scripts/documents/scheme-figure-test.ts runs them with the switch on). */
export const OWN_FIGURE_CHECKS = { on: false };

/** A named payer other than this policy: a name in capitals ("SilverYears Care", "HealthBase"), or a national, public or
 * government scheme. Never "the rider", "the death benefit" or "this plan" (TE r377: "rider, which pays", "on top of the
 * death benefit"). Case-sensitive on the name. */
const NAMED = String.raw`(?:(?:the|your)\s+)?(?!(?:This|The|Your|Our|Each|Any|Rider|Death|Policy|Plan|Basic|Main)\b)[A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,4}`;
const SCHEME = /\b(?:national|public|government|state)\s+(?:[a-z-]+\s+){0,3}scheme\b/i;
/** The sentence ties the figure to another named payer, in one of a closed list of shapes:
 * - "works with / on top of / alongside / in addition to <Name>", then "which (currently) pays" or "currently pays" before
 *   the figure ("This plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year");
 * - "less / minus / net of / after deducting any payout from <Name>" ("less any payout from SilverYears Care (currently
 *   S$640)"). */
const NAMED_AT = new RegExp("^" + NAMED);
/** Whether a lead-in (matched without regard to case, its last group the rest of the text) is followed by a named payer
 * (matched with regard to case) or a scheme. */
/** A name that ends as this policy's own part ("the Hospital Cash Rider", "SilverCare Rider", "Family Plan") is not another
 * payer (Critic r377 F1, F2). */
const OWN_PART = /\b(?:riders?|plans?|benefits?|supplements?|covers?|polic(?:y|ies))$/i;
/** Whether a name is one of the document's own products ("SilverYears Care" on SilverYears Care's own statement). */
const isOwn = (name: string, own: string[]) => { const n = name.replace(/^(?:the|your)\s+/i, "").toLowerCase(); return own.some((o) => { const w = o.trim().toLowerCase(); return !!w && (n.startsWith(w) || w.startsWith(n)); }); };
const namedAfter = (text: string, lead: RegExp, own: string[] = []) => [...text.matchAll(lead)].some((m) => {
  const rest = m[m.length - 1];
  const name = NAMED_AT.exec(rest)?.[0].trim();
  return (!!name && !OWN_PART.test(name) && !isOwn(name, own)) || /^(?:(?:the|your)\s+)?(?:[\w-]+\s+){0,2}scheme\b/i.test(rest);
});
/** A scheme sentence with no "works with" lead is about another payer only when it is not the document's own: never
 * "Your <Name>, the national ... scheme, which pays", never "pays you", never a sentence naming the document's own
 * product (TE r377 round 3: the person's own national scheme statement). */
const otherScheme = (sentence: string, own: string[]) => SCHEME.test(sentence) && !/^\s*(?:\(?\w\)?\s*)?your\b/i.test(sentence) && !/\bpays?\s+you\b/i.test(sentence)
  && !own.some((o) => o.trim() && sentence.toLowerCase().includes(o.trim().toLowerCase()));
const WITH_LEAD = /\b(?:works?\s+(?:together\s+)?with|on\s+top\s+of|alongside|in\s+addition\s+to)\s+(.*)$/gi;
const PAYS_NOW = /\b(?:which|that)\s+(?:currently\s+|now\s+|also\s+)?pays\b[^.;]{0,30}$|\b(?:currently|now)\s+pays\b[^.;]{0,30}$/i;
const LESS_LEAD = /\b(?:less|minus|net\s+of|after\s+deducting|deducting|reduced\s+by|offset\s+(?:by|against))\b[^.;]{0,40}\b(?:payouts?|payments?|benefits?|amounts?)\s+(?:from|under|paid\s+by)\s+(.*)$/gi;
/** A total with another named plan or scheme ("Total monthly payout with SilverYears Care:", "combined benefit including
 * your scheme payout"). A combined limit of this policy's own items ("Combined limit including outpatient") is not one. */
const COMBINED_LEAD = /\b(?:total|combined)\b[^.;:]{0,40}\b(?:payouts?|benefits?|payments?)\b[^.;:]{0,20}\b(?:with|plus|including)\s+(.*)$/gi;
/** A worked example: the sentence opens as one ("Example:", "For example", "e.g.", "For instance", "Illustration:"). */
const EXAMPLE = /^\s*(?:for\s+example\b|example\s*\d*\s*[:.\-–]|e\.g\.|for\s+instance\b|illustration\s*\d*\s*[:.\-–]|hypothetically\b)/i;
/** A figure the page projects for later ("rises ... to S$806 in 2036", "will be S$717 in 2030"). */
const PROJECTION = /\b(?:rises?|increases?|grows?|goes\s+up)\b[^.;]{0,50}\bto\s*$|\bprojected\b/i;
/** "Will be" is a projection only with a later year or a number of years in the sentence ("will be S$717 in 2030"); "The sum
 * assured will be paid on death: S$500,000" is the policy's own sum (Critic r377 B1, B2). */
const WILL_BE = /\bwill\s+be\b/i;
const LATER = /\b20\d\d\b|\bin\s+\d+\s+years?\b|\bafter\s+\d+\s+years?\b/i;
/** A premium being paid: the figure's own label is a premium ("Annual premium:", "Premium (paid from MediSave):", "Amount
 * due:"), or a sentence says the premium is the figure ("Your premium for the coming year is S$331.60"). A premium word
 * inside a benefit's name ("Rider premium waiver sum assured:", "death benefit (including return of premiums):") is not. */
const PREMIUM_LABEL = /(?<!\b(?:waiver|return|refund|waive)\s+of\s+(?:the\s+)?)\b(?:premium|instal+ment)s?(?:\s+(?:payable|due|paid|amount))?\s*(?:\([^)]*\))?\s*[:\-–]?\s*$|\b(?:premium|instal+ment)s?\b[^.;:()]{0,40}\b(?:is|are|will\s+be)\s*$|\bamount\s+due\s*[:\-–]?\s*$/i;

export type FigureContext = "other_payer" | "combined_total" | "example" | "projection" | "premium";
const WHY: Record<FigureContext, string> = {
  other_payer: "what another scheme or plan pays",
  combined_total: "a total with another plan",
  example: "an example or illustration",
  projection: "a projected figure",
  premium: "a premium",
};
export const figureContextWords = (c: FigureContext) => WHY[c];

/** The sentence a span sits in (between full stops or semicolons; a decimal point is not one). */
function wholeSentence(line: string, start: number) {
  const stops = [...line.matchAll(/(?<!\d)[.;](?!\d)|[.;](?=\s)/g)].map((m) => m.index!);
  const from = Math.max(-1, ...stops.filter((i) => i < start)) + 1;
  const to = Math.min(line.length, ...stops.filter((i) => i >= start));
  return line.slice(from, to);
}
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
export function figureContext(line: string, start: number, _end: number, o: { premium?: boolean; own?: string[] } = {}): FigureContext | null {
  const b = wordsBefore(line, start);
  const own = (o.own ?? []).filter((x) => x && x.trim().length >= 3);
  if ((PAYS_NOW.test(b.clause) && (namedAfter(b.sentence, WITH_LEAD, own) || otherScheme(wholeSentence(line, start), own))) || namedAfter(b.sentence, LESS_LEAD, own)) return "other_payer";
  if (namedAfter(b.clause, COMBINED_LEAD, own)) return "combined_total";
  if (EXAMPLE.test(sentenceStart(line, start))) return "example";
  if (PROJECTION.test(b.sentence)) return "projection";
  if (WILL_BE.test(b.sentence) && LATER.test(wholeSentence(line, start))) return "projection";
  if (o.premium && PREMIUM_LABEL.test(b.clause)) return "premium";
  return null;
}
/** The sentence before a span, from its last full stop or semicolon (not cut at figures or commas). */
function sentenceStart(line: string, start: number) {
  const head = line.slice(0, start);
  const stops = [...head.matchAll(/(?<!\d)[.;](?!\d)|[.;](?=\s)/g)].map((m) => m.index! + 1);
  return head.slice(Math.max(0, ...stops));
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
export function amountOnlyInContext(text: string, amount: number, o: { premium?: boolean; title?: string } = {}): FigureContext | null {
  const spans = amountSpans(text, amount);
  const own = titleNames(o.title ?? text);
  if (!spans.length) return null;
  let first: FigureContext | null = null;
  for (const s of spans) {
    const c = figureContext(s.line, s.start, s.end, { premium: o.premium, own });
    if (!c) return null;
    first ??= c;
  }
  return first;
}

/** A page that says it is a sample or specimen. TE r377 round 3: a banner counts only in the page's heading block (its
 * first five lines) or its footer (its last three), as a whole line that names the document itself: SAMPLE, SPECIMEN,
 * DUMMY or MOCK-UP, alone or with document words or "only" ("SAMPLE POLICY SCHEDULE", "Specimen Certificate of
 * Insurance", "POLICY SCHEDULE (SPECIMEN)", "*** Sample schedule for training ***"), and at most a disclaimer beside it
 * ("SPECIMEN - NOT VALID FOR CLAIMS", "Sample only - this is not an actual policy", "VOID - SPECIMEN"). Never a body
 * heading or note, never another noun after the marker ("Specimen signature", "SPECIMEN COLLECTION", "Sample statement of
 * account enclosed"), never "Void if altered" or "Example only". */
const BANNER_MARK = /^(?:sample|specimen|dummy|mock-?up)$/i;
const BANNER_WORD = /^(?:policy|schedule|statement|certificate|of|insurance|document|contract|card|letter|notice|copy|only|coverage|cover|summary|for|training|void|a|an|the|this|illustration|illustrative|purposes|is)$/i;
const PHRASE_MARK = /^(?:for\s+illustrat(?:ion|ive)\s+(?:purposes\s+)?only|test\s+document(?:\s+only)?)$/i;
const DISCLAIMER = /\bnot\s+(?:valid|for|a\s+real|an\s+actual|to\s+be\s+used|an?\s+(?:policy|contract))\b/i;
function bannerLine(line: string): boolean {
  // Words in brackets inside a title are never its banner ("Policy Schedule (sample collection included)", TE round 4).
  const t = line.trim().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/^[\s*#=_|~\-–]+|[\s*#=_|~\-–]+$/g, "").trim();
  if (!t || /(?:S\$|US\$|\$|RM|SGD|£|€)\s?\d|\d{3,}/.test(t) || t.split(/\s+/).length > 10) return false;
  const parts = t.split(/\s*[-–:|]\s+|\s+[-–:|]\s*|\.\s+|[()[\]]/).map((x) => x.replace(/^[\s*.,!]+|[\s*.,!]+$/g, "")).filter(Boolean);
  let marked = false;
  for (const part of parts) {
    const words = part.split(/\s+/);
    // Two whole-part markers that name the document as not real: "FOR ILLUSTRATION PURPOSES ONLY", "TEST DOCUMENT" (never
    // with another word before it, as made-up test packs print "SYNTHETIC TEST DOCUMENT").
    if (PHRASE_MARK.test(part)) { marked = true; continue; }
    if (/^page\s+\d+(?:\s+of\s+\d+)?$/i.test(part)) continue;
    if (words.some((w) => BANNER_MARK.test(w)) && words.every((w) => BANNER_MARK.test(w) || BANNER_WORD.test(w))) { marked = true; continue; }
    if (DISCLAIMER.test(part) || words.every((w) => BANNER_WORD.test(w))) continue;
    return false;
  }
  return marked;
}
/** The page's heading block (its first lines before any particulars or figure line, at most five) and its footer (the
 * lines after its last figure line, at most three). A lone "Sample" between a label and its figure is a table cell, not a
 * heading (Critic G4). */
function pageEdges(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const body = (l: string) => /\S\s*:\s*\S|(?:S\$|US\$|\$|RM|SGD|£|€)\s?\d/.test(l);
  const firstBody = lines.findIndex(body), lastMoney = lines.map((l) => /(?:S\$|US\$|\$|RM|SGD|£|€)\s?\d/.test(l)).lastIndexOf(true);
  const head = lines.slice(0, Math.min(8, firstBody < 0 ? lines.length : firstBody));
  // A whole banner (a marker with document words or a disclaimer, not a lone word) also counts anywhere in the page's
  // first eight lines, after a label line too ("Policy No: ...", then "SPECIMEN POLICY SCHEDULE").
  const upper = lines.slice(0, 8);
  const foot = lines.slice(Math.max(lastMoney + 1, lines.length - 3));
  return { head, upper, foot };
}
const THIS_IS_A_SAMPLE = /\bthis\s+is\s+(?:a|an)\s+(?:sample|specimen)(?:\s+(?:policy|schedule|statement|certificate|document|copy|contract))?\s*(?:only\b|[.!]|$)/im;
export function specimenPage(text: string) {
  // A whole document's text (pages joined by form feeds) is judged as a document (Critic r377d K4).
  if (text.includes("\f")) return specimenDocument(text.split("\f"));
  const { head, upper, foot } = pageEdges(text);
  // A lone marker word ("Sample", "Specimen") is a banner only in the heading block, before any label or figure line; in
  // the footer or under a label it may be a table's row label (Critic r377d K3, G4).
  const lone = (l: string) => BANNER_MARK.test(l.replace(/^[\s*#=_|~\-–()[\]]+|[\s*#=_|~\-–()[\]]+$/g, ""));
  return THIS_IS_A_SAMPLE.test(text) || head.some(bannerLine) || [...upper, ...foot].filter((l) => !lone(l)).some(bannerLine);
}
/** Whether a whole document is a sample, so that no page of it gives anyone cover: its first page is a sample page (a
 * heading or footer banner). A later page that is itself a specimen or an illustration ("SPECIMEN POLICY CONTRACT", a
 * benefit illustration's "FOR ILLUSTRATION PURPOSES ONLY", a sample member card) sets aside only that page: real policy
 * packs end with such pages (Critic r378 L1-L5, TE r378). */
export function specimenDocument(pages: string[]): boolean {
  const first = pages.find((p) => p.trim());
  return !!first && specimenPage(first);
}
/** The names a page's own heading block prints as its title or product ("SilverYears Care" on that scheme's own
 * statement), never a document-type line ("Policy Schedule"). The own scheme is taken from these only, never from a
 * reading (TE r377 round 4). */
function titleNames(text: string): string[] {
  const first = text.includes("\f") ? text.split("\f").find((p) => p.trim()) ?? "" : text;
  return pageEdges(first).head.map((l) => l.replace(/^[\s*#=_|~\-–]+|[\s*#=_|~\-–]+$/g, ""))
    .filter((l) => l.length >= 3 && l.split(/\s+/).length <= 6 && !/\d/.test(l) && !/\b(?:schedule|statement|certificate|summary|notice|letter|contract|coverage|wording|endorsement|guide|brochure)\b/i.test(l));
}

/** Lower-case words that are part of a name ("binti", "a/l", "van", "de"). */
const NAME_PARTICLE = /^(?:bin|binti|binte|bte|bt|b\.|bint|ibn|d\/o|s\/o|a\/l|a\/p|ap|van|von|der|den|de|da|das|do|dos|du|del|della|di|la|le|al|el|y|e)$/i;
const HONORIFIC = /^(?:mr|mrs|ms|mdm|miss|dr|madam|mister|mx)\.?$/i;
/** Words that may sit in a name cell without being part of the name: an identity number or a date of birth label. */
const ID_TOKEN = /^(?:[stfgm]\d{4,}[a-z]?|x{3,}\d*[a-z]?|\*{2,}\d*[a-z]?|\(.*\)|nric|fin|id|passport)$/i;
/** A label that never introduces the page's own person ("Example:", "Dear", "Meet"). */
// Word edges by letters of any script: "hi" is no word of "hiểm".
const NOT_A_PERSON_LABEL = /(?<!\p{L})(?:example|e\.g|sample|specimen|illustration|illustrative|hypothetical|dear|meet|hi|hello|story|case\s+study|testimonial)(?!\p{L})/iu;
/** A heading line that sets aside the person under it, a closed shape: the line is only a marker ("Example", "Example:",
 * "Example 2", "Sample", "Case studies", "Meet our customer"), or a sample banner of document words. A line that opens with
 * such a word and goes on to name something else ("Sample collection benefit included") never does (TE r377 round 6). */
const MARKER_HEADING = /^\W*(?:(?:example|e\.g|sample|specimen|illustration|illustrative|hypothetical|case\s+stud(?:y|ies)|testimonials?|customer\s+stor(?:y|ies)|(?:a\s+)?real\s+stor(?:y|ies))\s*\d*\s*[:.\-–!]?|meet\s+(?:our|the|a)?\s*(?:customers?|members?|clients?|famil(?:y|ies)|[A-Z][\w'-]*)(?:\s+[A-Z][\w'-]*)?\s*[:.!,]?)\s*$/iu;
/** Whether the page prints this person as its particulars: a cell of the page (a line, or a part of one set off by a tab, a
 * colon or a run of spaces) that is the person's name and nothing else but an honorific or an identity number, and whose
 * label (the cell before it on its line) is not an example's or a greeting's. A name only inside a sentence ("Meet Mdm
 * Rosalind Teo, 58", "Dear Mr Daniel Ong", "Example: Ahmad bin Yusof claims in 2030") is not. */
/** "Traveller" and "Covered member" also head a brochure's example ("Traveller: Rosalind Teo, 34"): they introduce the
 * insured only on a page that prints its own policy or certificate number (TE and Critic r377 round 3). */
const WEAK_LABEL = /^(?:travell?ers?|covered\s+members?)(?:'?s|\(s\))?(?:\s+names?)?$/i;
/** A brochure's story: a line that tells what a person did ("She claims S$5,000 for a cancelled trip"). */
/** A story line also prints a money figure or a claim verb; a certificate's condition ("They must depart from and return
 * to Singapore together", "Their cover starts on the departure date") is no story (Critic r378 N1, N2). */
const NARRATIVE = /^\s*(?:she|he|they|her|his|their)\b[^\n]*(?:(?:S\$|US\$|\$|SGD|RM)\s?\d|\b(?:claim(?:s|ed)?|receive[sd]?|paid|was|were|needed|got|gets)\b)/im;
const OWN_NUMBER = /\b(?:policy|certificate|cert\.?|member(?:ship)?)\s*(?:no\.?|number|#)\s*[:.]?\s*[A-Z]{0,6}[-\/]?\d[\w\/-]{3,}/i;
export function personAsParticulars(person: string, pageText: string): boolean {
  const want = normalizePersonName(person).split(" ").filter((w) => w.length > 0 && !HONORIFIC.test(w));
  if (!want.length) return false;
  const lines = pageText.split("\n");
  // A page with a table whose header names a name column ("No Name Relationship Sum Insured") prints its people in rows.
  const tableish = lines.some((l) => /\bnames?\b/i.test(l) && /\b(?:relationship|nric|age|sum|plan|dob|gender|insured|assured|cover)\b/i.test(l) && l.trim().split(/\s+/).length <= 12);
  for (const [k, raw] of lines.entries()) {
    // A line that is an example's or a greeting's, or comes right under such a heading ("Meet our customer", "Example"),
    // names no insured (Critic r377 E4, E5, E7).
    const prev = (lines[k - 1] ?? "").trim();
    // The previous line counts only as a heading that opens with such a word; a sample or example word elsewhere in a title
    // ("Policy Schedule (sample collection included)") never sets aside the labelled insured under it (TE r377 round 5).
    const prevHead = prev.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
    if (NOT_A_PERSON_LABEL.test(raw) || (prevHead && (MARKER_HEADING.test(prevHead) || bannerLine(prevHead)))) continue;
    // A name printed in capitals is how a schedule or certificate prints its insured, even inside a sentence ("This is
    // to certify that LIM WEI JIE is insured"); a brochure's example person is printed in ordinary case.
    const capitals = raw.match(/\b[A-Z][A-Z'.-]+(?:[ \t]+(?:[A-Z][A-Z'.-]+|BIN|BINTI|BINTE|BTE|BT|D\/O|S\/O|A\/L|A\/P))+\b/g) ?? [];
    if (!NOT_A_PERSON_LABEL.test(raw) && capitals.some((run) => { const n = normalizePersonName(run).split(" "); return want.every((w) => n.includes(w)) && n.length <= want.length + 2; })) return true;
    if (afterInsuredLabel(raw, want, tableish, OWN_NUMBER.test(pageText) && !NARRATIVE.test(pageText))) return true;
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

/** A word on a line that makes the line an example's or a story's, never the document's own particulars: positive evidence
 * only. A greeting ("Dear", "Hi", "Welcome", "Thank you") is addressed to the policyholder, so it is no such word (Critic #384). */
const EXAMPLE_WORD = /(?<!\p{L})(?:examples?|e\.g|for\s+instance|meet|case\s+stud(?:y|ies)|stor(?:y|ies)|testimonials?|illustrative|hypothetical|imagine|suppose|let'?s\s+say)(?!\p{L})/iu;
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A person's name words (no honorific), and a test for each as a whole word in any case, by letters only: digits and
 * brackets around it do not hide it ("(XY1)Tan Mei Ling(S0000002B)"). */
function nameWords(person: string) {
  const want = person.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !HONORIFIC.test(w));
  return { want, word: want.map((w) => new RegExp(`(?<!\\p{L})${escapeRe(w)}(?!\\p{L})`, "iu")) };
}
/** Whether one line of the text prints all the person's name words, in any order and case. */
export function namePrinted(person: string, text: string): boolean {
  const { want, word } = nameWords(person);
  return want.length > 0 && text.split(/\n|\f/).some((l) => word.every((r) => r.test(l)));
}
/** Whether a person the reading names is NOT the document's insured, so cover read for them is set aside. Built to keep:
 * the person is set aside only when none of these holds.
 * 1. A page prints them as its particulars the way main always recognised (personAsParticulars): this never sets aside a
 *    cover main kept.
 * 2. A line that names them (any of their name words: a surname, initials, a split name; in any case, run into other text
 *    or not) and is no example's carries a particulars signal: an insured, holder or name label ("Your name : Lim wei jie",
 *    "Life Assured: LIM W J"), an identity or policy number, a cell break, or the name run into brackets or digits
 *    ("Plan (XY1)Tan Mei Ling(S0000002B)25"). This is the live regression on #377: such layouts keep their cover.
 * 3. The document prints a policy, certificate or identity number of its own, and a line that names them is neither an
 *    example's nor a greeting ("We confirm that Lim Wei Jie is covered", with the policy number on the page).
 * 4. No line names any of their words at all (nothing to judge by).
 * A line is an example's when it has an example or story word, runs on from such a line, sits under a marker heading or a
 * sample banner, is an FAQ's Q:/A: line, introduces the person with an age on a line naming no cover or label, or names
 * them on a brochure page that has only a weak label (Traveller, Covered member) and no number of its own.
 * So a brochure's or a letter's person (a greeting, a story sentence, an FAQ answer) on a document with no particulars and
 * no number of its own gets no cover, as on main (TE #384 L3, E9, E10, E13, E14, G5). */
export function personOnlyInExample(person: string, pages: string[]): boolean {
  const { want, word } = nameWords(person);
  if (!want.length) return false;
  if (pages.some((p) => personAsParticulars(person, p))) return false;
  const ownNumber = (t: string) => OWN_NUMBER.test(t) || /\b[stfgm]\d{7}[a-z]\b/i.test(t)
    || /\b(?:policy|certificate|cert)\b\.?\s*(?:no\.?|number|#|id)?\s*[:.]?\s*(?=[\w\/-]*\d)(?=[\w\/-]*[A-Za-z])[A-Za-z0-9][\w\/-]{5,}/i.test(t);
  const docOwn = pages.some(ownNumber);
  const LABEL = /\b(?:insured|assured|policy\s*holder|policy\s*owner|proposer|member|employee|names?|life|travell?er|person|dependants?|spouse|child|beneficiary|holder|owner)\b[^\n:]{0,25}?(?::|\t|\s[-–]\s)/i;
  const GREETING = /^\W*(?:dear|hi|hello|hey|welcome|thank\s+you|thanks)\b/i;
  const runIn = want.filter((w) => w.length >= 2).map((w) => new RegExp(`[\\d()\\[\\]](?:${escapeRe(w)})(?!\\p{L})|(?<!\\p{L})(?:${escapeRe(w)})[\\d()\\[\\]]`, "iu"));
  // A line that opens with an insured or holder word and then the name, with no colon ("Policyholder Tan Mei", "Employee Lim
  // Wei Jie is covered"), or a certifying phrase ("This certifies that ...").
  const LEAD = new RegExp(`^\\W*(?:the\\s+)?(?:insured|assured|life\\s+assured|policy\\s*holder|policy\\s*owner|proposer|member|employee|travell?er|beneficiary|dependant)(?:'?s|\\(s\\))?(?:\\s+(?:person|name|names))?\\s+(?:(?:mr|mrs|ms|mdm|miss|dr|madam)\\.?\\s+)?(?:${want.filter((w) => w.length >= 2).map(escapeRe).join("|")})(?!\\p{L})`, "iu");
  const signal = (l: string) => LEAD.test(l) || /\bcertif(?:y|ies|ied)\b[^.\n]{0,30}\bthat\b/i.test(l) || LABEL.test(l) || ownNumber(l) || /\t|\S\s{2,}\S|\|/.test(l) || runIn.some((r) => r.test(l));
  let named = false;
  const whole = (l: string) => word.every((r) => r.test(l));
  const any = want.filter((w) => w.length >= 2).map((w) => new RegExp(`(?<!\\p{L})${escapeRe(w)}(?!\\p{L})`, "iu"));
  const QA = /^\s*(?:q|a|q\d+|question|answer)\s*[:.)]/i;
  // A brochure's person introduced with an age, on a line that names no cover, policy, label or number ("Ken Lau, 38, chose
  // S$900 a month.", "Take Ken Lau, a 38-year-old teacher."): a schedule prints an age after a label or in a cell (Critic #384).
  const nameRun = `${want.map(escapeRe).join("\\s+")}`;
  const aged = new RegExp(`(?<!\\p{L})${nameRun}(?!\\p{L})\\s*,\\s*(?:\\d{1,2}\\s*(?:,|$|\\.)|aged\\s+\\d{1,2}\\b|an?\\s+\\d{1,2}[-\\s]year[-\\s]old\\b)`, "iu");
  const agedStory = (l: string) => aged.test(l) && !/\t|\S\s{2,}\S|\|/.test(l) && !OWN_NUMBER.test(l) && !/\b[stfgm]\d{7}[a-z]\b/i.test(l)
    && !/\b(?:insured|assured|policy|plan|cover(?:ed|age)?|certificate|member|employee|holder|owner|proposer|nric|fin|passport|name|traveller|dependant|spouse|child|relationship)\b/i.test(l);
  for (const text of pages) {
    const lines = text.split(/\n|\f/);
    // A question-and-answer page (an FAQ): its "Q:" and "A:" lines are worked answers, never particulars.
    const faq = lines.some((l) => /^\s*(?:q\d*|question)\s*[:.)]/i.test(l)) && lines.some((l) => /^\s*(?:a|answer)\s*[:.)]/i.test(l));
    // A brochure page that names the person only after a weak label ("Traveller:", "Covered member -") and prints no policy,
    // certificate or identity number of its own: every line of it that names the person is the brochure's (p377c I1, TE F2).
    const own = OWN_NUMBER.test(text) || /\b(?:policy|certificate|cert|member(?:ship)?|plan)\b[^\n]{0,20}?\b[A-Z]{0,6}[-\/]?\d[\w\/-]{3,}/i.test(text) || /\b[stfgm]\d{7}[a-z]\b/i.test(text);
    const weakPage = !own && lines.some((l) => { const m = /^\s*([^:\t]{2,40}?)\s*(?::|\t|\s[-–]\s)\s*(.+)$/.exec(l); return !!m && WEAK_LABEL.test(m[1].trim()) && whole(m[2]); });
    const evidence: boolean[] = [];
    for (const [k, raw] of lines.entries()) {
      const prev = (lines[k - 1] ?? "").trim();
      const prevHead = prev.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
      // An example word on the line, or on the line before when that line runs on into this one ("Example: Mr Ken" /
      // "Lau, 40, buys S$300,000 of cover."); a marker heading or a sample banner right above.
      evidence[k] = EXAMPLE_WORD.test(raw) || (!!prevHead && (MARKER_HEADING.test(prevHead) || bannerLine(prevHead)))
        || (k > 0 && evidence[k - 1] && EXAMPLE_WORD.test(prev) && !/[.!?]["')\]]?$/.test(prev) && !/^\s*[^:\t]{2,40}?\s*(?::|\t|\s[-–]\s)/.test(raw))
        || (faq && QA.test(raw)) || weakPage || agedStory(raw);
      if (!any.some((r) => r.test(raw))) continue;
      named = true;
      if (evidence[k]) continue;
      if (signal(raw) || (docOwn && !GREETING.test(raw))) return false;
    }
  }
  return named;
}

/** A label that introduces the insured person, a closed list ("Name of Life Assured", "Insured Child:", "Policyholder",
 * "Insured person name", "Member"), or a row number at the start of a table row ("1"), or nothing at all. */
const INSURED_LABEL = /^(?:\d{1,3}[.)]?|(?:name\s+of\s+(?:the\s+)?)?(?:(?:joint\s+)?(?:life|lives)\s+(?:assured|insured)|insured(?:\s+(?:person|persons|member|members|child|children|spouse|life|lives|employee|travell?ers?))?|covered\s+(?:person|persons|member|members|life|lives)|travell?ers?|assured|policy\s*holder|policy\s+owner|proposer|member|employee|dependants?)(?:'?s|\(s\))?(?:\s+(?:name|names))?|name|this\s+is\s+to\s+certify\s+that|we\s+certify\s+that|certif(?:y|ies)\s+that)?$/i;
/** What may follow the name on its line: a cell break, or only an age, gender, relationship, date, identity number, money
 * figure or plan cell ("Female 12/03/1985", ", 5 years", "born 3 Mar 2019", ", NRIC S1234567A", "Spouse S$100,000"), or
 * "is insured" after a certificate's "certify that". */
const TRAIL_TOKEN = /^(?:\d[\d\/.,-]*|[stfg]\d{7}[a-z]|[stfg]\*+\d*[a-z]?|s\$[\d,.]+|(?:sgd|rm|us\$|\$)[\d,.]*|age[d]?|years?|yrs?|old|born|dob|on|nric|fin|id|passport|no\.?|male|female|m|f|self|spouse|wife|husband|child|son|daughter|father|mother|dependant|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;
/** The person printed after an insured label (or a row number, or alone), with only particulars after the name on its line
 * (Critic r377 A1-A23: "Name of Life Assured Lim Wei Jie", "Insured Child: Tan Xiao Ming, 5 years", "1 Lee Mei Ling
 * Spouse S$100,000", "This is to certify that Lim Wei Jie is insured"). */
function afterInsuredLabel(raw: string, want: string[], tableish: boolean, numbered: boolean): boolean {
  const labelOk = (l: string) => INSURED_LABEL.test(l) && (numbered || !WEAK_LABEL.test(l));
  if (NOT_A_PERSON_LABEL.test(raw)) return false;
  // A list after an insured label ("Insured persons: A, B and C", "Insured: Lim Wei Jie,
  // born 3 Mar 1980", "Insured: Lee Mei Ling, Female, 45"): each item is a name with only particulars, or particulars.
  const listed = /^\s*([^:\t]{2,50}?)\s*(?::|\t|\s[-–]\s)\s*(.+)$/.exec(raw);
  if (listed && listed[1].trim() && !/^\d/.test(listed[1].trim()) && labelOk(listed[1].trim())
      && listed[2].replace(/\([^)]*\)/g, " ").split(/\s*(?:,|;|&|\band\b|\t)\s*/).some((item) => nameWithParticulars(item, want))) return true;
  const tokens = [...raw.matchAll(/[^\s,;:()]+/g)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));
  for (let i = 0; i < tokens.length; i++) {
    for (let len = want.length; len <= want.length + 2 && i + len <= tokens.length; len++) {
      const win = tokens.slice(i, i + len).filter((t) => !HONORIFIC.test(t.w));
      const norm = win.map((t) => normalizePersonName(t.w)).join(" ").split(" ").filter(Boolean);
      if (!want.every((w) => norm.includes(w)) || norm.length > want.length + 2) continue;
      if (win.some((t) => /\d/.test(t.w) || (/^[a-z]/.test(t.w) && !NAME_PARTICLE.test(t.w)))) continue;
      const before = raw.slice(0, tokens[i].start).replace(/(?:\b(?:mr|mrs|ms|mdm|miss|dr|madam)\.?\s*)+$/i, "").replace(/[\s:\-–\t|]+$/, "").trim();
      // A certifying sentence names its insured, whatever follows ("We hereby certify that Lim Wei Jie, born ..., is insured").
      if (/\bcertif(?:y|ies|ied)\b[^.]{0,30}\bthat$/i.test(before)) return true;
      if (!labelOk(before)) continue;
      // No label, or a row number: only on a table line (cell breaks) or a page with a name column (Critic r377 E2, E3).
      if ((!before || /^\d/.test(before)) && !tableish && !/\t|\s{2,}|\|/.test(raw)) continue;
      const after = raw.slice(tokens[i + len - 1].end);
      if (/^\s*(?:\t|\s{2,}|\||$)/.test(after)) return true;
      const rest = after.replace(/\([^)]*\)/g, " ").split(/[\s,;:.]+/).filter(Boolean);
      if (rest.every((w) => TRAIL_TOKEN.test(w))) return true;
    }
  }
  return false;
}
/** One item of a list: the person's name (with at most two more name words and an honorific), then only particulars. */
function nameWithParticulars(item: string, want: string[]): boolean {
  const toks = item.split(/\s+/).filter(Boolean).filter((t) => !HONORIFIC.test(t));
  for (let len = want.length; len <= want.length + 2 && len <= toks.length; len++) {
    const win = toks.slice(0, len);
    const norm = normalizePersonName(win.join(" ")).split(" ").filter(Boolean);
    if (!want.every((w) => norm.includes(w))) continue;
    if (win.some((t) => /\d/.test(t) || (/^[a-z]/.test(t) && !NAME_PARTICLE.test(t)))) continue;
    if (toks.slice(len).every((w) => TRAIL_TOKEN.test(w.replace(/[.,;:]+$/, "")))) return true;
  }
  return false;
}
