/**
 * V1.1 Task 2: the source-verified answer boundary.
 *
 * Every material statement an answer makes is first a structured Assertion.
 * verifyAssertions() keeps only the ones whose cited passage, document
 * version and ownership actually support them; everything else is dropped
 * with a reason. Nothing that fails a check is rendered -- not softened, not
 * caveated, omitted.
 *
 * Checks, in order:
 *  - the document exists, belongs to this household, is active (not deleted
 *    or pending deletion) and was released by the document-safety gate; a
 *    superseded document fails unless the assertion presents it as
 *    superseded (and its wording says so);
 *  - the subject is one of the people the question is about, the document
 *    speaks for that person, and the wording names no one else;
 *  - the cited version (checksum) is recorded, the document's version is
 *    known, and the two are the same (a missing hash is never a pass);
 *  - a page is recorded and the passage is found on that page;
 *  - every number, currency, date and condition the assertion states is in
 *    the passage (so a citation to the wrong clause does not count);
 *  - Round 16 -- what the passage says about it, not only its words:
 *     * polarity: a coverage claim may not reverse the passage ("not",
 *       "no", "excluded", "does not", "will not", "shall not", "nil", "not
 *       payable", "not covered" ...), and a line printed under an
 *       Exclusions heading is not cover;
 *     * qualifiers the passage attaches (waiting period, only if, subject
 *       to, provided that, unless / except, age limits, day / visit caps)
 *       are carried by the wording or the assertion's conditions;
 *     * units and periods (per day / month / year / event, lifetime, %,
 *       days vs months) are the passage's, never swapped or dropped;
 *     * an amount belongs to the row (label) it is stated for, not a
 *       neighbouring row of the same passage;
 *     * the currency printed beside the amount is the assertion's: never
 *       relabelled, never assumed (a bare "$" names no currency);
 *  - no recorded conflict between versions/pages (a conflict is withheld and
 *    explained, never resolved by picking one);
 *  - an indicative estimate never passes here: only the deterministic claim
 *    calculators may produce one.
 */
import { cleanScannedLine, looksScanned } from "./scanned-text";
import { currenciesStatedIn, currencyStatedIn } from "@/lib/claims/currency-evidence";

export type Assertion = {
  kind: "policy_fact" | "possible_benefit" | "indicative_estimate";
  text: string; subjectId: string; policyId: string;
  documentHash: string | null; page: number | null; passage: string;
  amount?: number | null; currency?: string | null; date?: string | null; conditions?: string[];
  /** Additive (V1.1): the ingestion evidence flags for the stored fact. */
  conflictNote?: string | null; passageVerified?: boolean | null;
  /** Round 16: the wording explicitly presents a superseded document as superseded ("the earlier schedule, since replaced, stated ..."). */
  presentedAsSuperseded?: boolean;
};
export type AssertionDocument = {
  id: string; accountId: string; lifecycleState: string; supersededAt: string | null; quarantineStatus: string | null;
  fileHash: string | null;
  /** The people this document may speak for in this answer. */
  subjectIds: string[];
};
export type VerifyPerson = { id: string; display_name?: string | null; preferred_name?: string | null };
export type VerifyContext = {
  accountId: string; people: VerifyPerson[];
  documents: Record<string, AssertionDocument>;
  /** Stored text of a page, or null when the page is unknown. */
  pageText: (policyId: string, page: number) => string | null;
  /** Everyone in the household (for "the wording names someone else"); defaults to `people`. */
  household?: VerifyPerson[];
};
export type Rejection = { assertion: Assertion; reason: string };

