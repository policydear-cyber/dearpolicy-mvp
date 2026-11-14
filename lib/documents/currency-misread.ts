/**
 * A scan reader can print a currency prefix's letter as a digit in front of the amount: "S$20,000" read as "$520,000",
 * "S$2,200" as "$52,200", "S$500" as "$5500" (50-document Baidu PaddleOCR run, 14 Nov 2026: every S$ figure printed
 * "$5..." on a made-up S$ schedule, 27 of 27, sat on a page that printed "S$" correctly elsewhere). The figure looks
 * well formed, so every later check would accept the wrong, larger amount: a wrong claimable amount.
 *
 * On a transcribed page, an amount printed with a bare "$" whose first digit is how a reader misprints a letter of a
 * currency prefix the same page prints elsewhere ("S$", "US$", "SG$"), and whose remaining digits are themselves a
 * well-formed amount, is not confirmed: it is replaced by the page check's "[amount not checked]" mark. It is never
 * repaired, because "$55,000" may be S$5,000 misread or S$55,000 with its "S" dropped.
 *
 * Left alone: a page that prints no such prefix (a bare-dollar schedule's "$520,000" is its own figure); an amount
 * whose remaining digits are not an amount ("$500,000" would be "S$00,000"; "$5,000" would be "S$,000"); a figure with
 * its prefix intact ("S$520,000", or "S $520,000" with a space before the sign where the page prints "S$"); an ISO-code
 * page ("SGD 520,000").
 */
import { NOT_CHECKED } from "@/lib/documents/layout-check";

/** A prefix letter, and the digit a reader has been seen to print for it. Extend only from observed readings. */
export const PREFIX_LETTER_AS_DIGIT: Readonly<Record<string, string>> = { S: "5" };

/** A currency prefix ending in "$" ("S$", "US$", "HK$", "NZ$") in front of a figure. */
const PREFIX_BEFORE_FIGURE = /(?<![A-Za-z])([A-Z]{1,3})\$\s?\d/g;
/** An amount printed with a bare "$" (no letter or "$" before it). The figure stops before a trailing "," or ".". */
const BARE_DOLLAR_AMOUNT = /(?<![A-Za-z0-9$])\$\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)(?![\d])/g;
/** A well-formed amount: no leading zero, thousands grouped by threes or not at all, at most two decimals. */
const WELL_FORMED = /^(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d{1,2})?$/;

/** The prefixes printed on this page, and the digits a misread prefix letter could have left in front of an amount. */
function pagePrefixes(text: string): { prefixes: Set<string>; digits: Set<string> } {
  const prefixes = new Set<string>(), digits = new Set<string>();
  for (const m of text.matchAll(PREFIX_BEFORE_FIGURE)) {
    prefixes.add(m[1]);
    for (const letter of m[1]) if (PREFIX_LETTER_AS_DIGIT[letter]) digits.add(PREFIX_LETTER_AS_DIGIT[letter]);
  }
  return { prefixes, digits };
}

/** The page text with every amount whose first digit may be a misread prefix letter marked as not checked, and the
 * amounts so marked, as printed. */
export function maskPrefixLetterMisreads(text: string): { text: string; masked: string[] } {
  const source = String(text ?? "");
  const { prefixes, digits } = pagePrefixes(source);
  if (!digits.size) return { text: source, masked: [] };
  const masked: string[] = [];
  const out = source.replace(BARE_DOLLAR_AMOUNT, (token: string, figure: string, at: number) => {
    if (!digits.has(figure[0]) || !WELL_FORMED.test(figure.slice(1))) return token;
    // The prefix kept, a space before its sign ("S $520,000", "US $520,000"): not a bare amount (Critic #476 LOW).
    const before = /(?<![A-Za-z])([A-Z]{1,3})\s$/.exec(source.slice(Math.max(0, at - 5), at));
    if (before && prefixes.has(before[1])) return token;
    masked.push(token);
    return NOT_CHECKED;
  });
  return { text: out, masked };
}

/**
 * A scan reader can print a thousands comma as a dot: "S$935,542" read as "S$935.542", "S$1,372,820" as "S$1.372.820"
 * (50-document Baidu PaddleOCR run, 14 Nov 2026: 12 such figures in 8 of 11 made-up documents, every one right after a
 * currency mark, in documents whose figures are otherwise all comma-grouped). Read as printed, the amount is a
 * thousand times too small. Some documents do group thousands with dots ("EUR 1.372.820,50"), so the style is the
 * document's own, decided from its figures, never from the currency's name.
 *
 * In a comma-grouped document, on a transcribed page, a figure grouped by dots is not confirmed: replaced by the page
 * check's "[amount not checked]" mark, never repaired. That is a figure right after a currency mark with one or more dot
 * groups of three ("S$935.542", "GBP 48.000"), or anywhere with two or more ("1.372.820": never a decimal). A single dot
 * group with no currency mark ("0.125", "a factor of 1.375") is a decimal and stays, as does a percentage.
 */
