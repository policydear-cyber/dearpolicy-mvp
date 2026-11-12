/**
 * Round 9: every fact a document READ reports is re-found, in plain code, in
 * the document's own text before it can be stored as something the chat may
 * state. What cannot be re-found is dropped (or kept unverified, so it is
 * never answered from), with a note -- never guessed, never repaired into a
 * different fact.
 *
 * The reader (a hosted model) is treated as a fallible witness: its names,
 * figures, units, dates, people, roles and numbers are each checked against
 * the verbatim page they cite. Pure functions; no I/O.
 */
import { moneyShapedFigure } from "@/lib/documents/image-currency";
import { OWN_FIGURE_CHECKS, amountOnlyInContext, figureContextWords, namePrinted as nameWordsOnLine, personOnlyInExample, specimenHeading, specimenPage } from "@/lib/documents/own-figure";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { NOTIONAL_SUM_NOTE, RIDER_NAME, printsNotionalSum } from "@/lib/documents/notional-sum";
import { PERSONAL_AUTHORITY_ROLES } from "@/lib/documents/intelligence";
import { NOT_CHECKED } from "@/lib/documents/layout-check";
import { amountAppears, documentDateFrom, locatePassage, looksLikeInjectedInstruction, nameAppears, parsePrintedDate, printedDateMatches, printedDates } from "@/lib/documents/evidence";

type Page = { pageNumber: number; text: string; imageCurrency?: string };
const norm = (value: string) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const nameKey = (value: string) => norm(value).replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------
const CURRENCY_MARK = String.raw`(?:S\$|SG\$|US\$|HK\$|A\$|(?<![A-Za-z])(?:SGD|USD|HKD|AUD|RM|MYR|PHP|EUR|GBP)(?![A-Za-z])|₱|€|£|\$)`;
/** A capital code run on from a lower-case word, with its figure right after: the space a PDF's text layer lost between
 * two table cells ("Sum InsuredSGD 100,000"). Matched case-sensitively, so a word that merely ends in a code's letters
 * ("Term 20", "TERM 20", "fraud 10") is never one (Critic #421 (1)). */
const GLUED_CODE = (codes: string) => String.raw`(?<=[a-z])(?:${codes})(?=\s?\d)`;
const GLUED_MARK = GLUED_CODE("SGD|USD|HKD|AUD|RM|MYR|PHP|EUR|GBP");
function digitsPattern(value: number) {
  const whole = Math.trunc(Math.abs(value)), cents = Math.round((Math.abs(value) - whole) * 100);
  const digits = String(whole), groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join("[,\\s]?") + (cents ? "\\." + String(cents).padStart(2, "0").replace(/0$/, "0?") : "(?:\\.0{1,2})?");
}
/** The amount printed as MONEY in the text: with a currency mark before it, or
 * bare in a line that prints a currency elsewhere -- never as a percentage, a
 * count of days or years, or part of a longer number or a date. */
/** Round 7 (port): the two ways a scan misreads a Singapore-dollar figure --
 * the "S" read as "5" or "$" ("5$168,00", "$$50,000") and the decimal point
 * read as a comma before exactly two digits ("168,00": never a thousands
 * separator, which is followed by three). Repaired only next to a dollar sign. */
export function repairScannedMoney(text: string): string {
  return String(text ?? "").replace(/(^|[^\w$])(?:\$\$|5\$|S5\$?|SS)(?=\d)/g, "$1S$").replace(/(S\$\d{1,3}(?:,\d{3})*),(\d{2})(?![\d,])/g, "$1.$2");
}
export function moneyPrinted(text: string, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  const repaired = repairScannedMoney(text);
  if (repaired !== text && moneyPrintedExact(repaired, value)) return true;
  return moneyPrintedExact(text, value);
}
function moneyPrintedExact(text: string, value: number): boolean {
  const body = digitsPattern(value);
  // Round 10: never part of a figure a scan printed unclearly ("S$5O,000" is not S$5).
  const after = String.raw`(?![\d.,]\d|\s*%|\s*per\s*cent|[,.]?[OoIl|])`;
  const marked = new RegExp(CURRENCY_MARK + String.raw`\s?` + body + after, "i");
  if (marked.test(text) || new RegExp(GLUED_MARK + String.raw`\s?` + body + after).test(text)) return true;
  const bare = new RegExp(String.raw`(?<![\d.,/-])(?<![\d][,.]?[OoIl|]+[,.]?)` + body + String.raw`(?![\d]|[.,]\d|\s*(?:%|per\s*cent|days?|nights?|years?|months?|hours?|weeks?|x\b|times)|[/-]\d|[,.]?[OoIl|])`, "i");
  return String(text ?? "").split("\n").some((line) => (new RegExp(CURRENCY_MARK, "i").test(line) || new RegExp(GLUED_MARK).test(line)) && bare.test(line));
}
/** A per-day (or per-night) rate: the figure is followed by "per day", "a day", "daily", "per night" in its line. */
export function dailyRatePrinted(text: string, value: number) {
  const body = digitsPattern(value);
  return new RegExp(CURRENCY_MARK + String.raw`?\s?` + body + String.raw`(?:\.\d+)?\s*(?:\(?[^)\n]{0,12}\)?\s*)?(?:per\s+(?:day|night)|a\s+(?:day|night)|each\s+(?:day|night)|daily|/\s*day)`, "i").test(text)
    || new RegExp(String.raw`\bdaily\b[^\n]{0,40}` + body, "i").test(text);
}

// ---------------------------------------------------------------------------
// Names, people, numbers, dates
// ---------------------------------------------------------------------------
/** A name (insurer, product, benefit) the document itself prints. */
export function namePrinted(fullText: string, name: string | null | undefined) {
  const value = String(name ?? "").trim();
  if (!value) return false;
  if (looksLikeInjectedInstruction(value)) return false;
  const escaped = norm(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])").test(norm(fullText)) || nameAppears(fullText, value)) return true;
  // An abbreviation the document spells out ("PA" for "Personal Accident", "CI", "FDW").
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.some((w) => /^[A-Z]{2,4}$/.test(w))) return false;
  const spelled = words.map((w) => /^[A-Z]{2,4}$/.test(w) ? w.split("").map((c) => c + "[a-z]*").join("[\\s-]+") : w.replace(/[^A-Za-z0-9]/g, "")).join("[\\s-]+");
  return new RegExp("\\b" + spelled + "\\b", "i").test(fullText.replace(/\s+/g, " "));
}
/** A benefit name a reader gave: most of its words are the page's own (a
 * reader may add a qualifier the heading implies, "Major Critical Illness"),
 * none is a printed word cut short ("ASSURETE" for "ASSURETERM"), and it is
 * not an instruction. */
export function benefitNamePrinted(pageText: string, name: string | null | undefined) {
  const value = String(name ?? "").trim();
  if (!value || looksLikeInjectedInstruction(value)) return false;
  if (namePrinted(pageText, value)) return true;
  const pageWords = new Set(nameKey(pageText).split(" ").filter(Boolean));
  // "Benefit", "cover", "plan" describe any benefit: they neither prove nor disprove a name.
  const words = [...new Set(nameKey(value).split(" ").filter((w) => w.length > 1 && !/^\d+$/.test(w)
    && !["of", "the", "and", "or", "for", "to", "in", "on", "a", "benefit", "benefits", "cover", "coverage", "plan", "rider", "insurance"].includes(w)))];
  if (!words.length) return false;
  if (words.some((w) => !pageWords.has(w) && [...pageWords].some((p) => p.length > w.length && p.startsWith(w)))) return false;
  return words.filter((w) => pageWords.has(w)).length / words.length >= 0.6;
}