const RELEASED = new Set(["scan_clean", "not_scanned_prototype"]);
export function normalPassage(text: string) {
  return text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim().toLowerCase();
}
function numbersIn(text: string) {
  return (text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** `amount` is literally present in `passage` (thousands separators and
 * trailing .00 tolerated; nothing else -- 100 is not "1,000"). */
export function amountAppears(amount: number, passage: string) {
  if (!Number.isFinite(amount)) return false;
  return numbersIn(passage).some((n) => same(n, amount));
}
function dateVariants(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [iso];
  const [, y, mo, d] = m; const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const name = months[Number(mo) - 1], short = name.slice(0, 3), day = String(Number(d));
  return [iso.slice(0, 10), `${d}/${mo}/${y}`, `${day}/${Number(mo)}/${y}`, `${d}.${mo}.${y}`, `${day} ${name} ${y}`, `${day} ${short} ${y}`, `${d} ${short} ${y}`, `${name} ${day}, ${y}`, `${short} ${day}, ${y}`, `${d}-${short}-${y}`];
}
export function dateAppears(date: string, passage: string) {
  const p = normalPassage(passage);
  return dateVariants(date).some((v) => p.includes(normalPassage(v)));
}
/** A condition is stated in the passage: verbatim, or every number and every
 * meaningful word of it is there. */
export function conditionAppears(condition: string, passage: string) {
  const c = normalPassage(condition).replace(/[.;:,]+$/, ""), p = normalPassage(passage);
  if (!c) return true;
  if (p.includes(c)) return true;
  const numbers = numbersIn(condition), have = numbersIn(passage);
  if (!numbers.every((n) => have.some((h) => same(h, n)))) return false;
  const words = c.match(/[a-z]{4,}/g) ?? [];
  return words.length > 0 && words.every((w) => p.includes(w));
}
function passageOnPage(passage: string, page: string) {
  const p = normalPassage(passage);
  return p.length >= 3 && normalPassage(page).includes(p);
}

// ---------------------------------------------------------------------------
// Round 16: what a passage says, not only which words it has.
// ---------------------------------------------------------------------------

/** Phrases with a negative word that do not negate what they are about: a cap
 * ("not exceeding 30 days"), a deadline ("no later than"), a discount name
 * ("no-claim discount"), a number abbreviation ("Policy No."). */
const BENIGN_NEGATIVE = /\bnot\s+(?:exceeding|to exceed|more than|less than|later than|earlier than|fewer than|only)\b|\bno\s+(?:more|later|less|fewer|earlier)\s+than\b|\bno[- ]claims?\b|\bnon[- ]?(?:smoker|participating|par|guaranteed)\b|\bwhether or not\b|\bnot guaranteed\b|\bnon-?guaranteed\b|\(?no currency is printed for this amount\)?|\bno currency\b|\bno (?:limit|cap|maximum|upper limit|sub-?limit)s?\b(?: (?:is )?printed)?|\bno\.(?=\s*(?:[:#]|\d|[A-Z0-9-]{2,}|of\b))|\bnos?\.\s/gi;
/** Words that make a statement negative: "not", "no", "excluded", "nil", "does not", "will not", "shall not", "not payable", "not covered" ... */
const NEGATIVE = /\b(?:not|no|never|nil|none|nothing|neither|nor|cannot|can't|won't|doesn't|don't|isn't|aren't|wasn't|weren't|shan't|shouldn't|excluded|excludes?|exclusions?|uninsured|n\/a|without (?:any )?cover)\b|\bn\.a\.(?!\w)/i;
/** A heading (or a "Heading:" prefix) that makes what follows an exclusion: short, not a sentence, and naming
 * exclusions ("Exclusions", "GHS EXCLUSIONS", "Section 5 - What is not covered", "We will not pay for"). */
const EXCLUSION_WORDS = /\b(?:exclusions?(?:\s+clauses?)?|what (?:is|are) not covered|what (?:we|this policy) (?:do(?:es)? not|don't|doesn't|will not|won't) (?:cover|pay(?: for)?)|items? not covered|not covered|we (?:do not|don't|will not|won't) (?:cover|pay(?: for)?))\b/i;
function isExclusionHeading(text: string): boolean {
  const h = text.trim().replace(/:\s*$/, "");
  return !!h && h.split(/\s+/).length <= 8 && !/[.;!?]\s*$/.test(h) && EXCLUSION_WORDS.test(h) && !/\b(?:does not apply|do not apply|exceptions? to)\b/i.test(h);
}
const HEADING_LINE = /^\s*(?:(?:section|part|clause|article)\s+\d+[a-z]?\s*[-–:.]?\s*|\d+(?:\.\d+)*[.)]?\s+)?[A-Za-z][A-Za-z &'’/,()-]{1,70}:?\s*$/;

/** The text with benign negative phrases removed. */
const unBenign = (text: string) => text.replace(BENIGN_NEGATIVE, " ");
/** Is this (one clause of) text negative? A leading exclusion heading
 * ("Exclusions: ...") counts as one negation, so "Exclusions: this exclusion
 * does not apply to X" is positive about X. */
export function negated(text: string, underExclusionHeading = false): boolean {
  let t = text.trim(), flips = underExclusionHeading ? 1 : 0;
  const m = t.match(/^([^:\n]{2,60}?)\s*[:–-]\s+/);
  if (m && isExclusionHeading(m[1])) { flips++; t = t.slice(m[0].length); }
  const body = unBenign(t);
  if (NEGATIVE.test(body)) flips++;
  return flips % 2 === 1;
}

const STOP = new Set(["this", "that", "these", "those", "with", "from", "under", "your", "their", "them", "they", "will", "shall", "would", "could", "does", "have", "been", "being", "were", "what", "which", "when", "where", "there", "here", "into", "onto", "upon", "also", "only", "each", "every", "plan", "policy", "policies", "insured", "insurer", "states", "stated", "print", "printed", "says", "column", "page", "schedule", "document", "about", "than", "more", "less", "after", "before", "within", "until", "including", "subject", "provided", "unless", "except", "excluding", "pays", "payable", "cover", "covered", "covers", "coverage", "benefit", "benefits", "amount", "limit", "maximum", "minimum", "sum", "death", "life"]);
const GENERIC_LABEL = new Set(["sum", "insured", "assured", "benefit", "benefits", "amount", "cover", "coverage", "limit", "limits", "maximum", "plan", "policy", "per", "total", "annual", "yearly", "lifetime", "daily", "basic", "main"]);
const stem = (w: string) => w.length > 4 ? w.replace(/(?:ies|ing|ed|es|s|e)$/, "") : w;
function contentWords(text: string, extraStop?: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const w of unBenign(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    if (STOP.has(w) || extraStop?.has(w) || NEGATIVE.test(w) || /^(?:excluded|exclusion|exclusions|exclude|excludes)$/.test(w)) continue;
    out.add(stem(w.replace(/'s$/, "")));
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

/** A line broken inside a sentence ("no further\npremium is payable") is one line. */
const unwrap = (text: string) => text.replace(/([^.;:!?\n\t])\n(?=[a-z])/g, "$1 ");
/** The clauses of a passage: lines, then sentences and ";"-separated parts. */
function clausesOf(passage: string): string[] {
  return unwrap(passage).split(/\n+|;\s+|(?<=[a-z)%\d])\.\s+(?=[A-Z(“"])/).map((s) => s.trim()).filter((s) => s.length > 0);
}
/** The rows of a passage, when it is several (lines or ";"-separated rows; "|" and tabs separate a row's cells). */
function rowsOf(passage: string): string[] {
  return unwrap(passage).split(/\n+|;\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Whether the passage sits under an Exclusions heading on its page. */
function underExclusionHeading(passage: string, page: string | null): boolean {
  if (!page) return false;
  const lines = page.split(/\n/);
  const head = normalPassage(passage).slice(0, 40);
  if (!head) return false;
  let at = -1;
  for (let i = 0; i < lines.length; i++) { const l = normalPassage(lines[i]); if (l && (l.includes(head) || (l.length >= 6 && head.startsWith(l.slice(0, 40))))) { at = i; break; } }
  if (at < 0) return false;
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    if (isExclusionHeading(l)) return true;
    // Any other heading (a numbered or "Section" heading, an ALL-CAPS or Title Case line, a "Heading:" line) ends the search.
    if (HEADING_LINE.test(l) && !/\t/.test(l) && l.split(/\s+/).length <= 8 && ((/^[^a-z]*$/.test(l) && l.split(/\s+/).length >= 2) || /:\s*$/.test(l) || /^(?:section|part|clause|article)\b|^\d+(?:\.\d+)*[.)]?\s+[A-Za-z]/i.test(l) || /^[A-Z][\w'’()-]*(?:\s+[A-Z][\w'’()-]*)*$/.test(l))) return false;
  }
  return false;
}

/** The page prints an exclusion heading somewhere before the passage. */
function exclusionHeadingBefore(passage: string, page: string | null): boolean {
  if (!page) return false;
  const at = normalPassage(page).indexOf(normalPassage(passage).slice(0, 40));
  const before = at >= 0 ? page.slice(0, Math.max(0, Math.min(page.length, at + 40))) : "";
  return before.split(/\n/).some((l) => isExclusionHeading(l));
}

// ---- units and periods ------------------------------------------------------
type Period = "day" | "week" | "month" | "year" | "event" | "lifetime";
const PERIOD_AFTER: [RegExp, Period][] = [
  [/^(?:[^\d.;\n]{0,24}?)\b(?:per|a|each|every|\/)\s*(?:day|night)\b|^(?:[^\d.;\n]{0,10}?)\bdaily\b/i, "day"],
  [/^(?:[^\d.;\n]{0,24}?)\b(?:per|a|each|every|\/)\s*week\b|^(?:[^\d.;\n]{0,10}?)\bweekly\b/i, "week"],
  [/^(?:[^\d.;\n]{0,24}?)\b(?:per|a|each|every|\/)\s*month\b|^(?:[^\d.;\n]{0,10}?)\bmonthly\b/i, "month"],
  [/^(?:[^\d.;\n]{0,24}?)\b(?:per|a|each|every|in any|\/)\s*(?:(?:policy|calendar|insurance)\s+)?(?:year|annum)\b|^(?:[^\d;\n]{0,10}?)(?:\bp\.\s?a\.|\bannually\b|\byearly\b)/i, "year"],
  [/^(?:[^\d.;\n]{0,24}?)\b(?:per|each|every|any one|for (?:each|any one))\s+(?:event|accident|incident|occurrence|disability|injury|admission|hospitali[sz]ation|operation|surgery|visit|trip|journey|claim|illness|condition)\b/i, "event"],
  [/^(?:[^\d.;\n]{0,24}?)\b(?:lifetime|per life(?:time)?|over (?:the|your) lifetime|for life)\b/i, "lifetime"],
];
const PERIOD_BEFORE: [RegExp, Period][] = [
  [/\b(?:daily|per day)\s+(?:[a-z]+\s+){0,2}(?:limit|maximum|cap|benefit|cash|allowance|amount)[^\d.;\n]{0,20}$/i, "day"],
  [/\b(?:monthly)\s+(?:[a-z]+\s+){0,2}(?:limit|maximum|cap|benefit|income|payout|amount|premium)[^\d.;\n]{0,20}$/i, "month"],
  [/\b(?:annual|yearly|per (?:policy )?year|policy year)\s+(?:[a-z]+\s+){0,2}(?:limit|maximum|cap|benefit|amount|premium)[^\d.;\n]{0,20}$/i, "year"],
  [/\b(?:limit|maximum|cap)\s+(?:per|a|each)\s+(?:policy\s+)?year[^\d.;\n]{0,20}$/i, "year"],
  [/\b(?:lifetime)\s+(?:[a-z]+\s+){0,2}(?:limit|maximum|cap|benefit|amount)[^\d.;\n]{0,20}$/i, "lifetime"],
  [/\b(?:per (?:event|accident|disability|admission|visit|trip|claim))\s+(?:limit|maximum|cap)[^\d.;\n]{0,20}$/i, "event"],
];
const UNIT_AFTER: [RegExp, string][] = [
  [/^\s?%|^\s?per ?cent\b/i, "%"],
  [/^\s?-?\s?(?:calendar\s+|working\s+|consecutive\s+)?(?:days?|nights?)\b/i, "day"],
  [/^\s?-?\s?weeks?\b/i, "week"],
  [/^\s?-?\s?months?\b/i, "month"],
  [/^\s?-?\s?years?\b(?!\s+old)/i, "year"],
  [/^\s?-?\s?(?:visits?|sessions?|treatments?)\b/i, "visit"],
  [/^\s?-?\s?times?\b/i, "times"],
];
type Occurrence = { value: number; unit: string | null; period: Period | null; currency: string | null; at: number };
const CURRENCY_BEFORE: [RegExp, string][] = [
  [/(?:\bS\$|\bSG\$|\bSGD)\s?$/i, "SGD"], [/(?:\bUS\$|\bUSD)\s?$/i, "USD"], [/(?:\bRM|\bMYR)\s?$/i, "MYR"], [/(?:\bHK\$|\bHKD)\s?$/i, "HKD"],
  [/(?:\bA\$|\bAU\$|\bAUD)\s?$/i, "AUD"], [/(?:€|\bEUR)\s?$/i, "EUR"], [/(?:£|\bGBP)\s?$/i, "GBP"], [/(?:¥|\bJPY)\s?$/i, "JPY"], [/(?:₱|\bPHP)\s?$/i, "PHP"],
];
const CURRENCY_AFTER: [RegExp, string][] = [[/^\s?SGD\b/i, "SGD"], [/^\s?USD\b/i, "USD"], [/^\s?MYR\b/i, "MYR"], [/^\s?HKD\b/i, "HKD"], [/^\s?AUD\b/i, "AUD"], [/^\s?EUR\b/i, "EUR"], [/^\s?GBP\b/i, "GBP"]];
/** Every number in `text` with the unit, period and currency printed beside it. */
function occurrences(text: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const m of text.matchAll(/(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.,])\d+(?:\.\d+)?/g)) {
    const at = m.index!, end = at + m[0].length;
    const value = Number(m[0].replace(/,/g, ""));
    const before = text.slice(Math.max(0, at - 40), at), after = text.slice(end, end + 48);
    const unit = UNIT_AFTER.find(([re]) => re.test(after))?.[1] ?? null;
    const afterClause = after.split(/[;\n]|\.\s/)[0];
    const period = (PERIOD_AFTER.find(([re]) => re.test(afterClause))?.[1] ?? PERIOD_BEFORE.find(([re]) => re.test(before.split(/[;\n]|\.\s/).at(-1) ?? ""))?.[1]) ?? null;
    const currency = CURRENCY_BEFORE.find(([re]) => re.test(before))?.[1] ?? CURRENCY_AFTER.find(([re]) => re.test(after))?.[1] ?? null;
    out.push({ value, unit, period: unit && unit !== "%" ? null : period, currency, at });
  }
  return out;
}

/** Every figure `text` prints beside a currency, with the period printed with it. */
export function printedFigures(text: string): { value: number; currency: string; period: string | null }[] {
  return occurrences(text).filter((o) => o.currency).map((o) => ({ value: o.value, currency: o.currency!, period: o.period }));
}
/** How `text` prints `amount`: beside `currency` ("match"), beside another currency only ("other"), only bare
 * ("bare"), or not at all ("absent"). A bare "$" names no currency. */
export function amountPrintedWith(amount: number, currency: string | null, text: string): "match" | "other" | "bare" | "absent" {
  const at = occurrences(text).filter((o) => same(o.value, amount));
  if (!at.length) return "absent";
  if (currency && at.some((o) => o.currency === currency)) return "match";
  return at.some((o) => o.currency) ? "other" : "bare";
}

// ---- qualifiers ---------------------------------------------------------------
type Qualifier = { key: string; keyRe: RegExp; span: string };
const QUALIFIERS: { key: string; find: RegExp; keyRe: RegExp }[] = [
  { key: "waiting period", find: /\bwaiting period\b[^.;\n]{0,40}|\b\d+[- ]?days?\s+waiting period\b/gi, keyRe: /\bwaiting\b/i },
  { key: "survival period", find: /\bsurvival period\b[^.;\n]{0,40}/gi, keyRe: /\bsurviv/i },
  { key: "only if", find: /\bonly (?:if|when|where|after|upon|on|for)\b[^.;\n]{0,50}/gi, keyRe: /\bonly\b|\bif\b|\bwhen\b|\bprovided\b/i },
  { key: "subject to", find: /\bsubject to\b[^.;,\n]{0,50}/gi, keyRe: /\bsubject to\b|\bafter\b|\bless\b|\bminus\b/i },
  { key: "provided", find: /\bprovided (?:that\s+)?\b[^.;\n]{0,50}/gi, keyRe: /\bprovided\b|\bif\b|\bonly\b|\bas long as\b/i },
  { key: "unless", find: /\bunless\b[^.;\n]{0,60}/gi, keyRe: /\bunless\b|\bif\b|\bexcept\b|\bwhen\b/i },
  { key: "except", find: /\bexcept(?:\s+(?:for|where|when|if))?\b[^.;\n]{0,60}/gi, keyRe: /\bexcept\b|\bunless\b|\bif\b|\bother than\b|\bexcluding\b/i },
  { key: "excluding", find: /\bexcluding\b[^.;\n]{0,60}/gi, keyRe: /\bexclud|\bexcept\b|\bnot\b|\bother than\b/i },
  { key: "age", find: /\b(?:up to|until|before|from|after|between|below|under|over|above|reaching|attain(?:s|ing)?)\s+(?:the\s+)?(?:age|aged)\s+(?:of\s+)?\d+|\bages?\s+\d+(?:\s*(?:to|-|–|and)\s*\d+)?|\baged\s+\d+(?:\s*(?:to|-|–|and)\s*\d+)?|\b(?:age|aged)\s+(?:of\s+)?\d+\s*(?:or|and)\s+(?:above|below|older|younger|under|over)/gi, keyRe: /\bage/i },
];
/** The qualifiers a clause attaches to what it states. */
function qualifiersIn(text: string): Qualifier[] {
  const out: Qualifier[] = [];
  for (const q of QUALIFIERS) for (const m of text.matchAll(q.find)) out.push({ key: q.key, keyRe: q.keyRe, span: m[0] });
  // A cap on days / visits ("up to 30 days", "maximum of 10 visits"): the number and its unit.
  for (const m of text.matchAll(/\b(?:up to|maximum(?: of)?|max\.?|not exceeding|limited to|capped at)\s+(\d+)\s*(days?|nights?|visits?|weeks?|months?|sessions?|treatments?)\b/gi))
    out.push({ key: "cap", keyRe: new RegExp("\\b" + m[1] + "\\b"), span: m[0] });
  return out;
}
/** `qualifier` is carried by `carrier` (the assertion's wording and conditions). */
function carried(q: Qualifier, carrier: string): boolean {
  const c = normalPassage(carrier);
  if (normalPassage(q.span).length >= 6 && c.includes(normalPassage(q.span))) return true;
  if (!q.keyRe.test(carrier)) return false;
  const want = occurrences(q.span), have = occurrences(carrier);
  // Every number of the qualifier, with its unit, is carried.
  if (!want.every((w) => have.some((h) => same(h.value, w.value) && (!w.unit || !h.unit || h.unit === w.unit)))) return false;
  // An exception's content (what it excepts) is carried, not only its keyword.
  if (/^(?:unless|except|excluding|only if|provided|subject to)$/.test(q.key)) {
    const words = contentWords(q.span.replace(/^\s*(?:unless|except(?:\s+(?:for|where|when|if))?|excluding|only (?:if|when|where|after|upon|on|for)|provided(?: that)?|subject to)\b/i, ""));
    const have2 = contentWords(carrier);
    return words.size === 0 || [...words].every((w) => have2.has(w));
  }
  return true;
}

/** The clause(s) of a passage an assertion is about: the ones that print its amount, else the ones sharing most of its words. */
function aboutClauses(a: { text: string; amount?: number | null }, passage: string): string[] {
  const clauses = clausesOf(passage);
  if (clauses.length <= 1) return clauses;
  if (a.amount != null) { const hit = clauses.filter((c) => amountAppears(a.amount!, c)); if (hit.length) return hit; }
  const words = contentWords(a.text);
  const scored = clauses.map((c) => ({ c, n: overlap(words, contentWords(c)) }));
  const best = Math.max(...scored.map((s) => s.n));
  return best > 0 ? scored.filter((s) => s.n === best).map((s) => s.c) : clauses;
}
/** The label an assertion states its figure for ("Hospital cash" of "Hospital cash: S$100 per day"). */
function labelWords(text: string): Set<string> {
  const label = text.includes(":") ? text.slice(0, text.indexOf(":")) : text.replace(/(?:S\$|US\$|(?<![A-Za-z])(?:SGD|USD|RM|MYR)|\$)?\s?\d[\d,.]*.*$/, "");
  return contentWords(label.replace(/\([^)]*column\)/i, ""), GENERIC_LABEL);
}
const SAYS_SUPERSEDED = /\b(?:superseded|replaced|earlier|previous(?:ly)?|old(?:er)?|original(?:ly)?|former(?:ly)?|before (?:the|it was) (?:change|endorse|amend)|no longer (?:current|in force)|since (?:been )?(?:replaced|amended|changed))\b/i;
const COVERAGE_CLAIM = /\b(?:cover(?:ed|s)?|pays?|paid|payable|reimburs\w*|insured|benefits?|claim(?:able|s)?|entitled|receive|eligible|includes?|included)\b/i;

/** The parts of a passage an assertion is about. A table row ("Label<TAB>cell<TAB>cell", one column per plan
 * tier or person class) is read cell by cell, each with its row label: "Dental  Up to S$300 per year  Not covered"
 * says one thing per column. Otherwise its clauses (lines, sentences). */
function segmentsFor(a: { text: string; amount?: number | null }, passage: string): string[] {
  const lines = unwrap(passage).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const segments: string[] = [];
  let table = false;
  for (const line of lines) {
    let cells = line.split(/\t+|\s{3,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && /^\d{1,2}[.)]?$/.test(cells[0])) cells = cells.slice(1);
    if (cells.length >= 3) { table = true; for (const v of cells.slice(1)) segments.push(cells[0] + " " + v); }
    else segments.push(...clausesOf(line));
  }
  if (!table) return aboutClauses(a, passage);
  if (a.amount != null) { const hit = segments.filter((s) => amountAppears(a.amount!, s)); if (hit.length) return hit; }
  const value = a.text.includes(":") ? a.text.slice(a.text.indexOf(":") + 1) : a.text;
  const words = contentWords(value);
  const scored = segments.map((s) => ({ s, n: overlap(words, contentWords(s)) }));
  const best = Math.max(0, ...scored.map((x) => x.n));
  return best > 0 ? scored.filter((x) => x.n === best).map((x) => x.s) : segments;
}

/** One segment's problem with the assertion (polarity, exclusion heading, units and periods, qualifiers), or null. */
function segmentProblem(a: Assertion, seg: string, heading: boolean, carrier: string, polarityChecked = false): string | null {
  // ---- polarity
  const textNeg = negated(a.text);
  if (!polarityChecked && negated(seg, heading) !== textNeg) {
    // A negative clause with an exception ("excluded unless caused by an accident") supports a positive claim that carries the exception.
    const exceptions = qualifiersIn(seg).filter((q) => q.key === "unless" || q.key === "except");
    const carveOut = !textNeg && exceptions.length > 0 && exceptions.every((q) => carried(q, carrier));
    if (!carveOut) return heading && !textNeg ? "the cited passage is printed under an exclusions heading: it is not cover" : "the wording says the opposite of the cited passage (" + (textNeg ? "the passage does not negate it" : "the passage says it is not covered or not payable") + ")";
  }
  if (heading && !textNeg && COVERAGE_CLAIM.test(a.text) && !/\b(?:unless|except)\b/i.test(seg) && !negated(seg)) return "the cited passage is printed under an exclusions heading: it is not cover";
  // ---- units and periods
  const pOcc = occurrences(seg), tOcc = occurrences(a.text);
  for (const t of tOcc) {
    const ps = pOcc.filter((p) => same(p.value, t.value));
    if (!ps.length) continue;
    if (t.unit && !ps.some((p) => p.unit === t.unit)) return "the wording states a different unit than the passage (" + t.value + " " + t.unit + ")";
    if (!t.unit && ps.every((p) => p.unit && p.unit !== "times")) return "the wording drops the unit the passage prints for " + t.value + " (" + ps[0].unit + ")";
    if (t.period && !ps.some((p) => p.period === t.period)) return "the wording states a different period than the passage (" + t.value + " per " + t.period + ")";
    if (!t.period && !t.unit && ps.every((p) => !!p.period)) return "the wording drops the period the passage prints for " + t.value + " (per " + ps[0].period + ")";
  }
  // ---- qualifiers the passage attaches must be carried
  for (const q of qualifiersIn(seg)) if (!carried(q, carrier)) return "a condition the passage attaches is not carried (" + q.span.trim().slice(0, 60) + ")";
  return null;
}

/** Round 16: the checks of what the passage says (polarity, qualifiers, units/periods, row, currency). Null when they pass. */
function meaningProblem(a: Assertion, page: string | null, repaired: string | null): string | null {
  const passage = a.passage;
  // An assertion that says its line is an exclusion ("Exclusions: ...") reads the passage under that heading
  // when the page prints one before it.
  const prefix = a.text.match(/^([^:\n]{2,60}?)\s*[:–-]\s+/)?.[1]?.trim();
  const heading = underExclusionHeading(passage, page) || (!!prefix && isExclusionHeading(prefix) && exclusionHeadingBefore(passage, page));
  const carrier = a.text + " " + (a.conditions ?? []).join(" ");
  const segments = segmentsFor(a, passage);
  // Wording of several clauses ("Premium payments completed at age 65. Cover continues for life; no further premium
  // is payable.") is checked clause by clause: each keeps the polarity of the passage clause it restates.
  const textClauses = clausesOf(a.text.replace(/^[^:\n]{2,60}?:\s+/, (m) => isExclusionHeading(m.replace(/:\s+$/, "")) ? m : ""));
  let polarityChecked = false;
  if (textClauses.length > 1) {
    const passageClauses = clausesOf(passage);
    for (const tc of textClauses) {
      const words = contentWords(tc);
      if (!words.size) continue;
      const scored = passageClauses.map((c) => ({ c, n: overlap(words, contentWords(c)) }));
      const best = Math.max(0, ...scored.map((x) => x.n));
      if (!best) continue;
      if (!scored.filter((x) => x.n === best).some((x) => negated(x.c, heading) === negated(tc))) return "the wording says the opposite of the cited passage (" + (negated(tc) ? "the passage does not negate it" : "the passage says it is not covered or not payable") + ")";
    }
    polarityChecked = true;
  }
  let first: string | null = null, ok: string | null = null;
  for (const seg of segments) { const problem = segmentProblem(a, seg, heading, carrier, polarityChecked); if (!problem) { ok = seg; break; } first ??= problem; }
  if (ok == null) return first ?? "the wording is not supported by the cited passage";
  // ---- benefit association: the amount is on the row its label is
  if (a.amount != null) {
    const rows = rowsOf(passage);
    if (rows.length > 1) {
      const label = labelWords(a.text);
      if (label.size) {
        // The row that names the benefit best must be a row that prints the amount.
        const scored = rows.map((r) => ({ r, n: overlap(label, contentWords(r)), has: amountAppears(a.amount!, r) }));
        const best = Math.max(...scored.map((x) => x.n));
        if (best > 0 && scored.some((x) => x.has) && !scored.some((x) => x.n === best && x.has)) return "the amount belongs to a different row of the passage than the benefit it is stated for";
      }
    }
  }
  // ---- currency printed beside the amount (in the part of the passage the assertion is about)
  if (a.amount != null && a.currency) {
    // (A scanned passage is read as printed and as repaired -- "$$50,000" is "S$50,000".)
    const at = [...occurrences(ok), ...occurrences(passage), ...(repaired ? occurrences(repaired) : [])].filter((p) => same(p.value, a.amount!));
    const own = occurrences(ok).filter((p) => same(p.value, a.amount!) && p.currency);
    const labelled = own.length ? own : at.filter((p) => p.currency);
    if (labelled.length && !labelled.some((p) => p.currency === a.currency)) return "the currency printed beside the amount is " + labelled[0].currency + ", not " + a.currency;
    if (!labelled.length) {
      // A bare figure: only a currency the passage itself names (a column headed "S$") stands for it -- never a bare "$".
      const named = [...new Set([...currenciesStatedIn(passage), ...currenciesStatedIn(repaired)])];
      if (named.length !== 1 || named[0] !== a.currency) return "the currency of the amount is not printed in the cited passage";
    }
    for (const code of currenciesStatedIn(a.text)) if (code !== a.currency) return "the wording states a currency (" + code + ") that is not the amount's (" + a.currency + ")";
  }
  return null;
}

/** Round 16: the assertion's wording with the period and qualifiers the passage prints for it added, as printed,
 * where the wording leaves them out ("Dental: up to S$300" + "Up to S$300 per year" -> "Dental: up to S$300 per year";
 * "Hospital cash: S$100 per day" + "S$100 per day, up to 30 days" -> "..., up to 30 days"). Used by answer paths that
 * compose a short line from a stored benefit, so the line says what the document says; the verifier still decides. */
export function withPrintedQualifiers(a: { text: string; passage: string; amount?: number | null; conditions?: string[] }): string {
  if (!a.passage || !a.text) return a.text;
  const segments = [...new Set(segmentsFor(a, a.passage))];
  const seg = segments[0];
  if (!seg || segments.length > 1 && a.amount == null) return a.text;
  let text = a.text.replace(/\s+$/, "");
  const tOcc = occurrences(text), sOcc = occurrences(seg);
  // A period printed with a figure the wording states without one.
  for (const t of tOcc) {
    if (t.period || t.unit) continue;
    const s = sOcc.find((p) => same(p.value, t.value) && p.period);
    if (!s) continue;
    const after = seg.slice(seg.search(new RegExp("(?<![\\d.,])" + String(t.value).replace(/\B(?=(\d{3})+(?!\d))/g, ",?").replace(".", "\\.") + "(?:\\.0+)?(?![\\d])")));
    const m = after.match(/^[\d.,]+\s*(?:[^\d.;\n]{0,24}?)\b((?:per|a|each|every|for each|any one|in any|\/)\s*(?:(?:policy|calendar|insurance)\s+)?[a-z]+|daily|weekly|monthly|annually|yearly|p\.\s?a\.|lifetime|per life(?:time)?)\b/i);
    if (!m) continue;
    const phrase = m[1];
    // Insert right after the figure (and any currency code printed after it) in the wording.
    const figure = text.slice(t.at).match(/^[\d.,]+(?:\s?(?:SGD|USD|MYR))?/)?.[0] ?? "";
    text = text.slice(0, t.at + figure.length) + " " + phrase + text.slice(t.at + figure.length);
    break;
  }
  const carrier = text + " " + (a.conditions ?? []).join(" ");
  const missing = qualifiersIn(seg).filter((q) => !carried(q, carrier)).map((q) => q.span.trim().replace(/[,;]+$/, ""));
  if (missing.length) text = text.replace(/[.;]$/, "") + ", " + [...new Set(missing)].join(", ");
  return text;
}

/** People other than the subject whose name the wording uses. */
function namesSomeoneElse(a: Assertion, ctx: VerifyContext): boolean {
  const everyone = ctx.household ?? ctx.people;
  const subject = everyone.find((p) => p.id === a.subjectId);
  const lower = " " + a.text.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ") + " ";
  const has = (n: string | null | undefined) => !!n && n.trim().length >= 3 && lower.includes(" " + n.toLowerCase().trim() + " ");
  // (A name the cited passage itself prints -- a named driver, a joint life assured -- is the document's, not the wording's.)
  const passage = " " + a.passage.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ") + " ";
  const printed = (n: string | null | undefined) => !!n && n.trim().length >= 3 && passage.includes(" " + n.toLowerCase().trim() + " ");
  return everyone.some((p) => p.id !== a.subjectId && ((has(p.display_name) && !printed(p.display_name)) || (has(p.preferred_name) && !printed(p.preferred_name) && !printed(p.display_name))) && !(subject && (has(subject.display_name) || has(subject.preferred_name)) && [p.display_name, p.preferred_name].some((n) => n && [subject.display_name, subject.preferred_name].some((s) => s && s.toLowerCase().includes(n.toLowerCase())))));
}

export function verifyAssertion(a: Assertion, ctx: VerifyContext): string | null {
  if (a.kind === "indicative_estimate") return "an indicative estimate can only come from a claim calculator with reviewed evidence";
  const doc = ctx.documents[a.policyId];
  if (!doc) return "the cited document is not one of this household's current documents";
  if (doc.accountId !== ctx.accountId) return "the cited document belongs to another household";
  if (doc.lifecycleState !== "active") return "the cited document has been deleted";
  if (doc.supersededAt && !(a.presentedAsSuperseded && SAYS_SUPERSEDED.test(a.text))) return "the cited document has been replaced by a newer version" + (a.presentedAsSuperseded ? " and the wording does not say it is superseded" : "");
  if (!RELEASED.has(doc.quarantineStatus ?? "")) return "the cited document has not been released for reading";
  if (!ctx.people.some((p) => p.id === a.subjectId)) return "the assertion is about someone this question is not about";
  if (!doc.subjectIds.includes(a.subjectId)) return "the cited document does not belong to this person";
  if (namesSomeoneElse(a, ctx)) return "the wording names someone else than the person the document speaks for";
  // Round 16: a version that is not recorded is not a verified version.
  if (!a.documentHash || !a.documentHash.trim()) return "the cited version of the document is not recorded";
  if (!doc.fileHash || !doc.fileHash.trim()) return "the document's current version is unknown";
  if (a.documentHash !== doc.fileHash) return "the cited version is not the document's current version";
  if (a.conflictNote) return "conflict: " + a.conflictNote;
  if (a.passageVerified === false) return "the stored figure could not be re-found in its passage";
  if (a.page == null || !(a.page > 0)) return "the page of the supporting passage is not recorded";
  const page = ctx.pageText(a.policyId, a.page);
  if (!page) return "the cited page's text is not stored";
  if (!a.passage || !passageOnPage(a.passage, page)) return "the supporting passage is not on the cited page";
  if (a.amount != null && !amountAppears(a.amount, a.passage)) return "the amount is not in the cited passage";
  if (a.amount != null && !a.currency) return "the currency of the amount is not stated";
  if (a.currency && !currencyStatedIn(a.currency, a.passage)) return "the currency is not written in the cited passage";
  if (a.date && !dateAppears(a.date, a.passage)) return "the date is not in the cited passage";
  for (const condition of a.conditions ?? []) if (!conditionAppears(condition, a.passage)) return "a condition is not in the cited passage";
  // The rendered sentence itself may not carry a figure or currency that the
  // passage does not.
  const passageNumbers = numbersIn(a.passage);
  for (const n of numbersIn(a.text)) if (!passageNumbers.some((h) => same(h, n))) return "the wording states a number the passage does not";
  // A passage read by OCR from a scan may print "$$50,000" for "S$50,000";
  // the repaired line (scanned-text.ts, which repairs only that sign) is what
  // the wording is checked against, alongside the raw OCR text.
  const currencyPassage = looksScanned(a.passage) ? (cleanScannedLine(a.passage) ?? "") + " " + a.passage : a.passage;
  for (const code of currenciesStatedIn(a.text)) if (!currencyStatedIn(code, currencyPassage)) return "the wording states a currency the passage does not";
  // A bare "$" in the wording names no currency: never a stated amount.
  if (/(?<![A-Za-z$])\$\s?\d/.test(a.text) && !currenciesStatedIn(a.text).length) return "the wording shows a bare $ that names no currency";
  return meaningProblem(a, page, looksScanned(a.passage) ? cleanScannedLine(a.passage) ?? null : null);
}

export function verifyAssertions(list: Assertion[], ctx: VerifyContext): { kept: Assertion[]; rejected: Rejection[] } {
  const kept: Assertion[] = [], rejected: Rejection[] = [];
  for (const assertion of list) {
    const reason = verifyAssertion(assertion, ctx);
    if (reason && (globalThis as { __dpVerifyDebug?: boolean }).__dpVerifyDebug) process.stderr.write("[verify] rejected «" + assertion.text.slice(0, 160) + "» | passage «" + assertion.passage.slice(0, 200).replace(/\n/g, "⏎") + "» | " + reason + "\n");
    if (reason) rejected.push({ assertion, reason }); else kept.push(assertion);
  }
  return { kept, rejected };
}

/** Words that change what a policy pays or when. A rephrasing may not add
 * one the verified assertions do not already contain. */
const CONDITION_WORDS = /\b(?:unless|except|excluding|excluded|exclusions?|only if|provided that|subject to|waiting period|survival period|deductible|co-?insurance|capped|maximum|minimum|limit(?:ed)?|within \d+|after \d+|before \d+|guaranteed|not covered|no cover|uninsured|approved|will pay|will receive|entitled)\b/gi;
/** True when `text` (a model's rephrasing) adds no number, currency,
 * condition word or negative that the verified assertions lack, says the
 * opposite of none of them (or of their passages), drops no qualifier or
 * period they attach to a figure it states, and swaps no unit or period. */
export function rephrasingIsFaithful(text: string, kept: Assertion[]) {
  const source = kept.map((a) => a.text + " " + a.passage + " " + (a.conditions ?? []).join(" ")).join(" ");
  const have = numbersIn(source);
  for (const n of numbersIn(text)) if (!have.some((h) => same(h, n))) return false;
  for (const code of currenciesStatedIn(text)) if (!currenciesStatedIn(source).includes(code)) return false;
  if (/\$\s?\d/.test(text) && !/\$\s?\d/.test(source)) return false;
  const lower = normalPassage(source);
  for (const word of text.match(CONDITION_WORDS) ?? []) if (!lower.includes(normalPassage(word))) return false;
  // Round 16 -- polarity: each sentence agrees with the assertion it is about, and with that assertion's passage.
  const units = kept.map((a) => ({ a, words: contentWords(a.text + " " + a.passage) }));
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
    const words = contentWords(sentence);
    if (!words.size) continue;
    const scored = units.map((u) => ({ ...u, n: overlap(words, u.words) })).filter((u) => u.n > 0);
    if (!scored.length) continue;
    const best = Math.max(...scored.map((s) => s.n));
    const about = scored.filter((s) => s.n === best);
    const neg = negated(sentence);
    const agrees = about.some(({ a }) => negated(a.text) === neg && aboutClauses({ text: sentence, amount: a.amount }, a.passage).some((c) => negated(c) === neg || (!neg && /\b(?:unless|except)\b/i.test(c) && qualifiersIn(c).filter((q) => q.key === "unless" || q.key === "except").every((q) => carried(q, sentence)))));
    if (!agrees) return false;
  }
  // Units and periods: a figure keeps the unit and period its assertion prints.
  const sOcc = kept.flatMap((a) => occurrences(a.text + "\n" + a.passage));
  for (const t of occurrences(text)) {
    const ps = sOcc.filter((p) => same(p.value, t.value));
    if (!ps.length) continue;
    if (t.unit && !ps.some((p) => p.unit === t.unit)) return false;
    if (t.period && !ps.some((p) => p.period === t.period)) return false;
  }
  // A figure it states keeps the qualifiers its assertion attaches to it.
  for (const a of kept) {
    if (a.amount == null || !amountAppears(a.amount, text)) continue;
    for (const q of qualifiersIn(a.text)) if (!carried(q, text)) return false;
    const periods = occurrences(a.text).filter((o) => same(o.value, a.amount!) && o.period).map((o) => o.period);
    if (periods.length && !occurrences(text).some((o) => same(o.value, a.amount!) && periods.includes(o.period))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Gate R17: scope binding helpers for the save-time answer gate (lib/chat/answer-verification.ts).
// ---------------------------------------------------------------------------

/** The cells of one table row ("Label<TAB>cell<TAB>cell", cells split by tabs, " | " or 3+ spaces). */
export function rowCells(row: string): string[] {
  return row.split(/\t+|\s+\|\s+|\s{3,}/).map((c) => c.trim()).filter(Boolean);
}
/** The rows of a passage (lines, or ";"-separated rows). */
export function passageRows(passage: string): string[] { return rowsOf(passage); }
/** The content words of a benefit label (generic words like "benefit", "amount", "sum insured" left out; "death" and
 * "life" kept -- they name a benefit). */
export function benefitWords(label: string): Set<string> {
  const out = contentWords(label, GENERIC_LABEL);
  for (const w of ["death", "life"]) if (new RegExp("\\b" + w + "\\b", "i").test(label)) out.add(w);
  return out;
}
/** The 3-letter words of a label that are not generic ("GST", "TPD", "ICU"). */
function shortWords(label: string): string[] {
  return (label.toLowerCase().match(/\b[a-z]{3}\b/g) ?? []).filter((w) => !/^(?:the|and|for|per|any|day|one|all|not|its|our|you|was|are|has|had|but|off|out|may|can|age|year|sum|pay)$/.test(w));
}
function sentenceWords(text: string): Set<string> {
  const out = contentWords(text);
  for (const w of ["death", "life"]) if (new RegExp("\\b" + w + "\\b", "i").test(text)) out.add(w);
  return out;
}
/** Does `sentence` name the benefit `benefit` (one of its distinctive words; a label of generic words only -- "Sum
 * assured" -- is named by itself or by "cover")? */
export function namesBenefit(sentence: string, benefit: string): boolean {
  // V1.3: a parenthetical qualifier of a label ("Basic sum assured (death or terminal illness)", "GROUP TERM LIFE
  // (POLICY NO. ...)") is detail, not the benefit's name: a sentence naming the label without it names the benefit.
  const bare = benefit.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (bare && bare !== benefit.trim() && namesBenefitExact(sentence, bare)) return true;
  return namesBenefitExact(sentence, benefit);
}
function namesBenefitExact(sentence: string, benefit: string): boolean {
  const label = benefitWords(benefit);
  if (!label.size) {
    if (/\bsum (?:assured|insured)\b|\bcover\b/i.test(benefit)) return /\bsum (?:assured|insured)\b|\bcover(?:ed|age)?\b/i.test(sentence);
    const short = shortWords(benefit);
    if (short.length) return short.some((w) => new RegExp("\\b" + w + "\\b", "i").test(sentence));
    return normalPassage(benefit).length >= 3 && normalPassage(sentence).includes(normalPassage(benefit));
  }
  return overlap(label, sentenceWords(sentence)) > 0;
}
/** Is `amount` printed on the row of `passage` that names `benefit` best? Null when it is; otherwise the reason. */
export function benefitRowProblem(amount: number, benefit: string, passage: string): string | null {
  // (A table row -- cells split by tabs -- is one row even where a cell has a ";" in it.)
  const rows = unwrap(passage).split(/\n+/).map((l) => l.trim()).filter(Boolean).flatMap((l) => rowCells(l).length >= 3 ? [l] : l.split(/;\s+/).map((x) => x.trim()).filter(Boolean));
  const withAmount = rows.filter((r) => amountAppears(amount, r));
  if (!withAmount.length) return "the amount is not printed in the cited passage";
  const label = benefitWords(benefit);
  if (!label.size && shortWords(benefit).length) {
    // A short label ("GST", "TPD"): the row printing the amount names it.
    const short = shortWords(benefit);
    return withAmount.some((r) => short.some((w) => new RegExp("\\b" + w + "\\b", "i").test(r))) ? null : "the cited passage does not print the amount on the row of the benefit it is stated for";
  }
  if (!label.size) {
    const b = normalPassage(benefit);
    return b.length >= 3 && withAmount.some((r) => normalPassage(r).includes(b)) ? null : "the cited passage does not print the amount on the row of the benefit it is stated for";
  }
  const scored = rows.map((r) => ({ r, n: overlap(label, sentenceWords(r)), has: amountAppears(amount, r) }));
  // V1.3: a row that names no benefit of its own (a certificate roster's person row: masked ID, name, amount, date) is
  // read under the heading printed above it -- the product heading it belongs to -- as a reader of the page does.
  for (let j = 0; j < scored.length; j++) {
    if (scored[j].n > 0 || !scored[j].has) continue;
    for (let k = j - 1; k >= 0; k--) {
      const r = scored[k].r;
      if (/\d[\d,]*(?:\.\d+)?/.test(r.replace(/\b(?:no|policy|group)\b\.?\s*[A-Z0-9-]+/gi, "")) && rowCells(r).length >= 2) continue; // another data row
      if (rowCells(r).length <= 1 && !/[$€£¥]\s?\d/.test(r) && r.length <= 80 && !/[.:]$/.test(r)) { scored[j] = { ...scored[j], n: scored[k].n }; }
      break;
    }
  }
  // PR #54: a line under a numbered section heading ("Section 5 - Compassionate Death Allowance Benefit") belongs to that
  // section's benefit, as the page reads -- up to the next section heading (never across it).
  const SECTION_ROW = /^\s*(?:section|part|clause)\s+[\w.]+\s*[-–—:]\s*\S/i;
  let head = -1;
  for (let j = 0; j < scored.length; j++) {
    if (SECTION_ROW.test(scored[j].r)) { head = j; continue; }
    if (head >= 0 && scored[j].has && scored[head].n > scored[j].n) scored[j] = { ...scored[j], n: scored[head].n };
  }
  const best = Math.max(0, ...scored.map((x) => x.n));
  if (best === 0) return "the cited passage does not name the benefit the figure is stated for";
  return scored.some((x) => x.n === best && x.has) ? null : "the amount belongs to a different row of the passage than the benefit it is stated for";
}
/** The periods `text` prints beside `amount` in `currency` (null for none). */
export function printedPeriodsOf(amount: number, currency: string, text: string): (string | null)[] {
  return occurrences(text).filter((o) => same(o.value, amount) && (o.currency === currency || o.currency == null)).map((o) => o.period);
}
