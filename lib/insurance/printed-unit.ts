/**
 * The unit printed with a money figure, whether the page prints it after the figure ("S$100 per day", "S$50/night",
 * "S$200 daily") or before it ("Per day S$100", "Per disability: S$5,000", "Daily S$80", "Each trip up to S$500").
 *
 * A closed list of unit words; anything else is no unit. A unit phrase between two figures ("S$100 per day S$200") belongs
 * to one of them only: when the line's first figure has a unit printed before it, the line prints its units before its
 * figures, so the phrase is the next figure's; otherwise it is the figure before it (the common "S$100 per day" layout).
 */
const UNIT_WORDS = "day|night|week|month|year|hour|trip|journey|claim|visit|disability|person|item|event|incident|illness|injury|accident|confinement|admission|period";
const ADVERB: Record<string, string> = { daily: "day", nightly: "night", weekly: "week", monthly: "month", yearly: "year", annually: "year" };
const singular = (w: string) => w.toLowerCase().replace(/s$/, "");
/** A unit printed right after a figure: "per day", "per policy year", "/night", "each trip", "daily", "a day". */
const AFTER = new RegExp(String.raw`^\s*\(?\s*(?:(?:per|each|every|for\s+each|a|an)\s+(?:policy\s+|calendar\s+|insured\s+)?(${UNIT_WORDS})s?\b|\/\s*(${UNIT_WORDS})s?\b|(daily|nightly|weekly|monthly|yearly|annually)\b)`, "i");
/** A unit printed right before a figure, with at most a colon, a dash, "of" or a cap word between them: "Per day S$100",
 * "Per disability: S$5,000", "Daily S$80", "Each trip up to S$500", "per day - maximum of S$200". */
const BEFORE = new RegExp(String.raw`(?:\b(?:per|each|every|for\s+each)\s+(?:policy\s+|calendar\s+|insured\s+)?(${UNIT_WORDS})s?|\b(daily|nightly|weekly|monthly|yearly|annually))\s*[:\-–]?\s*(?:(?:up\s+to|max(?:imum)?(?:\s+of)?|limit(?:ed)?\s+(?:of|to)|of)\s*)?\(?\s*$`, "i");
const unitOf = (m: RegExpMatchArray | null): string | null => {
  if (!m) return null;
  const w = m[1] ?? m[2] ?? m[3];
  return ADVERB[w.toLowerCase()] ?? singular(w);
};
export type FigureSpan = { start: number; end: number };
/** Whether a line prints its units before its figures: its first figure has a unit printed right before it. */
export function unitsBeforeFigures(line: string, figures: FigureSpan[]): boolean {
  return figures.length > 0 && BEFORE.test(line.slice(0, figures[0].start));
}
/** The unit of each figure of a line, in order ("" when none is printed), from the spans of the line's money figures. */
export function printedUnits(line: string, figures: FigureSpan[]): string[] {
  if (!figures.length) return [];
  const before = figures.map((f, i) => {
    const from = i > 0 ? figures[i - 1].end : 0;
    return unitOf(line.slice(from, f.start).match(BEFORE));
  });
  const after = figures.map((f, i) => {
    const to = i < figures.length - 1 ? figures[i + 1].start : line.length;
    return unitOf(line.slice(f.end, to).match(AFTER));
  });
  // The line prints its units before its figures when its first figure has one there.
  const unitsFirst = before[0] != null;
  return figures.map((f, i) => {
    const b = before[i], a = after[i];
    // A phrase between this figure and the one before it that is only that phrase: whose it is depends on the layout.
    const sharedBefore = b != null && i > 0 && after[i - 1] != null && onlyUnitBetween(line.slice(figures[i - 1].end, f.start));
    const sharedAfter = a != null && i < figures.length - 1 && before[i + 1] != null && onlyUnitBetween(line.slice(f.end, figures[i + 1].start));
    const own = [unitsFirst || !sharedBefore ? b : null, !unitsFirst || !sharedAfter ? a : null].filter((u): u is string => u != null);
    // A unit before and a different one after ("Per day S$100 per year"): no one unit is the figure's.
    if (own.length === 2 && own[0] !== own[1]) return "?";
    return own[0] ?? "";
  });
}
/** Text between two figures that holds only a unit phrase (and separators or a cap word). */
function onlyUnitBetween(text: string): boolean {
  const rest = text.replace(AFTER, " ").replace(BEFORE, " ").replace(/\b(?:up\s+to|max(?:imum)?(?:\s+of)?|limit(?:ed)?\s+(?:of|to)|or|and)\b/gi, " ");
  return /^[\s|/;,:()\-–.]*$/.test(rest);
}
/** Text between two cells with the next cell's unit phrase taken off its end ("| per night " -> "| "), for a line that
 * prints its units before its figures. */
export function withoutUnitBefore(text: string): string {
  return text.replace(BEFORE, "");
}
/** Units that pay by time: a figure printed with one is a rate, never a whole amount. */
export const RATE_UNITS = new Set(["day", "night", "week", "month", "hour"]);