/** A benefit, plan or product NAME -- not a sentence of the wording lifted as one
 * ("Salary multiples use the basic monthly salary on the date of the event."). */
export function looksLikeName(value: string | null | undefined) {
  const v = String(value ?? "").replace(/\s+/g, " ").trim();
  if (v.length < 2 || v.length > 90) return false;
  if (/[.;!?]\s+\S/.test(v) || /[.;!?]$/.test(v) && v.split(" ").length > 6) return false;
  if (v.split(" ").length > 12) return false;
  if (/^(?:the|a|an|if|we|you|your|this|these|any|all|for|when|where|in|on|subject|salary|note|please)\b/i.test(v) && v.split(" ").length > 4) return false;
  return !looksLikeInjectedInstruction(v);
}

/** A person's name printed in the document: the full name, or every part of it on one line. */
export function personPrinted(fullText: string, name: string) {
  const wanted = nameKey(name).split(" ").filter((w) => w.length > 1 && !["bin", "binte", "binti", "bte", "s", "o", "d"].includes(w));
  if (!wanted.length || looksLikeInjectedInstruction(name)) return false;
  if (nameKey(fullText).includes(nameKey(name))) return true;
  return String(fullText ?? "").split("\n").some((line) => { const words = new Set(nameKey(line).split(" ")); return wanted.every((w) => words.has(w)); });
}
const GROUP_LABEL = /group\s+(?:policy|scheme|contract|master)\s*(?:no\.?|number|#)?\s*[:#-]?\s*$/i;
/** Is this number only ever printed as a GROUP policy number? */
export function onlyPrintedAsGroupNumber(pages: Page[], number: string) {
  const wanted = number.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let seen = 0, group = 0;
  for (const page of pages) for (const line of page.text.split("\n")) {
    const upper = line.toUpperCase();
    let at = upper.indexOf(number.toUpperCase());
    if (at < 0 && upper.replace(/[^A-Z0-9]/g, "").includes(wanted)) at = 0;
    if (at < 0) continue;
    seen++;
    if (GROUP_LABEL.test(line.slice(Math.max(0, at - 40), at))) group++;
  }
  return seen > 0 && group === seen;
}
/**
 * Round 13: what a printed date IS, read from the words printed before it on its own line (the
 * closest label wins) -- or from its place in a printed period ("1 March 2026 to 28 February
 * 2027": the first date starts it, the second ends it). A date the reader reports as the start or
 * the expiry must be printed at least once in a place that fits: an expiry printed only as a
 * "Policy start date", a start printed only as the end of the period, a birth or valuation date
 * as either, is not that date.
 */
export type PrintedDateKind = "start" | "issue" | "expiry" | "end" | "due" | "maturity" | "renewal" | "other" | "period" | "unlabelled";
const DATE_LABELS: [Exclude<PrintedDateKind, "unlabelled">, RegExp][] = [
  ["other", /\b(?:date\s+of\s+birth|birth\s*date|born|d\.?o\.?b\.?|tarikh\s+lahir|age|valuation|bid\s+price|nav|as\s+at|receipt|date\s+of\s+payment|payment\s+(?:received|date)|paid(?:\s+on)?|statement\s+date|tarikh\s+penyata|claim|date\s+of\s+(?:accident|loss|admission|discharge|event)|admitted|discharged|letter|printed|^\s*date)/gi],
  ["issue", /\b(?:date\s+of\s+issue|issue\s+date|issued(?:\s+on)?|date\s+issued)\b/gi],
  ["maturity", /\b(?:matur\w*)\b/gi],
  ["start", /\b(?:start\w*|commenc\w*|effective|inception|from|begin\w*|valid\s+from|cover\s+start|mula|policy\s+date|in\s+force\s+since)\b/gi],
  // A renewal date both ends one period and starts the next.
  ["renewal", /\b(?:renew\w*)\b/gi],
  // A payment due date, a grace period's end or a lapse: an end of sorts, never the expiry a reader can be corrected to.
  ["due", /\b(?:lapse\w*|grace|due)\b/gi],
  ["expiry", /\b(?:expir\w*|end\s+date|ends?|ended)\b/gi],
  ["end", /\b(?:until|till|through|valid\s+(?:till|until|to)|to)\b/gi],
  ["period", /\b(?:period\s+of\s+(?:insurance|cover)|cover\s+period|policy\s+period|insured\s+period|period)\b/gi],
];
function labelKind(label: string): PrintedDateKind {
  let best: { kind: PrintedDateKind; end: number } | null = null;
  for (const [kind, re] of DATE_LABELS) for (const m of label.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (!best || end > best.end) best = { kind, end };
  }
  return best?.kind ?? "unlabelled";
}
/** Every printing of a date in the pages, with what its label says it is. */
export function printedDateKinds(pages: Page[], iso: string): PrintedDateKind[] {
  const out: PrintedDateKind[] = [];
  for (const page of pages) {
    const lines = page.text.split("\n");
    lines.forEach((line, i) => {
      const found = printedDateMatches(line);
      found.forEach((m, k) => {
        if (m.iso !== iso) return;
        const prev = found[k - 1], next = found[k + 1];
        const RANGE = /^\s*(?:to|until|till|through|-|–|—|hingga|sehingga)\s*$/i;
        if (next && RANGE.test(line.slice(m.index + m.length, next.index))) { out.push("start"); return; }
        if (prev && RANGE.test(line.slice(prev.index + prev.length, m.index))) { out.push("expiry"); return; }
        let label = line.slice(prev ? prev.index + prev.length : 0, m.index);
        if (!/[a-z]{2}/i.test(label)) label = (lines[i - 1] ?? "").slice(-80) + " " + label;
        out.push(labelKind(label.slice(-80)));
      });
    });
  }
  return out;
}
/** A start or expiry date is acceptable when it is printed at least once with a label that fits
 * that role (or a period or no label at all). An issue date stands for the start only when the
 * document prints no start date of its own; a maturity date is an expiry. */
export function dateFitsRole(pages: Page[], iso: string, role: "start" | "end") {
  const kinds = printedDateKinds(pages, iso);
  if (!kinds.length) return false;
  if (role === "end") return kinds.some((k) => k === "expiry" || k === "end" || k === "due" || k === "maturity" || k === "renewal" || k === "period" || k === "unlabelled");
  if (kinds.some((k) => k === "start" || k === "renewal" || k === "period" || k === "unlabelled")) return true;
  if (!kinds.includes("issue")) return false;
  const text = pages.map((p) => p.text).join("\n");
  return !printedDateMatches(text).some((m) => m.iso !== iso && printedDateKinds(pages, m.iso).includes("start"));
}
/** Round 13: the one date a document prints under a label of that role (a start or commencement
 * date or the first date of its period; a maturity date, else the last date of its period or an
 * expiry date), or null when it prints none or more than one. */
export function labelledDate(pages: Page[], role: "start" | "end"): string | null {
  const text = pages.map((p) => p.text).join("\n");
  const dates = [...new Set(printedDateMatches(text).map((m) => m.iso))];
  const kinds = new Map(dates.map((d) => [d, printedDateKinds(pages, d)]));
  const having = (k: PrintedDateKind) => dates.filter((d) => kinds.get(d)!.includes(k));
  const pick = (list: string[]) => (list.length === 1 ? list[0] : null);
  if (role === "start") return pick(having("start"));
  const maturity = having("maturity");
  return maturity.length ? pick(maturity) : pick(having("expiry").filter((d) => !kinds.get(d)!.some((k) => k === "due" || k === "renewal" || k === "start")));
}
/** Round 13: the policy term a document prints, in years ("Policy term 18 years", "a 20-year plan"). */
export function printedTermYears(fullText: string): number | null {
  const m = fullText.match(/\b(?:policy\s+|plan\s+|benefit\s+|coverage\s+|cover\s+)?term\s*(?:of\s*)?[:\-\t ]\s*(\d{1,2})\s*years?\b/i)
    ?? fullText.match(/\b(\d{1,2})[-\s]year\s+(?:policy\s+)?(?:term|policy|plan|endowment|cover)\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
}
function printedTermYearsAll(fullText: string): number[] {
  return [...fullText.matchAll(/\b(?:term|plan|endowment|policy)[^\n]{0,24}?(\d{1,2})\s*years?\b|\b(\d{1,2})[-\s]year\b/gi)].map((m) => Number(m[1] ?? m[2])).filter((n) => n >= 1 && n <= 99);
}
const DAY_MS = 86_400_000;
const isoMs = (d: string) => Date.parse(d + "T00:00:00Z");

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const PAYMENT_WORDS = /\b(?:premium|receipt|payment|payable|amount\s+due|paid|giro|medisave|renewal\s+notice|statement)\b/i;
// (Round 7 port: "Insured: NAME", "Insured child: NAME" -- a label ending in a colon has no word boundary after it.)
const PERSONAL_WORDS = /\b(?:insured\s+person|life\s+assured|name\s+of\s+(?:the\s+)?insured|policyholder|policy\s+owner|insured(?:\s+(?:child|spouse|life|member|employee))?\s*:|particulars\s+of\s+insured|named\s+driver|insured\s+helper|employee\s+name|member\s+name)(?![a-z])/i;
const PAYMENT_ROLES = new Set(["premium_receipt", "renewal_statement", "annual_statement"]);
const PERSONAL_ROLES = new Set(["personal_schedule", "certificate", "endorsement"]);
const REFERENCE_ROLE_SET = new Set(["policy_wording", "product_summary", "benefit_guide", "brochure", "policy_illustration", "claim_form", "welcome_letter"]);
/** Round 13: the wording that names each kind of document. A role other than the generic ones
 * ("personal_schedule", "other") is kept only when the document prints its name. */
const ROLE_WORDS: Partial<Record<NonNullable<PolicyExtraction["documentRole"]>, RegExp>> = {
  certificate: /\bcertificate\s+(?:of\s+(?:insurance|renewal|cover|entitlement)|and\s+schedule)|\b(?:insurance|renewal)\s+certificate\b|\bcertificate\s+(?:no\.?|number)\b/i,
  endorsement: /\bendorsement\b|\b(?:policy\s+)?amendment\b/i,
  premium_receipt: /\breceipt\b|\bpayment\s+(?:received|acknowledg\w*)|\bpremium\s+notice\b|\bamount\s+received\b|\btax\s+invoice\b/i,
  renewal_statement: /\brenewal\s+(?:notice|statement|invitation|premium|advice)\b|\bnotice\s+of\s+renewal\b|\bdue\s+for\s+renewal\b/i,
  annual_statement: /\b(?:annual|yearly)\s+(?:policy\s+)?statement\b|\bpolicy\s+statement\b|\bstatement\s+of\s+account\b/i,
  policy_wording: /\bpolicy\s+(?:wording|conditions|contract\s+terms)\b|\bterms\s+and\s+conditions\b|\bgeneral\s+(?:provisions|conditions|exclusions)\b|\bdefinitions\b/i,
  product_summary: /\bproduct\s+summar(?:y|ies)\b/i,
  benefit_guide: /\bbenefits?\s+(?:guide|booklet|summary|schedule|table|highlights)\b|\b(?:summary|schedule|table)\s+of\s+benefits\b|\bhighlights\s+of\s+cover\b|\bemployee\s+benefits\b/i,
  brochure: /\bbrochure\b|\bleaflet\b|\bwhy\s+choose\b|\bapply\s+(?:now|today)\b/i,
  policy_illustration: /\b(?:policy|benefit)\s+illustration\b|\billustration\b/i,
  claim_form: /\bclaim\s+form\b/i,
  welcome_letter: /\bwelcome\b/i,
};
/** The kinds of document a document's TITLE names (its heading lines, product names taken out:
 * "TravelSafe Annual Family" is a product, not an annual statement). "CERTIFICATE OF RENEWAL" names a
 * certificate, not a renewal notice. */
export function titleRoles(pages: Page[], productNames: (string | null | undefined)[] = []): Set<string> {
  let title = linesWithoutContents(pages).slice(0, 6).join("\n");
  for (const name of [...productNames, titleProductName(pages)]) if (name && name.trim().length >= 4) title = title.split(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
  const out = new Set<string>();
  const t = title.replace(/\s+/g, " ");
  if (/\bcertificate\s+of\s+renewal\b|\brenewal\s+certificate\b/i.test(t)) out.add("certificate");
  else if (ROLE_WORDS.renewal_statement!.test(t)) out.add("renewal_statement");
  for (const role of ["certificate", "endorsement", "premium_receipt", "annual_statement", "product_summary", "benefit_guide", "brochure", "policy_illustration", "claim_form", "policy_wording"] as const)
    if (ROLE_WORDS[role]!.test(t) && !(role === "policy_wording" && !/\bpolicy\s+wording\b|\bterms\s+and\s+conditions\b/i.test(t))) out.add(role);
  // "CERTIFICATE AND SCHEDULE" is a certificate (its schedule is part of it).
  if (/\b(?:policy\s+)?schedule\b(?!\s+of\s+benefits)|\bpolicy\s+(?:information\s+page|contract)\b/i.test(t.replace(/\bcertificate\s+and\s+schedule\b/gi, "certificate"))) out.add("personal_schedule");
  return out;
}
/** A role the reader chose that the document's own wording cannot carry is not kept. */
export function plausibleRole(role: PolicyExtraction["documentRole"], fullText: string, pages?: Page[], productNames: (string | null | undefined)[] = []): PolicyExtraction["documentRole"] {
  if (!role) return role;
  if (PAYMENT_ROLES.has(role) && !PAYMENT_WORDS.test(fullText)) return null;
  const particulars = PERSONAL_WORDS.test(fullText) && /\b(?:policy|certificate|rider)\s+(?:no\.?|number)(?![a-z])/i.test(fullText);
  if (PERSONAL_ROLES.has(role) && !particulars) return null;
  // Generic wording never prints one person's particulars and policy number.
  if (REFERENCE_ROLE_SET.has(role) && particulars) return null;
  // Round 13: a specific kind of document is one whose wording names it -- in its title when its
  // title names a kind at all; and the generic personal schedule is not a document whose title
  // names it as a payment notice, a guide or wording.
  const docPages = pages ?? [{ pageNumber: 1, text: fullText }];
  const titled = titleRoles(docPages, productNames);
  if (role === "personal_schedule") {
    if ([...titled].some((r) => r === "premium_receipt" || r === "renewal_statement" || r === "certificate" || r === "endorsement" || REFERENCE_ROLE_SET.has(r)) && !titled.has("personal_schedule")) return null;
    return role;
  }
  const words = ROLE_WORDS[role];
  if (!words) return role;
  if (titled.size) return titled.has(role) ? role : null;
  let text = fullText;
  for (const name of productNames) if (name && name.trim().length >= 4) text = text.split(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
  return words.test(text) ? role : null;
}

// ---------------------------------------------------------------------------
// The extraction as a whole
// ---------------------------------------------------------------------------
const STATUS_CLAIM = /\b(?:in\s+force|lapsed|terminated|approved|guaranteed|pre-?approved|covered\s+for\s+everything|renewed\s+to)\b/i;
/** A free-text line the reader wrote (a note, an exclusion summary): kept only
 * when it is not an instruction and every figure, date and status in it is
 * printed in the document. */
export function readerTextSupported(fullText: string, text: string) {
  const value = String(text ?? "").trim();
  if (!value || looksLikeInjectedInstruction(value)) return false;
  for (const m of value.matchAll(/(?:S\$|SGD\s?|US\$|\$)\s?(\d[\d,]*(?:\.\d+)?)/g)) if (!moneyPrinted(fullText, Number(m[1].replace(/,/g, "")))) return false;
  for (const iso of printedDates(value)) if (!printedDates(fullText).includes(iso)) return false;
  for (const m of value.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) if (!new RegExp("(?<![\\d.])" + m[1].replace(".", "\\.") + "\\s*%").test(fullText)) return false;
  const status = value.match(STATUS_CLAIM)?.[0];
  if (status && !norm(fullText).includes(norm(status))) return false;
  return true;
}

export type FactCheckResult = { extraction: PolicyExtraction; dropped: string[] };

/** Re-finds every fact of a policy extraction in the document's pages.
 * `roleFromReader`: the role was the reader's choice (no wording rule decided it), so it must be plausible. */
export function factCheckExtraction(raw: PolicyExtraction, pages: Page[], opts: { roleFromReader?: boolean; documentTitle?: string | null } = {}): FactCheckResult {
  const fullText = pages.map((p) => p.text).join("\n");
  const pageText = new Map(pages.map((p) => [p.pageNumber, p.text]));
  const pageCurrency = new Map(pages.flatMap((p) => p.imageCurrency ? [[p.pageNumber, p.imageCurrency] as const] : []));
  const dropped: string[] = [];
  const drop = (what: string) => { dropped.push(what); return null; };
  const printedOr = (value: string | null, what: string) => (value && !namePrinted(fullText, value) ? drop(what + " that is not printed in this document") : value);

  // A name the reader got wrong (or could not give) is replaced only by the one the document prints as its own title or letterhead.
  const insurer = printedOr(raw.insurer, "an insurer name") ?? letterheadInsurer(pages);
  // Round 7 (port): the PDF's own Title property is the document speaking too
  // ("TermGuard 65 - Policy Schedule"), for the product's name only.
  const titled = opts.documentTitle && !looksLikeInjectedInstruction(opts.documentTitle) ? opts.documentTitle : "";
  const productName = (raw.productName && titled && !namePrinted(fullText, raw.productName) && namePrinted(titled, raw.productName) ? raw.productName : null)
    ?? printedOr(raw.productName, "a product name") ?? titleProductName(pages) ?? productFromDocumentTitle(titled);
  const policyholder = printedOr(raw.policyholder, "a policyholder name");
  const productsMentioned = [...new Set(raw.productsMentioned.filter((p) => namePrinted(fullText, p)))];
  if (productsMentioned.length < raw.productsMentioned.length) dropped.push("product names that are not printed in this document");
  const referenceCoverages = raw.referenceCoverages
    .filter((r) => !r.productName || namePrinted(fullText, r.productName))
    .map((r) => ({ ...r, notes: r.notes && readerTextSupported(fullText, r.notes) && namePrinted(fullText, r.notes) ? r.notes : null }));

  // Numbers: the personal number is printed and is not only ever printed as the group number.
  let policyNumber = raw.policyNumber, groupPolicyNumber = raw.groupPolicyNumber;
  const printedNumber = (n: string | null) => !!n && fullText.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(n.toUpperCase().replace(/[^A-Z0-9]/g, "")) && n.replace(/[^A-Za-z0-9]/g, "").length >= 3;
  if (groupPolicyNumber && !printedNumber(groupPolicyNumber)) groupPolicyNumber = drop("a group policy number that is not printed in this document");
  if (policyNumber && printedNumber(policyNumber) && onlyPrintedAsGroupNumber(pages, policyNumber)) {
    dropped.push("a policy number that this document prints only as its group policy number");
    groupPolicyNumber = groupPolicyNumber ?? policyNumber; policyNumber = null;
  }
  if (policyNumber && groupPolicyNumber && nameKey(policyNumber) === nameKey(groupPolicyNumber) && onlyPrintedAsGroupNumber(pages, policyNumber)) policyNumber = null;

  // Dates: printed in a line that reads like that role, and in order.
  let startDate = raw.startDate, renewalOrExpiryDate = raw.renewalOrExpiryDate;
  const iso = (d: string | null) => (d ? parsePrintedDate(d) ?? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null) : null);
  let startDropped = false, endDropped = false;
  if (startDate && iso(startDate) && printedDates(fullText).includes(iso(startDate)!) && !dateFitsRole(pages, iso(startDate)!, "start")) { startDate = drop("a start date this document prints for something else"); startDropped = true; }
  if (renewalOrExpiryDate && iso(renewalOrExpiryDate) && printedDates(fullText).includes(iso(renewalOrExpiryDate)!) && !dateFitsRole(pages, iso(renewalOrExpiryDate)!, "end")) { renewalOrExpiryDate = drop("an expiry date this document prints for something else"); endDropped = true; }
  if (startDate && renewalOrExpiryDate && iso(startDate) && iso(renewalOrExpiryDate) && iso(startDate)! > iso(renewalOrExpiryDate)!) {
    dropped.push("a start date later than the expiry date (the two were not used)");
    startDate = null; renewalOrExpiryDate = null; startDropped = endDropped = true;
  }
  // Round 13: a date the reader got wrong is replaced only by the one date this document prints
  // under that very label ("Commencement date", "Maturity date", the two ends of its printed period)
  // -- never guessed, and never when it prints more than one.
  if (startDropped && !startDate) startDate = labelledDate(pages, "start");
  if (endDropped && !renewalOrExpiryDate) renewalOrExpiryDate = labelledDate(pages, "end");
  if (startDate && renewalOrExpiryDate && iso(startDate)! > iso(renewalOrExpiryDate)!) { startDate = null; renewalOrExpiryDate = null; }
  // Round 13: sanity bounds. Cover does not start more than a year after the document itself was
  // written (a renewal notice or a schedule is issued shortly before its period, never years ahead).
  const written = documentDateFrom(pages);
  if (startDate && iso(startDate) && written && isoMs(iso(startDate)!) - isoMs(written) > 400 * DAY_MS) startDate = drop("a start date implausibly far after the date of this document");
  // An endowment's or ILP's maturity is its term after its start: a date that is not is some other date.
  const term = printedTermYears(fullText);
  if (term && startDate && renewalOrExpiryDate && iso(startDate) && iso(renewalOrExpiryDate)) {
    const years = (isoMs(iso(renewalOrExpiryDate)!) - isoMs(iso(startDate)!)) / (365.25 * DAY_MS);
    if (years > 2 && Math.abs(years - term) > 1.05 && Math.abs(years - term + 1) > 1.05 && !printedTermYearsAll(fullText).some((t) => Math.abs(years - t) <= 1.05)) renewalOrExpiryDate = drop("an expiry or maturity date that does not match the policy term this document prints");
  }

  // People: printed in the document, one entry per person, a relationship only as printed near them.
  const people: PolicyExtraction["insuredPeople"] = [];
  for (const person of raw.insuredPeople) {
    if (!personPrinted(fullText, person.name)) { dropped.push("a person who is not named in this document"); continue; }
    const same = people.find((p) => nameKey(p.name) === nameKey(person.name));
    const hint = person.relationshipHint && hintNearName(pages, person.name, person.relationshipHint) ? person.relationshipHint : null;
    const coverages = person.coverages.map((c) => checkCoverage({ ...c,
      productName: c.productName && namePrinted(fullText, c.productName) ? c.productName : null,
      policyNumber: c.policyNumber && printedNumber(c.policyNumber) ? c.policyNumber : null }, person.name, pageText, pageCurrency));
    if (same) { same.coverages.push(...coverages); same.relationshipHint ??= hint; }
    else people.push({ ...person, relationshipHint: hint, coverages });
  }
  // Round 7 (port): someone the document names only as its policyholder or payer ("Policyholder: GOH BOON HOCK" on his
  // wife's schedule) is not one of its insured people when the document names someone else as insured.
  {
    const flat = fullText.replace(/\s+/g, " ");
    const LABEL = /(policyholder|policy owner|proposer|payer|paid by|premium payer|owner|life assured|insured(?: person| child| spouse| member)?|name of (?:the )?insured|member|employee|dependants?|spouse|child(?:ren)?|insured lives?)\s*[:\-]?\s*$/i;
    const payerOnly = (name: string) => {
      const re = new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
      const labels = [...flat.matchAll(re)].map((m) => flat.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0).match(LABEL)?.[1]?.toLowerCase() ?? null);
      return labels.length > 0 && labels.every((l) => !!l && /^(?:policyholder|policy owner|proposer|payer|paid by|premium payer|owner)$/.test(l));
    };
    // Someone else is printed as the insured ("Life assured: TEO HUI MIN GRACE"): the payer is not.
    const insuredElsewhere = (name: string) => [...flat.matchAll(/\b(?:life assured|insured(?: person| child| spouse)?|name of (?:the )?insured)\s*[:\-]\s*([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,4})/g)]
      .some((m) => !m[1].toLowerCase().startsWith(name.trim().toLowerCase().split(/\s+/)[0]));
    const keep = people.filter((p) => !(payerOnly(p.name) && (people.length > 1 || insuredElsewhere(p.name))));
    if (keep.length < people.length) { dropped.push("a policyholder named as insured"); people.splice(0, people.length, ...keep); }
  }
  // A document whose own wording names no type (the reader named it): a person it prints only inside a sentence (a
  // brochure's example person, a letter's greeting) or on a sample page holds no cover from it; the person is kept, so the
  // paper is filed with them, with no cover (lib/documents/own-figure).
  let particularsShown = true;
  if (OWN_FIGURE_CHECKS.on && opts.roleFromReader) {
    // Judged page by page (Critic r377d): a pack's specimen wording appendix or sample letter page clears only cover read
    // from that page, not the schedule's.
    // A banner in the first page's heading block sets the whole document aside.
    const samplePages = new Set(pages.filter((p, i) => specimenPage(p.text) || (i > 0 && specimenHeading(pages[0].text))).map((p) => p.pageNumber));
    const realPage = (p: { pageNumber: number }) => !samplePages.has(p.pageNumber);
    for (const person of people) {
      if (personOnlyInExample(person.name, pages.filter(realPage).map((p) => p.text)) || (samplePages.size > 0 && pages.every((p) => !realPage(p) || !nameWordsOnLine(person.name, p.text)) && pages.some((p) => nameWordsOnLine(person.name, p.text)))) {
        if (person.coverages.length) dropped.push(samplePages.size ? "cover for a person printed only on a sample page or in a sentence" : "cover for a person the document names only in a sentence, not as its insured");
        person.coverages = [];
        continue;
      }
      const kept = person.coverages.filter((c) => (c.sourcePage == null ? !samplePages.size : !samplePages.has(c.sourcePage)));
      if (kept.length < person.coverages.length) { dropped.push("cover read from a sample page"); person.coverages = kept; }
    }
    particularsShown = people.some((p) => !personOnlyInExample(p.name, pages.filter(realPage).map((page) => page.text)));
  }
  for (const person of people) {
    const seen = new Set<string>();
    person.coverages = person.coverages.filter((c) => { const k = [norm(c.category), c.amount, c.currency, c.sourcePage].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // Premiums: printed as money on a line about paying, with printed dates.
  const premiumLine = (text: string, amount: number) => text.split("\n").some((line) => /premium|payable|payment|paid|total|amount\s+due|giro|instal/i.test(line) && moneyPrinted(line, amount));
  let premium = raw.premium;
  if (premium.amount != null && !pages.some((p) => premiumLine(p.text, premium.amount!))) { premium = { amount: null, currency: null, frequency: null }; dropped.push("a premium that is not printed in this document"); }
  if (premium.frequency && frequencyContradicted(fullText, premium.frequency)) premium = { ...premium, frequency: null };
  const seenPayments = new Set<string>();
  const paymentRecords = raw.paymentRecords.flatMap((p) => {
    const where = p.sourcePage != null ? pageText.get(p.sourcePage) ?? "" : fullText;
    let sourcePage = p.sourcePage;
    if (p.amount != null && !premiumLine(where, p.amount)) {
      // The page cited does not print it: the page that does, if any, is the source; otherwise it is not kept.
      const printedOn = pages.find((page) => premiumLine(page.text, p.amount!));
      if (!printedOn) { dropped.push("a payment that is not printed in this document"); return []; }
      sourcePage = printedOn.pageNumber;
    }
    const date = (d: string | null) => (d && iso(d) && printedDates(fullText).includes(iso(d)!) ? d : null);
    const rec = { ...p, sourcePage, frequency: p.frequency && frequencyContradicted(fullText, p.frequency) ? null : p.frequency, paymentDate: date(p.paymentDate), periodStart: date(p.periodStart), periodEnd: date(p.periodEnd),
      insuredPersonName: p.insuredPersonName && personPrinted(fullText, p.insuredPersonName) ? p.insuredPersonName : null,
      policyNumber: p.policyNumber && printedNumber(p.policyNumber) ? p.policyNumber : null,
      insurer: p.insurer && namePrinted(fullText, p.insurer) ? p.insurer : null,
      productName: p.productName && namePrinted(fullText, p.productName) ? p.productName : null,
      notes: p.notes && readerTextSupported(fullText, p.notes) ? p.notes : null };
    const k = JSON.stringify([rec.insuredPersonName && nameKey(rec.insuredPersonName), rec.amount, rec.currency, rec.frequency, rec.paymentDate, rec.periodStart, rec.periodEnd, rec.sourcePage]);
    if (seenPayments.has(k)) return [];
    seenPayments.add(k);
    return [rec];
  });

  let documentRole = opts.roleFromReader ? plausibleRole(raw.documentRole, fullText, pages, [insurer, productName, ...productsMentioned]) : raw.documentRole;
  if (documentRole !== raw.documentRole) {
    dropped.push("a document type its own wording does not support");
    // Round 13: replaced only by the one kind of REFERENCE document its title names ("Employee Benefits
    // Booklet"): a role that never confers personal cover. A personal role is never assigned here.
    const titled = [...titleRoles(pages, [productName, ...productsMentioned])];
    if (titled.length === 1 && REFERENCE_ROLE_SET.has(titled[0]) && plausibleRole(titled[0] as PolicyExtraction["documentRole"], fullText, pages, [insurer, productName, ...productsMentioned]) === titled[0]) documentRole = titled[0] as PolicyExtraction["documentRole"];
  }
  const personalCoverageConfirmed = raw.personalCoverageConfirmed && people.length > 0 && particularsShown && !!documentRole && PERSONAL_AUTHORITY_ROLES.has(documentRole);
  // Summaries the reader wrote (shown on the document's page): no instruction, and every figure, date and status in them printed.
  const keep = (items: string[]) => [...new Set(items.filter((x) => readerTextSupported(fullText, x)))];
  const documentNotes = raw.documentNotes.filter((note) => readerTextSupported(fullText, note));
  return {
    dropped,
    extraction: {
      ...raw, insurer, productName, policyholder, productsMentioned, referenceCoverages, policyNumber, groupPolicyNumber, startDate, renewalOrExpiryDate,
      documentRole, personalCoverageConfirmed,
      insuredPeople: people, premium, paymentRecords, documentNotes: [...documentNotes, ...(dropped.length ? ["Not kept because the document does not print it: " + [...new Set(dropped)].join("; ") + "."] : [])],
      keyExclusions: keep(raw.keyExclusions), waitingPeriods: keep(raw.waitingPeriods), deductiblesAndCoinsurance: keep(raw.deductiblesAndCoinsurance), riders: keep(raw.riders).filter((x) => namePrinted(fullText, x)),
    },
  };
}

const FREQUENCIES: [string, RegExp][] = [
  ["annual", /\b(?:annual(?:ly)?|yearly|per\s+annum|a\s+year|p\.a\.|every\s+year|12\s+months)\b/i],
  ["monthly", /\b(?:monthly|per\s+month|a\s+month|every\s+month)\b/i],
  ["quarterly", /\b(?:quarterly|per\s+quarter|every\s+3\s+months)\b/i],
  ["half", /\b(?:half[-\s]?yearly|semi[-\s]?annual(?:ly)?|every\s+6\s+months)\b/i],
  ["single", /\b(?:single\s+premium|one[-\s]?time|lump\s+sum\s+premium)\b/i],
];
/** A payment frequency the document contradicts: its premium lines print a frequency, and never this one. */
export function frequencyContradicted(fullText: string, frequency: string) {
  const f = frequency.toLowerCase();
  const mine = FREQUENCIES.find(([k]) => f.includes(k) || (k === "annual" && /year/.test(f)) || (k === "half" && /semi/.test(f)));
  if (!mine) return false;
  const premiumLines = fullText.split("\n").filter((line) => /premium|instal|payable|payment|giro/i.test(line)).join("\n");
  const printed = FREQUENCIES.filter(([, re]) => re.test(premiumLines)).map(([k]) => k);
  return printed.length > 0 && !printed.includes(mine[0]);
}

/** Lines of the document's own pages (not a synthetic control block). */
function contentLines(pages: Page[]) {
  return pages.flatMap((p) => p.text.split("\n")).map((l) => l.replace(/\t/g, " ").replace(/\s+/g, " ").trim()).filter((l) => l && !/DPTEST-|^[A-Za-z0-9+/=]{40,}$/.test(l));
}
const TITLE_KINDS = /\s+[-–:]\s+(?:policy\s+schedule|schedule|certificate|policy|statement|benefit\s+illustration|policy\s+illustration|illustration|renewal|notice|endorsement|summary)\b/i;
/** The product a document names in its own title line ("MEDIGUARD INTEGRATED SHIELD - POLICY SCHEDULE"). */
const KIND_FIRST = /^(?:notice\s+of\s+lapse|lapse\s+notice|renewal\s+notice|premium\s+notice|premium\s+reminder|grace\s+period\s+reminder|reminder|annual\s+statement|statement)\s*[-–:]\s*(.+)$/i;
/** A line that is nothing but the kind of document ("POLICY SCHEDULE") under a title line. */
const KIND_ONLY = /^(?:policy\s+schedule|schedule(?:\s+of\s+insurance)?|certificate(?:\s+of\s+insurance)?|policy\s+certificate|policy\s+statement|annual\s+statement|benefit\s+illustration|policy\s+illustration|endorsement|renewal\s+(?:notice|certificate))$/i;
/** The document's own lines with its contents entries left out: a line with dot leaders ("Policy schedule ...... 3") or a
 * page number after a tab ("2. SafeTrip Plus - Policy Schedule<tab>5"), and, under a "Contents" heading, its entries: a
 * line ending in a page number ("Claims 9", "Claims p. 9"), a numbered line ("1<tab>Who is covered?"), a page number
 * alone ("pg 2", "5"), or a line followed by one. The block ends at a blank line or the first line that is no entry, so
 * a title printed below a contents box still names the document. A contents entry names a section further on, never
 * the document. */
function linesWithoutContents(pages: Page[]): string[] {
  const out: string[] = [];
  const pageNumberOnly = (l: string) => /^(?:p(?:age|g)?\.?\s*)?\d{1,3}$/i.test(l);
  for (const p of pages) {
    const raws = p.text.split("\n");
    let inContents = false;
    for (const [i, raw] of raws.entries()) {
      const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
      if (!line) { inContents = false; continue; }
      if (/DPTEST-|^[A-Za-z0-9+/=]{40,}$/.test(line)) continue;
      if (/^(?:table\s+of\s+)?contents:?$/i.test(line)) { inContents = true; continue; }
      if (/\.{3,}|…/.test(raw) || /\t\s*(?:p(?:age|g)\.?\s*)?\d{1,3}\s*$/i.test(raw)) continue;
      if (inContents) {
        const nextRaw = raws[i + 1] ?? "";
        const next = nextRaw.replace(/\s+/g, " ").trim();
        // A page number after a gap or a "p." ("Claims  9", "Claims p. 9") is an entry's; after a single space
        // ("Schedule 2") only when the next line is an entry too, so a title ending in a number ("SECURE LIFE 65")
        // above its kind line is the document's own.
        const strong = (r: string) => /(?:\s{2,}|\t|\s(?:p(?:age|g)?\.?\s*))\d{1,3}\s*$/i.test(r) || /^\d{1,2}(?:\.|\t|\s)/.test(r.trim()) || pageNumberOnly(r.replace(/\s+/g, " ").trim());
        const weak = (r: string) => /\s\d{1,3}\s*$/.test(r);
        const entry = strong(raw) || pageNumberOnly(next) || (weak(raw) && (strong(nextRaw) || weak(nextRaw)));
        if (entry) continue;
        inContents = false;
      }
      out.push(line);
    }
  }
  return out;
}
export function titleProductName(pages: Page[]): string | null {
  const lines = linesWithoutContents(pages).slice(0, 40);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Round 13: a title printed over two lines ("SHIELDCARE PREMIER - Integrated Shield Plan" / "POLICY SCHEDULE").
    const twoLine = lines[i + 1] && KIND_ONLY.test(lines[i + 1]) && /[A-Za-z]{3}/.test(line) && !/\t/.test(line) ? line.split(/\s+[-–:]\s+/)[0] : null;
    const m = twoLine ? null : line.match(TITLE_KINDS);
    const first = m || twoLine ? null : line.match(KIND_FIRST);
    if ((!m || m.index == null) && !first && !twoLine) continue;
    const name = (twoLine ?? (first ? first[1] : line.slice(0, m!.index))).trim();
    // A rider's own schedule ("SHIELDCARE PLUS RIDER - SCHEDULE OF BENEFITS") does not name the document's product.
    if (/\brider\s*$/i.test(name) || (m && /^\s*[-–:]\s*schedule\s+of\s+benefits\b/i.test(line.slice(m.index!)))) continue;
    if (name.length < 4 || name.length > 70 || /\b(?:insurance|assurance)\s*\(|^(?:dear|page|item)\b/i.test(name) || looksLikeInjectedInstruction(name)) continue;
    // Round 7 (port): a letterhead or address line above the title ("Policy
    // Services | 8 Kranji Link Singapore 739000") is not the product's name.
    if (/\||\b\d{6}\b|\b(?:pte|ltd|berhad|limited|services|tel|fax|www|email)\b|@/i.test(name)) continue;
    return name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name;
  }
  return null;
}
/** Round 7 (port): the product a PDF's Title property names ("LifeShield Protect -
 * Endorsement No. 2", "Notice of Lapse - Lotus Whole Life Plan"). */
export function productFromDocumentTitle(title: string | null | undefined): string | null {
  const parts = String(title ?? "").replace(/\\?\(scanned\\?\)/gi, "").split(/\s+[-–:|]\s+/).map((x) => x.trim()).filter(Boolean);
  const kind = /^(?:notice of lapse|lapse notice|confirmation of reinstatement|reinstatement|official receipt|receipt|premium (?:notice|reminder)|renewal notice|annual statement|statement|policy (?:schedule|summary|data page|illustration summary|contract summary|statement)|schedule(?: \d{4})?|certificate|rider schedule|endorsement(?: no\.? ?\d+)?|benefit summary|policy schedule \(\d{4}\)|employee benefits booklet.*)$/i;
  const name = parts.find((p) => !kind.test(p)) ?? null;
  if (!name || name.length < 4 || name.length > 70 || looksLikeInjectedInstruction(name)) return null;
  return name.replace(/\s+(?:certificate|schedule|policy)$/i, "").trim();
}
/** The insurer a document's letterhead prints (its first line naming an insurer). A line carrying a money figure, a
 * thousands figure or a percentage ("General dental  $900", "Life Cover  AUD 850,000") is a row of the document, never its
 * letterhead; a registration number ("Reg. No. 199002477Z") is not a figure (new-user
 * walkthrough, 31 Oct: a health fund's membership certificate was filed under the insurer "General dental $900"). */
export function letterheadInsurer(pages: Page[]): string | null {
  for (const line of contentLines(pages).slice(0, 12)) {
    if (line.length > 70 || /\bpage\s+\d|synthetic|policy|dear\b/i.test(line)) continue;
    if (/[$€£¥₹₱]\s?\d|\d\s?[$€£]|\b(?:[A-Z]{3}|RM)\s?\d[\d,.]*\b|\d{1,3}(?:[,.]\d{3})+|\b\d+(?:\.\d+)?\s?%/.test(line)) continue;
    if (/\b(?:insurance|assurance|life|general|mutual|takaful|insurer|insurers|health\s+fund|friendly\s+society|underwriters?)\b/i.test(line)) return line;
  }
  return null;
}

/** A relationship or plan hint ("spouse", "Plan A") printed within two lines of the person's name. */
function hintNearName(pages: Page[], name: string, hint: string) {
  const words = nameKey(hint).split(" ").filter((w) => w.length > 1 && !["the", "of", "and"].includes(w));
  if (!words.length) return false;
  for (const page of pages) {
    const lines = page.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!personPrinted(lines[i], name)) continue;
      const near = nameKey(lines.slice(Math.max(0, i - 2), i + 3).join(" ")).split(" ");
      if (words.every((w) => near.includes(w) || near.some((n) => n.startsWith(w) || w.startsWith(n) && n.length >= 4))) return true;
    }
  }
  return false;
}

/** One coverage: its evidence is on its own page, the person is named on that
 * page, and the amount is printed as money in the evidence (or on the line
 * that carries it). Anything less is kept as unverified, which the chat never
 * states as a figure. */
function checkCoverage<C extends PolicyExtraction["insuredPeople"][number]["coverages"][number]>(coverage: C, person: string, pageText: Map<number, string>, imageCurrency: Map<number, string> = new Map()): C {
  const text = coverage.sourcePage != null ? pageText.get(coverage.sourcePage) ?? "" : "";
  const evidence = String(coverage.evidenceText ?? "");
  let ok = !!text && evidence.trim().length >= 3 && !looksLikeInjectedInstruction(evidence) && personPrinted(text, person);
  if (ok) {
    const span = locatePassage(text, evidence);
    const lines = text.split("\n");
    const near = span ? null : closestLines(lines, evidence);
    const evidenceLines = span ? lines.filter((line, i) => { const start = lines.slice(0, i).join("\n").length + (i ? 1 : 0); return start <= span.end && start + line.length >= span.start; })
      : near!.lines;
    // Lines with different labels tied as the closest to the citation: each must print the figure (closestLines).
    const onEvidence = (f: (line: string) => boolean) => near?.all ? evidenceLines.every(f) : evidenceLines.some(f);
    if (!evidenceLines.length) ok = false;
    else if (coverage.amount != null) {
      ok = onEvidence((line) => moneyPrinted(line, Number(coverage.amount)) && (!coverage.currency || currencyOk(line, coverage.currency)));
      // A page whose text layer prints no currency, confirmed against its image, which prints one (lib/documents/image-currency):
      // a money-shaped figure on the evidence line is confirmed only in exactly that currency (Critic #417 C1, C2).
      const code = coverage.sourcePage != null ? imageCurrency.get(coverage.sourcePage) : undefined;
      if (!ok && code && (coverage.currency ?? "").toUpperCase() === code) ok = onEvidence((line) => moneyShapedFigure(line, Number(coverage.amount)));
    }
  }
  const notes = coverage.notes && !looksLikeInjectedInstruction(coverage.notes) && (!text || readerTextSupported(text, coverage.notes)) ? coverage.notes : null;
  // A figure its page prints only as what another scheme or plan pays, a total with another plan, an example, a projection
  // or a premium, or any figure on a sample page, is never this person's cover amount (lib/documents/own-figure).
  if (OWN_FIGURE_CHECKS.on && coverage.amount != null && text) {
    const why = specimenPage(text) ? "a sample page" : amountOnlyInContext(text, Number(coverage.amount), { premium: true });
    if (why) return { ...coverage, amount: null, notes: [notes, "Not shown as cover: the page prints this figure only as " + (why === "a sample page" ? why : figureContextWords(why)) + "."].filter(Boolean).join(" · "), evidenceVerified: false };
  }
  // A sum on a page that says its sum insured is not what is paid (a bonus base, lib/documents/notional-sum) is kept as a
  // line with no amount: the cover is held, its figure is never a cover amount (Home, Coverage, chat, claims).
  if (coverage.amount != null && printsNotionalSum(text) && !RIDER_NAME.test(`${coverage.productName ?? ""} ${coverage.evidenceText ?? ""}`))
    return { ...coverage, amount: null, notes: [notes, NOTIONAL_SUM_NOTE].filter(Boolean).join(" · "), evidenceVerified: ok && coverage.evidenceVerified === true };
  return { ...coverage, notes, evidenceVerified: ok && coverage.evidenceVerified === true };
}
/** A label's own words, in order: no figures, and no "[amount not checked]" the page check left where it could not confirm
 * a figure. */
const labelWords = (t: string) => nameKey(String(t ?? "").split(NOT_CHECKED).join(" ")
  // A dotted initialism is one word: "T.P.D." is "TPD" (TE #422 V24).
  .replace(/(?<![A-Za-z])((?:[A-Za-z]\.){2,}[A-Za-z]?)(?![A-Za-z])/g, (m) => m.replace(/\./g, ""))).split(" ").filter((w) => w.length > 1 && !/\d/.test(w));
const LINKING_WORDS = new Set(["and", "of", "the", "for", "on", "in", "or"]);
/** How a citation's label words sit in a page line's label. A cited word matches a word the line prints, or is the
 * initialism of a run of the line's words, case-insensitive and leaving out linking words ("TPD" for "Total and Permanent
 * Disability", "CI" for "Critical Illness", TE #422 V11). `covered` counts the line's words the matches account for. */
function labelMatch(want: string[], line: string) {
  const words = labelWords(line), have = new Set(words), content = words.filter((w) => !LINKING_WORDS.has(w));
  const runs = new Map<string, number>();
  for (let i = 0; i < content.length; i++) for (let n = 2; n <= 6 && i + n <= content.length; n++) {
    const key = content.slice(i, i + n).map((w) => w[0]).join("");
    if (!runs.has(key)) runs.set(key, n);
  }
  let matched = 0, covered = 0;
  for (const w of new Set(want)) {
    if (have.has(w)) { matched++; covered++; }
    else if (w.length >= 2 && w.length <= 6 && /^[a-z]+$/.test(w) && runs.has(w)) { matched++; covered += runs.get(w)!; }
  }
  return { matched, covered: Math.min(covered, have.size), size: have.size };
}
/** How much of a cited line a page line holds, when the citation is not found word for word (spacing, a tab read as a
 * space, an abbreviated label). The figures count toward the share, but never alone: the line must also hold at least half
 * of the citation's own words (its label). Else another line that prints the same figure stands in for the cited one
 * ("Death S$250,000" confirmed from "Total Permanent Disability S$250,000" once the page check marked the Death line's
 * figure as not checked, TE #417 N11m), and a wrong amount is confirmed. A citation with no words of its own is never
 * matched this way. */
function tokenShare(line: string, evidence: string) {
  const want = [...new Set(nameKey(evidence).split(" ").filter((t) => t.length > 1))];
  if (!want.length) return 0;
  const words = [...new Set(labelWords(evidence))];
  if (!words.length) return 0;
  const { matched } = labelMatch(words, line);
  if (matched * 2 < words.length) return 0;
  const have = new Set(nameKey(line).split(" "));
  const figures = want.filter((t) => /\d/.test(t));
  return (matched + figures.filter((t) => have.has(t)).length) / (words.length + figures.length);
}
/** The page lines a citation not found word for word stands for: of the lines that name at least half of its words, only
 * those whose label is closest to the citation's own words (word Jaccard, an initialism counting for the words it spells).
 * Another cover whose label holds the same words or more ("Sum Assured (TPD)" for "Sum Assured Death", "Accidental Death
 * Benefit" for "Death Benefit") never stands in for the cover's own line while that line is on the page (Critic #422 G1,
 * G2). `all` is set when lines with different labels tie: then every one of them must print the figure, as which cover
 * the citation meant is not known ("CI" for both "Critical Illness" and "Cancer Insurance"). */
function closestLines(lines: string[], evidence: string): { lines: string[]; all: boolean } {
  const want = [...new Set(labelWords(evidence))];
  if (!want.length) return { lines: [], all: false };
  // The closest label is chosen among the lines that hold the citation's figures and the lines whose figure the page check
  // could not confirm: the cover's own line with "[amount not checked]" still wins over another cover's line, and then
  // confirms nothing. A heading or plan line with no figure ("Plan: Heron Guard Death Cover") never competes, so it cannot
  // hide the row below it (Critic #422 R1).
  const scored = lines.flatMap((line) => {
    if (!line.includes(NOT_CHECKED) && tokenShare(line, evidence) < 0.7) return [];
    const m = labelMatch(want, line);
    return m.matched * 2 < want.length ? [] : [{ line, score: m.matched / (want.length + m.size - m.covered || 1) }];
  });
  const best = Math.max(0, ...scored.map((x) => x.score));
  const top = scored.filter((x) => x.score === best).map((x) => x.line);
  // Then the closest lines must also hold the citation's figures (tokenShare); one that does not confirms nothing.
  const all = new Set(top.map((l) => labelWords(l).join(" "))).size > 1;
  const held = top.filter((line) => tokenShare(line, evidence) >= 0.7);
  return { lines: all && held.length < top.length ? [] : held, all };
}
function currencyOk(line: string, currency: string) {
  const code = currency.toUpperCase();
  if (code === "SGD") return /S\$|(?<![A-Za-z])SGD(?![A-Za-z])|SG\$/i.test(line) || new RegExp(GLUED_CODE("SGD")).test(line)
    || !(/US\$|(?<![A-Za-z])(?:USD|RM|MYR)(?![A-Za-z])|€|£|HK\$/i.test(line) || new RegExp(GLUED_CODE("USD|RM|MYR")).test(line));
  if (code === "USD") return /US\$|(?<![A-Za-z])USD(?![A-Za-z])/i.test(line) || new RegExp(GLUED_CODE("USD")).test(line);
  return true;
}

// ---------------------------------------------------------------------------
// Benefit and ledger rows read by a model
// ---------------------------------------------------------------------------
const DAILY_WORDS = /\bper\s+(?:day|night)\b|\ba\s+(?:day|night)\b|\beach\s+(?:day|night)\b|\bdaily\b/i;
/** A model-read payout row: its figure is printed in its quote in the unit it claims. */
export function rowFigureSupported(passage: string, kind: "lump_sum" | "per_day" | "per_month" | "percent_of_sum" | "reimbursement_cap" | "stated" | "fixed" | "daily" | "expense_cap" | "sum_insured" | "none", amount: number | null | undefined) {
  if (amount == null || kind === "stated" || kind === "none") return true;
  if (kind === "percent_of_sum" || kind === "sum_insured") return amountAppears(passage, amount, "fraction");
  if (!moneyPrinted(passage, amount) && !percentOfPrinted(passage, amount)) return false;
  const daily = dailyRatePrinted(passage, amount);
  if (kind === "per_day" || kind === "daily") return daily;
  if (kind === "per_month") return /\bper\s+month\b|\bmonthly\b|\ba\s+month\b/i.test(passage);
  // A lump sum or a limit is never a figure the page prints as a daily rate.
  return !daily || !DAILY_WORDS.test(passage.replace(/up\s+to[^.]*$/i, ""));
}
/** A sum the passage states as a percentage of a printed amount ("25% of S$5,000" is S$1,250). */
function percentOfPrinted(passage: string, amount: number) {
  for (const m of String(passage ?? "").matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*of\s*(?:the\s+)?(?:[A-Z]{0,3}\$|[A-Z]{3}\s?)\s?([\d,]+(?:\.\d{1,2})?)/gi))
    if (Math.abs(Math.round(Number(m[2].replace(/,/g, "")) * Number(m[1])) / 100 - amount) < 0.005) return true;
  return false;
}
const EVENT_WORDS: Record<string, RegExp> = {
  death: /\bdeath|\bdie|\bdied|\blife\b|fatal|\bdeceased/i,
  accidental_death: /accident|death|\bdie/i,
  tpd: /disab|tpd|permanent/i,
  terminal_illness: /terminal/i,
  critical_illness: /critical|\bci\b|cancer|illness|dread/i,
  early_critical_illness: /early|critical|\bci\b/i,
  hospital_daily_cash: /hospital|cash|daily|per\s+day|income/i,
  icu_daily_cash: /icu|intensive/i,
  surgery: /surg|operat/i,
  fracture: /fractur|bone/i,
  dismemberment: /loss\s+of|dismember|limb|sight|hearing|speech/i,
  accidental_disablement: /disabl|disab/i,
  travel_delay: /delay/i,
  trip_cancellation: /cancel|curtail|postpone/i,
  baggage: /baggage|luggage|belonging|personal\s+effects/i,
  travel_medical: /medical|overseas|hospital|treatment/i,
  motor_damage: /vehicle|car|motor|damage|repair|windscreen/i,
  home_damage: /home|contents|fire|property|damage|household/i,
  maturity: /maturity|matur|survival|endow/i,
  ambulance: /ambulance/i,
};
/** The event a ledger row claims is one its own words can name. */
export function eventSupported(eventType: string, words: string) {
  const re = EVENT_WORDS[eventType];
  return !re || re.test(words);
}
