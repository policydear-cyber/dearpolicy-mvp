import { printedDay } from "./dates";

/** A child's share printed inside a percentage row's own amount cell ("100% of the Sum Insured. For an insured child under
 * 18, limited to 25% of the Sum Insured."). Acceptance run TE-ACC-20261113 R2, H1-B: a child's accidental death on a family
 * schedule had no amount, because the cell's second percentage made the row unreadable for everyone.
 * One allow-list, for any insurer, wording and currency: the cell's other sentences print only the row's own share, and the
 * child's sentence is one of a few plain shapes ("For/If/Where an insured child (under N), [the benefit is] limited to /
 * reduced to C% of the Sum Insured", "Limited to C% of the Sum Insured for an insured child under N", "Children (under N):
 * C%"). Anything else (a negation, a co-pay or excess, another benefit or another person's sum, an age said as "up to",
 * two such sentences) is not read, and the row is as it was.
 * Whom it is for is settled only from the schedule's own line for the person (personStatus): with an age in the sentence,
 * the date of birth printed in a "Date of birth" column or after a "Date of birth:" label, on every day it could matter
 * (today and the printed period of insurance); with no age, the printed relationship ("Child", "Son", "Daughter";
 * "Policyholder", "Spouse"). Otherwise no amount, and the row's printed words are quoted with the condition. Pure. */
export type ChildLimit = { percent: number; belowAge: number | null; words: string };

const CHILD = String.raw`(?:(?:an?|the|each|any|every)\s+)?(?:(?:insured|covered|dependent|dependant|eligible)\s+)?(?:child(?:ren)?|minors?|juveniles?)`;
/** "under 18", "below the age of 16", "aged under 18 years", "younger than 18 years of age", "(under 18)", "aged 17 or
 * under" (below 18). Never "up to age 17" or "aged 17 and over" (whether the age itself counts is not plain). */
const AGE = String.raw`(?:\s*\(?\s*(?:(?:who\s+(?:is|are)\s+)?(?:aged\s+)?(?:under|below|younger\s+than|less\s+than)\s+(?:the\s+age\s+of\s+|age\s+)?(\d{1,2})(?:\s+years?(?:\s+(?:old|of\s+age))?)?|aged\s+(\d{1,2})(?:\s+years?)?\s+(?:or|and)\s+(?:under|below|younger))\s*\)?)?`;
/** The child's share: "25% of the Sum Insured", "25 per cent of the benefit", "25%". */
const SHARE = String.raw`(\d{1,2}(?:\.\d+)?)\s*(?:%|per\s?cent)(?:\s+of\s+(?:the\s+|their\s+|its\s+|this\s+|that\s+)?(sum\s+(?:insured|assured)|benefit(?:\s+amount)?|amount(?:\s+payable)?|amount\s+(?:above|shown)))?`;
/** "limited to", "the benefit is reduced to", "the amount payable is restricted to", "capped at". */
const LIMIT = String.raw`(?:(?:(?:(?:the|this)\s+(?:benefit|amount(?:\s+payable)?|sum\s+payable|payment)\s+|it\s+)?(?:is\s+|will\s+be\s+)?)?(?:limited|reduced|restricted)\s+to|capped\s+at)`;
const FOR = String.raw`(?:for|if|where|when|in\s+respect\s+of)\s+(?:the\s+(?:insured\s+person|insured|life\s+insured|life\s+assured)\s+is\s+)?`;
const END = String.raw`\s*[.;]?\s*$`;
/** The three shapes, each the whole sentence:
 * 1) "For/If/Where an insured child (under N), [limited to] C% [of the Sum Insured]";
 * 2) "[Limited to] C% [of the Sum Insured] for an insured child (under N)";
 * 3) "[Insured] children (under N): C% [of the Sum Insured]". */
