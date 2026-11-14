/** The benefit table, step 1b: the server's checks on one document's reading. Pure.
 *
 * A row is kept only when its own words are printed in this document: the quote is found on a stored page (the page
 * shown is where it was found, never the model's page number), every figure the row carries is printed in that quote,
 * and a fixed base ("% of S$5,000") is printed on the same page. A cover row also needs the person's name printed on
 * its page. A currency is only one the quote (or the base, or a currency the page declares for its table) prints; a
 * bare "$" stays unresolved. A condition is kept only when its words are printed in this document. Everything dropped
 * is listed with the reason, so a reading can be audited. */
import { normalizePersonName } from "@/lib/insurance";
import { SCALE_WORD, printedNumber as scaledFigure, scaleOf } from "@/lib/format/printed-number";
import { categoryOfBenefit } from "@/lib/coverage/table-figures";
import { figuresDifferByPlan, planCellRun } from "@/lib/insurance/scale-limit";
import { planTypeOfPages, type PlanType } from "@/lib/coverage/plan-type";
import { nameOnPage, otherLife } from "./lives";
import { OWN_FIGURE_CHECKS, amountOnlyInContext, figureContextWords, personOnlyInExample, specimenHeading, specimenPage } from "@/lib/documents/own-figure";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { ANY_MONEY_FIGURE, MONEY_SIGN, anyMoneyFigures } from "@/lib/format/currency";
import { printedDay } from "./dates";
import { RIDER_NAME, printsNotionalSum } from "@/lib/documents/notional-sum";
import { namesWaiverRider } from "@/lib/documents/waiver-rider";
import { NO_SCALE_AFTER, printedNumber } from "@/lib/format/printed-number";
import { CAPPED, ORDINAL_DAY, locateQuote, pageCurrency } from "@/lib/simple-chat/verify";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { BASES, DOCUMENT_KINDS, PAYS, PERCENT_OF, PERIODS, type ReadBenefit, type ReadCover, type Reading } from "./reading";

/** A money figure with its sign; a sign is never the end of a word ("FORM 2", "ARM 2"). */
const MONEY = String.raw`(?:(?<![A-Za-z])(?:S\$|US\$|A\$|HK\$|RM)|£|€|(?<![A-Za-z$])\$|\b(?:SGD|USD|MYR|GBP|EUR|AUD|HKD))\s?\d[\d,]*(?:\.\d+)?`;
/** A money cell and the unit printed right after it ("S$200 per day", "S$50/night", "S$100 each", "daily"). */
const UNIT_AFTER = String.raw`(?:\s*(?:\/\s*(day|night|week|month|year|trip)s?\b|(?:per|every)\s+(?:\d+\s+)?([a-z]+)|(each(?:\s+(?:day|night|week|month|year|trip|visit))?)\b|(daily|weekly|monthly|yearly|annually)\b|a\s+(day|night|week|month|year)\b))?`;
const MONEY_WITH_UNIT = new RegExp("(" + MONEY + ")" + UNIT_AFTER, "gi");
const UNIT_NAME: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year", annum: "year", annual: "year", each: "item", item: "item" };
/** Whether the excerpt's line that prints this figure is a row of plan figures (Critic R364, TE pr364): the figure is
 * one of two or more different figures in one unit ("S$5,000 S$10,000", "S$100 per day | S$200 per day", "S$50/night or
 * S$80/night"), however the cells are separated. Figures in different units are a rate and its cap ("S$200 per day up
 * to S$8,000", "S$200 per day S$20,000 per year", "S$100 every 6 hours up to S$1,000"); a sum and its premium, or figures in different currencies, are set
 * aside by figuresDifferByPlan. */
function plansOnValueLine(excerpt: string, value: number): boolean {
  const lines = excerpt.split("\n").filter((l) => printsNumber(l, value));
  return (lines.length ? lines : [excerpt]).some((line) => {
    const cells = [...line.matchAll(MONEY_WITH_UNIT)].map((m) => {
      // "each night" is a nightly rate; "each" alone is per item.
      const unit = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "").toLowerCase().replace(/^each\s+/, "").replace(/s$/, "");
      // A figure after "up to" or "maximum" is a cap, whatever its unit.
      const cap = /\b(?:up to|maximum(?: of)?|max\.?|capped at|limit of)\s*$/i.test(line.slice(0, m.index));
      return { text: m[1], start: m.index!, end: m.index! + m[0].length, amount: Number(m[1].replace(/^[^\d]*/, "").replace(/,/g, "")), unit: cap ? "cap" : UNIT_NAME[unit] ?? unit };
    });
    const at = cells.findIndex((c) => Math.abs(c.amount - value) < 0.005);
    if (at < 0) return false;
    // The run of cells side by side with this one: only separators between them (spaces, tabs, "|", "/", ";", ",", a dash,
    // "or", "and").
    // A figure set off by words ("RM150 per day (RM300 per day if confined in ICU)") is a condition, not another plan.
    // Two caps in one unit side by side ("up to S$500 up to S$1,000") are two plans' caps too.
    // A cell followed by a condition ("S$200 per day in ICU", "... if hospitalised overseas") is that condition's figure,
    // never another plan's (TE pr367).
    const trail = (i: number) => line.slice(cells[i].end, cells[i + 1]?.start ?? line.length);
    const conditionWord = (i: number) => /^\s*,?\s*(in|if|for|when|while|during|after|where|under|upon|on)\b/i.exec(trail(i))?.[1].toLowerCase() ?? null;
    const apart = (i: number) => {
      const between = trail(i);
      const here = conditionWord(i), next = conditionWord(i + 1);
      // Parallel cells that each name what they are for ("S$5,000 for Plan A | S$10,000 for Plan B", "S$500 on Basic,
      // S$1,000 on Premier", "S$100,000 for adults / S$25,000 for children") are plans' or people's cells (Critic R367).
      if (here && here === next && /^(?:for|on|in|under)$/.test(here))
        return /^\s*,?\s*\w+\s+(?:[\w.'&-]+\s*){1,4}?[\s|/;,\-–—]*(?:or\b|and\b)?[\s|/;,\-–—]*$/i.test(between);
      // A condition between two cells sets them apart. Any other run of side-by-side figures is plans, whatever follows
      // it ("S$5,000 | S$10,000 for any one trip", "S$100 per day | S$200 per day for each insured person"), except one
      // closed shape: a rate and a raised rate in the same unit, then the setting the raised rate is for ("S$100 per day
      // and S$200 per day in ICU", "S$100 a day, S$200 a day if in ICU") (TE and Critic, pr367 r4). Fails closed.
      if (here) return false;
      const rates = cells[i].unit && cells[i].unit !== "cap" && cells[i].unit === cells[i + 1].unit;
      // The one closed shape kept: a rate, "and"/"or"/a comma, a raised rate, then the setting it is raised in.
      const setting = /^\s*,?\s*(?:if\s+|while\s+|when\s+)?(?:confined\s+|warded\s+|admitted\s+|staying\s+)?(?:in|to|at)\s+(?:an?\s+|the\s+)?(?:icu|intensive care(?: unit)?|hdu|high dependency(?: unit| ward)?|ccu|coronary care(?: unit)?|isolation(?: ward)?|(?:a\s+)?(?:private\s+)?(?:hospital\s+)?ward|hospital)\b/i;
      if (next && rates && setting.test(trail(i + 1)) && /^\s*(?:,\s*(?:or\b|and\b)?|or\b|and\b)\s*$/i.test(between)) return false;
      if (/^[\s|/;,\-–—]*(?:or\b|and\b)?[\s|/;,\-–—]*$/i.test(between)) return true;
      return cells[i].unit === "cap" && cells[i + 1].unit === "cap" && /^[\s|/;,]*(?:or\s+|and\s+)?(?:up to|maximum(?: of)?|max\.?)\s*$/i.test(between);
    };
    let from = at, to = at;
    while (from > 0 && apart(from - 1)) from--;
    while (to < cells.length - 1 && apart(to)) to++;
    const mine = cells[at];
    const sameUnit = cells.slice(from, to + 1).filter((c) => c.unit === mine.unit);
    if (new Set(sameUnit.map((c) => c.amount)).size < 2) return false;
    // The same cells side by side, for figuresDifferByPlan's sum-and-premium and currency rules.
    return figuresDifferByPlan(line.slice(0, cells[0].start) + "\t" + sameUnit.map((c) => c.text).join("\t"));
  });
}


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
  /** The sum insured the cover's line prints when its page says that sum is not what is paid ("The sum insured ... does
   * not represent the amount to be paid out for claims", lib/documents/notional-sum): kept here for matching only, while
   * sumInsured is null, so no tile, total or share uses it. */
  notionalSum?: number | null;
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
  limitsHeading?: boolean;
  /** "Limited to N% of the Sum Insured" on a document printed for one life names the row's share, not a money cap
   * (ownShareNamed in checkReading): the table may work it out like any other share (assemble.ts baseFigure). */
  ownShareNamed?: boolean;
  /** The currency the row's cap itself prints ("up to S$15,000"), when it prints one: a cap in another currency than the
   * amount it limits cannot be compared with it, so no amount is worked out (assemble.ts). */
  capCurrency?: string | null;
  /** The whole printed line or lines the row's quote is on, and the line after them, as the page prints them (assemble.ts
   * perPersonRow: a row whose own line or the next prints another figure, such as an age or a child's rate, is not every
   * named insured's). Unset when the quote was not placed on its page. */
  rowText?: string; nextLine?: string; prevLine?: string;
  /** The footnote marks printed on the row's column heading ("Limit per insured person*"), on its own words or where the
   * page prints it (headingMarks): assemble.ts reads a per-person column with its note (plain-table gate round 5, R5-H2). */
  columnMarks?: string[] };
export type Dropped = { what: string; why: string };
/** periodFrom and periodTo: the document's own period of cover, each kept only when the document prints it. */
export type CheckedReading = { documentId: string; document: string; kind: Reading["document"]["kind"]; product: string | null; plan: string | null; namedPeople: string[];
  periodFrom?: string | null; periodTo?: string | null; covers: CheckedCover[]; benefits: CheckedBenefit[]; dropped: Dropped[];
  /** What the document's own pages say the plan is, when they say savings or investment (lib/coverage/plan-type.ts). */
  planType?: PlanType | null;
  /** The document's own field lines that say what kind of plan or insured it is ("Coverage type: Family", "Plan: Elite
   * (Family plan)", "Insured: Child"): a field label, then a value naming a family, child, individual or age group. Read by
   * assemble.ts tierProblem; never a benefit row's label. */
  tierLines?: string;
  /** Every person the reading gave a cover to whose name the document prints, kept or dropped: the document's insured lives
   * (assemble.ts lifeLostCover). */
  coverPeople?: string[];
  /** The document's printed lines that name a kind of life or an age ("Benefits for children under 18 are halved", "Note:
   * for insured children the limits are 50% of those shown"), or name an insured person and say something about an amount
   * ("Benefits for Grace Okafor are halved"), and are neither a benefit row's own line nor a cover's own line: notes that
   * may change any row for some of the lives (lifeNotesOf). Read by assemble.ts perPersonRows, where any
   * such note keeps every fixed-amount row of the document from being shown for each named person. */
  lifeNotes?: string[];
  /** The document's printed lines, off a cover's own line, that make a figure one limit shared by all the lives ("Limits are
   * per family unless stated otherwise", "Aggregate limit for all insured persons GBP 10,000"; SHARED_LIMIT): assemble.ts
   * plainTable then gives no fixed row to each named person. */
  sharedNotes?: string[];
  /** The document's printed lines, off every benefit row's and cover's own line, that tie a limit to the lives together
   * ("Limits are per family", "One limit for everyone on this certificate", "For couple plans the limits apply to both
   * insured persons jointly"; tiesLimitToLives, by clause: a tie within a few words of a limit word): assemble.ts gives no row under a per-person column to each named person.
   * Never a row's own "in total" or "combined with travel delay", an aggregate per event or conveyance, "all persons named
   * above" or "total liability ... the limits shown" (per-person-shared gate round 1). */
  tiedNotes?: string[];
  /** The document's note lines that set a cap for the lives together as a multiple of each person's own limit ("For Family
   * Plan, the most we pay for all insured persons combined is twice the limit shown"; capsAsMultiple): each person keeps
   * their per-person rows, with the note as a condition (assemble.ts). */
  capNotes?: string[];
  /** The document's note sentences, off every row, that tie anything to the lives together (TIED_TO_LIVES or livesTogether),
   * with or without a limit word: a per-person row whose label such a sentence names ("Personal liability is shared by the
   * family.") is withheld (assemble.ts perPersonColumnRow; gate round 7). */
  tieLines?: string[];
  /** Each line starting with a footnote mark ("Note (a):", "(b)", "*"), with the line that continues it: a row printing that
   * mark is read with its note (assemble.ts plainTable). */
  footnotes?: { mark: string; text: string }[];
  /** The document's lines outside its benefit rows and cover lines that are none of the closed set of lines a plain family
   * schedule prints (lifeNotesOf structural: title, insurer, policy number and period, the insured persons lines, the
   * premium, column headings, page furniture, admin lines that print no money, share, person, kind of life or word tied to
   * the amounts, and the footnotes a row points to). Any such line keeps assemble.ts plainTable from giving a fixed row to
   * each named person (TE gate round 2: an allow-list, not a list of words to refuse). */
  plainBlockers?: string[];
  /** The money figures printed on the document's premium lines: a row with one of them is never a benefit for each person. */
  premiumFigures?: number[] };

