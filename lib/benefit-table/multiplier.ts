import { moneyFiguresIn } from "@/lib/chat/answer-verification";

/** A row's own printed condition that pays a multiple of the row's amount in one stated case ("a compound fracture is paid
 * at double the Section 3 amount", "the benefit is doubled while travelling on public transport", "three times the
 * amount", "150% of the benefit for a fracture of the skull"). One general rule for any insurer, wording and currency: the
 * multiple is read from the words only, and applies only when the household's own words in the conversation state its case
 * (multiplierFor). Read by the row step (lib/benefit-table/chat.ts serverFigureOf) and read again from the stored page by the
 * chat's checks (lib/simple-chat/verify.ts serverFigureChecked), so a card never shows the single amount for a doubled case,
 * nor a doubled amount for a case nobody described (Harbourline family PA test, 13 Nov: "compound fracture" said, card
 * still the single 2% of the sum). */
export type Multiplier = { times: number; condition: string; keepsCap: boolean };

const TIMES: Record<string, number> = { double: 2, doubled: 2, twice: 2, treble: 3, trebled: 3, triple: 3, tripled: 3, half: 0.5, halved: 0.5,
  two: 2, three: 3, four: 4, five: 5 };
/** Only a multiple said of the amount itself: "paid at double", "is doubled", "twice the ... amount", "3 times the
 * benefit", "150% of the ... amount". "a double room" or "2% of the Sum Insured" is never one. */
const MULTIPLE = new RegExp([
  String.raw`\b(?:paid|payable|pays|paying|is|are|be)\s+(?:out\s+)?(?:at\s+)?(double|twice|treble|triple|half)\b`,
  String.raw`\b(doubled|trebled|tripled|halved)\b`,
  // Said of the amount right after it ("twice the Section 3 amount"), never of a count ("cannot be claimed twice for the
  // same benefit").
  String.raw`\b(twice|double|treble|triple|half)\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable|figure|rate)\b`,
  String.raw`(?<![\d.])(\d+(?:\.\d+)?|two|three|four|five)\s+times\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable|figure|rate)\b`,
  String.raw`(?<![\d.])(\d+(?:\.\d+)?)\s?(?:%|per\s?cent)\s+of\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable)\b`,
].join("|"), "gi");

/** The one multiple a condition prints, with the condition's words left once it is taken out; "unsure" when it prints two
 * different ones; null when none (or 1: "100% of the benefit" is the amount itself). */
export function multipleIn(text: string): { times: number; rest: string } | "unsure" | null {
  const found = [...text.matchAll(MULTIPLE)].map((m) => {
    const w = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").toLowerCase();
    return { at: m, times: m[5] != null ? Number(m[5]) / 100 : TIMES[w] ?? Number(w) };
  }).filter((x) => Number.isFinite(x.times) && x.times > 0 && Math.abs(x.times - 1) > 1e-9);
  if (!found.length) return null;
  if (new Set(found.map((x) => x.times)).size > 1) return "unsure";
  let rest = text;
  for (const x of found) rest = rest.replace(x.at[0], " , ");
  return { times: found[0].times, rest };
}

/** A condition that keeps the row's printed maximum on the multiplied amount: it prints only that maximum's figure, or says
 * the same maximum still applies ("still subject to the GBP 1,500 maximum", "subject to the same limit"). Otherwise
 * whether the maximum is multiplied too is not said, so a multiplied amount above it is never shown. */
export function keepsCapIn(text: string, cap: number | null): boolean {
  const figs = moneyFiguresIn(text);
  if (cap != null && figs.length && figs.every((f) => Math.abs(f.value - cap) < 0.005)) return true;
  return !figs.length && /\bstill\s+subject\s+to\b|\bsubject\s+to\s+the\s+same\b|\bthe\s+same\s+(?:maximum|limit|cap)\b|\b(?:maximum|limit|cap)\s+(?:still\s+)?applies\b/i.test(text);
}

/** Words that never name the case a multiple is paid in: grammar, how a benefit is paid, money and insurance words. Closed
 * list, like the file's other word lists; the row's own benefit and quote words are taken out as well (multiplierFor). */
const NOT_CASE = new Set(("a an the and or of to in on at by for from with within without as is are was were be been being it its this that these those " +
  "which who whom whose where when while if unless until any each every one per all such than then there their his her our your my " +
  "paid pay pays payable paying payment amount amounts benefit benefits sum sums insured assured figure rate section sections table schedule " +
  "note notes maximum minimum max limit limits limited cap capped subject still same applies apply applied up only also further " +
  "claim claims claimed policy cover covered insurer person persons life lives member members event events case cases " +
  "happen happens happened occur occurs occurred result results resulting resulted caused cause due suffered suffer sustained " +
  "injury injuries injured accident accidents accidental bodily illness item items total year years day days time times " +
  "not never cannot can will shall may must would should has have had does did being").split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z]+/).filter((w) => w.length >= 3);
const stem = (w: string) => w.length > 4 && w.endsWith("es") && /(?:ch|sh|x|ss|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
const NEGATION = /^(?:not|no|never|without|nor|isnt|wasnt|arent|werent|doesnt|didnt|dont|hasnt|hadnt)$/;

/** Each case a condition's multiple is paid in, as the words that name it: its parts split at "or" and commas, each part's
 * words that are not NOT_CASE and not the row's own words. "a compound fracture is paid at double the Section 3 amount,
 * still subject to the GBP 1,500 maximum" on a "Fracture of arm, wrist or leg" row gives [["compound"]]. */
export function caseWords(rest: string, own: string): string[][] {
  const mine = new Set(tokens(own).map(stem));
  return rest.replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "").split(/\bor\b|[,;/()]|\band\/or\b/i)
    .map((part) => [...new Set(tokens(part).map(stem).filter((w) => !NOT_CASE.has(w) && !mine.has(w)))]).filter((p) => p.length > 0);
}

/** The household states a case when every word of one of its parts is in their words and none is said only after a
 * negation within three words ("it was not a compound fracture" states nothing). */
export function statesCase(parts: string[][], heard: string): boolean {
  const said = tokens(heard);
  const stated = (w: string) => said.some((x, i) => stem(x) === w && !said.slice(Math.max(0, i - 3), i).some((y) => NEGATION.test(y)));
  return parts.some((p) => p.every(stated));
}

/** The multiple the row's own printed conditions pay in a case the household's words state: null when none applies; "unsure"
 * when a stated condition prints two multiples, or two stated conditions print different ones (no amount is then shown).
 * `own` is the row's benefit name and printed quote; `cap` is the row's printed maximum, if any. */
export function multiplierFor(conditions: readonly string[], own: string, heard: string, cap: number | null): Multiplier | "unsure" | null {
  if (!heard.trim()) return null;
  const hits: Multiplier[] = [];
  for (const c of conditions) {
    const m = multipleIn(c);
    if (!m) continue;
    const parts = caseWords(m === "unsure" ? c : m.rest, own);
    if (!statesCase(parts, heard)) continue;
    if (m === "unsure") return "unsure";
    hits.push({ times: m.times, condition: c, keepsCap: keepsCapIn(c, cap) });
  }
  if (!hits.length) return null;
  return new Set(hits.map((h) => h.times)).size > 1 ? "unsure" : hits[0];
}

/** "double", "3 times", "150%": the multiple as the card's working says it. */
export const timesWords = (t: number) => t === 2 ? "double" : t === 3 ? "treble" : t === 0.5 ? "half" : Number.isInteger(t) ? `${t} times` : `${Math.round(t * 1000) / 10}%`;
