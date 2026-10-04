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
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { PERSONAL_AUTHORITY_ROLES } from "@/lib/documents/intelligence";
import { amountAppears, locatePassage, looksLikeInjectedInstruction, nameAppears, parsePrintedDate, printedDates } from "@/lib/documents/evidence";

type Page = { pageNumber: number; text: string };
const norm = (value: string) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const nameKey = (value: string) => norm(value).replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------
const CURRENCY_MARK = String.raw`(?:S\$|SG\$|SGD|US\$|USD|HK\$|HKD|A\$|AUD|RM|MYR|PHP|₱|€|EUR|£|GBP|\$)`;
function digitsPattern(value: number) {
  const whole = Math.trunc(Math.abs(value)), cents = Math.round((Math.abs(value) - whole) * 100);
  const digits = String(whole), groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join("[,\\s]?") + (cents ? "\\." + String(cents).padStart(2, "0").replace(/0$/, "0?") : "(?:\\.0{1,2})?");
}
/** The amount printed as MONEY in the text: with a currency mark before it, or
 * bare in a line that prints a currency elsewhere -- never as a percentage, a
 * count of days or years, or part of a longer number or a date. */
export function moneyPrinted(text: string, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  const body = digitsPattern(value);
  // Round 10: never part of a figure a scan printed unclearly ("S$5O,000" is not S$5).
  const marked = new RegExp(CURRENCY_MARK + String.raw`\s?` + body + String.raw`(?![\d.,]\d|\s*%|\s*per\s*cent|[,.]?[OoIl|])`, "i");
  if (marked.test(text)) return true;
  const bare = new RegExp(String.raw`(?<![\d.,/-])(?<![\d][,.]?[OoIl|]+[,.]?)` + body + String.raw`(?![\d]|[.,]\d|\s*(?:%|per\s*cent|days?|nights?|years?|months?|hours?|weeks?|x\b|times)|[/-]\d|[,.]?[OoIl|])`, "i");
  return String(text ?? "").split("\n").some((line) => new RegExp(CURRENCY_MARK, "i").test(line) && bare.test(line));
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
const START_CONTEXT = /\b(?:start|commenc\w*|effective|inception|from|begin\w*|issue\s+date|date\s+of\s+issue|policy\s+date|period\s+of\s+(?:insurance|cover)|cover\s+period|policy\s+period|insured\s+period|valid\s+from)\b/i;
const END_CONTEXT = /\b(?:expir\w*|end\w*|until|till|to|through|renew\w*|maturity|matures?|valid\s+(?:till|until|to)|period\s+of\s+(?:insurance|cover)|cover\s+period|policy\s+period|lapse\w*|grace|due)\b/i;
const OTHER_DATE_CONTEXT = /\b(?:date\s+of\s+birth|birth\s*date|born|d\.?o\.?b|valuation|bid\s+price|nav|receipt\s+(?:no|date)|date\s+of\s+payment|payment\s+received|paid\s+on|statement\s+date|claim\s+date|date\s+of\s+(?:accident|loss|admission))\b/i;
/** Lines that print this ISO date. */
function linesWithDate(pages: Page[], iso: string) {
  return pages.flatMap((p) => p.text.split("\n")).filter((line) => printedDates(line).includes(iso));
}
/** A start or expiry date is acceptable when it is printed and at least one
 * line that prints it reads like that role (or carries no label at all) --
 * never a date printed only as a birth, valuation, receipt or claim date. */
export function dateFitsRole(pages: Page[], iso: string, role: "start" | "end") {
  const lines = linesWithDate(pages, iso);
  if (!lines.length) return false;
  const fits = role === "start" ? START_CONTEXT : END_CONTEXT;
  if (lines.some((line) => fits.test(line))) return true;
  return lines.some((line) => !OTHER_DATE_CONTEXT.test(line));
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const PAYMENT_WORDS = /\b(?:premium|receipt|payment|payable|amount\s+due|paid|giro|medisave|renewal\s+notice|statement)\b/i;
const PERSONAL_WORDS = /\b(?:insured\s+person|life\s+assured|name\s+of\s+(?:the\s+)?insured|policyholder|policy\s+owner|insured\s*:|particulars\s+of\s+insured|named\s+driver|insured\s+helper|employee\s+name|member\s+name)\b/i;
const PAYMENT_ROLES = new Set(["premium_receipt", "renewal_statement", "annual_statement"]);
const PERSONAL_ROLES = new Set(["personal_schedule", "certificate", "endorsement"]);
const REFERENCE_ROLE_SET = new Set(["policy_wording", "product_summary", "benefit_guide", "brochure"]);
/** A role the reader chose that the document's own wording cannot carry is not kept. */
export function plausibleRole(role: PolicyExtraction["documentRole"], fullText: string): PolicyExtraction["documentRole"] {
  if (!role) return role;
  if (PAYMENT_ROLES.has(role) && !PAYMENT_WORDS.test(fullText)) return null;
  const particulars = PERSONAL_WORDS.test(fullText) && /\b(?:policy|certificate)\s+(?:no\.?|number)\b/i.test(fullText);
  if (PERSONAL_ROLES.has(role) && !particulars) return null;
  // Generic wording never prints one person's particulars and policy number.
  if (REFERENCE_ROLE_SET.has(role) && particulars) return null;
  return role;
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
export function factCheckExtraction(raw: PolicyExtraction, pages: Page[], opts: { roleFromReader?: boolean } = {}): FactCheckResult {
  const fullText = pages.map((p) => p.text).join("\n");
  const pageText = new Map(pages.map((p) => [p.pageNumber, p.text]));
  const dropped: string[] = [];
  const drop = (what: string) => { dropped.push(what); return null; };
  const printedOr = (value: string | null, what: string) => (value && !namePrinted(fullText, value) ? drop(what + " that is not printed in this document") : value);

  // A name the reader got wrong (or could not give) is replaced only by the one the document prints as its own title or letterhead.
  const insurer = printedOr(raw.insurer, "an insurer name") ?? letterheadInsurer(pages);
  const productName = printedOr(raw.productName, "a product name") ?? titleProductName(pages);
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
  if (startDate && iso(startDate) && printedDates(fullText).includes(iso(startDate)!) && !dateFitsRole(pages, iso(startDate)!, "start")) startDate = drop("a start date this document prints for something else");
  if (renewalOrExpiryDate && iso(renewalOrExpiryDate) && printedDates(fullText).includes(iso(renewalOrExpiryDate)!) && !dateFitsRole(pages, iso(renewalOrExpiryDate)!, "end")) renewalOrExpiryDate = drop("an expiry date this document prints for something else");
  if (startDate && renewalOrExpiryDate && iso(startDate) && iso(renewalOrExpiryDate) && iso(startDate)! > iso(renewalOrExpiryDate)!) {
    dropped.push("a start date later than the expiry date (the two were not used)");
    startDate = null; renewalOrExpiryDate = null;
  }

  // People: printed in the document, one entry per person, a relationship only as printed near them.
  const people: PolicyExtraction["insuredPeople"] = [];
  for (const person of raw.insuredPeople) {
    if (!personPrinted(fullText, person.name)) { dropped.push("a person who is not named in this document"); continue; }
    const same = people.find((p) => nameKey(p.name) === nameKey(person.name));
    const hint = person.relationshipHint && hintNearName(pages, person.name, person.relationshipHint) ? person.relationshipHint : null;
    const coverages = person.coverages.map((c) => checkCoverage({ ...c,
      productName: c.productName && namePrinted(fullText, c.productName) ? c.productName : null,
      policyNumber: c.policyNumber && printedNumber(c.policyNumber) ? c.policyNumber : null }, person.name, pageText));
    if (same) { same.coverages.push(...coverages); same.relationshipHint ??= hint; }
    else people.push({ ...person, relationshipHint: hint, coverages });
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

  const documentRole = opts.roleFromReader ? plausibleRole(raw.documentRole, fullText) : raw.documentRole;
  if (documentRole !== raw.documentRole) dropped.push("a document type its own wording does not support");
  const personalCoverageConfirmed = raw.personalCoverageConfirmed && people.length > 0 && !!documentRole && PERSONAL_AUTHORITY_ROLES.has(documentRole);
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
export function titleProductName(pages: Page[]): string | null {
  for (const line of contentLines(pages).slice(0, 40)) {
    const m = line.match(TITLE_KINDS);
    const first = m ? null : line.match(KIND_FIRST);
    if ((!m || m.index == null) && !first) continue;
    const name = (first ? first[1] : line.slice(0, m!.index)).trim();
    if (name.length < 4 || name.length > 70 || /\b(?:insurance|assurance)\s*\(|^(?:dear|page|item)\b/i.test(name) || looksLikeInjectedInstruction(name)) continue;
    return name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name;
  }
  return null;
}
/** The insurer a document's letterhead prints (its first line naming an insurer). */
export function letterheadInsurer(pages: Page[]): string | null {
  for (const line of contentLines(pages).slice(0, 12)) {
    if (line.length > 70 || /\bpage\s+\d|synthetic|policy|dear\b/i.test(line)) continue;
    if (/\b(?:insurance|assurance|life|general|mutual|takaful|insurer)\b/i.test(line)) return line;
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
function checkCoverage<C extends PolicyExtraction["insuredPeople"][number]["coverages"][number]>(coverage: C, person: string, pageText: Map<number, string>): C {
  const text = coverage.sourcePage != null ? pageText.get(coverage.sourcePage) ?? "" : "";
  const evidence = String(coverage.evidenceText ?? "");
  let ok = !!text && evidence.trim().length >= 3 && !looksLikeInjectedInstruction(evidence) && personPrinted(text, person);
  if (ok) {
    const span = locatePassage(text, evidence);
    const lines = text.split("\n");
    const evidenceLines = span ? lines.filter((line, i) => { const start = lines.slice(0, i).join("\n").length + (i ? 1 : 0); return start <= span.end && start + line.length >= span.start; })
      : lines.filter((line) => tokenShare(line, evidence) >= 0.7);
    if (!evidenceLines.length) ok = false;
    else if (coverage.amount != null) ok = evidenceLines.some((line) => moneyPrinted(line, Number(coverage.amount)) && (!coverage.currency || currencyOk(line, coverage.currency)));
  }
  const notes = coverage.notes && !looksLikeInjectedInstruction(coverage.notes) && (!text || readerTextSupported(text, coverage.notes)) ? coverage.notes : null;
  return { ...coverage, notes, evidenceVerified: ok && coverage.evidenceVerified === true };
}
function tokenShare(line: string, evidence: string) {
  const want = [...new Set(nameKey(evidence).split(" ").filter((t) => t.length > 1))];
  if (!want.length) return 0;
  const have = new Set(nameKey(line).split(" "));
  return want.filter((t) => have.has(t)).length / want.length;
}
function currencyOk(line: string, currency: string) {
  const code = currency.toUpperCase();
  if (code === "SGD") return /S\$|SGD|SG\$/i.test(line) || !/US\$|USD|RM|MYR|€|£|HK\$/i.test(line);
  if (code === "USD") return /US\$|USD/i.test(line);
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