const SHAPES: { re: RegExp; age: [number, number]; pct: number; of: number }[] = [
  { re: new RegExp(String.raw`^${FOR}${CHILD}${AGE}\s*[,:\-–]?\s*(?:${LIMIT}\s+)?${SHARE}${END}`, "i"), age: [1, 2], pct: 3, of: 4 },
  { re: new RegExp(String.raw`^(?:${LIMIT}\s+)?${SHARE}\s+${FOR}${CHILD}${AGE}${END}`, "i"), age: [3, 4], pct: 1, of: 2 },
  { re: new RegExp(String.raw`^${CHILD}${AGE}\s*[:\-–]\s*(?:${LIMIT}\s+)?${SHARE}${END}`, "i"), age: [1, 2], pct: 3, of: 4 },
];
/** Words that name a kind of life or an age: exactly one sentence of the cell may hold them, the child's. */
const LIFE_WORDS = /\b(?:child(?:ren)?|kids?|minors?|infants?|juveniles?|juniors?|sons?|daughters?|adults?|seniors?|elderly|spouses?|dependants?|dependents?|aged?|years?\s+old)\b/i;
/** A sentence that takes the share away or makes it something else: never read. */
const NOT_PLAIN = /\b(?:not|no|never|none|except|excluding|unless|nor|excess|deductible|co-?pay\w*|co-?insurance|premium|additional|extra|plus|less|minus|maximum|up\s+to)\b|n['’]t\b/i;

/** The cell's sentences: split after a full stop followed by a capital, and at a semicolon. */
const sentencesOf = (text: string) => text.replace(/\s+/g, " ").split(/(?<=\.)\s+(?=[A-Z(])|;\s*/).map((s) => s.trim()).filter(Boolean);

/** The child's share a percentage row's own printed words give, or null. `cell`: the row's whole printed amount cell (its
 * quote and the rest of its line); `own`: the row's own percentage. The cell must hold exactly one sentence naming a kind
 * of life or an age, and it must be one of SHAPES, with a share below the row's own and of the sum insured (or of the
 * benefit, or with no base, only when the row's own share is 100%, where all three are the same). */
export function childLimitIn(cell: string, own: number | null): ChildLimit | null {
  if (own == null || !(own > 0)) return null;
  const sentences = sentencesOf(cell);
  const life = sentences.filter((s) => LIFE_WORDS.test(s));
  if (life.length !== 1) return null;
  const words = life[0];
  if (NOT_PLAIN.test(words)) return null;
  for (const shape of SHAPES) {
    const m = shape.re.exec(words);
    if (!m) continue;
    const percent = Number(m[shape.pct]);
    const of = (m[shape.of] ?? "").toLowerCase();
    if (!(percent > 0) || percent >= own) return null;
    if (!/^sum\s/.test(of) && Math.abs(own - 100) > 1e-9) return null;
    const under = m[shape.age[0]], orUnder = m[shape.age[1]];
    const belowAge = under != null ? Number(under) : orUnder != null ? Number(orUnder) + 1 : null;
    if (belowAge != null && (belowAge < 1 || belowAge > 30)) return null;
    return { percent, belowAge, words };
  }
  return null;
}
/** The cell's words without the child's sentence: what the row's own share and limit checks read (a "limited to" in the
 * child's sentence is the child's share, never a money cap on the row). */
export function withoutChildLimit(text: string, limit: Pick<ChildLimit, "words"> | null | undefined): string {
  if (!limit) return text;
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(limit.words.toLowerCase());
  return at < 0 ? text : `${flat.slice(0, at)} ${flat.slice(at + limit.words.length)}`.trim();
}

/** What the schedule prints about one person, from their own line of its people table. */
export type PrintedLife = { birth: string | null; relationship: string | null };
const BIRTH_HEAD = /^(?:date\s+of\s+birth|birth\s*date|d\.?\s?o\.?\s?b\.?|born)$/i;
const RELATION_HEAD = /^(?:relationship(?:\s+to\s+(?:the\s+)?(?:policyholder|proposer|insured|policy\s+owner))?|relation)$/i;
const DATE = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}`;
const DATES = new RegExp(DATE, "g");
/** A money figure as a table row prints it: a currency code or sign beside a non-zero figure (a header's "(GBP 000)" is
 * not one). */
const MONEY = /(?:\b[A-Z]{3}|[£$€¥₹]|\bRM|\bS\$)\s?[\d,.]*[1-9]|[1-9][\d,.]*\s?(?:\b[A-Z]{3}\b|[£€])/;
/** The date of birth and relationship a page prints on one person's line. `lines`: the page's lines; `at`: the person's
 * line; `person`: their printed name; `others`: the other names the document prints for its insured lives.
 * - By column: the person's line has tab cells; the lines right above it with as many cells, each printing a date or
 *   money, are its table's rows; the first line above them is the only header candidate, never looked past (gates H2,
 *   R3-H1: another table's header is never reached, whatever digits a header prints). Read only when that line has as
 *   many cells as the person's line and names "Date of birth" or "Relationship" exactly once.
 * - By label: "<the person's name>, date of birth: <date>" / "(DOB <date>)" / "born <date>", the label right after the
 *   person's own name, on a line naming no one else the document names and printing no other date (gate H3: "child of
 *   <parent> (Policyholder date of birth ...)" is never the child's). */
export function printedLife(lines: string[], at: number, person = "", others: string[] = []): PrintedLife {
  const line = lines[at] ?? "";
  const cells = line.split("\t").map((c) => c.trim());
  let birth: string | null = null, relationship: string | null = null;
  if (cells.length >= 2) {
    // Up through the same table's own rows only: as many cells as the person's line, each printing a date or money.
    // The first other line is the only header candidate, and it is never looked past (gate R3-H1).
    const dataRow = (t: string) => t.split("\t").length === cells.length && (new RegExp(DATE).test(t) || MONEY.test(t));
    let i = at - 1;
    while (i >= 0 && i >= at - 12 && dataRow(lines[i])) i--;
    const head = i >= 0 && i >= at - 12 ? lines[i].split("\t").map((c) => c.trim()) : [];
    if (head.length === cells.length) {
      const b = head.flatMap((h, k) => (BIRTH_HEAD.test(h) ? [k] : [])), r = head.flatMap((h, k) => (RELATION_HEAD.test(h) ? [k] : []));
      if (b.length === 1 && new RegExp(String.raw`^(?:${DATE})$`).test(cells[b[0]])) birth = cells[b[0]];
      if (r.length === 1 && /^[A-Za-z][A-Za-z ()/-]{1,40}$/.test(cells[r[0]])) relationship = cells[r[0]];
    }
  }
  const words = (n: string) => n.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const own = words(person);
  const lower = line.toLowerCase();
  const named = (n: string) => { const w = n.trim().toLowerCase(); return !!w && lower.includes(w); };
  if (!birth && own.length && !others.some((o) => o.trim().toLowerCase() !== person.trim().toLowerCase() && named(o))) {
    const m = new RegExp(String.raw`(?<![\p{L}\p{N}])${own.join(String.raw`\s+`)}\s*[,(\-–]?\s*(?:date\s+of\s+birth|d\.?o\.?b\.?|born(?:\s+on)?)\s*[:\-]?\s*(${DATE})(?=\s*(?:[),;]|\t|$))`, "iu").exec(line);
    if (m && (line.match(DATES) ?? []).length === 1) birth = m[1];
  }
  return { birth, relationship };
}

/** The relationships that make a person an insured child, a closed list: never a step, grand or in-law form, "adult child"
 * or "child (over 18)" (gate H1). */
const CHILD_RELATION = /^(?:child|son|daughter)$/i;
const ADULT_RELATION = /^(?:policy\s*holder|policy\s*owner|proposer|principal(?:\s+insured)?|main\s+insured|self|insured|spouse|husband|wife|partner|(?:legal|de\s+facto|civil)\s+(?:spouse|partner))$/i;

/** Whole years on a day count, from a printed birth date read one way. */
function yearsOn(y: number, mo: number, d: number, day: number): number {
  const now = new Date(day * 86_400_000);
  return now.getUTCFullYear() - y - (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d) ? 1 : 0);
}
/** A printed birth date's possible (year, month, day): "09/04/2017" may be day-first or month-first, so both are kept
 * when both are dates; "2017-04-09" and "9 April 2017" are one. */
function birthReadings(text: string): [number, number, number][] {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim());
  if (m) {
    const out: [number, number, number][] = [];
    for (const [d, mo] of [[Number(m[1]), Number(m[2])], [Number(m[2]), Number(m[1])]]) {
      const ms = Date.UTC(Number(m[3]), mo - 1, d), x = new Date(ms);
      if (x.getUTCMonth() === mo - 1 && x.getUTCDate() === d) out.push([Number(m[3]), mo, d]);
    }
    return out;
  }
  const day = printedDay(text);
  if (day == null) return [];
  const x = new Date(day * 86_400_000);
  return [[x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]];
}

/** Which side of an age a person is on every day given, by every reading of their printed date of birth: "under",
 * "over", or null (not settled: no readable date, or readings or days on both sides). */
function ageSide(birth: string, days: number[], age: number): "under" | "over" | null {
  const readings = birthReadings(birth);
  if (!readings.length || !days.length) return null;
  const seen = new Set<"under" | "over">();
  for (const [y, mo, d] of readings) for (const day of days) {
    const years = yearsOn(y, mo, d, day);
    if (years < 0 || years > 130) return null;
    seen.add(years < age ? "under" : "over");
  }
  return seen.size === 1 ? [...seen][0] : null;
}
const relationClass = (r: string | null | undefined): "child" | "adult" | "other" | null => {
  const t = (r ?? "").trim();
  return !t ? null : CHILD_RELATION.test(t) ? "child" : ADULT_RELATION.test(t) ? "adult" : "other";
};
/** Whether a person is the child the limit is for, on every day given (today and the printed period of insurance), from
 * the schedule's own line only, with why not when it is not settled:
 * - an age in the condition: the printed date of birth decides; with no age, the printed relationship (child, son or
 *   daughter; policyholder, self, insured, spouse, partner ...) decides;
 * - whatever decides, everything else the line prints must agree (gate H1): a printed relationship must be on one of the
 *   two closed lists, a child relationship needs a date of birth under 18 on every day, an adult one 18 or over, when a
 *   date of birth is printed; and with an age in the condition, a printed relationship must be printed too only if it
 *   agrees.
 * Anything else is not settled: no amount. */
export function personStatusWhy(life: PrintedLife | null | undefined, limit: Pick<ChildLimit, "belowAge">, days: number[]): { status: "child" | "not_child" } | { status: null; why: string } {
  const no = (why: string) => ({ status: null, why });
  if (!days.length) return no("has no day to settle it on");
  const rel = relationClass(life?.relationship), birth = life?.birth ?? null;
  if (rel === "other") return no(`prints the relationship "${life!.relationship!.trim()}", which does not settle whether they are insured as a child`);
  // The printed relationship and date of birth must agree: a child under 18, an adult 18 or over.
  if (rel && birth) {
    const side = ageSide(birth, days, 18);
    if (!side) return no(`prints a date of birth (${birth}) that does not settle whether they are under 18 on every day of the period of insurance`);
    if ((rel === "child") !== (side === "under")) return no(`prints a relationship ("${life!.relationship!.trim()}") and a date of birth (${birth}) that do not agree`);
  }
  if (limit.belowAge != null) {
    if (!birth) return no("does not print a date of birth");
    const side = ageSide(birth, days, limit.belowAge);
    if (!side) return no(`prints a date of birth (${birth}) that does not settle whether they are under ${limit.belowAge} on every day of the period of insurance`);
    return { status: side === "under" ? "child" : "not_child" };
  }
  if (!rel) return no("does not print whether they are insured as a child");
  return { status: rel === "child" ? "child" : "not_child" };
}
/** personStatusWhy's status alone. */
export function personStatus(life: PrintedLife | null | undefined, limit: Pick<ChildLimit, "belowAge">, days: number[]): "child" | "not_child" | null {
  return personStatusWhy(life, limit, days).status;
}
/** The days a status must hold on: today, and the document's printed period of insurance (each end) when printed. */
export function statusDays(today: number, from?: string | null, to?: string | null): number[] {
  return [today, printedDay(from ?? null), printedDay(to ?? null)].filter((d): d is number => d != null);
}
/** "under 18" / "a child" as the card says the limit's case. */
export const childCase = (limit: Pick<ChildLimit, "belowAge">) => limit.belowAge != null ? `an insured child under ${limit.belowAge}` : "an insured child";

/** A reading row's column that names only the child class of a child's share ("Insured child under 18", "Children (below
 * 16)", "Dependent child", "Minors aged 17 or under"): its age as ChildLimit.belowAge, or undefined when the column is
 * anything else (a plan, a tier, an age band, an adult). The real reader puts the child's sentence of a cell in a row of
 * its own under such a column (TE-ACC-20261114-R3); check.ts foldChildColumns folds it back into its parent row. */
export function childColumn(column: string | null | undefined): { belowAge: number | null } | undefined {
  const m = new RegExp(String.raw`^(?:for\s+)?${CHILD}${AGE}\s*$`, "i").exec((column ?? "").replace(/\s+/g, " ").trim());
  if (!m) return undefined;
  const under = m[1], orUnder = m[2];
  return { belowAge: under != null ? Number(under) : orUnder != null ? Number(orUnder) + 1 : null };
}
