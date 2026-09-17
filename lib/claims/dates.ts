export type ClaimDateContext = { now?: Date; timeZone?: string };
export type ResolvedClaimDate = { date: string; expression: string; relative: boolean };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function claimTimeZone(value?: string) {
  const candidate = value || process.env.CLAIM_TIME_ZONE || "Asia/Singapore";
  try { new Intl.DateTimeFormat("en", { timeZone: candidate }).format(); return candidate; }
  catch { return "Asia/Singapore"; }
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function claimLocalToday(context: ClaimDateContext = {}) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: claimTimeZone(context.timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(context.now ?? new Date());
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysFrom(today: string, days: number) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Dates are calendar dates in the user's zone, never the server's UTC day. */
export function resolveClaimDate(text: string, context: ClaimDateContext = {}): ResolvedClaimDate | null {
  const today = claimLocalToday(context);
  const monthPattern = MONTHS.map(m => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|");
  const candidates = [
    { type: "explicit", match: text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/) },
    { type: "explicit", match: text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/) },
    { type: "named", match: text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})[,.]?\\s+(\\d{4})\\b`, "i")) },
    { type: "usNamed", match: text.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "i")) },
    { type: "relative", match: text.match(/\b(day before yesterday|yesterday|today|(?:\d+|one|two|three|a)\s+(?:days?|weeks?)\s+ago|(?:last|this)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i) },
  ].filter(c => c.match).sort((a,b) => a.match!.index! - b.match!.index!);
  const first = candidates[0];
  const explicit = first?.type === "explicit" ? first.match : null;
  if (explicit) {
    const yearFirst = explicit[1].length === 4;
    const date = isoDate(Number(explicit[yearFirst ? 1 : 3]), Number(explicit[2]), Number(explicit[yearFirst ? 3 : 1]));
    return date ? { date, expression: explicit[0], relative: false } : null;
  }
  const named = first?.type === "named" ? first.match : null;
  const usNamed = first?.type === "usNamed" ? first.match : null;
  if (named || usNamed) {
    const m = named ?? usNamed!;
    const month = MONTHS.findIndex(value => value.startsWith(m[named ? 2 : 1].toLowerCase())) + 1;
    const date = isoDate(Number(m[3]), month, Number(m[named ? 1 : 2]));
    return date ? { date, expression: m[0], relative: false } : null;
  }
  const relative = first?.type === "relative" ? first.match : null;
  if (!relative) return null;
  const expression = relative[0].toLowerCase();
  let offset = 0;
  if (expression === "yesterday") offset = -1;
  else if (expression === "day before yesterday") offset = -2;
  else if (/ago$/.test(expression)) {
    const number = expression.split(" ")[0];
    const count = ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[number] ?? Number(number);
    offset = -count * (/week/.test(expression) ? 7 : 1);
  } else if (/^(last|this) /.test(expression)) {
    const weekday = WEEKDAYS.indexOf(expression.split(" ")[1]);
    const elapsed = (new Date(`${today}T00:00:00Z`).getUTCDay() - weekday + 7) % 7;
    offset = -(elapsed || (expression.startsWith("last ") ? 7 : 0));
  }
  return { date: daysFrom(today, offset), expression: relative[0], relative: true };
}

export function claimDateInFuture(date: string, context: ClaimDateContext = {}) {
  return date > claimLocalToday(context);
}
