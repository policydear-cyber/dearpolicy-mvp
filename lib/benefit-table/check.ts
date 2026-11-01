/** The benefit table, step 1b: the server's checks on one document's reading. Pure.
 *
 * A row is kept only when its own words are printed in this document: the quote is found on a stored page (the page
 * shown is where it was found, never the model's page number), every figure the row carries is printed in that quote,
 * and a fixed base ("% of S$5,000") is printed on the same page. A cover row also needs the person's name printed on
 * its page. A currency is only one the quote (or the base, or a currency the page declares for its table) prints; a
 * bare "$" stays unresolved. A condition is kept only when its words are printed in this document. Everything dropped
 * is listed with the reason, so a reading can be audited. */
import { normalizePersonName } from "@/lib/insurance";
import { categoryOfBenefit } from "@/lib/coverage/table-figures";
import { planTypeOfPages, type PlanType } from "@/lib/coverage/plan-type";
import { nameOnPage, otherLife } from "./lives";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { ANY_MONEY_FIGURE, MONEY_SIGN, anyMoneyFigures } from "@/lib/format/currency";
import { printedDay } from "./dates";
import { NO_SCALE_AFTER, printedNumber } from "@/lib/format/printed-number";
import { CAPPED, locateQuote, pageCurrency } from "@/lib/simple-chat/verify";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { BASES, DOCUMENT_KINDS, PAYS, PERCENT_OF, PERIODS, type ReadBenefit, type ReadCover, type Reading } from "./reading";

/** people: the household's member names, so a page naming another member is known (only the premium check uses it). */
export type SourceDoc = { id: string; name: string; readable: boolean; pages: { page: number; text: string }[]; people?: string[] };
export type Source = { documentId: string; document: string; page: number; excerpt: string };
/** premiumSource: where the premium is printed, when not on the cover's own line (a schedule's "Instalment Premium : 470.85"),
 * and premiumLabel the words that line prints before it ("Instalment Premium"). */
export type CheckedCover = ReadCover & { source: Source; currency: string | null; premiumSource?: Source | null; premiumLabel?: string | null;
  /** Said with the premium when its page also prints a first-year premium ('First Year Instalment Premium * : 376.68'). */
  premiumNote?: string | null;
  /** A premium taken from its page's premium line has the currency that line or its page settles, never the cover's
   * (Critic R126-4); unset, the premium has the cover's currency. */
  premiumCurrency?: string | null;
  /** The first policy year's premium, when the premium's page prints exactly one first-year premium line with a figure
   * ("First Year Instalment Premium * : 376.68"), and that line's words. */
  firstYearPremium?: number | null; firstYearSource?: Source | null; firstYearLabel?: string | null;
  /** The policy's start as the first-year premium's page labels it ("Policy Effective Date : 19/10/2026"), when that page
   * prints exactly one such date: the first policy year runs from it. */
  firstYearFrom?: string | null;
  /** The premium's parts as the cover's own schedule line prints them: the benefit's own premium on its line, then each
   * extra charged on it on the lines below ("- Health Extra --- 201.80"). Set only when the parts add up exactly to the
   * premium (premiumPartsOf). */
  premiumParts?: { label: string | null; amount: number; source: Source }[] | null };

/** A premium line the table may use on its own: a plain premium for the whole policy ("Premium", "Instalment Premium",
 * "Premium paid", "Total Premium"). A line that qualifies it ("First Year Instalment Premium *", "Rider Premium",
 * "Instalment Premium (Life Assured 2)") is about part of the premium or another life, so it is never used (Critic R108-2,
 * TE #97). */
/** A premium line's figure, in any currency, and everything after it. */
const PREMIUM_FIGURE_ON = new RegExp(String.raw`${MONEY_SIGN}?\s*\d[\d,]*(?:\.\d+)?.*$`);
const PLAIN_PREMIUM = /^(?:(?:total|annual|yearly|monthly|quarterly|half[\s-]yearly|modal|instalment|installment)\s+)?(?:premium|instalment|installment)(?:\s+(?:paid|payable|amount))?$/i;
const premiumLineLabel = (line: string, value: number) => {
  const at = [...line.matchAll(/\d[\d,]*(?:\.\d+)?/g)].find((m) => Math.abs(Number(m[0].replace(/,/g, "")) - value) < 0.005);
  return at ? line.slice(0, at.index).replace(new RegExp(String.raw`${MONEY_SIGN}\s*$`, "i"), "").replace(/[\t:]+/g, " ").replace(/\s+/g, " ").trim() : null;
};
/** A policy's start date as a schedule labels it: "Policy Effective Date : 19/10/2026", "POLICY START DATE 27 JUN 2020",
 * "Commencement Date: 1 March 2026". */
const POLICY_START = /\b(?:policy\s+(?:effective|start|commencement|inception)\s+date|(?:risk\s+)?commencement\s+date|date\s+of\s+commencement)[ \t]*[\t:][ \t:]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}[ \t]+[A-Za-z]{3,9}\.?,?[ \t]+\d{4})/gi;
/** A schedule cell holding a premium: a figure with cents ("269.05"), never a date or a whole sum. */
const PREMIUM_CELL = /^(?:[A-Z]{0,3}\$|RM\s?|£|€)?\d[\d,]*\.\d{2}$/;
const EMPTY_CELL = /^(?:-+|–+|—+|nil|n\/?a)?$/i;
const DATE_CELL = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
/** The parts of a cover's premium as its schedule line prints them (overnight run 23 Oct, N088, N092):
 *   Comprehensive Critical\t300,000.00\t269.05\t19/10/2036\t...
 *   Illness Benefit
 *   - Health Extra\t---\t201.80\t19/10/2036\t---\t---
 * The cover's line is the one page line whose cells hold its sum insured; its own premium (label null) is that line's one
 * other cell with cents. The extras are the lines just below it (after any wrap of the cover's name) that open with a dash and print no
 * sum, and exactly one cell with cents. Given only when the parts add up to the premium to the cent: anything else (two
 * lines with the sum, a second premium-like cell, parts that do not add up) gives none. A part left out is a missing card,
 * never a wrong one. */
