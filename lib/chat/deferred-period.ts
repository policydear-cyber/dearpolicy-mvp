/** "Tom has been off work for 3 months, can he claim on his income protection?": the time off work the household
 * states, against the deferred (waiting) period the plan prints. The comparison is computed here, in code, from the
 * two printed spans; a model never does the arithmetic. Months and years are not a fixed number of days, so every
 * span is a range of days and the answer says "about the same" whenever the ranges overlap. Pure. */

/** A length of time as a range of days ("3 months" is 84 to 93 days). */
export type Span = { min: number; max: number; text: string };

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, "twenty-four": 24, "twenty-six": 26, thirty: 30, "fifty-two": 52 };
const N = "(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|eighteen|twenty|twenty-four|twenty-six|thirty|fifty-two)";
const UNIT = "(days?|weeks?|months?|years?)";

function span(count: string, unit: string): Span | null {
  const n = /^\d+$/.test(count) ? Number(count) : NUMBER_WORDS[count.toLowerCase()];
  if (!n || n > 400) return null;
  const u = unit.toLowerCase().replace(/s$/, "");
  const [lo, hi] = u === "day" ? [1, 1] : u === "week" ? [7, 7] : u === "month" ? [28, 31] : [365, 366];
  return { min: n * lo, max: n * hi, text: n + " " + u + (n === 1 ? "" : "s") };
}