// The same lists as evidence.ts's printedFigures (#260): a currency printed right beside a figure, and words before a
// figure that make it a number other than money.
const SIGN_BEFORE = /(?<![A-Za-z])(?:([A-Z]{3})|[A-Z]{1,2}\$|R\$|Rp\.?|RM|€|£|¥|₹|₩|₱|฿|₫|Fr\.|kr\.?|zł|KD|BD)[ \u00a0\u202f]?$/u;
const SIGN_AFTER = /^[ \u00a0\u202f]?(?:€|£|₫|kr\b|zł|Kč|Ft|lei|([A-Z]{3})(?![A-Za-z]))/u;
// A three-letter code counts only when it is a currency on this closed list: "TPD 1.500" is no money sign.
const DOT_CODES = /^(?:SGD|USD|EUR|GBP|JPY|CNY|HKD|AUD|NZD|CAD|CHF|MYR|IDR|THB|INR|PHP|KRW|TWD|VND|AED|SAR|QAR|BND|MOP|SEK|NOK|DKK|ZAR|BRL|MXN|RUB|TRY|ILS|LKR|PKR|BDT|ARS|CLP|COP|PEN|PLN|CZK|HUF|RON|BHD|KWD|OMR|JOD|TND|LYD|IQD)$/;
// Currencies whose market groups thousands with dots, and the three-decimal ones (KD, BHD): the only signs beside which a
// lone dot group is read whole.
const DOT_MARKET = /^(?:Rp\.?|IDR|€|EUR|R\$|BRL|₫|VND|DKK|TRY|ARS|CLP|COP|RON|lei|KWD|BHD|OMR|JOD|TND|LYD|IQD)$/;
const NOT_MONEY_BEFORE = /\b(?:section|sect\.|table|version|ver\.|v|clause|item|article|art\.|para(?:graph)?|page|p\.|no\.|number|year|years|age|aged|ages|rule|schedule|part|chapter|form|code|ref(?:erence)?|multiplier|factor|rate|ratio|times)\W{0,3}$/i;
const RUN_SPACE = "[ \\u00a0\\u202f]";
/** A word right after a figure that makes it a count or part of a date, never a thousands group of the figure before. */
const COUNT_OR_DATE_AFTER = /^\s*(?:days?|nights?|hours?|hrs?|weeks?|months?|years?|yrs?|visits?|sessions?|treatments?|times|claims?|admissions?|trips?|persons?|people|children|members?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
/** A figure as printed: digits, with any comma, dot or apostrophe groups ("1,500", "250.00", "12'000"). */
const TOKEN = String.raw`\d+(?:[.,'’]\d+)*`;
/** Where the printed line holds a figure whose digits cannot be told apart safely. No figure inside such a span is read
 * on its own, so a piece of it never counts as printed (a wrong amount):
 * - figures a single space apart (plain, no-break or narrow space) form one run, while a tab, a wider gap, a word or a
 *   currency sign parts runs. A run's figures that each delimit themselves ("S$1,500 2,000 2,500", "RM 250.00 300.00")
 *   still read one by one, as does a bare figure before one whose first group could not carry it on ("Ward 4 1,200.00").
 *   Any other run ("S$ 1 500", "S$ 150 250 350", "RM 1,000 500 000", "S$ 1 500.00") prints nothing: which digits belong to
 *   which figure is not known, and DearPolicy reads figures grouped with commas only.
 * - a figure grouped with apostrophes ("12'000") prints nothing, never 12.
 * After a section, table, year, rate or reference word, a run is no money and its figures read one by one, as before. */
function unclearRuns(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\d.,'’])${TOKEN}(?:${RUN_SPACE}${TOKEN})+(?![\d]|[.,'’]\d)`, "g"))) {
    if (NOT_MONEY_BEFORE.test(text.slice(Math.max(0, m.index! - 24), m.index!))) continue;
    const tokens = [...m[0].matchAll(new RegExp(TOKEN, "g"))].map((t) => ({ at: m.index! + t.index!, raw: t[0] }));
    const delimited = (t: string) => /[.,'’]/.test(t);
    const parts: (typeof tokens)[] = [];
    for (const [i, t] of tokens.entries()) {
      // A figure carries on the one before it as a thousands group only when it could be one: the one before is 1 to 3
      // plain digits or already in the run, and this one's first group is exactly 3 digits and is
      // no count or date ("S$250 120 days", "S$200 01 Jan 2024", "2025 600,000", "600000 1000000" are separate figures).
      const prev = tokens[i - 1], part = parts[parts.length - 1];
      const firstGroup = t.raw.match(/^\d+/)![0];
      const carries = i > 0 && (part.length > 1 || /^\d{1,3}$/.test(prev.raw)) && firstGroup.length === 3
        && !COUNT_OR_DATE_AFTER.test(text.slice(t.at + t.raw.length, t.at + t.raw.length + 14));
      // A lakh grouping printed with a space ("₹ 1 50,000" is 1,50,000): a 1-digit figure, or a 1-2 digit one right after
      // a currency sign, before a figure grouped in twos then three, is one figure, never 50,000 (TE #339).
      const lakh = i === 1 && /^\d{1,2}$/.test(prev.raw) && /^\d{2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(t.raw)
        && (prev.raw.length === 1 || /(?:₹|rs\.?|inr|[$£€]|[A-Z]{3})\s*$/i.test(text.slice(Math.max(0, m.index! - 6), m.index!)));
      if (carries || lakh) part.push(t); else parts.push([t]);
    }
    // A run of plain figures with a percent sign after it ("Co-insurance 10 20 %") is one unclear share, never 10.
    const lastToken = tokens[tokens.length - 1];
    if (tokens.length > 1 && /^\d+$/.test(lastToken.raw) && /^\s*%/.test(text.slice(lastToken.at + lastToken.raw.length))) {
      spans.push([tokens[0].at, lastToken.at + lastToken.raw.length]);
      continue;
    }
    for (const part of parts) {
      if (part.length < 2) continue;
      const last = part[part.length - 1];
      spans.push([part[0].at, last.at + last.raw.length]);
    }
  }
  for (const m of text.matchAll(/(?<![\d.,'’])\d+(?:[.,]\d+)*['’]\d[\d.,'’]*/g)) spans.push([m.index!, m.index! + m[0].length]);
  return spans;
}
/** Dot-grouped figures read whole, and where they stand. */
function dotGrouped(text: string, unclear: [number, number][]): { figures: number[]; spans: [number, number][] } {
  const figures: number[] = [], spans: [number, number][] = [];
  // A market that groups thousands with dots ("Rp 500.000.000", "€50.000", "2.400,00") prints its figure whole: read by
  // the one shared figure reader (lib/format/printed-number.ts). Before, such a quote printed no figure, so the whole cover
  // was dropped (cross-page check, 31 Oct). Read only where the quote makes the grouping certain, the rule #260 settled
  // for evidence.ts (Critic #262 H1: "Section 1.500", "Multiplier 1.250", "Policy year 2.026" are no fifteen hundred):
  // a currency printed right beside the figure, or a figure that shows its grouping itself (two or more dot groups, or a
  // ",dd" decimal). Never before a percent sign, "times" or a scale word ("€1.500 million" is no 1,500, and which of
  // 1.5 or 1,500 million is meant is not known, so nothing is read), nor after a section, table, year, rate or factor word.
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\d.,'’])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)(?![\d]|[.,]\d)` + NO_SCALE_AFTER, "g"))) {
    const raw = m[1], at = m.index!, before = text.slice(Math.max(0, at - 24), at), after = text.slice(at + raw.length, at + raw.length + 12);
    if (unclear.some(([from, to]) => at >= from && at < to)) continue;
    if (/^\s*(?:%|per\s*cent|percent|pct|times\b|x\b|×)/i.test(after) || NOT_MONEY_BEFORE.test(before)) continue;
    const sign = (m: RegExpMatchArray | null) => (!m ? null : m[1] ? (DOT_CODES.test(m[1]) ? m[1] : null) : m[0].trim() === "KD" ? "KWD" : m[0].trim() === "BD" ? "BHD" : m[0].trim());
    const code = sign(before.match(SIGN_BEFORE)) ?? sign(after.match(SIGN_AFTER));
    // A lone group ("1.500") is thousands only beside a currency of a market that groups with dots, or a three-decimal one
    // (read as a decimal below): beside S$, US$, RM, £, ₹, HK$ or A$ the dot is a decimal point, so "S$1.500" is no
    // fifteen hundred (TE #262 F1). Two or more groups, or a ",dd" decimal, show their grouping wherever they stand.
    if (!/^\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,2})?$/.test(raw) && !/,\d{1,2}$/.test(raw) && !(code && DOT_MARKET.test(code))) continue;
    // A three-decimal currency beside it ("BHD 1.500", "KD 1.500") reads it as a decimal (printedNumber).
    const n = printedNumber(raw, code);
    if (n != null) { figures.push(n); spans.push([at, at + raw.length]); }
  }
  return { figures, spans };
}
/** Every number printed in a text, commas removed ("S$600,000" -> 600000, "1 million" -> 1000000), and a figure grouped
 * with dots read whole ("Rp 500.000.000" -> 500000000). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  let gluedEnd = -2;
  const scaleAfter = new RegExp(String.raw`^\s*(${SCALE_WORD})(?![A-Za-z0-9])`);
  const unclear = unclearRuns(text), dotted = dotGrouped(text, unclear);
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
    // A figure is read once, as its whole printed token: a piece of an unclear run, or of a dot-grouped figure read whole
    // ("Rp 250.000" is 250000, never also 250), is no figure of its own.
    if ([...unclear, ...dotted.spans].some(([from, to]) => m.index! >= from && m.index! < to)) continue;
    // Two figures glued together ("13,500.00100,000.00", "181.44181.44") print neither, nor any piece of their tail: which
    // digits belong to which is not known. A rate with more decimals ("1.375") is one figure (Critic R175-a, R176).
    if (m.index! === gluedEnd + 1) { gluedEnd = m.index! + m[1].length; continue; }
    if (/^[.,]\d/.test(text.slice(m.index! + m[1].length)) && /\.\d{3,}$/.test(m[1])) { gluedEnd = m.index! + m[1].length; continue; }
    const after = text.slice(m.index! + m[1].length);
    // A figure ending in a comma and one or two digits ("150,00", "3,50", "1,250,50") is not grouped with commas: it prints
    // nothing, never 15000 or 350.
    if (/,\d{1,2}$/.test(m[1]) && !/\./.test(m[1])) continue;
    const n = Number(m[1].replace(/,/g, ""));
    // A scale word after the figure multiplies it only from a closed list per currency, with that currency printed
    // directly beside the figure (coordinator, 31 Oct: strict first). "1.5 million" and "1.5m" read as before (a million,
    // never the bare figure), except that a figure reading two ways ("2.500 m", "1,5 million" read as 15) gives none.
    const scale = scaleAfter.exec(after) ?? ABBREVIATION_AFTER.exec(after);
    if (scale) {
      const word = scale[1].toLowerCase();
      const k = ABBREVIATIONS[word] ?? scaleOf(scale[1]);
      const currency = currencyBeside(text.slice(Math.max(0, m.index! - 8), m.index!), after.slice(scale[0].length));
      const allowed = SCALE_CURRENCIES[word.replace(/s$/, "")] ?? SCALE_CURRENCIES[word];
      const v = scaledFigure(m[1], null, { scaled: true });
      if (/^(?:million|m)$/.test(word)) { if (v != null) out.push(v * 1e6); continue; }
      if (allowed && currency && (allowed === "any" || allowed.has(currency))) { if (v != null && Number.isFinite(k)) out.push(v * k); continue; }
      // Otherwise the figure prints nothing, never the bare figure: with no currency, or one the word does not go with,
      // which it scales cannot be told ("Cover 3 Mio.", "2 juta", "S$2 juta", "€5 mil", "100 MD consultations") (TE #265 F3).
      continue;
    }
    if (Number.isFinite(n)) out.push(n);
  }
  out.push(...dotted.figures.filter((n) => !out.includes(n)));
  return out;
}
const ABBREVIATIONS: Record<string, number> = { jt: 1_000_000, rb: 1_000, cr: 10_000_000, tr: 1_000_000 };
const ABBREVIATION_AFTER = /^\s*(jt|rb|cr|tr)\.?(?![\p{L}\p{N}])/iu;
/** Which currencies print each scale word: a closed list per word. English words go with any currency. */
const LAKH = new Set(["INR", "PKR", "NPR", "BDT", "LKR"]), EURO = new Set(["EUR", "CHF"]), ID_MY = new Set(["IDR", "MYR"]);
const SCALE_CURRENCIES: Record<string, Set<string> | "any"> = {
  k: "any", mn: "any", bn: "any", billion: "any", thousand: "any",
  lakh: LAKH, lac: LAKH, crore: LAKH, cr: LAKH,
  juta: ID_MY, jt: ID_MY, rb: ID_MY, miliar: new Set(["IDR"]), milyar: new Set(["IDR"]),
  tr: new Set(["VND"]),
  mio: EURO, tsd: EURO, mrd: EURO, md: EURO, mln: new Set(["EUR", "PLN"]), mld: new Set(["EUR", "PLN"]),
};
/** The currency printed directly before a figure ("S$", "Rp ", "€", "USD ") or directly after its scale word ("2 Mio. €"),
 * from a closed list of signs and three-letter codes; null when none or one several currencies print. */
