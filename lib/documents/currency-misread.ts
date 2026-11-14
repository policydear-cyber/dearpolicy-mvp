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