export function premiumPartsOf(text: string, sumInsured: number | null, premium: number): { label: string | null; amount: number; line: string }[] | null {
  if (sumInsured == null) return null;
  const lines = text.split("\n");
  const cells = (l: string) => l.split("\t").map((c) => c.trim()).filter(Boolean);
  const value = (c: string) => Number(c.replace(/[^\d.]/g, ""));
  const own = lines.flatMap((l, i) => cells(l).slice(1).some((c) => /^(?:[A-Z]{0,3}\$|RM\s?|£|€)?\d[\d,]*(?:\.\d{2})?$/.test(c) && Math.abs(value(c) - sumInsured) < 0.005) ? [i] : []);
  if (own.length !== 1) return null;
  const at = own[0], line = cells(lines[at]);
  const sumAt = line.findIndex((c, k) => k > 0 && Math.abs(value(c) - sumInsured) < 0.005);
  const basic = line.slice(sumAt + 1).filter((c) => PREMIUM_CELL.test(c));
  if (basic.length !== 1 || !line.slice(sumAt + 1).every((c) => PREMIUM_CELL.test(c) || DATE_CELL.test(c) || EMPTY_CELL.test(c))) return null;
  const parts: { label: string | null; amount: number; line: string }[] = [{ label: null, amount: value(basic[0]), line: lines[at] }];
  for (let i = at + 1; i < lines.length && i <= at + 4; i++) {
    const c = cells(lines[i]);
    // The cover's name wrapped onto its own line ("Illness Benefit"): no cells, no figure.
    if (c.length === 1 && !/\d/.test(c[0]) && !/^[-–—]/.test(c[0]) && i === at + 1) continue;
    const name = /^[-–—]\s*([A-Za-z][A-Za-z &()/'-]{1,40})$/.exec(c[0] ?? "");
    if (!name) break;
    const figures = c.slice(1).filter((x) => PREMIUM_CELL.test(x));
    if (figures.length !== 1 || !c.slice(1).every((x) => PREMIUM_CELL.test(x) || DATE_CELL.test(x) || EMPTY_CELL.test(x)) || !EMPTY_CELL.test(c[1] ?? "")) return null;
    parts.push({ label: name[1].trim(), amount: value(figures[0]), line: lines[i] });
  }
  const total = Math.round(parts.reduce((t, p) => t + p.amount * 100, 0));
  return parts.length > 1 && total === Math.round(premium * 100) ? parts : null;
}
const labelOf = (l: string) => l.replace(/[\t:]+/g, " ").replace(/\s+/g, " ").trim();
/** A premium printed as a figure on a line of its own, with only its currency sign and how often it is paid
 * ("S$399.24 (MONTHLY)"), whose plain premium label is the line just below or above it ("PREMIUM"): a schedule that sets
 * each value over its label. One label line beside it, never two, and a label line holds no figure. */
const STACKED_FIGURE = new RegExp(String.raw`^[ \t]*${MONEY_SIGN}?[ \t]*(\d[\d,]*\.\d{2})[ \t]*(?:\(?[ \t]*(monthly|quarterly|half[\s-]yearly|yearly|annual(?:ly)?|single)[ \t]*\)?)?[ \t]*$`, "i");
/** A schedule's currency row ("CURRENCY\tSINGAPORE DOLLARS", "MATA WANG\tRM"): a key and a currency, nothing else. */
const CURRENCY_ROW = /^[ \t]*(?:currency|mata[ \t]+wang)[ \t]*[\t:][ \t:]*(?:singapore[ \t]+dollars?|(?:us|united[ \t]+states)[ \t]+dollars?|hong[ \t]+kong[ \t]+dollars?|australian[ \t]+dollars?|ringgit(?:[ \t]+malaysia)?|pounds?[ \t]+sterling|euros?|SGD|USD|HKD|AUD|MYR|RM|GBP|EUR)[ \t]*$/i;
export function stackedPremiumLines(text: string): { figureLine: string; label: string; amount: number; frequency: string | null }[] {
  // Blank lines are not read: PDF text puts them between rows, and a figure two lines from its label is still beside it.
  const lines = text.split("\n").filter((l) => l.trim());
  const isLabel = (i: number) => lines[i] != null && !/\d/.test(lines[i]) && PLAIN_PREMIUM.test(labelOf(lines[i]));
  const isFigure = (i: number) => lines[i] != null && STACKED_FIGURE.test(lines[i]);
  // The figure's other side could be the figure's own label (a schedule that prints each label above its value, or a header
  // row of field names over it), so only the page's currency row is harmless there. The label's other side could be the
  // label's own value ("Waived", "S$212.40 per month"), so only the page's edge, the currency row, or a header row of three
  // or more field names with no figure is harmless there (Critic R297 H1, H2; TE pr161 A1-A4, B1-B3).
  const cells = (i: number) => lines[i].trim().split(/\t+|\s*:\s*|\s{2,}/).filter(Boolean).length;
  const figureSideHarmless = (i: number) => lines[i] != null && CURRENCY_ROW.test(lines[i]);
  const labelSideHarmless = (i: number) => lines[i] == null || CURRENCY_ROW.test(lines[i]) || (!/\d/.test(lines[i]) && cells(i) >= 3);
  // Each figure beside exactly one label, and each such label beside exactly one figure: a label between two figures, or a
  // figure between two labels, cannot be told apart, and then the page gives none (TE pr158: two stacked premiums).
  const pairs: { figure: number; label: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isFigure(i)) continue;
    const labels = [i - 1, i + 1].filter(isLabel);
    if (labels.length > 1) return [];
    if (labels.length === 1) pairs.push({ figure: i, label: labels[0] });
  }
  if (pairs.some((p) => [p.label - 1, p.label + 1].filter(isFigure).length !== 1)) return [];
  if (pairs.some(({ figure, label }) => !figureSideHarmless(2 * figure - label) || !labelSideHarmless(2 * label - figure))) return [];
  return pairs.map(({ figure, label }) => {
    const m = STACKED_FIGURE.exec(lines[figure])!;
    return { figureLine: lines[figure], label: labelOf(lines[label]), amount: Number(m[1].replace(/,/g, "")), frequency: m[2] ?? null };
  });
}
/** The page's plain premium lines: a label and its figure on one line ("Instalment Premium : 470.85"), and a figure set over
 * or under its label (stackedPremiumLines). */
const plainPremiumLineCount = (text: string) =>
  text.split("\n").filter((l) => /\d/.test(l) && PLAIN_PREMIUM.test(labelOf(l.replace(/[\t:]+/g, " ").replace(PREMIUM_FIGURE_ON, "")))).length + stackedPremiumLines(text).length;

/** capSource: where the percentage's printed cap is, next to the row. capUnread: the row's words say it is capped ("up to",
 * "whichever is lesser") but no cap was read and checked, so no amount is worked out for it. */
export type CheckedBenefit = ReadBenefit & { source: Source; currency: string | null; baseSource: Source | null; capSource: Source | null; capUnread: boolean; droppedConditions: string[];
  /** The row is the most paid for several benefits' or policies' claims in total (combinedLimit below), not a benefit. */
  combinedLimit?: boolean;
  /** The row is printed under a heading that names the limits of compensation (LIMITS_HEADING). */
  limitsHeading?: boolean };
export type Dropped = { what: string; why: string };
/** periodFrom and periodTo: the document's own period of cover, each kept only when the document prints it. */
export type CheckedReading = { documentId: string; document: string; kind: Reading["document"]["kind"]; product: string | null; plan: string | null; namedPeople: string[];
  periodFrom?: string | null; periodTo?: string | null; covers: CheckedCover[]; benefits: CheckedBenefit[]; dropped: Dropped[];
  /** What the document's own pages say the plan is, when they say savings or investment (lib/coverage/plan-type.ts). */
  planType?: PlanType | null };

// The same lists as evidence.ts's printedFigures (#260): a currency printed right beside a figure, and words before a
// figure that make it a number other than money.
const SIGN_BEFORE = /(?:([A-Z]{3})|[A-Z]{1,2}\$|R\$|Rp\.?|RM|€|£|¥|₹|₩|₱|฿|₫|Fr\.|kr\.?|zł|KD|BD)[ \u00a0\u202f]?$/u;
const SIGN_AFTER = /^[ \u00a0\u202f]?(?:€|£|₫|kr\b|zł|Kč|Ft|lei|([A-Z]{3})(?![A-Za-z]))/u;
// A three-letter code counts only when it is a currency on this closed list: "TPD 1.500" is no money sign.
const DOT_CODES = /^(?:SGD|USD|EUR|GBP|JPY|CNY|HKD|AUD|NZD|CAD|CHF|MYR|IDR|THB|INR|PHP|KRW|TWD|VND|AED|SAR|QAR|BND|MOP|SEK|NOK|DKK|ZAR|BRL|MXN|RUB|TRY|ILS|LKR|PKR|BDT|ARS|CLP|COP|PEN|PLN|CZK|HUF|RON|BHD|KWD|OMR|JOD|TND|LYD|IQD)$/;
// Currencies whose market groups thousands with dots, and the three-decimal ones (KD, BHD): the only signs beside which a
// lone dot group is read whole.
const DOT_MARKET = /^(?:Rp\.?|IDR|€|EUR|R\$|BRL|₫|VND|DKK|TRY|ARS|CLP|COP|RON|lei|KWD|BHD|OMR|JOD|TND|LYD|IQD)$/;
const NOT_MONEY_BEFORE = /\b(?:section|sect\.|table|version|ver\.|v|clause|item|article|art\.|para(?:graph)?|page|p\.|no\.|number|year|years|age|aged|ages|rule|schedule|part|chapter|form|code|ref(?:erence)?|multiplier|factor|rate|ratio|times)\W{0,3}$/i;
/** Every number printed in a text, commas removed ("S$600,000" -> 600000, "1 million" -> 1000000), and a figure grouped
 * with dots read whole ("Rp 500.000.000" -> 500000000). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  let gluedEnd = -2;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*(?:million|m)\b)?/gi)) {
    // Two figures glued together ("13,500.00100,000.00", "181.44181.44") print neither, nor any piece of their tail: which
    // digits belong to which is not known. A rate with more decimals ("1.375") is one figure (Critic R175-a, R176).
    if (m.index! === gluedEnd + 1) { gluedEnd = m.index! + m[1].length; continue; }
    if (/^[.,]\d/.test(text.slice(m.index! + m[1].length)) && /\.\d{3,}$/.test(m[1])) { gluedEnd = m.index! + m[1].length; continue; }
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(m[2] ? n * 1e6 : n);
  }
  // A market that groups thousands with dots ("Rp 500.000.000", "€50.000", "2.400,00") prints its figure whole: read by
  // the one shared figure reader (lib/format/printed-number.ts). Before, such a quote printed no figure, so the whole cover
  // was dropped (cross-page check, 31 Oct). Read only where the quote makes the grouping certain, the rule #260 settled
  // for evidence.ts (Critic #262 H1: "Section 1.500", "Multiplier 1.250", "Policy year 2.026" are no fifteen hundred):
  // a currency printed right beside the figure, or a figure that shows its grouping itself (two or more dot groups, or a
  // ",dd" decimal). Never before a percent sign, "times" or a scale word ("€1.500 million" is no 1,500, and which of
  // 1.5 or 1,500 million is meant is not known, so nothing is read), nor after a section, table, year, rate or factor word.
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\d.,'’])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)(?![\d]|[.,]\d)` + NO_SCALE_AFTER, "g"))) {
    const raw = m[1], at = m.index!, before = text.slice(Math.max(0, at - 24), at), after = text.slice(at + raw.length, at + raw.length + 12);
    if (/^\s*(?:%|per\s*cent|percent|pct|times\b|x\b|×)/i.test(after) || NOT_MONEY_BEFORE.test(before)) continue;
    const sign = (m: RegExpMatchArray | null) => (!m ? null : m[1] ? (DOT_CODES.test(m[1]) ? m[1] : null) : m[0].trim() === "KD" ? "KWD" : m[0].trim() === "BD" ? "BHD" : m[0].trim());
    const code = sign(before.match(SIGN_BEFORE)) ?? sign(after.match(SIGN_AFTER));
    // A lone group ("1.500") is thousands only beside a currency of a market that groups with dots, or a three-decimal one
    // (read as a decimal below): beside S$, US$, RM, £, ₹, HK$ or A$ the dot is a decimal point, so "S$1.500" is no
    // fifteen hundred (TE #262 F1). Two or more groups, or a ",dd" decimal, show their grouping wherever they stand.
    if (!/^\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,2})?$/.test(raw) && !/,\d{1,2}$/.test(raw) && !(code && DOT_MARKET.test(code))) continue;
    // A three-decimal currency beside it ("BHD 1.500", "KD 1.500") reads it as a decimal (printedNumber).
    const n = printedNumber(raw, code);
    if (n != null && !out.includes(n)) out.push(n);
  }
  return out;
}
/** The first paid day a quote states, always next to the word "day": "from the 11th day", "from day 11", "from 11th to
 * 40th day" are day 11, "after the 10th day", "after 10 days" are day 11. undefined when it states none; null when it
 * states more than one, or only a limit ("not payable after the 30th day"). */
export function startDay(text: string): number | null | undefined {
  const days = new Set<number>();
  // "Not payable after the 30th day" is a limit, not a start: a day after a not/no/never in its own clause (up to a comma) never counts,
  // and a quote with only such a limit states no first paid day, whatever was read (TE #108).
  let limit = false;
  const negated = (at: number) => {
    const no = /\b(?:not|no|never|cannot)\b|n['’]t\b/i.test(text.slice(0, at).split(/[.,;:\n]/).pop() ?? "");
    limit ||= no;
    return no;
  };
  for (const m of text.matchAll(/\bfrom\s+(?:the\s+)?(?:day\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+(?:(?:to|-|until)\s+(?:the\s+)?\d+(?:st|nd|rd|th)\s+)?day)\b/gi)) if (!negated(m.index)) days.add(Number(m[1] ?? m[2]));
  // "After" counts only for a day of the stay ("after the 10th day", "after 10 days in hospital"), never a waiting period
  // ("payable after 30 days of continuous cover", Critic R149-1). "Beyond the 30th day" is as often a limit as a start,
  // so it never counts (TE #108 B6).
  for (const m of text.matchAll(/\bafter\s+(?:the\s+)?(?:first\s+)?(?:(\d+)(?:st|nd|rd|th)\s+day\b|(\d+)\s+(?:consecutive\s+)?days?\s+(?:of\s+(?:hospital\w*|confinement|stay|admission)|in\s+(?:the\s+)?hospital)\b)/gi)) if (!negated(m.index)) days.add(Number(m[1] ?? m[2]) + 1);
  return days.size === 0 ? (limit ? null : undefined) : days.size === 1 ? [...days][0] : null;
}
export const printsNumber = (text: string, value: number) => numbersIn(text).some((n) => Math.abs(n - value) < 0.005);

const DECLARED = /\(\s*(S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s*\)|\b(?:amounts?|figures?|limits?)\b[^.\n]{0,40}\b(?:in|are in)\s+(S\$|SGD|Singapore dollars?)/i;
/** The currency a page declares for its table ("Benefits (S$)"), or for every figure on it (a policy schedule's "Currency :
 * Singapore Dollar", the chat's own pageCurrency), or null. */
export function declaredCurrency(pageText: string): string | null {
  const m = pageText.match(DECLARED);
  // "All amounts in Singapore Dollar unless stated otherwise" does not settle a figure's currency (TE #97, R59-5).
  if (!m || /\b(?:unless|otherwise|except)\b/i.test(pageText.slice(m.index!, m.index! + m[0].length + 60))) return pageCurrency(pageText);
  const word = m[1] ?? m[2];
  return /singapore/i.test(word) ? "SGD" : statedCurrencyCode(word);
}

function asHousehold(doc: SourceDoc): Household {
  const d: HouseholdDocument = { policyId: doc.id, name: doc.name, insurer: null, productName: null, policyNumber: null, documentType: null, documentRole: null,
    effectiveDate: null, expiryDate: null, uploadedAt: null, uploadedFor: null, linkedPeople: [], supersededAt: null,
    processingStatus: doc.readable ? "ready" : "failed", pages: doc.pages };
  return { accountId: "", members: [], documents: [d] };
}


/** A printed date ("06/10/2022", "1 June 2040") is kept only when its digits are printed together on the page. */
export function dateOnPage(date: string | null, pageText: string): string | null {
  if (!date) return null;
  const digits = date.match(/\d+/g);
  if (!digits) return null;
  const page = numbersIn(pageText.replace(/[/.-]/g, " ")).map(String);
  return digits.every((d) => page.includes(String(Number(d)))) ? date : null;
}
const squashed = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A row that is a limit on what other benefits pay together, not a benefit of its own: the most an insurer pays for
 * several benefits' claims, or across policies, on one life ("Limits of compensation: most paid for TI and critical
 * illness (CI) claims in total on the same life"). It never pays on an event, so it is never a person's cover in a
 * category, and never what a claim pays (live 27f35c1: a whole-life plan's S$2,000,000 limit row was read as critical
 * illness cover). Decided on the head of the row's own name (before the first ":", dash, bracket or comma), like the
 * accident names of #142: the head must be limit wording ("Limits of compensation", "Overall limit", "Maximum amount
 * payable", "Most paid"), and the name or quote must give a scope wider than one benefit ("the same life", "all policies", "all
 * benefits combined"). A row whose head names a benefit ("TPD benefit: 100% of sum assured, up to S$5,000,000 for all
 * policies on the same life") is that benefit, whatever cap its line adds, and its heading alone never makes it a limit
 * (Critic R251 Q1): a wrong mark here hides real cover. */
const COMPENSATION_LIMIT = /^\s*(?:the\s+)?limits?\s+of\s+compensation\b/i;
/** A heading that names the limits of compensation ("LIMITS OF COMPENSATION", "Benefits and limits of compensation"):
 * its rows are decided when the table is put together, against the cover's sum insured (assemble.ts, TE P150-2). */
export const LIMITS_HEADING = /\blimits?\s+of\s+compensation\b/i;
const LIMIT_HEAD = /^\s*(?:the\s+)?(?:limits?\s+of\s+compensation|(?:overall|aggregate|combined|maximum|total)\s+(?:limit|benefit\s+limit|amount\s+payable)|maximum\s+(?:amount|sum)\s+payable|most\s+(?:paid|payable|we\s+(?:will\s+)?pay))\b/i;
const COMBINED_SCOPE = /\b(?:on|for|of|under|to)\s+the\s+same\s+life\b|\b(?:all|across)\s+(?:of\s+)?(?:the\s+|your\s+|its\s+)?(?:policies|plans|contracts)\b|\btotal\s+of\s+all\s+(?:the\s+)?benefits\b|\ball\s+(?:the\s+)?benefits\s+(?:combined|together|in\s+total|in\s+aggregate)\b/i;
/** A row named as a limit (NAMED_LIMIT) is a limit across policies when its sentence mentions any policy other than this
 * one ("this and other policies", "any other policy", "all our policies", "policies we have issued", "the same life"), or
 * several benefits together: that limit is not what this policy pays, and an unsure mention gives no amount, never a
 * wrong one (TE pr180). "Any policy year" and "other policy years" are periods, not policies. Plans count only as other
 * holdings ("this plan and any other plans", "plans you hold", "plans with us"): a schedule's "same for all plans" or
 * "(all plans)" says its plan columns print the same, not that the limit is shared (Critic R320 H1). */
const OTHER_POLICIES = new RegExp([
  String.raw`\b(?:other|another)\s+(?:of\s+(?:our|your|the)\s+)?(?:polic(?:y|ies)|contracts?)\b(?!\s+(?:years?|periods?|anniversar\w*|months?)\b)`,
  String.raw`\b(?:all|any|every|across)\s+(?:of\s+)?(?:(?:our|your|the|its|such)\s+)?(?:policies|contracts)\b`,
  String.raw`\bpolicies\s+(?:that\s+|which\s+)?we\s+(?:have\s+)?(?:issued?|underwrit\w*)\b`,
  String.raw`\bsame\s+life\b`,
  String.raw`\b(?:this|the)\s+(?:policy|plan)\s+and\s+(?:any\s+|all\s+)?(?:(?:of\s+)?(?:our|your|the)\s+)?other\s+plans?\b`,
  String.raw`\bplans?\s+(?:that\s+|which\s+)?(?:you|we)\s+(?:have\s+)?(?:hold|held|have|issued?|underwrit\w*)\b`,
  String.raw`\bplans?\s+(?:you\s+hold\s+)?with\s+us\b`,
  String.raw`\b(?:all|any|every)\s+(?:of\s+)?your\s+(?:other\s+)?plans\b`,
  String.raw`\btotal\s+of\s+all\s+(?:the\s+)?benefits\b|\ball\s+(?:the\s+)?benefits\s+(?:combined|together|in\s+total|in\s+aggregate)\b`,
].join("|"), "i");
/** Wording that says the limit is this plan's own even though other plans are named ("applies separately to this plan and
 * any other plans you hold", "not shared with any other policies", "claims under other policies do not reduce it"): an
 * allow-list, so the row stays this plan's limit. */
const OWN_LIMIT = /\b(?:appl(?:y|ies|ied)|counted|calculated|assessed)\s+separately\b|\bseparately\s+(?:to|for|under|from)\b|\bnot\s+shared\b|\bdo(?:es)?\s+not\s+(?:reduce|count\s+towards?|affect)\b/i;
/** A row named only as a limit: at most ten words, the last of them "limit", "limits", "cap" or "caps" ("TI/CI limit", "TI
 * benefits limit within the TI/CI limit", "TI/CI cap"). Not "Sub-limit", and not a name that goes on past the word
 * ("Limit of indemnity"), and not a benefit's name that says it is capped. */
const NAMED_LIMIT = (head: string) => { const w = head.trim().split(/\s+/); return w.length <= 10 && /^(?:limits?|caps?)$/i.test(w[w.length - 1] ?? "")
  // A benefit's name that says it is capped ("Critical Illness Benefit limited to the same life cap") is that benefit; a
  // limit's name that says it sits under another ("TI benefits limit subject to the TI/CI limit") is still a limit.
  && !/\b(?:limited|capped|subject)\b/i.test(head.replace(/^.*?\b(?:limits?|caps?)\s+subject\s+to\b/i, "")); };
/** A sentence that opens by pointing at the one before it ("Of this amount, the TI benefits cannot be more than
 * S$1,000,000.", "Out of this limit", "Within the above total"): its scope is that sentence's. */
const POINTS_BACK = /^\s*(?:of|out\s+of|within)\s+(?:this|that|the\s+above|the\s+said)\s+(?:amount|limit|total|sum)\b/i;
/** A sentence's end: a full stop before a space, or a blank line. Not the stop of "i.e.", "e.g.", "etc.", "No." and
 * the like, and not a semicolon, which runs a sentence on (TE pr180 A4, A5). */
const SENTENCE_STOP = /(?<![A-Za-z]\.[A-Za-z])(?<!\b(?:etc|no|nos|vs|approx|incl|cf|ref|art|cl|para|pg|pp))\.(?=\s)|\n\s*\n/gi;
/** Page text read as one line: a word split by its line's end ("poli-\ncies") is joined (TE pr180 A9). */
const asLine = (t: string) => t.replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, "$1$2").replace(/\s+/g, " ").trim();
/** A line a sentence may be read across: printed text with no table cell and no figure of its own (a row, a heading
 * with a figure, another benefit's amount are never crossed: Critic R318 H1). */
const CROSSABLE = (line: string) => !!line.trim() && !line.includes("\t") && !/\d/.test(line);
/** A line that carries on the sentence of the line above: the line above does not end one, and either this line starts
 * in lower case or the line above stops on a word no sentence or heading ends on ("issued by\nKestrel Mutual Life",
 * "on the same life for\nTI and CI claims": TE pr180 A18, A19). */
const CONTINUES = (above: string, line: string) => !/[.!?:]\s*$/.test(above)
  && (/^\s*[a-z(]/.test(line) || /\b(?:by|for|of|on|in|to|with|under|from|at|and|or|the|a|an|any|all|other|our|your|its|their|which|that|than|is|are|be)\s*$/.test(above));
/** The sentence of its page a quote is printed in, with the one before it when it opens by pointing back. It is read
 * only on the quote's own lines and the lines its sentence runs over (each in lower case after one that does not end, no
 * table cell, no figure): a heading, a table row or another clause beside the quote is never its sentence. */
export function quoteSentence(pageText: string, start: number, end: number): string {
  const lines: { from: number; text: string }[] = [];
  for (let at = 0; at <= pageText.length;) { const e = pageText.indexOf("\n", at); const to = e < 0 ? pageText.length : e; lines.push({ from: at, text: pageText.slice(at, to) }); at = to + 1; }
  const lineOf = (pos: number) => { let k = 0; while (k + 1 < lines.length && lines[k + 1].from <= pos) k++; return k; };
  let first = lineOf(start), last = lineOf(Math.max(start, end - 1));
  const own = lines.slice(first, last + 1).some((l) => l.text.includes("\t"));
  if (!own) {
    while (first > 0 && CONTINUES(lines[first - 1].text, lines[first].text) && CROSSABLE(lines[first - 1].text)) first--;
    while (last + 1 < lines.length && CONTINUES(lines[last].text, lines[last + 1].text) && CROSSABLE(lines[last + 1].text)) last++;
  }
  const blockFrom = lines[first].from, block = pageText.slice(blockFrom, lines[last].from + lines[last].text.length);
  const qs = start - blockFrom, qe = Math.min(block.length, end - blockFrom);
  const before = block.slice(0, qs), after = block.slice(qe);
  const starts = [...before.matchAll(SENTENCE_STOP)].map((m) => m.index! + m[0].length);
  const from = starts.length ? starts[starts.length - 1] : 0;
  const tail = [...(after.replace(/\s+$/, "") + " ").matchAll(SENTENCE_STOP)][0];
  const sentence = asLine(before.slice(from) + block.slice(qs, qe) + after.slice(0, tail ? tail.index! + 1 : after.length));
  if (!POINTS_BACK.test(sentence) || starts.length < 1) return sentence;
  const prior = asLine(before.slice(starts.length > 1 ? starts[starts.length - 2] : 0, from));
  return `${prior} ${sentence}`;
}
export function combinedLimit(b: { benefit: string; section?: string | null; quote?: string | null; sentence?: string | null }): boolean {
  return limitKind(b) === "combined";
}
/** "combined": a limit on several benefits together (above). "benefit_cap": limit wording whose head also names one
 * benefit ("Total amount payable for death: S$500,000 for all plans"): the row is that benefit, and its cap is said with
 * it as a condition (Critic R253 L1). null: neither. */
export function limitKind(b: { benefit: string; section?: string | null; quote?: string | null; sentence?: string | null }): "combined" | "benefit_cap" | null {
  const head = b.benefit.split(/\(|\s[-–—]\s|[,;:]/)[0];
  // A row named only as a limit whose own sentence on the page (or name, or quote) caps several policies on one life ("The
  // most we will pay ... for the policy and other policies ... is S$2,000,000 (the TI/CI limit)") is that limit, never what
  // the policy pays (audit of 1912d73: such a row showed "up to S$2,000,000" as a terminal illness card). Its figure is
  // the limit itself, so it is combined even when it names one benefit.
  if (!LIMIT_HEAD.test(head) && NAMED_LIMIT(head)) {
    const text = asLine([b.benefit, b.quote ?? "", b.sentence ?? ""].join("\n"));
    return !OWN_LIMIT.test(text) && OTHER_POLICIES.test(text) ? "combined" : null;
  }
  if (!LIMIT_HEAD.test(head) || !COMBINED_SCOPE.test([b.benefit, b.quote ?? ""].join("\n"))) return null;
  // "Limits of compensation" names only the limit, whatever benefit follows it; other limit wording that names a benefit
  // ("Total amount payable for death") is that benefit.
  return COMPENSATION_LIMIT.test(head) || !categoryOfBenefit(head) ? "combined" : "benefit_cap";
}

/** The currency of the row's own figure ("Up to S$8,000, capped at US$200 per day": S$ for 8,000), never another figure's on
 * the line (TE pr157 F1, F3). A figure printed without one (a bare "$") or not found takes the page's declared currency; a figure
 * printed in more than one way ("S$8,000 (US$8,000 if overseas)", or "$8,000" beside "S$8,000") has none. */
function figureCurrency(excerpt: string, value: number, page: string): string | null {
  const text = plainText(excerpt);
  const codes = new Set(anyMoneyFigures(text).filter((f) => Math.abs(f.value - value) < 0.005).map((f) => statedCurrencyCode(text.slice(f.index, f.index + f.length))));
  if (codes.size > 1) return null;
  return [...codes][0] ?? declaredCurrency(page);
}
/** Words that say a figure is capped: a percentage row with them pays at most a printed limit. */
export const CAP_WORDS = /\bup\s+to\b|\bmax(?:imum)?\b|\bwhichever\s+is\s+(?:the\s+)?(?:lower|lesser|less|smaller)\b|\bnot\s+(?:to\s+)?exceed|\blimited\s+to\b|\bcapped\b|\bsubject\s+to\s+(?:a\s+)?(?:maximum|limit)\b/i;
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The money figures of a row, in any currency (S$, RM, £, € or a code such as MYR or GBP, and a bare "$"), with where
 * each starts in flat(row). A row in ringgit or pounds is read as one in Singapore dollars is: its cap, and a second
 * limit beside it, count the same way (parity test, 25 Oct: "up to RM 200,000 or RM 100,000 after age 65" kept the
 * RM 200,000 cap that the same row in S$ refuses). */
/** NFKC without footnote marks: a superscript after a figure ("S$400,000¹") is never part of it (TE round 3). */
const plainText = (s: string) => s.replace(/[\u00B9\u00B2\u00B3\u2070-\u2079]/g, "").normalize("NFKC");
function moneyIn(row: string): { value: number; index: number; length: number }[] {
  return anyMoneyFigures(plainText(row).replace(/\s+/g, " ").trim());
}
/** The one money figure a percentage row's own words cap it at: printed right after a cap word, and the only money figure in
 * the row. Null otherwise. */
function capInRow(row: string): number | null {
  const text = flat(plainText(row)), found = moneyIn(row);
  const values = new Set(found.map((m) => m.value));
  if (values.size !== 1 || !found.length) return null;
  // A cap for some insured persons only ("Child: limited to S$50,000", "maximum S$200,000 above age 70") is not the row's
  // (Critic R169-1).
  if (/\b(?:child(?:ren)?|juveniles?|minors?|adults?|age[ds]?|years?\s+old|spouses?|dependants?|elderly|above|below|over|under)\b/.test(text)) return null;
  const before = text.slice(Math.max(0, found[0].index - 70), found[0].index);
  const after = text.slice(found[0].index + found[0].length, found[0].index + found[0].length + 30);
  // An excess ("subject to an excess not exceeding S$100") is not a cap, and a cap for each day or item ("up to S$200 per
  // day") is not the row's whole amount (TE pr113 A2, A11).
  if (/\b(?:excess|deductible|co-?pay\w*|co-?insurance)\b/.test(before)) return null;
  if (/^\s*(?:(?:per|a|an|each|every|for\s+(?:each|every)|\/)\s*(?:day|week|month|year|night|hour|visit|session|item|article|tooth|treatment)\b|daily\b)/.test(after)) return null;
  return /(?:\bup\s+to|\bmax(?:imum)?(?:\s+amount)?(?:\s+of)?|\bcapped\s+at|\bnot\s+(?:to\s+)?exceed(?:ing)?|\blimited\s+to)\b[^%\d]{0,60}$/.test(before) ? [...values][0] : null;
}
const otherMoneyThan = (row: string, cap: number) => moneyIn(row).some((m) => m.value !== cap);
// Signs that a line is another row: an item marker ("(b)", "ii.", "3)"), its own percentage, an upper-case label with a
// figure, or tab-separated cells (Critic R96-1, R98-1, R99).
const ITEM_MARKER = /^[ \t]*\(?(?:[a-z]{1,3}|[ivx]{1,5}|\d{1,3})[.)]\s/i;
// A following line goes on with the row only when it starts with a connective or a cap word, optionally after "(":
// "or up to S$50,000, whichever is lesser", "(max. S$5,000)", "subject to a maximum of ...". Nothing else joins (TE L12-L14).
const CONNECTIVE = /^[ \t,;:(]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|min(?:imum)?|limit(?:ed)?|not\s+(?:to\s+)?exceed(?:ing)?|capped)\b/i;
const TAB_CELLS = /\S\t+\S/;
const PERCENT = /\d\s*%/;
/** A cell with a percentage or a money figure in any currency. */
const FIGURE_IN_CELL = new RegExp(String.raw`\d\s*%|${ANY_MONEY_FIGURE}`, "u");
const LABEL_FIGURE = new RegExp(String.raw`^[ \t,;:]*[A-Za-z][A-Za-z'&/ -]*?\s(?:${ANY_MONEY_FIGURE})`, "u");
/** How many lines below the row are looked at for a cap that was not joined to it. */
const LINES_BELOW = 3;
/** The row as printed, and the text near it whose cap words withhold the row's amount unless a cap is tied to the row.
 * text: the quoted words (by their place on the page); then, from the rest of their line, the part up to the next tab
 * cell or the next label with a percentage, when it starts with a connective or cap word; then up to three following
 * lines that start with a connective or cap word and have no tab cells or percentage of their own.
 * near: the whole rest of the row's own line, never filtered (TE L22), every line below that starts with a connective
 * or cap word, and any other of the next three lines that does not plainly start another row, up to the first that
 * does. Cap words (NEAR_CAP) in it mark the row capped, so it shows no amount rather than a neighbour's cap or an
 * uncapped figure. otherPercent: a second percentage limit printed with the row's own cap. */
function rowSegment(pageText: string, start: number, end: number): { text: string; near: string; otherPercent: boolean } {
  const lineEnd = (i: number) => { const e = pageText.indexOf("\n", i); return e < 0 ? pageText.length : e; };
  let seg = pageText.slice(start, end);
  const near: string[] = [];
  // Another percentage on the row's own line or on a connective line below ("… up to S$50,000 or 10% of annual salary,
  // whichever is lower") is a second limit: the row withholds its amount even with its cap read (Critic R101-2).
  let otherPercent = false;
  const tail = pageText.slice(end, lineEnd(end));
  if (tail.trim()) {
    // A tab cell holding its own label and then a cell with its own percentage is the next row ("Hip\t75%\tWrist\t20% up
    // to S$5,000"): its limit is that row's, not near this one (follow-up to TE L22 control). A label with a cap word
    // ("Payable up to\t50% of S$100,000") or starting with a connective ("Or\t10% …") may be this row's limit, so it
    // stays near (Critic R105, TE layout 32).
    const nextRowCells = tail.match(/^\t+([A-Z][^\t%\d]*)\t+[^\t]*\d\s*%/);
    if (!nextRowCells || CONNECTIVE.test(nextRowCells[1]) || NEAR_CAP.test(nextRowCells[1])) near.push(tail);
    // In a two-column extraction the rest of the line may hold the next row (TE L19-L23): only the part before the next
    // tab cell or the next label with a percentage can be this row's.
    const cell = tail.split("\t").find((c) => c.trim()) ?? "";
    // The next row starts with an upper-case label; "or 10% of annual salary" is this row's second limit (Critic R101-2).
    // A label never starts with a connective: "Or 10% of annual salary" is still this row's (Critic R102-2).
    const next = [...cell.matchAll(/\s+([A-Z][^%\d]*\d+(?:\.\d+)?\s*%)/g)].find((m) => !CONNECTIVE.test(m[1]))?.index ?? -1;
    const own = next < 0 ? cell : cell.slice(0, next);
    otherPercent = PERCENT.test(own);
    if (CONNECTIVE.test(own) && !PERCENT.test(own)) seg += own;
  }
  let pos = lineEnd(end);
  let joining = true;
  for (let k = 0, below = 0; pos < pageText.length && below < LINES_BELOW && k < 3 + LINES_BELOW; k++) {
    const line = pageText.slice(pos + 1, lineEnd(pos + 1));
    pos = lineEnd(pos + 1);
    if (!line.trim()) { joining = false; continue; }
    // A line with its own percentage is never joined, even after "Maximum" ("Maximum Disablement 20% up to S$5,000").
    if (joining && k < 3 && CONNECTIVE.test(line) && !TAB_CELLS.test(line) && !PERCENT.test(line)) { seg += " " + line; continue; }
    joining = false;
    below++;
    if (CONNECTIVE.test(line) && PERCENT.test(line)) otherPercent = true;
    if (CONNECTIVE.test(line) || !otherRow(line)) near.push(line);
    // Lines after the next row belong to it ("Knee 10%\nElbow 10%\nAmbulance up to S$500"): stop there (TE control).
    else break;
  }
  return { text: seg, near: near.join("\n"), otherPercent };
}
// A line below that plainly starts another row has its own limit, not this row's: an item marker or its own percentage
// ("Wrist 20% up to S$5,000"), tab cells with a figure ("•\tAmbulance Cost*\tUp to S$500"), or an upper-case label with
// a figure. A lower-case line ("which is payable up to S$50,000") may be this row's limit (Critic R99-1, TE L12-L14).
const otherRow = (l: string) => (TAB_CELLS.test(l) && FIGURE_IN_CELL.test(l))
  || ITEM_MARKER.test(l) || PERCENT.test(l) || (/^[ \t]*[A-Z]/.test(l) && LABEL_FIGURE.test(l) && !NEAR_CAP.test(l));
/** Cap words near a row, including a bare "limit" ("Per accident limit S$50,000", Critic R100). An upper-case line with
 * a figure and these words may go on with the row's own cap ("Payable up to S$50,000 per accident"). */
const NEAR_CAP = new RegExp(`${CAP_WORDS.source}|\\blimit\\b`, "i");

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function checkReading(doc: SourceDoc, raw: unknown): CheckedReading {
  const r = (raw ?? {}) as Partial<Reading>;
  const d = (r.document ?? {}) as Partial<Reading["document"]>;
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(d.kind as string) ? d.kind! : "other";
  const out: CheckedReading = { documentId: doc.id, document: doc.name, kind, product: str(d.product), plan: str(d.plan),
    namedPeople: Array.isArray(d.namedPeople) ? d.namedPeople.filter((n): n is string => !!str(n)) : [], covers: [], benefits: [], dropped: [] };
  // The document's period of cover counts only where a page prints it.
  const printedPeriod = (v: unknown) => doc.pages.map((p) => dateOnPage(str(v), p.text)).find(Boolean) ?? null;
  out.periodFrom = printedPeriod(d.periodFrom); out.periodTo = printedPeriod(d.periodTo);
  out.planType = planTypeOfPages(doc.pages);
  const household = asHousehold(doc);
  const pageText = (n: number) => doc.pages.find((p) => p.page === n)?.text ?? "";
  // Where on its page each located quote is printed, for reading the row around it.
  const placed = new Map<Source, { start: number; end: number }>();
  const lineEndAt = (text: string, i: number) => { const e = text.indexOf("\n", i); return e < 0 ? text.length : e; };
  // A label cell that wraps onto the next line ("Comprehensive Critical\t300,000.00\t269.05\nIllness Benefit"), copied
  // whole by the model ("Comprehensive Critical\tIllness Benefit\t300,000.00\t269.05"): the row is its own line without
  // that cell, and only when the very next line prints that cell alone, with no figure. One reading only.
  const wrappedLabel = (quote: string) => {
    const cells = quote.split("\t");
    const flatten = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const hits = [];
    for (let j = 1; j < cells.length - 1; j++) {
      if (!/[a-z]/i.test(cells[j]) || /\d/.test(cells[j]) || !/[a-z]/i.test(cells[0])) continue;
      const g = locateQuote(household, [...cells.slice(0, j), ...cells.slice(j + 1)].join("\t"), 0);
      if (!g || g.excerpt.includes("\n")) continue;
      const text = pageText(g.page), end = lineEndAt(text, g.offset);
      if (flatten(text.slice(end + 1, lineEndAt(text, end + 1))) === flatten(cells[j])) hits.push(g);
    }
    return hits.length === 1 ? hits[0] : null;
  };
  const find = (quote: string | null, page: number | null): Source | null => {
    if (!quote) return null;
    const f = locateQuote(household, quote, 0) ?? wrappedLabel(quote);
    if (!f) return null;
    const at = (g: { page: number; excerpt: string; offset: number; end?: number }) => {
      const src: Source = { documentId: doc.id, document: doc.name, page: g.page, excerpt: g.excerpt };
      placed.set(src, { start: g.offset, end: g.end ?? lineEndAt(pageText(g.page), g.offset) });
      return src;
    };
    // The page the words are on, which is shown; the model's page only breaks a tie (locateQuote takes the first page).
    if (page != null && f.page !== page) {
      const onStated = locateQuote({ ...household, documents: [{ ...household.documents[0], pages: doc.pages.filter((p) => p.page === page) }] }, quote, 0);
      if (onStated) return at({ ...onStated, page });
    }
    return at(f);
  };
  const segmentOf = (src: Source) => { const p = placed.get(src); return p ? rowSegment(pageText(src.page), p.start, p.end) : { text: src.excerpt, near: "", otherPercent: false }; };

  for (const c of Array.isArray(r.covers) ? r.covers : []) {
    const label = `cover "${c?.cover}" for ${c?.person}`;
    const person = str(c?.person), product = str(c?.product), cover = str(c?.cover), quote = str(c?.quote);
    if (!person || !product || !cover || !quote) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(c.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    if (!nameOnPage(person, pageText(source.page))) { out.dropped.push({ what: label, why: "person's name not printed on that page" }); continue; }
    const sumInsured = num(c.sumInsured);
    if (sumInsured != null && !printsNumber(source.excerpt, sumInsured)) { out.dropped.push({ what: label, why: `sum insured ${sumInsured} not printed in the quote` }); continue; }
    let premium = num(c.premium);
    // A premium printed on its own line counts only on the cover's own page, on a line that says it is a premium.
    let premiumSource: Source | null = null, premiumLabel: string | null = null;
    // A premium equal to the cover's sum insured is not proved by the quote that prints the sum insured: it needs its own
    // premium line (TE pr161 R1), and a stacked figure equal to the sum insured is not one (TE pr162 S1).
    if (premium != null && (!printsNumber(source.excerpt, premium) || (sumInsured != null && Math.abs(premium - sumInsured) < 0.005))) {
      const at = find(str(c.premiumQuote), source.page);
      const stacked = at && at.page === source.page ? stackedPremiumLines(pageText(source.page)).find((x) => x.figureLine.trim() === at.excerpt.trim() && Math.abs(x.amount - premium!) < 0.005 && (sumInsured == null || Math.abs(x.amount - sumInsured) >= 0.005)) : undefined;
      const said = stacked ? stacked.label : at && !at.excerpt.includes("\n") ? premiumLineLabel(at.excerpt, premium) : null;
      // One plain premium line on the page: two (one per life, or per policy on a combined schedule) cannot be told apart.
      if (at && at.page === source.page && said && PLAIN_PREMIUM.test(said) && plainPremiumLineCount(pageText(source.page)) === 1 && !otherLife(pageText(source.page), person, doc.people ?? [])) { premiumSource = at; premiumLabel = said; }
      else { out.dropped.push({ what: label, why: `premium ${premium} not printed in the quote or on the page's one plain premium line for this life only; kept the cover without it` }); premium = null; }
    }
    const currency = sumInsured == null && premium == null ? null
      : statedCurrencyCode(source.excerpt) ?? (premiumSource ? statedCurrencyCode(premiumSource.excerpt) : null) ?? declaredCurrency(pageText(source.page));
    const page = pageText(source.page);
    const policyNumber = str(c.policyNumber) && squashed(page).includes(squashed(str(c.policyNumber)!)) ? str(c.policyNumber) : null;
    out.covers.push({ person, product, cover, plan: str(c.plan), riderOf: str(c.riderOf), policyNumber, sumInsured, premium,
      premiumFrequency: premium == null || !str(c.premiumFrequency) || !squashed(page).includes(squashed(str(c.premiumFrequency)!)) ? null : str(c.premiumFrequency), asOf: dateOnPage(str(c.asOf), page),
      startDate: dateOnPage(str(c.startDate), page), endDate: dateOnPage(str(c.endDate), page), page: source.page, quote, source, currency, premiumSource, premiumLabel });
  }
  // A premium the reading did not give is taken from the cover's page when the page prints exactly one plain premium line
  // and names no other life, the same test as a premium the reading gave (release-set A6: "Instalment Premium : 470.85",
  // "Premium paid : S$73.17"). It goes on the first cover of that page and person only, as one premium is for the policy.
  const seen = new Set<string>();
  for (const c of out.covers) {
    const key = `${c.page}|${normalizePersonName(c.person)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.covers.some((o) => o.page === c.page && normalizePersonName(o.person) === normalizePersonName(c.person) && o.premium != null)) continue;
    const text = pageText(c.page);
    const lines = text.split("\n").filter((l) => /\d/.test(l) && PLAIN_PREMIUM.test(labelOf(l.replace(/[\t:]+/g, " ").replace(PREMIUM_FIGURE_ON, ""))));
    const stacked = stackedPremiumLines(text);
    if (lines.length + stacked.length !== 1 || otherLife(text, c.person, doc.people ?? [])) continue;
    const line = lines[0] ?? stacked[0].figureLine;
    const amount = new RegExp(String.raw`^[^\d]*?${MONEY_SIGN}?\s*(\d[\d,]*(?:\.\d+)?)`).exec(line);
    const premium = amount ? Number(amount[1].replace(/,/g, "")) : NaN;
    // A stacked figure equal to the cover's sum insured may be the sum insured set over the wrong label: never the premium.
    if (!Number.isFinite(premium) || premium <= 0 || (stacked.length && c.sumInsured != null && Math.abs(premium - c.sumInsured) < 0.005)) continue;
    const at = find(line.trim(), c.page);
    const said = !at || at.page !== c.page || at.excerpt.includes("\n") ? null : stacked.length ? stacked[0].label : premiumLineLabel(at.excerpt, premium);
    if (!at || !said || !PLAIN_PREMIUM.test(said)) continue;
    const currency = statedCurrencyCode(at.excerpt) ?? declaredCurrency(text);
    if (c.currency && currency && c.currency !== currency) continue;
    const frequencies = [...text.matchAll(/\b(?:payment|premium)\s+(?:frequency|mode)\s*[\t:]+\s*(monthly|quarterly|half[\s-]yearly|yearly|annual(?:ly)?|single)\b/gi)].map((m) => m[1]);
    c.premium = premium; c.premiumSource = at; c.premiumLabel = said; c.premiumCurrency = currency;
    // A stacked premium's own line may say how often it is paid ("S$399.24 (MONTHLY)").
    if (stacked[0]?.frequency) frequencies.push(stacked[0].frequency);
    c.premiumFrequency = new Set(frequencies.map((f) => f.toLowerCase())).size === 1 ? frequencies[0] : null;
  }
  // The premium line's page also printing a first-year premium (a first-year discount): the plain premium is not what is
  // paid in the first policy year, so the row says so (release-set A6).
  // That first-year premium is given too, when the page prints it once, as a figure on a line of its own (release-set A6:
  // the schedule's 376.68): from the same page and person as the premium, so the same tests hold.
  for (const c of out.covers) {
    if (c.premium == null) continue;
    const page = (c.premiumSource ?? c.source).page;
    if (!/^[ \t]*first[ \t]+(?:policy[ \t]+)?year\b[^\n]*\bpremium/im.test(pageText(page))) continue;
    c.premiumNote = "the page prints a different premium for the first policy year";
    const lines = pageText(page).split("\n").filter((l) => /^[ \t]*first[ \t]+(?:policy[ \t]+)?year\b[^\n]*\bpremium/i.test(l));
    const m = lines.length === 1 ? new RegExp(String.raw`^[ \t]*(first[ \t]+(?:policy[ \t]+)?year[^\d\n]*?\bpremium)[ \t*]*[:\t][ \t]*${MONEY_SIGN}?[ \t]*(\d[\d,]*\.\d{2})[ \t]*$`, "i").exec(lines[0]) : null;
    const at = m ? find(lines[0].trim(), page) : null;
    if (!m || !at || at.page !== page || otherLife(pageText(page), c.person, doc.people ?? [])) continue;
    c.firstYearPremium = Number(m[2].replace(/,/g, "")); c.firstYearSource = at; c.firstYearLabel = m[1].replace(/\s+/g, " ").trim();
    // The day the first policy year starts, from the same page: a policy start labelled as such, never an issue or letter
    // date. Two different such dates on the page give none (Critic R284 M3).
    const starts = [...pageText(page).matchAll(POLICY_START)].map((x) => x[1].trim());
    c.firstYearFrom = new Set(starts.map((x) => printedDay(x))).size === 1 && printedDay(starts[0]) != null ? starts[0] : null;
  }

  for (const c of out.covers) {
    if (c.premium == null || (c.premiumSource && c.premiumSource.page !== c.page) || otherLife(pageText(c.page), c.person, doc.people ?? [])) continue;
    const parts = premiumPartsOf(pageText(c.page), c.sumInsured, c.premium);
    const sources = parts?.map((p) => find(p.line.trim(), c.page));
    if (parts && sources && sources.every((s) => s && s.page === c.page))
      c.premiumParts = parts.map((p, i) => ({ label: p.label, amount: p.amount, source: sources[i]! }));
  }

  for (const b of Array.isArray(r.benefits) ? r.benefits : []) {
    const label = `benefit "${b?.benefit}"${b?.column ? ` [${b.column}]` : ""}`;
    const benefit = str(b?.benefit), quote = str(b?.quote);
    const pays = (PAYS as readonly string[]).includes(b?.pays as string) ? b.pays : null;
    if (!benefit || !quote || !pays) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(b.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    let value = num(b.value);
    if (value != null && !printsNumber(source.excerpt, value)) { out.dropped.push({ what: label, why: `figure ${value} not printed in the quote` }); continue; }
    const FIGURED = ["amount", "up_to", "per_day", "per_period", "percent", "value"];
    if (FIGURED.includes(pays) && value == null) { out.dropped.push({ what: label, why: `"${pays}" row with no figure` }); continue; }
    if (!FIGURED.includes(pays)) value = null;
    const period = pays === "per_period" && (PERIODS as readonly string[]).includes(b.period as string) ? b.period! : null;
    if (pays === "per_period" && !period) { out.dropped.push({ what: label, why: "payment with no period" }); continue; }
    const basis = (BASES as readonly string[]).includes(b.basis as string) ? b.basis! : null;
    const percentOf = pays === "percent" && (PERCENT_OF as readonly string[]).includes(b.percentOf as string) ? b.percentOf! : null;
    let baseAmount: number | null = null, baseSource: Source | null = null;
    if (percentOf === "fixed_amount") {
      baseAmount = num(b.baseAmount);
      baseSource = find(str(b.baseQuote), source.page);
      if (baseAmount == null || !baseSource || baseSource.page !== source.page || !printsNumber(baseSource.excerpt, baseAmount)) {
        out.dropped.push({ what: label, why: "fixed base not printed on the row's page" }); continue;
      }
    }
    const currency = pays === "percent"
      ? (baseSource ? statedCurrencyCode(baseSource.excerpt) ?? declaredCurrency(pageText(source.page)) : null)
      : value == null ? null : figureCurrency(source.excerpt, value, pageText(source.page));
    const conditions: string[] = [], droppedConditions: string[] = [];
    for (const cond of Array.isArray(b.conditions) ? b.conditions : []) {
      const words = str(cond);
      if (!words) continue;
      (find(words, null) ? conditions : droppedConditions).push(words);
    }
    // A percentage's printed cap is kept only when its words, with the figure, are printed in the row itself or the lines
    // that continue it (never a neighbouring row's limit); a cap that
    // is claimed but not found, or a row whose words say it is capped with no cap read, gets no worked-out amount.
    let cap: number | null = null, capSource: Source | null = null, capUnread = false;
    // A percentage row's quote holds one row: two percentages mean it runs into the next row (R95-2, N3).
    // A percentage in the row's own label ("Burns: greater than 2% but less than 5%") is the label's, not another row's.
    const percents = (t: string) => (t.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length;
    if (pays === "percent" && percents(source.excerpt) > percents(benefit) + 1) { out.dropped.push({ what: label, why: "quote holds more than one row" }); continue; }
    if (pays === "percent") {
      const { text: row, near, otherPercent } = segmentOf(source);
      const claimed = num(b.cap);
      const s = claimed != null && claimed > 0 ? find(str(b.capQuote), source.page) : null;
      const tied = s && claimed != null && s.page === source.page && printsNumber(s.excerpt, claimed) && CAP_WORDS.test(s.excerpt) && flat(row).includes(flat(s.excerpt));
      // Another money figure in the row besides its cap ("up to S$50,000 or S$500 per day, whichever is lower") is a second
      // limit too (Critic R102-1).
      const otherMoney = moneyIn(row).some((m) => m.value !== claimed);
      // "Whichever" with any other number near the row ("or 500 per day, whichever is lower") is a second limit (Critic R103-1).
      // A leading item number ("1. Hip 75%") is the row's own.
      const otherWhichever = /\bwhichever\b/i.test(`${row}\n${near}`)
        && [...`${row.replace(ITEM_MARKER, "")}\n${near}`.matchAll(/\d[\d,]*(?:\.\d+)?/g)].some((m) => ![claimed, value].includes(Number(m[0].replace(/,/g, ""))));
      if (tied && (otherPercent || otherMoney || otherWhichever)) {
        out.dropped.push({ what: label, why: `cap ${claimed} printed with another limit; no amount is worked out for it` });
        capUnread = true;
      } else if (tied) {
        cap = claimed; capSource = s;
      } else if (claimed == null && capInRow(row) != null && !otherPercent && !otherMoneyThan(row, capInRow(row)!) && !NEAR_CAP.test(near)
        && !(/\bwhichever\b/i.test(`${row}\n${near}`) && [...`${row.replace(ITEM_MARKER, "")}\n${near}`.matchAll(/\d[\d,]*(?:\.\d+)?/g)].some((m) => ![capInRow(row), value].includes(Number(m[0].replace(/,/g, "")))))) {
        // No cap read, but the row's own words print exactly one money figure right after a cap word ("100% Sum Insured (up
        // to S$400,000)", "subject to a maximum amount of S$25,000"): that is its cap (overnight run 23 Oct, N016, N083).
        cap = capInRow(row); capSource = source;
      } else {
        if (claimed != null) out.dropped.push({ what: label, why: `cap ${claimed} not printed in the row; no amount is worked out for it` });
        capUnread = claimed != null || CAP_WORDS.test(source.excerpt) || conditions.some((c) => CAP_WORDS.test(c))
          || CAPPED.test(row) || NEAR_CAP.test(near);
      }
    }
    // Day counts are figures too: one the quote does not print is not kept.
    const day = (v: unknown) => { const n = int(v); return n != null && printsNumber(source.excerpt, n) ? n : null; };
    // "Payable after the 10th day" is first paid on day 11: the same day, worded from the day before (live run 23 Oct, B3).
    // The first paid day the quote states, parsed once as a number, is the row's: "after the 10th day" is day 11, "from day
    // 1" is day 1, whatever the reading said (live run 23 Oct, B3; TE #108 B2, B4). A quote that states two is none; one
    // that states none keeps the reading's day when it is printed.
    const firstDay = (v: unknown) => { const printed = pays === "per_day" || int(v) != null ? startDay(source.excerpt) : undefined; return printed === undefined ? day(v) : printed; };
    const fromDay = firstDay(b.fromDay), maxDays = day(b.maxDays);
    const at = placed.get(source);
    const kind = limitKind({ benefit, section: str(b.section), quote: source.excerpt, sentence: at ? quoteSentence(pageText(source.page), at.start, at.end) : null });
    out.benefits.push({ section: str(b.section), column: str(b.column), benefit, pays, value, period, basis, asOf: dateOnPage(str(b.asOf), pageText(source.page)),
      percentOf, baseAmount, baseQuote: str(b.baseQuote), cap, capQuote: cap != null ? str(b.capQuote) : null,
      fromDay, maxDays, conditions: kind === "benefit_cap" && !conditions.includes(source.excerpt) ? [...conditions, source.excerpt] : conditions,
      page: source.page, quote, source, currency, baseSource, capSource, capUnread, droppedConditions, combinedLimit: kind === "combined",
      limitsHeading: LIMITS_HEADING.test(str(b.section) ?? "") });
  }
  return out;
}