/** A currency mark right before a figure: a symbol with its country letters, or a code from a closed list. */
const MONEY_MARK = String.raw`(?:(?<![A-Za-z])(?:[A-Z]{1,3})?\$|[£€¥₹₱฿₩]|(?<![A-Za-z])(?:RM|Rp\.?|Rs\.?|[A-Z]{3})(?![A-Za-z]))`;
const ISO = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["SGD", "USD", "MYR", "GBP", "EUR", "IDR", "HKD", "INR", "PHP", "THB", "AUD", "CNY", "JPY", "CHF", "NZD"]);
/** Thousands grouped by commas ("935,542", "1,372,820.50"). */
const COMMA_GROUPED = /(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d]|[.,]\d)/g;
/** Thousands grouped by dots ("1.372.820", "1.372,50"), or a comma decimal ("372,50"): the dot style's own forms. */
const DOT_STYLE = /(?<![\d.,])(?:\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,2})?|\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{2})(?![\d]|[.,]\d)/g;
/** A dot-grouped figure: after a currency mark, one dot group or more; with no mark, two or more. */
const DOT_FIGURE = new RegExp(String.raw`(${MONEY_MARK}\s?)?(?<![\d.,])([1-9]\d{0,2}(?:\.\d{3})+)(?![\d]|[.,]\d|\s*(?:%|per\s*(?:cent|mille)|‰))`, "g");
/** A line about money: a cover, limit or charge word, or another money figure (a currency mark or a comma-grouped
 * figure). A dot-grouped figure with no currency mark is marked only on such a line, so a dotted reference ("Policy No.
 * 123.456.789", "Version 1.200.300") stays as printed (Critic #478 L2). An allow-list: a line naming none of these is
 * left alone. */
const MONEY_LINE = new RegExp(String.raw`\b(?:limits?|sums?\s+(?:insured|assured)|benefits?|premiums?|cover(?:ed|age)?|amounts?|excess|deductibles?|totals?|maximum|up\s+to|pay(?:s|able|ment)?|reimburse\w*|expenses?|liability|compensation|charges?|fees?|costs?|per\s+(?:day|year|claim|event|person|trip))\b|${MONEY_MARK}\s?\d|\d,\d{3}`, "i");

/** How the document groups thousands, from its own figures: "comma" when comma groups clearly outnumber the dot style's
 * own forms (at least 3 comma-grouped figures and three times as many as dot-style ones), "dot" the other way round,
 * "unknown" otherwise (nothing is marked). */
export function thousandsStyle(text: string): "comma" | "dot" | "unknown" {
  const comma = String(text ?? "").match(COMMA_GROUPED)?.length ?? 0, dot = String(text ?? "").match(DOT_STYLE)?.length ?? 0;
  if (comma >= 3 && comma >= 3 * dot) return "comma";
  if (dot >= 3 && dot >= 3 * comma) return "dot";
  return "unknown";
}

/** In a comma-grouped document, the page text with every dot-grouped figure marked as not checked, and the figures so
 * marked, as printed. */
export function maskDotGroupedFigures(text: string, style: ReturnType<typeof thousandsStyle>): { text: string; masked: string[] } {
  const source = String(text ?? "");
  if (style !== "comma") return { text: source, masked: [] };
  const masked: string[] = [];
  const out = source.replace(DOT_FIGURE, (token: string, mark: string | undefined, figure: string, at: number) => {
    const code = mark?.trim().replace(/\.$/, "");
    const isMark = !!mark && (!/^[A-Z]{3}$/.test(code ?? "") || ISO.has(code!));
    const groups = figure.split(".").length - 1;
    if (!isMark) {
      if (groups < 2) return token;
      const from = source.lastIndexOf("\n", at - 1) + 1, to = source.indexOf("\n", at);
      const line = source.slice(from, to < 0 ? undefined : to).replace(token, " ");
      if (!MONEY_LINE.test(line)) return token;
    }
    masked.push(token.trim());
    return isMark ? NOT_CHECKED : token.replace(figure, NOT_CHECKED);
  });
  return { text: out, masked };
}