/** Not working, said in the household's words. */
const OFF_WORK = /\b(?:off work|off sick|signed off|on sick leave|on medical leave|unable to work|can(?:not|['’]t) work|not (?:been )?(?:able to )?work(?:ing)?|out of work|away from work|hasn['’]t worked|haven['’]t worked|hasn['’]t been working)\b/i;

/** Time off that is still to come ("for the next 2 months", "will be off"): not time already off work. */
const FUTURE = new RegExp("\\b(?:next|coming|another|further)\\s+(?:" + N + "\\s+)?" + UNIT + "\\b|\\b(?:will|going to|expect(?:ed|s)? to)\\s+(?:be\\s+)?(?:off|out|away|unable|signed)\\b", "i");
/** A length printed beside the plan's own period words ("his deferred period is 13 weeks") is the period, not time off. */
const PERIOD_LENGTH = new RegExp("\\b(?:deferred|deferment|waiting|elimination|qualifying)\\s+period\\b[^.?!;\\d]{0,20}" + N + "\\s+" + UNIT + "\\b|\\b" + N + "\\s+" + UNIT + "\\s+(?:deferred|deferment|waiting|elimination|qualifying)\\b", "i");

/** How long the person has been off work, when the message says it once and says it as the time off itself ("off work
 * for 3 months", "off sick for the past six weeks", "signed off 10 days ago"). Two different lengths, a length that is the
 * plan's period, time off still to come, or none, give null. */
export function timeOffWork(message: string): Span | null {
  if (!OFF_WORK.test(message) || FUTURE.test(message) || PERIOD_LENGTH.test(message)) return null;
  // The length belongs to the off-work phrase: right after it ("off work for 3 months", "off sick for the past six weeks",
  // "unable to work for a year now"), or "N units ago" in the same message ("signed off 10 days ago").
  const own = new RegExp(OFF_WORK.source + "(?:\\s+(?:now|already|since then))?\\s+(?:for|over)\\s+(?:the\\s+)?(?:past\\s+|last\\s+)?(?:about\\s+|around\\s+|nearly\\s+|almost\\s+|over\\s+)?" + N + "\\s+" + UNIT + "\\b|\\b" + N + "\\s+" + UNIT + "\\s+ago\\b", "gi");
  const spans = [...message.matchAll(own)].map((m) => (m[1] ? span(m[1], m[2]) : span(m[3], m[4]))).filter((s): s is Span => !!s);
  if (!spans.length) return null;
  // Every length the message states: two different ones ("2 weeks ... 3 months") leave it unclear which is meant.
  const every = [...message.matchAll(new RegExp("\\b" + N + "\\s+" + UNIT + "\\b", "gi"))].map((m) => span(m[1], m[2])).filter((s): s is Span => !!s);
  const distinct = [...new Map([...spans, ...every].map((s) => [s.min + "-" + s.max, s])).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

/** The deferred or waiting period a schedule line prints ("Deferred period\t13 weeks", "Waiting period: 30 days"). A
 * line with two lengths ("4 or 13 weeks", "13 weeks (26 weeks for self-employed)") gives null. */
export function printedWaitingPeriod(line: string): { label: string; span: Span } | null {
  // The label, then one length and nothing else ("Waiting period for maternity 280 days" is another benefit's).
  const m = line.match(new RegExp("^\\s*((?:deferred|deferment|waiting|elimination|qualifying)\\s+period)\\s*(?:[:\\t-]\\s*|\\s(?:is|of)\\s+)?" + N + "\\s+" + UNIT + "\\s*[.;]?\\s*$", "i"));
  if (!m) return null;
  const lengths = [[m[0], m[2], m[3]]];
  const s = span(lengths[0][1], lengths[0][2]);
  return s ? { label: m[1].toLowerCase().replace(/\s+/g, " "), span: s } : null;
}

function length(days: number) {
  return days >= 14 && days % 7 === 0 ? days / 7 + " weeks" : days + " day" + (days === 1 ? "" : "s");
}

/** How the time off compares with the waiting period, in words, and what is left of it when it has not passed. */
export function compareWithWaiting(off: Span, waiting: Span): { state: "passed" | "about" | "not_yet"; left: string | null } {
  if (off.min > waiting.max) return { state: "passed", left: null };
  if (off.max < waiting.min) {
    const lo = waiting.min - off.max, hi = waiting.max - off.min;
    // Said in the period's own unit when it is printed in days ("30 days": 20 days to go).
    if (/days?$/.test(waiting.text)) return { state: "not_yet", left: lo === hi ? lo + " day" + (lo === 1 ? "" : "s") : "about " + lo + " to " + hi + " days" };
    return { state: "not_yet", left: lo === hi ? (lo >= 14 && lo % 7 ? "about " + Math.round(lo / 7) + " weeks" : length(lo)) : lo >= 14 ? "about " + Math.floor(lo / 7) + " to " + Math.ceil(hi / 7) + " weeks" : "about " + lo + " to " + hi + " days" };
  }
  return { state: "about", left: null };
}

/** The sentence that answers the question, from the stated time off and the printed line. Never says the insurer will
 * pay: income protection normally pays only after the waiting period, and the insurer decides the claim. */
export function waitingPeriodSentence(who: string, off: Span, printed: { label: string; span: Span }, plan: string): string {
  const { state, left } = compareWithWaiting(off, printed.span);
  const period = "the " + printed.label + " of " + printed.span.text + " that " + plan + " prints";
  if (state === "passed") return who + " has been off work for " + off.text + ", which is longer than " + period + ". That period has passed, and benefit is normally paid only after it; whether the claim is accepted is the insurer’s decision.";
  if (state === "about") return who + " has been off work for " + off.text + ", which is about the same as " + period + ", so that period ends around now. Benefit is normally paid only after it ends; the insurer decides the claim and the exact dates.";
  return who + " has been off work for " + off.text + ", which is shorter than " + period + ", with " + left + " still to go (counted from the first day off work). Benefit is normally not paid during that period; it is still worth telling the insurer now.";
}

/** The message asks about the plan that pays while someone can't work (closed list), and about nothing else that
 * happened: "Tom broke his leg and has been off work for 6 weeks, what can he claim?" is a fracture and hospital claim
 * first, so the usual answer stays and this comparison is not given in its place. */
const INCOME_ASKED = /\b(?:income protection|income (?:benefit|cover|insurance|plan|replacement|continuance)|disability (?:income|insurance|benefit|cover|plan)|salary (?:continuance|protection|cover|plan)|permanent health|loss of income|(?:deferred|deferment|waiting|elimination|qualifying) period)\b/i;
const OTHER_EVENT = /\b(?:broke|broken|break|fractur\w*|hospital\w*|warded|surgery|surgical|operation|accident\w*|injur\w*|diagnos\w*|cancer|heart attack|stroke|dental|died|death|passed away|disabled for life|permanent(?:ly)? disab\w*)\b/i;
export function asksAboutIncomeCover(message: string): boolean {
  return INCOME_ASKED.test(message) && !OTHER_EVENT.test(message);
}