const SIGNS: Record<string, string> = { "₹": "INR", "RS": "INR", "RS.": "INR", "৳": "BDT", "TK": "BDT", "RP": "IDR", "RP.": "IDR", "RM": "MYR", "₫": "VND", "Đ": "VND",
  "€": "EUR", "£": "GBP", "S$": "SGD", "US$": "USD", "A$": "AUD", "HK$": "HKD", "NZ$": "NZD", "R$": "BRL", "¥": "JPY", "₱": "PHP", "₩": "KRW", "฿": "THB", "ZŁ": "PLN" };
/** The runtime's closed list of ISO 4217 codes; none where the runtime has no list (then only signs count). */
let isoList: Set<string> | undefined;
function isoCodes(): Set<string> {
  if (!isoList) {
    try { isoList = new Set((Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency") ?? []); }
    catch { isoList = new Set(); }
    for (const word of ["ALL", "TOP", "CUP", "BOB", "SOS", "GEL", "MAD"]) isoList.delete(word); // codes that are also printed words
  }
  return isoList;
}
function currencyBeside(before: string, afterScale: string): string | null {
  const b = /(?:(?<![A-Za-z])([A-Z]{3})|((?<![A-Za-z])[A-Z]{1,3}\$|(?<![A-Za-z])(?:Rp\.?|RM|Rs\.?)|Tk|zł|\p{Sc}))\s?$/u.exec(before);
  const a = /^\.?\s?(?:([A-Z]{3})(?![A-Za-z])|([A-Z]{1,3}\$|Rp\.?(?![A-Za-z])|RM(?![A-Za-z])|Rs\.?(?![A-Za-z])|Tk(?![A-Za-z])|\p{Sc}|zł|đ(?![\p{L}])))/u.exec(afterScale);
  const code = b?.[1] ?? a?.[1];
  if (code) return isoCodes().has(code) ? code : null; // "TPD 2 mn" is no money
  const sign = (b?.[2] ?? a?.[2])?.toUpperCase();
  return sign ? SIGNS[sign] ?? null : null;
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
  for (const m of text.matchAll(/\bfrom\s+(?:the\s+)?(?:day\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+(?:(?:to|-|until)\s+(?:the\s+)?\d+(?:st|nd|rd|th)\s+)?(?:consecutive\s+)?day)\b/gi)) if (!negated(m.index)) days.add(Number(m[1] ?? m[2]));
  // The same day in words ("payable from the third consecutive day", TE-ACC-20261113): a closed list of ordinals.
  for (const m of text.matchAll(new RegExp(String.raw`\bfrom\s+(?:the\s+)?(${Object.keys(ORDINAL_DAY).join("|")})\s+(?:consecutive\s+|full\s+)?day\b`, "gi"))) if (!negated(m.index)) days.add(ORDINAL_DAY[m[1].toLowerCase()]);
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


const SPLIT_FIGURE = new RegExp(String.raw`(${MONEY_SIGN}${RUN_SPACE}?\d{1,3})${RUN_SPACE}*\t[\t \u00a0\u202f]*(?=\d{3}(?!\d))`, "gi");
/** A row's own text with its table cells kept apart by tabs, except a cell break inside one spaced money figure. */
export const cellsApart = (row: string) => row.replace(SPLIT_FIGURE, "$1 ");
/** A printed date (""06/10/2022", "1 June 2040") is kept only when its digits are printed together on the page. */
export function dateOnPage(date: string | null, pageText: string): string | null {
  if (!date) return null;
  const digits = date.match(/\d+/g);
  if (!digits) return null;
  // Each part of a printed date is read on its own ("31 12 2025" and "31 Dec 2025" print 31, 12 and 2025): the parts are
  // parted by tabs, so they are no space-grouped run (numbersIn reads no such run).
  const page = numbersIn(pageText.replace(/[/.-]/g, " ").replace(/(\d)[ \u00a0\u202f]+(?=\d)/g, "$1\t")).map(String);
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
/** The currency of a cap figure: the one printed with it in the excerpt; for a bare "$", the currency its page declares
 * (Critic B2); otherwise null. Two different ones printed with it give null. */
function capFigureCurrency(excerpt: string, value: number, page: string): string | null {
  const text = plainText(excerpt);
  const figures = anyMoneyFigures(text).filter((f) => Math.abs(f.value - value) < 0.005);
  const codes = new Set(figures.map((f) => statedCurrencyCode(text.slice(f.index, f.index + f.length))).filter((c): c is string => !!c));
  if (codes.size === 1) return [...codes][0];
  if (codes.size > 1) return null;
  return figures.some((f) => /\$/.test(text.slice(f.index, f.index + f.length))) ? declaredCurrency(page) : null;
}
/** What a percentage is of may be the sum insured only when the row says so, read with ALLOW-lists in any wording (Critic
 * audit of 5c1075d7, A1 and B1: a list of other bases leaks, "10% Basic Premium", "5% Initial Investment Amount"). After
 * the percentage, with an optional "of"/"on" (Malay "daripada"/"dari"), the row must go on with words that name the sum
 * insured, or end, or go on with a neutral continuation (a table cell's next figure, punctuation, "per", "payable", "up
 * to", "subject to", "whichever"). Anything else is another base, and a share of it is never worked out on the sum
 * insured. */
const SUM_INSURED_WORDS = /^(?:(?:the|your|this|its|basic|base|main|initial|original|current|prevailing|total|policy(?:'s|’s)?|plan(?:'s|’s)?|rider(?:'s|’s)?|benefit|coverage|cover)\s+)*(?:sum\s+(?:insured|assured|covered|at\s+risk)|insured\s+amount|amount\s+(?:insured|assured)|face\s+(?:amount|value)|coverage\s+amount|amount\s+of\s+(?:cover|coverage|insurance)|s\.?\s?[ia]\.?(?![\p{L}])|jumlah\s+(?:diinsuranskan|dijamin|dilindungi))/iu;
/** What may follow a percentage without naming its base: the row's next figure (a table cell), a closing bracket or a full
 * stop, or words that say how or how much it pays. */
const NEUTRAL_AFTER = /^(?:$|[\d$£€¥₱)*^]|\.(?:\s|$)|(?:s|us|hk|nz|a|sg)\$|(?:sgd|usd|myr|rm|hkd|gbp|eur|aud|nzd|idr|php|thb)\b|not\s+covered\b|(?:per|payable|paid|up\s+to|subject\s+to|max(?:imum)?|limited\s+to|not\s+exceeding|capped|whichever|each|a\s+(?:day|week|month|year)|daily|weekly|monthly|yearly|annually|for\s+(?:each|every|any|one)|of\s+(?:each|every)|(?:less|more|greater)\s+than|at\s+least|equals?\s+to|(?:or|and)\s+(?:more|less|above|below|over))\b)/iu;
/** A separator after a percentage says nothing by itself: the words after it are read again (Critic B3, "10% - annual
 * premium", "10% and premium refund"). */
const SEPARATOR = /^(?:[-–—:;,/|]|(?:and|or|but)\b)\s*/iu;
/** A bracket that only spells the percentage out ("(one hundred per cent)") is read through. */
const SPELLED_PERCENT = /^\(\s*[\p{L}\s-]*\bper\s*cent\s*\)\s*/iu;
/** Whether the row leaves its percentage's base unsettled (anything but the sum insured, a neutral continuation or the
 * row's end follows it). False when no percentage equal to the value is printed. */
function percentBaseUnsettled(row: string, value: number): boolean {
  const t = row.normalize("NFKC").replace(/[ \t]+/g, " ");
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    if (Math.abs(Number(m[1].replace(",", ".")) - value) > 0.0001) continue;
    // Only the rest of the percentage's own line counts: a line below is the row's next line or the next row. A
    // percentage that ends its line with its "of ..." wrapped onto the next ("10%\nof the annual premium") reads on.
    const lines = t.slice(m.index! + m[0].length).split("\n");
    let after = (!lines[0].trim() && /^\s*(?:of|on|daripada|dari)\s/iu.test(lines[1] ?? "") ? lines[1] : lines[0]).trim();
    // The ")" closing "(100%)", a bracket spelling the percentage out, an opening bracket and separators are read through.
    for (let i = 0; i < 6; i++) {
      const next = after.replace(/^\)\s*/, "").replace(SPELLED_PERCENT, "").replace(/^\(\s*/, "").replace(SEPARATOR, "");
      if (next === after) break;
      after = next;
    }
    const of = after.match(/^(?:of|on|daripada|dari)\s+/iu);
    if (of) { if (!SUM_INSURED_WORDS.test(after.slice(of[0].length))) return true; continue; }
    if (!SUM_INSURED_WORDS.test(after) && !NEUTRAL_AFTER.test(after)) return true;
  }
  return false;
}
/** Words that name one kind of life among several ("an insured child", "adults", "seniors"). */
export const KIND_OF_LIFE = /\b(?:child(?:ren)?|kids?|minors?|infants?|juniors?|sons?|daughters?|adults?|seniors?|elderly|spouses?|dependants?|dependents?|principal|parents?)\b/i;
/** A line that names a kind of life or an age group: KIND_OF_LIFE, a few more words for one life among several, or a number
 * read as an age ("under 18", "aged 65", "70 years old"; never "over 3 days" or "above 50%"). */
const LIFE_NOTE = new RegExp(String.raw`${KIND_OF_LIFE.source}|\b(?:infants?|bab(?:y|ies)|juveniles?|students?|elderly|wi(?:fe|ves)|husbands?|partners?|policy\s*holders?|grand(?:children|child|parents?)|(?:first|second|third|fourth|fifth|main|joint|other|additional)\s+(?:insured|life|lives|person|adult|member)s?)\b`
  + String.raw`|\b(?:under|below|over|above|aged?|age\s+of)\s+(?:the\s+age\s+of\s+)?(?:\d{1,3}|[a-z]+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b(?!\s*(?:days?|hours?|weeks?|months?|%|per\s*cent|[,.]\d))|\b\d{1,3}\s*(?:years?|yrs?)\s+(?:old|of\s+age|and\s+(?:over|above|under|below)|or\s+(?:older|younger|over|above|under|below))\b`, "i");
/** See CheckedReading.lifeNotes. A line counts as a row's own only when it is a line of that row's printed text (rowText):
 * a note on the line after a row may be about the whole table, so it counts as a note. A cover's own line (an insured
 * persons table's "Grace Okafor  Child  09/04/2017  GBP 20,000") is who is insured, not a note. */
const CHANGES_A_FIGURE = /\b(?:benefits?|amounts?|pa(?:id|ys?|yable)|half|halved|double[ds]?|%|per\s*cent|limit(?:ed|s)?|reduc\w*|less|only|maximum|up\s+to|not\s+covered|exclud\w*|instead)\b|\d[\d,]*(?:\.\d+)?\s*%/i;
/** Words that give some of the lives another figure, with or without naming them ("halved", "reduced cover", "for the second
 * and subsequent insured persons", "those still in full-time education receive half"). */
export const FIGURE_CHANGE = /\b(?:half|halved|halves|reduc\w*|double[ds]?|second|subsequent|thereafter|for\s+those|those\s+(?:who|still|in|aged|under|over))\b/i;
/** Words that make a figure one limit shared by all the lives (per family, per policy, in aggregate, combined). */
export const SHARED_LIMIT = /\b(?:aggregate[ds]?|in\s+aggregate|combined|together(?!\s+with)|in\s+total|shared|share\s+(?:one|a|the)|per\s+(?:policy|certificate|household|family|schedule)|all\s+(?:the\s+)?(?:insured\s+)?(?:persons|people|lives|members)|whole\s+family|(?:maximum|most|total)\s+(?:\w+\s+){0,3}under\s+this\s+(?:policy|certificate|schedule))\b/i;
/** Words that say a line or a row's note is about every row of the table, not its own ("All benefits for children are half
 * the amounts shown in this table"). */
const WHOLE_TABLE = /\b(?:all|every|each|other|any)\s+(?:the\s+)?(?:benefits?|amounts?|limits?|sections?)\b|\bthe\s+(?:amounts?|limits?|benefits?|figures?)\s+(?:shown|above|below|in\s+this)\b|\bin\s+this\s+(?:table|schedule)\b/i;
/** A footnote mark at the start of a line ("Note (a):", "(b)", "a)", "*", "†"), and the mark it names. */
const NOTE_MARK = /^\s*(?:notes?\s*)?(?:\(([a-z]|\d{1,2})\)|([a-z]|\d{1,2})[.):](?=\s)|(\*{1,3}|†|‡))/i;
export const noteMarkOf = (line: string): string | null => { const m = NOTE_MARK.exec(line); return m ? (m[1] ?? m[2] ?? m[3]).toLowerCase() : null; };
/** Whether a row's own words print a footnote mark: "(note a)", "(a)" after its words, or a "*", "†" or "‡". */
export function marksIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\(\s*(?:note\s+)?([a-z]|\d{1,2})\s*\)|\bnote\s+([a-z]|\d{1,2})\b/gi)) {
    const k = (m[1] ?? m[2]).toLowerCase();
    // "(1)" after a figure or as a list number, "(s)" in "person(s)": only a letter in brackets after a space, or "note x".
    if (m[2] || /^[a-z]$/.test(k) && /\s$/.test(text.slice(0, m.index))) out.add(k);
  }
  for (const m of text.matchAll(/\*{1,3}|†|‡/g)) out.add(m[0]);
  return [...out];
}
/** The footnote marks a column heading prints: in the heading the reader gave ("Limit per insured person*"), or right after
 * it wherever the page prints it, when the reader left the mark off. */
export function headingMarks(pageText: string, column: string): string[] {
  const out = new Set(marksIn(column));
  const c = column.replace(/(?:\s|\*|†|‡)+$/, "").trim();
  if (c.length < 3) return [...out];
  const at = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[ \\t]+") + String.raw`[ \t]*(\*{1,3}|†|‡|\(\s*(?:note\s+)?[a-z]\s*\))`, "gi");
  for (const m of pageText.matchAll(at)) for (const k of marksIn(` ${m[1]}`)) out.add(k);
  return [...out];
}
/** Words that tie a limit to the insured lives together, not to each of them (per-person-shared gate round 1): per family,
 * household, couple, party, group, booking, certificate or policy; shared or jointly; one limit for; for everyone, all of
 * you, the group; however many; as a whole; regardless of the number; a family's or household's own limit. */
export const TIED_TO_LIVES = new RegExp(String.raw`\b(?:per\s+(?:famil(?:y|ies)|households?|couples?|party|parties|group|booking|certificate|policy|schedule)`
  + String.raw`|shared(?!\s+(?:rooms?|wards?|accommodation))|sharing|shares?\s+(?:one|a|the|this|their)\s+(?:limit|maximum|amount|sum)|jointly|joint\s+limits?`
  + String.raw`|(?:one|single|a\s+single)\s+(?:limit|maximum|amount|sum)\s+(?:for|applies|covers)`
  + String.raw`|for\s+(?:everyone|everybody|all\s+of\s+you|both\s+of\s+you|you\s+all|(?:the|your)\s+(?:whole\s+)?(?:group|party|family|household|couple))`
  + String.raw`|however\s+many|as\s+a\s+whole|as\s+a\s+unit|pool(?:ed|s)?|(?:regardless\s+of|whatever)\s+(?:the\s+)?numbers?|for\s+the\s+(?:whole\s+)?certificate|(?:all|every)\s+(?:the\s+)?travell?ers?|for\s+both(?=\s*(?:$|\n|\)|of\s+you|insured|travell?ers|persons|people))|whole\s+(?:family|household|group|party)`
  + String.raw`|between\s+(?:the\s+|all\s+)?(?:insured|you|both|them)|(?:famil(?:y|ies)|households?|couples?)(?:'s|’s|\s+(?:limits?|maximum|aggregate|total|sum))`
  + String.raw`)\b`, "i");
/** A limit word a note line's tie must sit near (per-person-shared gate round 2). */
const LIMIT_WORD = /\b(?:limits?|maximum|amounts?|benefits?|sums?\s+insured|sums?|cover|most\s+we(?:\s+will)?\s+pay)\b/gi;
/** The lives taken together: insured persons (plural), all insured, travellers, all or both or the two of you, everyone, a
 * couple, family or household; named persons, persons named, every (insured) person (gate round 13). Never one insured person. */
const LIVES = /\b(?:(?:the\s+|all\s+(?:the\s+)?)?insured\s+(?:persons|people|lives|members)|(?:all\s+(?:the\s+)?)?named\s+(?:insured\s+)?(?:persons|people)|(?:insured\s+)?persons\s+named|every\s+(?:insured\s+|named\s+)?person(?:\s+named)?|all\s+(?:the\s+)?insured|travell?ers|all\s+of\s+you|both\s+of\s+you|the\s+two\s+of\s+you|everyone|everybody|couples?|famil(?:y|ies)|households?)\b/gi;
/** Whether words name the insured lives taken together (LIVES): the family, all insured persons, travellers, both of you. */
export const namesTheLives = (text: string) => new RegExp(LIVES.source, "i").test(text);
/** Words that put the lives together when they sit next to them. */
const TOGETHER = /\b(?:shared?|share|jointly|together|combined|in\s+total|total|in\s+aggregate|aggregate|collectively|pool(?:ed|s)?)\b/gi;
/** Phrases that tie a limit to the lives together on their own. */
const OWNER_TIE = new RegExp(String.raw`\b(?:per\s+(?:famil(?:y|ies)|households?|couples?|party|parties|group)`
  + String.raw`|for\s+(?:the|your)\s+(?:whole\s+)?(?:family|household|group|party|couple)|whole\s+(?:family|household|group|party)`
  + String.raw`|(?:famil(?:y|ies)|households?|couples?)(?:'s|’s|\s+(?:limits?|maximum|aggregate|total))`
  + String.raw`|one\s+(?:limit|maximum|amount|sum)\s+(?:applies\s+)?(?:for|to)\s+(?:everyone|everybody|all\s+of\s+you|both\s+of\s+you|all\b)`
  + String.raw`|(?:apply|applies)\s+(?:jointly\s+)?to\s+(?:the\s+two\s+of\s+you|both\s+of\s+you|all\s+of\s+you|everyone|everybody)`
  + String.raw`|as\s+a\s+whole|as\s+a\s+unit|not\s+(?:per|for\s+each)\s+(?:insured\s+)?(?:person|travell?er)|(?:all|every)\s+(?:the\s+)?travell?ers?`
  + String.raw`|(?:draw|claim)\s+(?:on|from|against)\s+the\s+same|up\s+to\s+the\s+limits?\s+shown\s+in\s+total|for\s+both(?!\s+(?:adults?|children|trips?|sections?|benefits?))`
  + String.raw`|(?:maximum|most|total|limits?)\s+(?:\w+\s+){0,3}for\s+(?:this|the)\s+(?:certificate|policy)(?!\s+(?:period|year|term))`
  + String.raw`|for\s+all\s+(?:the\s+)?(?:insured\s+persons|travell?ers|insured)\s+on\s+(?:this|the)\s+(?:certificate|policy)`
  + String.raw`|per\s+(?:certificate|policy|booking)(?!\s+(?:period|year|term|claim))`
  + String.raw`|(?:regardless\s+of|whatever)\s+(?:the\s+)?numbers?\s+of\s+(?:insured|persons|people|travell?ers|lives))\b`, "gi");
/** A clause about the premium or payment, a dispute between the lives and the insurer, or a cap per event or conveyance:
 * never a limit shared by the lives (each person's own limit still applies). */
const NOT_A_TIE_CLAUSE = /\b(?:between\s+(?:you|the\s+insured|insured\s+persons?|the\s+insured\s+persons?)\s+and\s+us|per\s+(?:event|occurrence|incident|accident|conveyance)|any\s+one\s+(?:event|conveyance|occurrence|accident|incident))\b/i;
/** Travel or admin "together" that puts no limit together (per-person-shared gate round 11): travelling together, on the same
 * trip, buying or submitting something together, under one policy or certificate. These words are taken out before any tie
 * is looked for, and no row is named from inside them. */
const TRAVEL_TOGETHER = new RegExp(String.raw`\b(?:(?:travel(?:s|led|ed|ling|ing)?|depart(?:s|ed|ing)?|journey(?:s|ed|ing)?)\s+together(?:\s+with\s+(?:an?\s+|the\s+)?(?:insured\s+)?(?:adults?|parents?|persons?))?`
  + String.raw`|(?:on|for)\s+the\s+same\s+(?:trip|journey|booking)(?:\s+and\s+(?:the\s+same\s+)?(?:booking|trip|journey))?`
  + String.raw`|(?:buy|buys|bought|buying|purchase[sd]?|purchasing|take\s+out|takes\s+out)\s+(?:\w+\s+){0,3}?together`
  + String.raw`|submit(?:s|ted|ting)?\s+(?:\w+\s+){0,2}?together|under\s+(?:one|a\s+single|the\s+same)\s+(?:policy|certificate|plan))\b`, "gi");
export const withoutTravelTogether = (text: string) => text.replace(TRAVEL_TOGETHER, " ");
/** A clause saying each insured person keeps their own limit ("apply to each insured person", "for each of the insured
 * persons", "can still claim their own limit"), with no word putting the lives together left in it: no tie, as "Limits
 * apply per insured person" (per-person-shared gate round 11). */
const EACH_OWN = /\b(?:(?:to|for)\s+each\s+(?:of\s+(?:the\s+)?)?(?:insured\s+)?(?:persons?|travell?ers?|of\s+you)|each\s+insured\s+(?:person|traveller|traveler)|each\s+of\s+the\s+insured(?:\s+persons)?|(?:their|his\s+or\s+her|your)\s+own\s+(?:\w+\s+)?limits?)\b/i;
const SHARE_WORD = /\b(?:shared?|shares|sharing|jointly|pool(?:ed|s)?|combined|together|collectively|in\s+aggregate|aggregate|between|as\s+a\s+(?:whole|unit)|whole|not\s+(?:per|for\s+each)|in\s+total)\b/i;
const MOST_FOR_LIVES = /\b(?:most|maximum|total|limits?|sum)\b[^.;]*?\bfor\s+(?:(?:the\s+|your\s+|all\s+(?:the\s+)?)(?:whole\s+)?(?:famil|household|couple|group|party|insured\s+persons|travell)|everyone|everybody|all\s+of\s+(?:you|them)|both\s+of\s+you|you\s+all)/i;
/** The rule (per-person-shared gate round 13): a sentence shares a limit only when it binds a limit or amount to a group of
 * people, or to the certificate or policy as the unit, in the same clause. "One / single / only one", "once", "combined",
 * "in total", "same", "common" and "share" are sharing words only with that group side present; joining benefits,
 * sections, items, events, days or trips they share nothing ("The single article limit is S$500"; "paid once per trip";
 * "Medical and dental expenses combined"). */
/** The group side: the lives together (LIVES), a party, group or booking, between them, whoever claims, or the certificate or
 * policy as the unit ("per certificate", "under one certificate", "for the whole policy"). */
const UNIT = /\b(?:per\s+(?:certificate|policy|booking|party|parties|group)(?!\s+(?:period|year|term|claim))|under\s+(?:one|a\s+single|the\s+same)\s+(?:certificate|policy)|for\s+(?:the|this)\s+(?:whole\s+)?(?:certificate|policy)(?!\s+(?:period|year|term))|between\s+(?:the\s+|all\s+)?(?:insured|you|both|them)|for\s+both\s+of\s+you|whoever\s+(?:claims|makes)|no\s+matter\s+who)\b/i;
/** Whether words name a group of people or the certificate as the unit (travel-together phrases aside). */
export const namesTheGroup = (text: string) => namesTheLives(withoutTravelTogether(text)) || UNIT.test(text);
/** Whether words bind a limit, sum or benefit to the certificate or policy as the unit ("per policy" for an excess binds none). */
export const limitForTheUnit = (text: string) => UNIT.test(text) && /\b(?:limits?|maximum|sums?\s+insured|sums?|amounts?|benefits?|cover)\b/i.test(text);
/** Each person's claims drawn from one pool ("Claims for each insured person come out of a single limit"): the people are
 * the group side even though each is named alone. */
const POOL = /\b(?:out\s+of|from|towards|against|draws?\s+on|drawn\s+from|deducted\s+from|counts?\s+(?:towards|against))\s+(?:a|one|the\s+same|a\s+single|a\s+common|one\s+common)\s+(?:\w+\s+)?(?:limits?|sums?(?:\s+insured)?|amounts?|maximum)\b/i;
const EACH_PERSON = /\beach\s+(?:insured\s+)?(?:person|traveller|traveler|of\s+you)\b/i;
const poolsEachPerson = (text: string) => POOL.test(text) && EACH_PERSON.test(text);
/** Whether a sharing note binds its limit to a group of people or to the certificate as the unit (assemble.ts: such a note
 * naming no row withholds every row). */
export const bindsToGroup = (text: string) => namesTheLives(withoutTravelTogether(text)) || limitForTheUnit(text) || poolsEachPerson(text);
/** One limit, amount or benefit; paid once (with no time or event after it: "once a day", "once per trip", "once after 6
 * hours", "once the claim is approved" are none). A "one limit" clause going on to say each or per person is each
 * person's own ("one limit applies for each insured person"), unless it goes on "and their family". */
const ONE_OR_ONCE = /\b(?:(?:only\s+)?(?:one|a\s+single|single)\s+(?:[\w-]+\s+){0,2}?(?:limits?|amounts?|sums?|benefits?|maximum)\b(?![^.;,]*\b(?:each|per\s+(?:insured\s+)?(?:person|traveller|traveler|life))\b(?![^.;,]*\band\s+(?:their|the|your|his\s+or\s+her)\s+famil))|(?:paid|payable|pay|claimed)\s+(?:only\s+)?once\b(?!\s+(?:a|an|per|each|every|after|before|when|while|the|you|your|in|on|during|within|if|it|we|they|for\s+each|to\s+each|for\s+every)\b))/i;
/** Further sharing words, each only with the group side: for all of them or everyone, as a family, combined, in total, the
 * same, a common or the certificate limit. */
const SHARE_SIGNAL = /\b(?:for\s+(?:all\s+of\s+(?:them|you)|everyone|everybody|both\s+of\s+you|you\s+all)|as\s+a\s+(?:family|couple|household|group|whole|unit)|combined|in\s+total|(?:same|common|certificate|policy)\s+(?:\w+\s+)?(?:limits?|maximum|sums?(?:\s+insured)?|amounts?|cover))\b/i;
const sharingWord = (text: string) => ONE_OR_ONCE.test(text) || SHARE_SIGNAL.test(text);
const eachOwnClause = (clause: string, group: boolean) => EACH_OWN.test(clause) && !SHARE_WORD.test(clause) && !(group && sharingWord(clause)) && !poolsEachPerson(clause) && !MOST_FOR_LIVES.test(clause) && !new RegExp(OWNER_TIE.source, "i").test(clause);
/** Whether a note sentence, read clause by clause with the travel-together phrases out, ties something to the lives together
 * (a sharing note: assemble.ts withholds the rows it names, or every row when it names none). */
export const sharesWithLives = (sentence: string) => sentence.split(/[.;!?](?=\s|$)/).some((clause) => {
  const c = withoutTravelTogether(clause);
  const group = namesTheGroup(clause);
  if (NOT_A_TIE_CLAUSE.test(c) || eachOwnClause(c, group)) return false;
  if (livesTogether(c) || (group && sharingWord(c)) || poolsEachPerson(c)) return true;
  // In a clause about travelling, buying or submitting together, a bare "for the family" says whose the trip or the claims
  // are, not that a limit is shared ("Baggage claims for the family must be submitted together." ties nothing; gate round 12).
  const t = c === clause ? c : c.replace(WEAK_OWNER, " ");
  return new RegExp(OWNER_TIE.source, "i").test(t) || (TIED_TO_LIVES.test(t) && (namesTheLives(t) || UNIT.test(clause)));
});
/** A clause that ties nothing to the lives together: a dispute with us, a cap per event or conveyance, or each person's own limit. */
const noTieClause = (clause: string) => NOT_A_TIE_CLAUSE.test(clause) || eachOwnClause(clause, namesTheGroup(clause));
const WEAK_OWNER = /\bfor\s+(?:the|your)\s+(?:famil(?:y|ies)|households?|couples?|group|party)\b/gi;
const wordAt = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => text.slice(0, m.index).split(/\s+/).filter(Boolean).length);
/** Whether the words name the lives taken together ("combined for all insured", "in total for the travellers", "insured
 * persons share"): a lives word and a together word within six words. */
export function livesTogether(text: string): boolean {
  const lives = wordAt(text, LIVES);
  return lives.length > 0 && wordAt(text, TOGETHER).some((t) => lives.some((l) => Math.abs(l - t) <= 6));
}
/** A cap for the lives together set as a multiple of each person's own limit ("twice the limit shown", "200% of the individual
 * limit", "2 times the per insured person limit"): it confirms each person's own limit is the column's figure (a family
 * plan's cap on top of it; per-person-shared gate round 3). */
/** Each person's own limit named in a note: "the limit shown", "the individual limit", "the per insured person limit". Any such
 * phrase in a clause about the lives together ties the limit to them, unless the whole line is one of the closed family-cap
 * shapes (capsAsMultiple). */
const OF_OWN_LIMIT = new RegExp(String.raw`\b(?:(?:individual|per[\s-]+(?:insured[\s-]+)?person|single|each\s+person'?s?|personal|own|shown|stated)\s+(?:\w+\s+)?limits?`
  + String.raw`|limits?\s+(?:shown|stated|per\s+(?:insured\s+)?person|for\s+(?:one|each|an?)\s+(?:insured\s+)?(?:person|individual)))\b`, "i");
/** A clause about the lives together: an owner phrase, the lives with a together word, or a family, couple or group plan. */
const aboutLivesTogether = (clause: string) => wordAt(clause, OWNER_TIE).length > 0 || livesTogether(clause) || /\b(?:famil(?:y|ies)|couples?|group)\b/i.test(clause);
/** The family-cap multiples a keep shape may print (a closed list), and their values. */
const M = String.raw`(twice|double|treble|triple|thrice|(?:two|three|four|five|six)\s+times|\d+(?:\.\d+)?\s*(?:times|x)|x\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:%|per\s?cent))`;
const MULTIPLE_WORD: Record<string, number> = { twice: 2, double: 2, treble: 3, triple: 3, thrice: 3, two: 2, three: 3, four: 4, five: 5, six: 6 };
function multipleValue(token: string): number {
  const t = token.toLowerCase().trim();
  const word = /^([a-z]+)/.exec(t)?.[1];
  if (word && word !== "x" && MULTIPLE_WORD[word]) return MULTIPLE_WORD[word];
  const n = Number(/(\d+(?:\.\d+)?)/.exec(t)?.[1] ?? NaN);
  return /%|cent/.test(t) ? n / 100 : n;
}
const OWN = String.raw`(?:of\s+)?(?:the\s+|your\s+)?(?:individual\s+limits?|limits?\s+shown|per[\s-]+insured[\s-]+person\s+limits?|limits?\s+per\s+insured\s+person)`;
const PLAN = String.raw`(?:the\s+|your\s+)?[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+plans?`;
const LEAD = String.raw`(?:(?:(?:for|under)\s+${PLAN}\s*,?|${PLAN}\s*[:,])\s*)?`;
const ALL_LIVES = String.raw`(?:all\s+(?:the\s+)?insured\s+persons|(?:the\s+|your\s+)(?:whole\s+)?family|both\s+of\s+you)`;
const TAIL = String.raw`(?:\s+for\s+each\s+benefit)?(?:\s*,\s*whether\s+or\s+not\s+you\s+travel\s+together)?\s*\.?\s*$`;
const MOST = String.raw`(?:the\s+most\s+we\s+(?:will\s+)?pay|the\s+maximum\s+(?:amount\s+)?(?:payable|we\s+(?:will\s+)?pay)|the\s+total\s+(?:amount\s+)?(?:payable|paid|we\s+(?:will\s+)?pay))`;
/** A leading footnote mark or "Note:" before a note's words. */
const NOTE_LEAD = /^\s*(?:\*{1,3}|†|‡|\(\s*[a-z0-9]{1,2}\s*\)|notes?\s*:)\s*/i;
/** The closed shapes of a family plan's cap set as a multiple above one of each person's own limit (per-person-shared gate
 * rounds 6, 7: an allow-list over the whole sentence, after PR #472's lesson, never a parse around the multiple), after an
 * optional footnote mark or "Note:" and an optional "For / Under (the) <Plan> plan(,)" or "<Plan> plan:" lead-in:
 * A) "the most we (will) pay / the maximum (amount) payable / we (will) pay / the total payable for all (the) insured
 *    persons / (the|your) (whole) family / both of you [combined | together | in total | in aggregate] is / shall not exceed
 *    <M> (of) (the) individual limit / limit shown / per insured person limit / limit per insured person."
 * B) "<M> (of) the ... limit for (the|your) whole family / all insured persons / both of you [combined | in aggregate]."
 * C) "Family / Couple (plan) maximum / limit: <M> (of) (the) ... limit[, in aggregate]."
 * each with an optional "for each benefit" and ", whether or not you travel together". <M> is from the closed list and above
 * one; nothing else may be printed in the sentence (no money, no other limit, no "which is", "formerly", "but", "only",
 * "for <benefit>", no negation). */
const KEEP_SHAPES = [
  new RegExp(String.raw`^\s*${LEAD}${MOST}\s+for\s+${ALL_LIVES}(?:\s+(?:combined|together|in\s+total|in\s+aggregate))?\s+(?:is|(?:shall|will)\s+not\s+exceed)\s+${M}\s+${OWN}${TAIL}`, "i"),
  new RegExp(String.raw`^\s*${LEAD}${M}\s+${OWN}\s+for\s+${ALL_LIVES}(?:\s+(?:combined|in\s+aggregate))?${TAIL}`, "i"),
  new RegExp(String.raw`^\s*(?:family|couple)\s+(?:plan\s+)?(?:maximum|limit)\s*:\s*${M}\s+${OWN}(?:\s*,\s*in\s+aggregate)?${TAIL}`, "i"),
];
/** Whether a note sentence is, as a whole, one of the closed family-cap shapes with a multiple above one: kept with each
 * person's rows as a condition (capNotes), never withholding them. A sentence left open (no full stop, with a line after it
 * that may carry it on) is none. Any other sentence naming each person's own limit about the lives together is a tie
 * (tiesLimitToLives). */
export function capsAsMultiple(sentence: string, open = false): boolean {
  if (open) return false;
  const t = sentence.replace(NOTE_LEAD, "").trim();
  for (const re of KEEP_SHAPES) {
    const m = re.exec(t);
    if (m) return multipleValue(m[1]) > 1;
  }
  return false;
}
export function tiesLimitToLives(line: string, open = false): boolean {
  return !capsAsMultiple(line, open) && tiesInClauses(line);
}
/** A cheap first look: a sentence with none of these words can tie nothing to the lives together, set no family cap and name
 * no shared benefit (every word OWNER_TIE, TOGETHER, LIVES, TIED_TO_LIVES and KEEP_SHAPES need starts here). */
const TIE_HINT = /(?:once|named|common|out\s+of|draws?\s+on|famil|household|couple|part(?:y|ies)|group|shar|joint|together|combined|total|aggregate|collectiv|pool|every|\ball\b|both|two\s+of\s+you|however|whole|unit|regardless|whatever|travell?er|insured\s+(?:persons|people|lives|members)|not\s+(?:per|for)|same|between|\bone\b|single|certificate|polic|booking|schedule)/i;
function tiesInClauses(line: string): boolean {
  for (const clause of withoutTravelTogether(line).split(/[.;!?](?=\s|$)/)) {
    if (noTieClause(clause)) continue;
    // Each person's own limit named in a clause about the lives together, in any shape but the closed family-cap ones: one
    // limit, or some share of one, for all of them (per-person-shared gate round 6).
    if (OF_OWN_LIMIT.test(clause) && aboutLivesTogether(clause)) return true;
    const limits = wordAt(clause, LIMIT_WORD);
    if (!limits.length) continue;
    const lives = wordAt(clause, LIVES);
    const ties = [...wordAt(clause, OWNER_TIE), ...wordAt(clause, TOGETHER).filter((t) => lives.some((l) => Math.abs(l - t) <= 6))];
    if (ties.some((t) => limits.some((l) => Math.abs(l - t) <= 8))) return true;
  }
  return false;
}
export type DocumentNotes = { tieLines: string[]; capNotes: string[]; tiedNotes: string[]; lifeNotes: string[]; sharedNotes: string[]; footnotes: { mark: string; text: string }[]; plainBlockers: string[]; premiumFigures: number[] };
/** Words that change a figure for whoever a line names: a printed share, a cut or a rise (TE gate round 2, R2-M1: never "paid",
 * "only" or "limited", which ordinary lines about who may be insured print). */
const STRICT_CHANGE = /\b(?:half|halved|halves|doubl\w*|reduc\w*|less|lower|instead|not\s+covered|exclud\w*|subsequent|benefits?|amounts?|limits?|rates?|maximum|pays?)\b|%|\bper\s*cent\b/i;
/** A role that is no kind of life on its own: the policyholder is the payer and the payee, named on most schedules. */
const ROLE_ONLY = /\b(?:policy\s*holders?|proposers?)\b/gi;
/** Words a plain schedule's own admin lines never print (TE gate round 2: "for you and your family", "one limit applies to
 * everyone", "the policy as a whole", "regardless of the number of insured persons"). A line with any of them is not an
 * admin line. Used only as part of the closed set of structural lines (plainLine), never on its own to give a row. */
const ADMIN_SCOPE = /\b(?:amounts?|limits?|most|maximum|max|each|every|everyone|everybody|all|family|families|household|per|one|once|whole|regardless|however|many|together|share[ds]?|aggregate[ds]?|combined|total|same|half|halved|halves|reduc\w*|doubl\w*|second|subsequent|those|only|less|lower|up\s+to|apply|applies|applied|you|your|yours|we|us|our|instead|except|unless|but|rates?|pays?|payable|covered|cover)\b|%/i;
/** Words an insured persons line prints beside a name: a relationship or role, a date of birth, a sum (TE gate round 2). */
const PERSON_LINE_WORDS = new Set(("policyholder policy holder spouse partner husband wife child son daughter insured person persons main joint life assured " +
  "relationship dependant dependent principal member mr mrs ms miss dr and date of birth dob sum name").split(" "));
/** See CheckedReading.lifeNotes, sharedNotes, footnotes, plainBlockers and premiumFigures. */
export function lifeNotesOf(pages: { text: string }[], reading: Pick<CheckedReading, "covers" | "benefits" | "namedPeople"> & { kind?: CheckedReading["kind"]; product?: string | null; insurer?: string | null }): DocumentNotes {
  // Only a person's own schedule or certificate gives a row to each named insured person (assemble.ts perPersonRows needs
  // its own proof, plainTable a personal_proof): any other document's notes are never read, so its pages are not walked
  // (benefit-table:speed-test: a 360-page household of wordings went from about 0.5 s to 4.8 s when every line was).
  if (reading.kind != null && reading.kind !== "personal_proof") return { tieLines: [], capNotes: [], tiedNotes: [], lifeNotes: [], sharedNotes: [], footnotes: [], plainBlockers: [], premiumFigures: [] };
  const own = new Set<string>();
  for (const b of reading.benefits) for (const l of (b.rowText ?? "").split("\n")) if (flat(l)) own.add(flat(l));
  // A row kept as words, whose line was not read around it (a percentage quote holding two percentages): its own table
  // line, a line of two or more cells, one of its first two the row's label, holding the row's quote.
  // Read once, not for every line of every page (speed-test).
  const wordsRows = reading.benefits.filter((b) => !b.rowText && flat(b.benefit).length >= 3).map((b) => ({ label: flat(b.benefit), quote: flat(b.source.excerpt) }));
  const tableLine = (line: string) => { if (!wordsRows.length || !line.includes("\t")) return false;
    const cells = line.split("\t").map(flat);
    if (cells.length < 2) return false;
    const whole = flat(line);
    return wordsRows.some((b) => cells.slice(0, 2).includes(b.label) && whole.includes(b.quote)); };
  const coverLines = reading.covers.map((c) => flat(c.source.excerpt)).filter((x) => x.length >= 6);
  const people = [...new Set([...reading.namedPeople, ...reading.covers.map((c) => c.person)].map(flat).filter((n) => n.length >= 3 && n.includes(" ")))];
  const sums = reading.covers.map((c) => c.sumInsured).filter((n): n is number => n != null);
  // The marks the rows print: a footnote line starting with one is that row's note, read with the row (assemble.ts).
  const referenced = new Set(reading.benefits.flatMap((b) => marksIn(b.rowText ?? b.source.excerpt)));
  const markRows = new Map<string, typeof reading.benefits>();
  for (const b of reading.benefits) for (const m of marksIn(b.rowText ?? b.source.excerpt)) markRows.set(m, [...(markRows.get(m) ?? []), b]);
  const firstNames = [...new Set([...reading.namedPeople, ...reading.covers.map((c) => c.person)].map((n) => flat(n).split(" ")[0]).filter((n) => n && n.length >= 3))];
  /** Whether a footnote a row prints the mark of is that row's own (TE gate round 3, R3-H1): an allow-list. It names no
   * section, row or benefit but its own row's, no whole table ("every", "all", "this table", "sections"), no person or life
   * (a kind of life, an age, "youngest", "first/last named", "subsequent", "only", "not available", a covered person's full
   * or first name), and any money figure in it is its row's own figure or cap ("Note (a): a compound fracture is paid at
   * double the Section 3 amount, still subject to the GBP 1,500 maximum per accident" is row 3's own). Any other note is a
   * note on the document: it blocks every plain row (plainBlockers). */
  const ownNote = (mark: string, text: string): boolean => {
    const rows = markRows.get(mark) ?? [];
    if (!rows.length) return false;
    const t = flat(text), w = ` ${t.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
    const ownNumbers = new Set(rows.map((b) => { const m = /^\s*(?:(?:section|part|item|benefit)\s+)?(\d{1,3})[.)]?\s*$/i.exec(b.section ?? ""); return m ? Number(m[1]) : null; }));
    for (const m of t.matchAll(/\b(?:section|row|item|benefit|part)\s+(\d{1,3})\b/g)) if (!ownNumbers.has(Number(m[1]))) return false;
    if (/\b(?:sections|rows|items|parts)\b/.test(t)) return false;
    if (reading.benefits.some((b) => !rows.includes(b) && flat(b.benefit).length >= 5 && w.includes(` ${flat(b.benefit).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `))) return false;
    if (/\b(?:every|all|each|any|other|others|table|schedule|policy|whole|also|throughout|everyone|everybody|together|shared|you|your)\b/.test(t)) return false;
    if (LIFE_NOTE.test(text) || /\b(?:youngest|eldest|oldest|first|last|second|third|fourth|named|subsequent|only|not\s+available|do(?:es)?\s+not\s+apply|excluded|policy\s*holders?)\b/.test(t)) return false;
    if (people.some((n) => w.includes(` ${n.replace(/[^a-z0-9 ]+/g, " ")} `)) || firstNames.some((n) => w.includes(` ${n} `))) return false;
    return anyMoneyFigures(text).every((f) => rows.some((b) => [b.value, b.cap].some((v) => v != null && Math.abs(v - f.value) < 0.005)));
  };
  /** A footnote line and the line that continues it (one starting in lower case). */
  const noteText = (lines: string[], i: number) => /^\s*[a-z]/.test(lines[i + 1] ?? "") ? `${lines[i].trim()} ${lines[i + 1].trim()}` : lines[i].trim();
  const out: DocumentNotes = { tieLines: [], capNotes: [], tiedNotes: [], lifeNotes: [], sharedNotes: [], footnotes: [], plainBlockers: [], premiumFigures: [] };
  const add = (list: string[], line: string) => { if (!list.includes(line.trim()) && list.length < 20) list.push(line.trim()); };
  const money = (line: string) => anyMoneyFigures(line).map((f) => f.value);
  const peopleWords = people.map((n) => ` ${n.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `);
  const named = (l: string) => { if (!people.length) return []; const t = ` ${l.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `; return people.filter((_, i) => t.includes(peopleWords[i])); };
  const words = (t: string) => flat(t).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  const strip = (t: string) => {
    let x = ` ${flat(t)} `;
    for (const n of [reading.product, reading.insurer]) if (n && flat(n).length >= 4) x = x.split(flat(n)).join(" ");
    // "(all amounts in GBP)": what currency the table is printed in.
    return x.replace(/\(?\s*(?:all\s+)?(?:amounts?|figures?)\s+(?:are\s+)?(?:shown\s+|stated\s+)?in\s+[a-z ]{3,20}\)?/g, " ")
      // A heading over the table: "TABLE OF BENEFITS", "Schedule of benefits", "Benefit schedule".
      .replace(/\b(?:(?:table|schedule|summary)\s+of\s+benefits?|benefits?\s+(?:table|schedule|summary))\b/g, " ");
  };
  // An admin line: no money figure, no share, no person, no kind of life or age (the policyholder aside), none of the
  // words that would tie it to the amounts (ADMIN_SCOPE).
  // The money test last: it is the costly one (speed-test), and the others settle most lines.
  const admin = (line: string) => !ADMIN_SCOPE.test(strip(line)) && !LIFE_NOTE.test(line.replace(ROLE_ONLY, " ")) && !named(flat(line)).length && !money(line).length;
  /** The premium line test alone (the premium branch of structural), for a document whose blockers list is already full. */
  const premiumLine = (line: string, l: string) => {
    if (/\b(?:premiums?|contributions?|instal?l?ments?|direct\s+debit)\b/i.test(line) && !named(l).length && !LIFE_NOTE.test(line.replace(ROLE_ONLY, " "))) out.premiumFigures.push(...money(line));
  };
  /** One of the closed set of lines a plain family schedule prints outside its benefit rows (assemble.ts plainTable). */
  const structural = (line: string, l: string, prevStructural: "admin" | "footnote" | null, full: string): "admin" | "footnote" | "other" | null => {
    if (/^\s*(?:page\s+)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*$/i.test(line)) return "admin";
    // Column headings: two or more cells, no figure, no kind of life, and only words that say what a column is.
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !/\d/.test(line) && !LIFE_NOTE.test(line.replace(ROLE_ONLY, " ")) && !named(l).length
      && !ADMIN_SCOPE.test(l.replace(/\b(?:amounts?|limits?|maximum|max|benefits?|payable|sum|insured|cover)\b/g, " "))) return "admin";
    // The premium the household pays (its figures are never a benefit's: assemble.ts).
    if (/\b(?:premiums?|contributions?|instal?l?ments?|direct\s+debit)\b/i.test(line) && !named(l).length && !LIFE_NOTE.test(line.replace(ROLE_ONLY, " "))) {
      out.premiumFigures.push(...money(line)); return "admin";
    }
    // An insured persons line: names, a relationship or role, a date of birth, the person's own sum.
    const names = named(l);
    if (names.length) {
      let rest = ` ${l} `;
      for (const n of names) rest = rest.split(n).join(" ");
      rest = rest.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, " ");
      const figs = anyMoneyFigures(rest);
      if (figs.some((f) => !sums.some((v) => Math.abs(v - f.value) < 0.005))) return null;
      for (const f of [...figs].reverse()) rest = rest.slice(0, f.index) + " " + rest.slice(f.index + f.length);
      return words(rest).every((w) => PERSON_LINE_WORDS.has(w)) && !/\d/.test(rest) ? "admin" : null;
    }
    // A footnote a row prints the mark of: read with that row, and its continuation.
    const mark = noteMarkOf(line);
    if (mark && referenced.has(mark)) return ownNote(mark, full) ? "footnote" : null;
    if (prevStructural === "footnote" && /^\s*[a-z]/.test(line)) return "footnote";
    if (admin(line)) return "admin";
    // A few admin lines with words admin() refuses (TE gate round 3, LOW): a line saying every limit is each person's,
    // "Exclusions apply.", and a short field of the plan's kind ("Plan type: Family", "Cover level: Couple").
    if (/^\s*(?:all\s+|the\s+)?(?:limits|amounts|benefits|figures)(?:\s+shown)?\s+(?:are|apply)\s+(?:per|for\s+each|to\s+each)\s+insured\s+person\.?\s*$/i.test(line)) return "admin";
    if (/^\s*(?:exclusions|terms(?:\s+and\s+conditions)?|conditions|limits\s+and\s+exclusions)\s+apply\.?\s*$/i.test(line)) return "admin";
    const field = /^\s*((?:plan|cover|coverage|policy)\s+(?:type|level|basis|category))\s*:\s*([A-Za-z][A-Za-z ]{0,20}?)\s*$/i.exec(line);
    if (field && !named(l).length && !LIFE_NOTE.test(field[2]) && field[2].split(/\s+/).every((x) => /^(?:family|couple|individual|single|joint|standard|annual|plan|cover)$/i.test(x))) return "admin";
    // The rest of a wrapped admin line ("of this policy: Pounds sterling (GBP)", "2025)").
    if (prevStructural === "admin" && /^\s*[a-z(\d]/.test(line) && admin(line)) return "admin";
    return null;
  };
  // Every page's lines in one run too, so a note sentence is read across a page break (gate round 8, R8-H1).
  const pageLines = pages.map((p) => p.text.split(/\r?\n/));
  const all = pageLines.flat();
  // For each line, the next printed line at or after it: blank lines and page numbers ("Page 3 of 5", "3/5", "3") are
  // skipped, however many (gate round 9, R9-H1 and D2). Built once, from the end.
  const PAGE_NUMBER = /^\s*(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;
  const nextPrinted = new Array<number>(all.length + 1).fill(all.length);
  for (let k = all.length - 1; k >= 0; k--) nextPrinted[k] = flat(all[k]) && !PAGE_NUMBER.test(all[k]) ? k : nextPrinted[k + 1];
  let pageStart = 0, carriedTo = 0;
  for (const lines of pageLines) {
    const off = pageStart;
    pageStart += lines.length;
    let prev: "admin" | "footnote" | null = null;
    lines.forEach((line, i) => {
      const l = flat(line);
      if (!l) return;
      const mark = noteMarkOf(line);
      if (mark) {
        // The note and the line that continues it (one starting in lower case).
        out.footnotes.push({ mark, text: noteText(lines, i) });
      }
      const isCover = coverLines.some((c) => l.includes(c) || (l.length >= 6 && c.includes(l)));
      if (isCover) { prev = "admin"; return; }
      const rowLine = own.has(l) || tableLine(line);
      // A shared or aggregate limit, on a row's own line or any other: every figure may be shared by all the lives.
      if (SHARED_LIMIT.test(line)) add(out.sharedNotes, line);
      // The note's whole sentence: this line and the lines that carry it on (starting in lower case), up to its full stop;
      // the family-cap shape and the tie are judged on the same sentence the row's condition shows (gate round 7, R7-H1).
      // TIE_HINT first, so a page of ordinary lines costs one test each.
      // A line already read as the rest of the sentence above it is not read again on its own.
      // Lines are counted across pages (g), so the sentence runs on over a page break and blank lines at a page's foot.
      const g = off + i;
      const nextText = (from: number) => { const k = nextPrinted[Math.min(from, all.length)]; return k < all.length ? { k, line: all[k] } : null; };
      if (!rowLine && g >= carriedTo && (TIE_HINT.test(line) || /^\s*[a-z]/.test(nextText(g + 1)?.line ?? ""))) {
        const parts = [line.trim()];
        let j = g + 1;
        for (let n = nextText(j); n && parts.length < 8 && !/[.!?]\s*$/.test(parts.at(-1)!) && /^\s*[a-z]/.test(n.line) && !own.has(flat(n.line)); n = nextText(j)) { parts.push(n.line.trim()); j = n.k + 1; }
        carriedTo = j;
        const sentence = parts.join(" ");
        if (TIE_HINT.test(sentence)) {
          // Left open: a line follows that is no row's, and either the sentence has no full stop (another line, or another
          // page, may carry it on) or that line starts in lower case ("…twice the limit shown." / "or S$5,000, whichever is
          // less."; gate round 8, C5).
          const after = nextText(j);
          const open = !!after && !own.has(flat(after.line)) && !tableLine(after.line) && (!/[.!?]\s*$/.test(sentence) || /^\s*[a-z]/.test(after.line));
          const keep = capsAsMultiple(sentence, open);
          if (keep) add(out.capNotes, sentence);
          else if (tiesInClauses(sentence)) add(out.tiedNotes, sentence);
          // A sentence that ties something to the lives together, printed for one benefit ("Personal liability is shared by
          // the family."): that row is no one's own (assemble.ts, by the row's label).
          // Never a kept family cap, nor a cap per event or conveyance or a dispute with us, nor travelling together or each
          // person's own limit (each person's own limit stands; gate round 11).
          if (!keep && !NOT_A_TIE_CLAUSE.test(sentence) && sharesWithLives(sentence)) add(out.tieLines, sentence);
        }
      }
      // A note printed on a row's own line about every row ("All benefits for children are half the amounts shown").
      if (rowLine) {
        prev = null;
        if (LIFE_NOTE.test(line) && WHOLE_TABLE.test(line)) add(out.lifeNotes, line);
        // A footnote another row prints the mark of, read as a row of its own: still a note, held to the same test.
        if (mark && (markRows.get(mark) ?? []).some((b) => flat((b.rowText ?? "").split("\n")[0]) !== l)) {
          if (ownNote(mark, noteText(lines, i))) prev = "footnote"; else add(out.plainBlockers, line);
        }
        return;
      }
      // Once the blockers list is full (add keeps 20), a line's kind can add nothing to it: only a premium line's figures
      // are still read (speed-test: a long personal document no longer runs every line through the structural tests).
      if (out.plainBlockers.length >= 20) premiumLine(line, l);
      else {
        const kind = structural(line, l, prev, mark ? noteText(lines, i) : line);
        prev = kind === "admin" || kind === "footnote" ? kind : null;
        if (!kind) add(out.plainBlockers, line);
      }
      // A line naming an insured person is a note when it prints an amount, a share or a change to one ("Grace Okafor:
      // hospital cash GBP 25 a day", "Benefits for Grace Okafor are halved"); one that only says who they are ("Spouse:
      // Daniel Okafor") is not. A line naming a kind of life or an age group (the policyholder alone is no kind of life) is
      // a note when it prints a money figure or a share, says something about an amount, or is a short heading over rows
      // ("Children (under 18)", "Second insured person"); a definition or a rule about who may be insured ("Partner means
      // your spouse ...", "Children are covered free of charge up to age 18", "Cover for persons over 70 is limited to trips
      // of 31 days") is not (TE gate H4, R2-H1, R2-M1). A line that gives some lives another figure without naming them
      // ("Those still in full-time education receive half") is a note too, unless it is the footnote of a row that prints
      // its mark (read with that row).
      // The line's figures only when it names a person or a kind of life (the costly money test; speed-test).
      const figures = () => money(line).filter((v) => !sums.some((x) => Math.abs(x - v) < 0.005));
      const heading = l.split(" ").length <= 5 && !/[.:;]\s*$/.test(line.trim());
      const life = LIFE_NOTE.test(line.replace(ROLE_ONLY, " "));
      const isNote = named(l).length ? figures().length > 0 || STRICT_CHANGE.test(line) || FIGURE_CHANGE.test(line)
        : life ? figures().length > 0 || STRICT_CHANGE.test(line) || FIGURE_CHANGE.test(line) || heading
          : FIGURE_CHANGE.test(line) && !(mark && referenced.has(mark) && ownNote(mark, noteText(lines, i)));
      if (isNote) add(out.lifeNotes, line);
    });
  }
  return out;
}
/** Words that say a figure is capped: a percentage row with them pays at most a printed limit. */
export const CAP_WORDS = /\bup\s+to\b|\bmax(?:imum)?\b|\bwhichever\s+is\s+(?:the\s+)?(?:lower|lesser|less|smaller)\b|\bnot\s+(?:to\s+)?exceed|\blimited\s+to\b|\bcapped\b|\bsubject\s+to\s+(?:a\s+)?(?:maximum|limit)\b/i;
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The row's words without "limited to" whose object is the row's own percentage: "For an insured child under 18, limited
 * to 25% of the Sum Insured" names the share itself, not a money limit on it, so it never marks the row as capped
 * (TE-ACC-20261113: it left the child's accidental death with "a maximum applies, but it was not captured"). Only "limited
 * to": "up to 50%" or "a maximum of 50% according to the Scale of Fractures" says the share varies up to that, so the row
 * still counts as capped and no fixed amount is worked out (Critic #449 F3). Only the row's own percentage: "100% ...,
 * limited to 25% for a child" or a cap word before any other figure still marks it. Used only on a document printed for
 * one life (checkReading): on a family schedule, whose life the share is for is not settled (Critic #449 rounds 1-4). */
export function withoutOwnShareCap(text: string, percent: number | null): string {
  if (percent == null || !(percent > 0)) return text;
  const own = String(percent).replace(".", "\\.");
  // Only of the sum insured itself, with nothing naming another life's sum after it ("of the Sum Insured of the Principal
  // Insured", "applicable to the Insured Parent": Critic #449 round 4).
  return text.replace(new RegExp(String.raw`\blimited\s+to\s+(?<![\d.])${own}(?:\.0+)?\s*(?:%|per\s?cent)\s+of\s+(?:the\s+|your\s+)?sum\s+(?:insured|assured)(?!\s*(?:of|for|applicable|payable|under|in\s+respect|as\s+per|according)\b)(?=\s*(?:$|[.;,)\n]))`, "gi"), " ");
}
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

/** See CheckedReading.tierLines: a short field label ending in a plan or cover word, then its value, which names a tier. */
const TIER_FIELD = /^\s*([^:\t\n]{0,40}?\b(?:type|option|category|plan|cover(?:age)?|basis|insured|class)\b)\s*(?::|\t)\s*([^\n]+)$/i;
const TIER_VALUE = /\b(?:family|child(?:ren)?|individual|single|couple|senior|adult|aged?\s+\d|\d{1,3}\s*(?:years?|yrs?))\b/i;
export function tierLinesOf(pages: { text: string }[]): string {
  const lines: string[] = [];
  for (const p of pages) for (const line of p.text.split(/\r?\n/)) {
    const m = TIER_FIELD.exec(line);
    // The value is words, not a figure: "Baggage overall limit for family plan  S$12,500" is a benefit row, not a field.
    if (m && TIER_VALUE.test(m[2]) && !/\d[\d,]*(?:\.\d+)?\s*$/.test(m[2].replace(/\b(?:years?|yrs?)(?:\s+old)?\b.*$/i, "")) ) lines.push(line.trim());
    if (lines.length >= 20) break;
  }
  return lines.join("\n");
}

/** The page text reaches the model escaped as markup (reading.ts renderDocument: "&" as "&amp;"), and the model can copy
 * the escape back ("Accident Death&amp;Dismemberment"). Every string it returns is read back as the page prints it. */
function unescaped(v: unknown): unknown {
  if (typeof v === "string") return v.includes("&") ? v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : v;
  if (Array.isArray(v)) return v.map(unescaped);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unescaped(x)]));
  return v;
}

/** `notesKind`: the kind of the document a part's reading is merged into (checkStored), so a later part stored with its own
 * kind ("other", none) still works out the document's notes, which mergeReadings intersects (#474 perf gate, P474-H1). */
export function checkReading(doc: SourceDoc, raw: unknown, o: { notesKind?: CheckedReading["kind"] } = {}): CheckedReading {
  const r = (unescaped(raw) ?? {}) as Partial<Reading>;
  const d = (r.document ?? {}) as Partial<Reading["document"]>;
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(d.kind as string) ? d.kind! : "other";
  const out: CheckedReading = { documentId: doc.id, document: doc.name, kind, product: str(d.product), plan: str(d.plan),
    namedPeople: Array.isArray(d.namedPeople) ? d.namedPeople.filter((n): n is string => !!str(n)) : [], covers: [], benefits: [], dropped: [] };
  // The document's period of cover counts only where a page prints it.
  const printedPeriod = (v: unknown) => doc.pages.map((p) => dateOnPage(str(v), p.text)).find(Boolean) ?? null;
  out.periodFrom = printedPeriod(d.periodFrom); out.periodTo = printedPeriod(d.periodTo);
  out.planType = planTypeOfPages(doc.pages);
  out.tierLines = tierLinesOf(doc.pages);
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
  // A figure counts as printed on its row as the page prints it: the quote's own span of the page, with its table cells
  // still parted by tabs. The excerpt joins cells with single spaces (locateQuote), so a year, age or count cell before
  // a figure ("60\t143,309", "1\t75%") would read as one space-grouped run and print nothing (#339 live regression).
  // A cell break inside one spaced figure ("Room\tS$ 1\t500") parts nothing: a cell ending in a currency sign and 1 to 3
  // digits, before a cell that opens with exactly 3 digits, is one unclear run, and prints neither piece (Critic and TE #352).
  const printedIn = (src: Source, value: number) => {
    const p = placed.get(src);
    return printsNumber(p ? cellsApart(pageText(src.page).slice(p.start, p.end)) : src.excerpt, value);
  };
  const segmentOf = (src: Source) => { const p = placed.get(src); return p ? rowSegment(pageText(src.page), p.start, p.end) : { text: src.excerpt, near: "", otherPercent: false }; };

  const readCovers = Array.isArray(r.covers) ? r.covers : [];
  /** The page's one line that is labelled as a sum insured and prints this figure (see the cover loop). */
  const ownSumLine = (page: number, person: string, value: number): Source | null => {
    const text = pageText(page);
    const sameLife = readCovers.filter((x) => str(x?.person) && normalizePersonName(str(x.person)!) === normalizePersonName(person)
      && (int(x.page) == null || int(x.page) === page));
    if (sameLife.length !== 1 || otherLife(text, person, doc.people ?? [])) return null;
    // A line labelled as a sum insured, with no word before the label but the policy's own ("Sum Insured", "Basic Sum
    // Assured (RM)"): never a total, a rider's or a benefit's (Critic #454 H1).
    const lines = text.split("\n").filter((l) => {
      const label = l.trim().split(/\t|:/)[0].trim();
      const m = SUM_INSURED_WORDS.exec(label);
      return !!m && !/\b(?:total|aggregate|combined|overall|rider|benefit|plan)\b/i.test(m[0].replace(/\b(?:sum|insured|assured|amount|coverage)\b/gi, ""))
        && /^\s*(?:\([^)\n]*\))?\s*$/.test(label.slice(m[0].length)) && numbersIn(cellsApart(l)).length > 0;
    });
    // One line, printing one figure: a line with a figure for each column is the table's, not this cover's (Critic H2).
    if (lines.length !== 1 || numbersIn(cellsApart(lines[0])).length !== 1 || !printsNumber(cellsApart(lines[0]), value)) return null;
    const at = find(lines[0].trim(), page);
    return at && at.page === page && !at.excerpt.includes("\n") ? at : null;
  };
  const allText = doc.pages.map((p) => p.text).join("\n");
  out.coverPeople = [...new Set(readCovers.map((c) => str(c?.person)).filter((n): n is string => !!n && nameOnPage(n, allText)))];
  // The lines premium-waiver riders were read from (page and words, spacing aside), with the figure each waives: a row on
  // one of them that prints that same figure is the waived premium. Another figure on the line (a cover a glued line joins
  // to the waiver's, Critic #460) keeps its own amount.
  const waiverLines = new Map<string, number[]>();
  const lineAt = (at: Source) => `${at.page}\u0000${at.excerpt.toLowerCase().replace(/\s+/g, " ").trim()}`;
  for (const c of readCovers) {
    const label = `cover "${c?.cover}" for ${c?.person}`;
    const person = str(c?.person), product = str(c?.product), cover = str(c?.cover), quote = str(c?.quote);
    if (!person || !product || !cover || !quote) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    let source = find(quote, int(c.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    if (!nameOnPage(person, pageText(source.page))) { out.dropped.push({ what: label, why: "person's name not printed on that page" }); continue; }
    // A sample page gives no one cover; a person printed only inside a sentence (a brochure's example person, a letter's
    // greeting, a worked example) is not the person the page insures (lib/documents/own-figure).
    if (OWN_FIGURE_CHECKS.on && (specimenPage(pageText(source.page)) || (doc.pages.length > 1 && specimenHeading(doc.pages[0].text)))) { out.dropped.push({ what: label, why: "the page is a sample" }); continue; }
    if (OWN_FIGURE_CHECKS.on && personOnlyInExample(person, doc.pages.map((p) => p.text))) { out.dropped.push({ what: label, why: "person named only in an example, a greeting or a sentence about them, never as the document's insured" }); continue; }
    let sumInsured = num(c.sumInsured);
    // A sum its page prints only as what another scheme pays, a total with another plan, an example, a projection or a
    // premium is not this cover's sum: the cover is kept without it.
    const sumWhy = OWN_FIGURE_CHECKS.on && sumInsured != null ? amountOnlyInContext(pageText(source.page), sumInsured, { premium: true }) : null;
    if (sumWhy) { out.dropped.push({ what: label, why: `sum insured ${sumInsured} is printed only as ${figureContextWords(sumWhy)}; kept the cover without it` }); sumInsured = null; }
    // A premium-waiver rider pays the policy's premiums, never a sum of its own: the figure in its sum column is the premium
    // it waives (live 13 Nov: "Crisis Waiver III  150.00" shown as a S$150 cover). The cover stays, with no sum (the same
    // rule as intake, lib/documents/waiver-rider).
    // The cover's own name only: its quote may be a glued line whose first cell is another rider (Critic #460).
    const waived = namesWaiverRider(cover) ? num(c.sumInsured) : null;
    if (waived != null) waiverLines.set(lineAt(source), [...(waiverLines.get(lineAt(source)) ?? []), waived]);
    if (sumInsured != null && namesWaiverRider(cover)) {
      out.dropped.push({ what: label, why: `sum insured ${sumInsured} is on a premium-waiver rider's line: the premium it waives, not a sum it pays; kept the cover without it` });
      sumInsured = null;
    }
    // A sum the quote does not print is taken from the page's one sum insured line instead, on the same tests as a premium
    // on its own line: the page is about this life only, and the reading gives this person no other cover there. Else the
    // cover is kept without the sum, on the same footing as a cover read with no sum: an unproved sum never costs the
    // person their cover, whose rows would then go to nobody or to another holder of the cover type (#449 repro).
    const quoted = source;
    // Only a quote that prints no money figure of its own (the name line): a quote printing another figure says the sum is
    // not this one (Critic #454 H1).
    if (sumInsured != null && !printedIn(source, sumInsured)) {
      // A figure the quote prints as the reading's premium says nothing about the sum (Critic #454 L1).
      const readPremium = num(c.premium);
      const notPremium = (v: number) => readPremium == null || Math.abs(v - readPremium) >= 0.005;
      const ownFigure = anyMoneyFigures(source.excerpt).some((f) => notPremium(f.value))
        || [...source.excerpt.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g)].some((m) => notPremium(Number(m[0].replace(/,/g, ""))));
      const sumLine = ownFigure ? null : ownSumLine(source.page, person, sumInsured);
      if (sumLine) source = sumLine;
      else { out.dropped.push({ what: label, why: `sum insured ${sumInsured} not printed in the quote or on the page's one sum insured line for this life only; kept the cover without it` }); sumInsured = null; }
    }
    let premium = num(c.premium);
    // A premium printed on its own line counts only on the cover's own page, on a line that says it is a premium.
    let premiumSource: Source | null = null, premiumLabel: string | null = null;
    // A premium equal to the cover's sum insured is not proved by the quote that prints the sum insured: it needs its own
    // premium line (TE pr161 R1), and a stacked figure equal to the sum insured is not one (TE pr162 S1).
    if (premium != null && (!(printedIn(source, premium) || printedIn(quoted, premium)) || (sumInsured != null && Math.abs(premium - sumInsured) < 0.005))) {
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
    // A page that says its sum insured is not what is paid (a bonus base): the figure is kept for matching only.
    // The note governs the basic plan: a rider listed on the same page keeps its own fixed sum (TE O1, Critic L4).
    const notional = sumInsured != null && printsNotionalSum(page) && !str(c.riderOf) && !RIDER_NAME.test(`${cover ?? ""} ${product ?? ""} ${quote}`);
    out.covers.push({ person, product, cover, plan: str(c.plan), riderOf: str(c.riderOf), policyNumber, sumInsured: notional ? null : sumInsured, ...(notional ? { notionalSum: sumInsured } : {}), premium,
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
    if (!Number.isFinite(premium) || premium <= 0 || (stacked.length && (c.sumInsured ?? c.notionalSum) != null && Math.abs(premium - (c.sumInsured ?? c.notionalSum)!) < 0.005)) continue;
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
    const parts = premiumPartsOf(pageText(c.page), c.sumInsured ?? c.notionalSum ?? null, c.premium);
    const sources = parts?.map((p) => find(p.line.trim(), c.page));
    if (parts && sources && sources.every((s) => s && s.page === c.page))
      c.premiumParts = parts.map((p, i) => ({ label: p.label, amount: p.amount, source: sources[i]! }));
  }

  // A document printed for one life: every cover and every named person is the same person.
  const lives = new Set([...out.covers.map((c) => c.person), ...out.namedPeople].map((n) => normalizePersonName(n)).filter(Boolean));
  const oneLife = lives.size === 1;
  for (const b of Array.isArray(r.benefits) ? r.benefits : []) {
    const label = `benefit "${b?.benefit}"${b?.column ? ` [${b.column}]` : ""}`;
    const benefit = str(b?.benefit), quote = str(b?.quote);
    let pays = (PAYS as readonly string[]).includes(b?.pays as string) ? b.pays : null;
    if (!benefit || !quote || !pays) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(b.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    let value = num(b.value);
    if (value != null && !printedIn(source, value)) { out.dropped.push({ what: label, why: `figure ${value} not printed in the quote` }); continue; }
    // A row whose line prints a figure for each plan ("Emergency evacuation S$50,000 S$150,000 S$300,000", "Trip
    // cancellation S$5,000 S$10,000") gives a figure only with the plan column it was read under: without one, the figure
    // may be any plan's (Critic R364 H1, the FWD plan-column regression). Fails closed whatever the reader did, including
    // a table whose header is on another page. The line tested is the one that prints the value, so a quote of two plan
    // lines is judged line by line. Two figures on a line are kept only when one is a rate ("RM200 per day RM8,000"); a
    // sum and its premium are already set aside by figuresDifferByPlan.
    if (value != null && !str(b.column) && plansOnValueLine(source.excerpt, value)) {
      out.dropped.push({ what: label, why: `figure ${value} is one of several plans' figures on its line, read with no plan column` }); continue;
    }
    // A figure equal to the sum insured its page says is not what is paid (lib/documents/notional-sum) is that notional
    // sum: the row stays, paid as its wording says, with no figure.
    if (value != null && pays !== "percent" && out.covers.some((c) => c.notionalSum != null && c.page === source.page && Math.abs(c.notionalSum - value!) < 0.005)) {
      out.dropped.push({ what: label, why: `figure ${value} is the sum insured its page says is not the amount paid; kept the row without it` });
      pays = "words"; value = null;
    }
    // A figure its quote prints only as what another scheme or plan pays, a total with another plan, an example or a
    // projection is not this benefit's: the row stays, paid as its words say, with no figure (lib/documents/own-figure).
    const valueWhy = OWN_FIGURE_CHECKS.on && value != null && pays !== "percent" ? amountOnlyInContext(source.excerpt, value, { title: pageText(source.page) }) : null;
    if (valueWhy) { out.dropped.push({ what: label, why: `figure ${value} is printed only as ${figureContextWords(valueWhy)}; kept the row without it` }); pays = "words"; value = null; }
    // A row read from a premium-waiver rider's own cover line that prints the figure the rider waives: that figure is a
    // premium, never an amount paid out, so the row stays with no figure. Only that line: a benefit that describes a waiver in its own words ("Waiver
    // of Premium Benefit up to S$5,000 of future premiums") keeps them.
    if (value != null && (waiverLines.get(lineAt(source)) ?? []).some((w) => Math.abs(w - value!) < 0.005)) { out.dropped.push({ what: label, why: `figure ${value} is on a premium-waiver rider's line: the premium it waives, not an amount it pays; kept the row without it` }); pays = "words"; value = null; }
    const FIGURED = ["amount", "up_to", "per_day", "per_period", "percent", "value"];
    if (FIGURED.includes(pays) && value == null) { out.dropped.push({ what: label, why: `"${pays}" row with no figure` }); continue; }
    if (!FIGURED.includes(pays)) value = null;
    const period = pays === "per_period" && (PERIODS as readonly string[]).includes(b.period as string) ? b.period! : null;
    if (pays === "per_period" && !period) { out.dropped.push({ what: label, why: "payment with no period" }); continue; }
    const basis = (BASES as readonly string[]).includes(b.basis as string) ? b.basis! : null;
    let percentOf = pays === "percent" && (PERCENT_OF as readonly string[]).includes(b.percentOf as string) ? b.percentOf! : null;
    let baseAmount: number | null = null, baseSource: Source | null = null;
    if (percentOf === "fixed_amount") {
      baseAmount = num(b.baseAmount);
      baseSource = find(str(b.baseQuote), source.page);
      if (baseAmount == null || !baseSource || baseSource.page !== source.page || !printedIn(baseSource, baseAmount)) {
        // The row stays with its share as printed and no amount: what it is a share of is not settled on its page.
        out.dropped.push({ what: label, why: "fixed base not printed on the row's page; kept the row with no amount" });
        percentOf = null; baseAmount = null; baseSource = null;
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
    let cap: number | null = null, capSource: Source | null = null, capUnread = false, ownShareNamed = false;
    // A percentage row's quote holds one row: two percentages mean it runs into the next row (R95-2, N3).
    // A percentage in the row's own label ("Burns: greater than 2% but less than 5%") is the label's, not another row's.
    const percents = (t: string) => (t.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length;
    // The row itself stays, as words with no figure: its quote cannot tell which percentage is its own.
    if (pays === "percent" && percents(source.excerpt) > percents(benefit) + 1) {
      out.dropped.push({ what: label, why: "quote holds more than one percentage; kept the row with no figure" });
      out.benefits.push({ section: str(b.section), column: str(b.column), benefit, pays: "words", value: null, period: null, basis, asOf: null, percentOf: null, baseAmount: null,
        baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions, page: source.page, quote, source, currency: null, baseSource: null, capSource: null,
        capUnread: false, droppedConditions, combinedLimit: false, limitsHeading: LIMITS_HEADING.test(str(b.section) ?? "") });
      continue;
    }
    if (pays === "percent") {
      const { text: row, near, otherPercent } = segmentOf(source);
      const claimed = num(b.cap);
      const s = claimed != null && claimed > 0 ? find(str(b.capQuote), source.page) : null;
      const tied = s && claimed != null && s.page === source.page && printedIn(s, claimed) && CAP_WORDS.test(s.excerpt) && flat(row).includes(flat(s.excerpt));
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
        // "Limited to 25%" names the share only when the row prints no money beside it ("limited to 25% of the Sum Insured
        // or AUD 15,000" is capped, whatever words join them: Critic #449 round 3).
        // Only on a document printed for one life (one person's covers): on a family or joint schedule the share's life is
        // not settled by the row (Critic #449 rounds 1-4).
        // Nor when the row names a kind of life ("an insured child under 16"): the one life may not be that kind (Critic
        // #449 round 5: a child's 25% worked out on an adult's own certificate).
        const own = (t: string) => oneLife && !KIND_OF_LIFE.test(`${benefit} ${str(b.column) ?? ""} ${row} ${near} ${conditions.join(" ")}`)
          && !(moneyIn(row).length || moneyIn(near).length || conditions.some((c) => moneyIn(c).length)) ? withoutOwnShareCap(t, value) : t;
        capUnread = claimed != null || CAP_WORDS.test(own(source.excerpt)) || conditions.some((c) => CAP_WORDS.test(own(c)))
          || CAPPED.test(own(row)) || NEAR_CAP.test(own(near));
        ownShareNamed = !capUnread && own(source.excerpt) !== source.excerpt;
      }
    }
    // A share read as of the sum insured whose row names another base ("10% of the annual premium", "50% of the Death
    // Benefit") is not of the sum insured: the row keeps its words and gets no amount.
    if (percentOf === "sum_insured" && value != null && percentBaseUnsettled(pays === "percent" ? segmentOf(source).text : source.excerpt, value)) {
      out.dropped.push({ what: label, why: `${value}% is not printed as a share of the sum insured; no amount is worked out for it` });
      percentOf = null;
    }
    const capCurrency = cap != null && capSource ? capFigureCurrency(capSource.excerpt, cap, pageText(capSource.page)) : null;
    // Day counts are figures too: one the quote does not print is not kept.
    const day = (v: unknown) => { const n = int(v); return n != null && printedIn(source, n) ? n : null; };
    // "Payable after the 10th day" is first paid on day 11: the same day, worded from the day before (live run 23 Oct, B3).
    // The first paid day the quote states, parsed once as a number, is the row's: "after the 10th day" is day 11, "from day
    // 1" is day 1, whatever the reading said (live run 23 Oct, B3; TE #108 B2, B4). A quote that states two is none; one
    // that states none keeps the reading's day when it is printed.
    const firstDay = (v: unknown) => { const printed = pays === "per_day" || int(v) != null ? startDay(source.excerpt) : undefined; return printed === undefined ? day(v) : printed; };
    const fromDay = firstDay(b.fromDay), maxDays = day(b.maxDays);
    const at = placed.get(source);
    const lines = at ? (() => {
      const text = pageText(source.page), from = text.lastIndexOf("\n", at.start - 1) + 1, to = lineEndAt(text, at.end);
      const prevFrom = from > 0 ? text.lastIndexOf("\n", from - 2) + 1 : -1;
      return { rowText: text.slice(from, to), nextLine: to < text.length ? text.slice(to + 1, lineEndAt(text, to + 1)) : "",
        prevLine: prevFrom >= 0 ? text.slice(prevFrom, from - 1) : "" };
    })() : null;
    const columnMarks = str(b.column) ? headingMarks(pageText(source.page), str(b.column)!) : [];
    const kind = limitKind({ benefit, section: str(b.section), quote: source.excerpt, sentence: at ? quoteSentence(pageText(source.page), at.start, at.end) : null });
    out.benefits.push({ section: str(b.section), column: str(b.column), benefit, pays, value, period, basis, asOf: dateOnPage(str(b.asOf), pageText(source.page)),
      percentOf, baseAmount, baseQuote: str(b.baseQuote), cap, capQuote: cap != null ? str(b.capQuote) : null,
      fromDay, maxDays, conditions: kind === "benefit_cap" && !conditions.includes(source.excerpt) ? [...conditions, source.excerpt] : conditions,
      page: source.page, quote, source, currency, baseSource, capSource, capUnread, droppedConditions, combinedLimit: kind === "combined",
      limitsHeading: LIMITS_HEADING.test(str(b.section) ?? ""), ...(capCurrency ? { capCurrency } : {}), ...(columnMarks.length ? { columnMarks } : {}),
      ...(ownShareNamed ? { ownShareNamed } : {}), ...(lines ?? {}),
      ...(b.forWhom === "each_named_insured" || b.forWhom === "some_insured" ? { forWhom: b.forWhom } : {}) });
  }
  Object.assign(out, lifeNotesOf(doc.pages, { ...out, kind: o.notesKind ?? out.kind, insurer: str(d.insurer) }));
  return out;
}
