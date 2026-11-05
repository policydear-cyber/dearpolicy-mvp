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
/** A unit printed right after a figure: "per day", "per policy year", "/night", "each trip", "daily", "a day". "Per
 * (insured) person" before another unit ("S$50 per person per day") gives way to that unit. */
const AFTER = new RegExp(String.raw`^\s*\(?\s*(?:(?:per|each|every|for\s+each)\s+(?:insured\s+)?(?:person|member)\s*,?\s*(?=(?:per|a|an|each)\s))?(?:(?:per|each|every|for\s+each|a|an)\s+(?:policy\s+|calendar\s+|insured\s+)?(${UNIT_WORDS})s?\b|\/\s*(${UNIT_WORDS})s?\b|(daily|nightly|weekly|monthly|yearly|annually)\b)`, "i");
/** A unit printed right before a figure, with at most a colon, a dash, "of" or a cap word between them: "Per day S$100",
 * "Per disability: S$5,000", "Daily S$80", "Each trip up to S$500", "per day - maximum of S$200". */
const BEFORE = new RegExp(String.raw`(?:\b(?:per|each|every|for\s+each)\s+(?:policy\s+|calendar\s+|insured\s+)?(${UNIT_WORDS})s?|\b(daily|nightly|weekly|monthly|yearly|annually))\s*[:\-–]?\s*((?:up\s+to|max(?:imum)?(?:\s+of)?|limit(?:ed)?\s+(?:of|to)|of)\s*)?\(?\s*$`, "i");
/** A cap word between the unit phrase and the figure ("S$300 per day maximum S$9,000"): after another figure, the phrase
 * is that figure's unit and the cap is a whole amount. */
const CAP_AFTER_UNIT = /^(?:up|max|limit)/i;
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
    const m = line.slice(from, f.start).match(BEFORE);
    if (m && i > 0 && m[3] && CAP_AFTER_UNIT.test(m[3])) return null;
    return unitOf(m);
  });
  const after = figures.map((f, i) => {
    const to = i < figures.length - 1 ? figures[i + 1].start : line.length;
    return unitOf(line.slice(f.end, to).match(AFTER));
  });
  // The line prints its units before its figures when its first figure has one there.
  const unitsFirst = before[0] != null;
  const out: string[] = [];
  figures.forEach((f, i) => {
    const b = before[i], a = after[i];
    // A phrase between this figure and the one before it that is only that phrase: whose it is depends on the layout.
    const sharedBefore = b != null && i > 0 && after[i - 1] != null && onlyUnitBetween(line.slice(figures[i - 1].end, f.start));
    const sharedAfter = a != null && i < figures.length - 1 && before[i + 1] != null && onlyUnitBetween(line.slice(f.end, figures[i + 1].start));
    let own = [unitsFirst || !sharedBefore ? b : null, !unitsFirst || !sharedAfter ? a : null].filter((u): u is string => u != null);
    // "Per (insured) person" on one side gives way to a unit on the other ("Per insured person: S$2,000 a month").
    if (own.length === 2 && own.some((u) => u === "person") && own.some((u) => u !== "person")) own = own.filter((u) => u !== "person");
    // A rate unit before and a different unit after ("Per day S$100 per year"): no one unit is the figure's. Two units
    // that are no rate ("each trip up to S$500 per person") may both hold: the first printed stands.
    if (own.length === 2 && own[0] !== own[1] && (RATE_UNITS.has(own[0]) || RATE_UNITS.has(own[1]))) { out.push("?"); return; }
    // On a line that prints its units first, a cell with none of its own right after another cell ("Per day: S$100 S$200",
    // "Per night: S$80 | S$120") is in the same run under the same unit.
    if (!own.length && unitsFirst && i > 0 && /^[\s|/;,]*(?:or\b)?[\s|/;,]*$/i.test(line.slice(figures[i - 1].end, f.start))) { out.push(out[i - 1]); return; }
    out.push(own[0] ?? "");
  });
  return out;
}
/** For a line that prints its units before its figures: each figure's unit as the run prints it. The unit printed right
 * before the figure; else a unit printed right after it ("Per day S$100 or S$200 per year": the second is yearly); else,
 * with no unit on either side, the one printed before an earlier figure of the line ("Per day S$100 for Plan A, S$200 for
 * Plan B": both daily). "For each (insured) person" after a figure is no unit of its own, so it never sets a cell apart
 * from the run ("Per day S$100 | S$200 for each insured person"). A cap word between a unit and its figure ("per day
 * maximum S$9,000") gives no unit; the caller reads it as a cap. "" before any unit is printed. */
export function runUnitsBefore(line: string, figures: FigureSpan[]): string[] {
  let run = "";
  return figures.map((f, i) => {
    const m = line.slice(i > 0 ? figures[i - 1].end : 0, f.start).match(BEFORE);
    if (m && i > 0 && m[3] && CAP_AFTER_UNIT.test(m[3])) return run;
    const u = unitOf(m);
    if (u) { run = u; return u; }
    const a = unitOf(line.slice(f.end, i < figures.length - 1 ? figures[i + 1].start : line.length).match(AFTER));
    if (a && a !== "person" && a !== "member") return a;
    return run;
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
