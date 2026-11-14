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
/** A whole cell that is one money figure, as a table row prints it: a currency code or sign beside a non-zero figure and
 * nothing else (a header's "Sum Insured (max GBP 250,000)" or "(GBP 000)" is not one). */
const WHOLE_MONEY = /^(?:(?:[A-Z]{3}|[£$€¥₹]|RM|S\$|US\$)\s?(?=[\d,.]*[1-9])\d[\d,]*(?:\.\d+)?|(?=[\d,.]*[1-9])\d[\d,]*(?:\.\d+)?\s?(?:[A-Z]{3}|[£€]))$/;
/** A whole cell that is one date. */
const WHOLE_DATE = new RegExp(String.raw`^(?:${DATE})$`);
/** The date of birth and relationship a page prints on one person's line. `lines`: the page's lines; `at`: the person's
 * line; `person`: their printed name; `others`: the other names the document prints for its insured lives.
 * - By column: the person's line has tab cells; the lines right above it with as many cells, at least one of them a
 *   whole date or money cell and none mixing words and digits, are its table's rows; the first line above them is the
 *   only header candidate, never looked past (gates H2, R3-H1, R4-H1: another table's header is never reached, and a
 *   header cell such as "Sum Insured (max GBP 250,000)" is a header, not a row). Read only when that line has as many
 *   cells as the person's line and names "Date of birth" or "Relationship" exactly once, and the birth cell is a whole
 *   date no other cell of the person's line repeats (R4-H1: never the cover start).
 * - By label: "<the person's name>, date of birth: <date>" / "(DOB <date>)" / "born <date>", the label right after the
 *   person's own name, on a line naming no one else the document names and printing no other date (gate H3: "child of
 *   <parent> (Policyholder date of birth ...)" is never the child's); after the date only an optional ")" and the end of
 *   the cell (gate R4-H4: "born <date>; policyholder's date" is not theirs). */
export function printedLife(lines: string[], at: number, person = "", others: string[] = []): PrintedLife {
  const line = lines[at] ?? "";
  const cells = line.split("\t").map((c) => c.trim());
  let birth: string | null = null, relationship: string | null = null;
  if (cells.length >= 2) {
    // Up through the same table's own rows only: as many cells as the person's line, at least one a whole date or money
    // cell, and no cell mixing words and digits. The first other line is the only header candidate, and it is never
    // looked past (gates R3-H1, R4-H1).
    const whole = (c: string) => WHOLE_DATE.test(c) || WHOLE_MONEY.test(c);
    const dataRow = (t: string) => {
      const cs = t.split("\t").map((c) => c.trim());
      return cs.length === cells.length && cs.some(whole) && cs.every((c) => whole(c) || !/\d/.test(c) || !/\p{L}/u.test(c));
    };
    let i = at - 1;
    while (i >= 0 && i >= at - 12 && dataRow(lines[i])) i--;
    const head = i >= 0 && i >= at - 12 ? lines[i].split("\t").map((c) => c.trim()) : [];
    if (head.length === cells.length) {
      const b = head.flatMap((h, k) => (BIRTH_HEAD.test(h) ? [k] : [])), r = head.flatMap((h, k) => (RELATION_HEAD.test(h) ? [k] : []));
      if (b.length === 1 && WHOLE_DATE.test(cells[b[0]]) && cells.filter((c) => c === cells[b[0]]).length === 1) birth = cells[b[0]];
      if (r.length === 1 && /^[A-Za-z][A-Za-z ()/-]{1,40}$/.test(cells[r[0]])) relationship = cells[r[0]];
    }
  }
  const words = (n: string) => n.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const own = words(person);
  const lower = line.toLowerCase();
  const named = (n: string) => { const w = n.trim().toLowerCase(); return !!w && lower.includes(w); };
  if (!birth && own.length && !others.some((o) => o.trim().toLowerCase() !== person.trim().toLowerCase() && named(o))) {
    const m = new RegExp(String.raw`(?<![\p{L}\p{N}])${own.join(String.raw`\s+`)}\s*[,(\-–]?\s*(?:date\s+of\s+birth|d\.?o\.?b\.?|born(?:\s+on)?)\s*[:\-]?\s*(${DATE})(?=\s*\)?\s*(?:\t|$))`, "iu").exec(line);
    if (m && (line.match(DATES) ?? []).length === 1) birth = m[1];
  }
  return { birth, relationship };
}

// ---------- Other words about children in the document (gate rounds R4-H3, R5, R6) ----------
// Two decisions, kept apart:
// (1) Giving a child's share read from a row's own cell (childWordsElsewhere): only when the WHOLE document prints no child
//     or young-life word and no age phrase anywhere but that cell and the people table's relationship cells. No limiting
//     word is needed: any such word is doubt, and doubt gives the child no share (main's behaviour).
// (2) Withholding a plain row's own share from a person not proven an adult (childLimitNotes): only for a sentence that
//     limits an insured child's benefit, by closed lists; anything else falls back to main's behaviour.

/** A number that is an age by the words next to it, never days, nights, cm, hours, weeks or months. */
const NOT_AGE = String.raw`(?!\s*(?:days?|nights?|cm|mm|km|kg|hours?|hrs?|weeks?|months?|%|per\s?cent|miles?|metres?|meters?|minutes?|am|pm))`;
const CHILD_ANY = /\b(?:child(?:ren)?|sons?|daughters?|minors?|juveniles?|dependants?|dependents?|students?|young\s+(?:persons?|people|lives)|infants?|kids?|U\d{2}s?|under-\d{1,2}s?)\b/i;
const AGE_ANY = new RegExp(String.raw`\bage[ds]?\b\s*(?:of\s+|between\s+|under\s+|below\s+|over\s+|above\s+|from\s+|up\s+to\s+|less\s+than\s+)?\d{1,3}\b|\b\d{1,3}\s*(?:years?(?:\s*-?\s*old|\s+of\s+age)?|yrs?|year-old)\b|\bbetween\s+\d{1,3}\s+and\s+\d{1,3}\b${NOT_AGE}|\b0\s*[-–]\s*\d{1,2}\b${NOT_AGE}|\b(?:under|below|less\s+than|younger\s+than|over|above|older\s+than)\s+\d{1,2}\b${NOT_AGE}`, "i");
/** A tab cell that is only a relationship ("Child", "Dependent child", "Son"), as a people table prints it. */
const RELATION_CELL = /^(?:(?:insured|dependent|dependant|eligible|covered)\s+)?(?:child|son|daughter|minor|juvenile|student)$/i;
/** A page footer or header line ("Page 2 of 3\tHPA-55120-K"): never part of a sentence. */
const FOOTER = /^\s*(?:page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\/\s*\d+|-\s*\d+\s*-)(?:\s|\t|$)/i;
/** The document's text with the row's own cell taken out, as units: each tab line on its own (a people table's
 * relationship cells left out, on a line naming an insured person), and running text joined across blank lines, page
 * breaks and footer lines. */
function textUnits(pages: { page: number; text: string }[], own: { page: number; from: number; to: number } | null, people: string[]): string[] {
  const names = people.map((n) => n.replace(/\s+/g, " ").trim().toLowerCase()).filter((n) => n.length >= 3);
  const units: string[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length) units.push(run.join(" ")); run = []; };
  for (const pg of pages) {
    let text = pg.text;
    if (own && pg.page === own.page) text = `${text.slice(0, own.from)}\n\t\n${text.slice(own.to)}`;
    for (const line of text.split("\n")) {
      if (!line.trim() || FOOTER.test(line)) continue;
      if (!line.includes("\t")) { run.push(line.trim()); continue; }
      flush();
      const flat = line.replace(/\s+/g, " ").toLowerCase();
      const peopleLine = names.some((n) => flat.includes(n));
      const cells = line.split("\t").map((c) => c.trim()).filter((c) => c && !(peopleLine && RELATION_CELL.test(c)));
      if (cells.length) units.push(cells.join(" "));
    }
  }
  flush();
  return units;
}
/** Sentences of a unit: split after ".", ";", "!" or "?" before a capital, a digit or a mark, never after an abbreviation
 * ("e.g.", "i.e.", "etc.", "No.", "approx.", "Mr."). */
const ABBREVIATION = /(?:\b(?:e\.g|i\.e|etc|no|nos|approx|incl|max|min|mr|mrs|ms|dr|st|vs|cf|viz|sec|art|cl|para|p|pp)\.|\b[A-Z]\.)$/i;
function noteSentences(unit: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of unit.matchAll(/[.;!?](?=\s+[\p{Lu}\d*(†‡"“])/gu)) {
    const end = m.index! + 1;
    if (m[0] === "." && ABBREVIATION.test(unit.slice(start, end))) continue;
    out.push(unit.slice(start, end).trim());
    start = end;
  }
  out.push(unit.slice(start).trim());
  return out.filter(Boolean);
}
/** Decision (1): whether the document prints any child or young-life word, or any age phrase, outside the row's own
 * cell (`own`) and the people table's relationship cells (on a line naming one of `people`). When it does, the cell's
 * child share is never given (gate R6-H1: "Children: ...", a "CHILDREN" heading, a "Child\tGBP 3,000" limits row, a note
 * split by a page break, a blank line or a footer). */
export function childWordsElsewhere(pages: { page: number; text: string }[], own: { page: number; from: number; to: number } | null, people: string[] = []): boolean {
  return textUnits(pages, own, people).some((u) => CHILD_ANY.test(u) || AGE_ANY.test(u));
}

// Decision (2): a sentence that limits an insured child's benefit.
// (a) A phrase whose subject is an insured child or a young insured life, a closed list. An age number counts only beside an
// age word or right after a child or person word.
const AGE_PHRASES: { re: RegExp; plus: number }[] = [
  { re: new RegExp(String.raw`\b(?:aged\s+)?(?:under|below|less\s+than|younger\s+than)\s+(?:the\s+)?age\s+(?:of\s+)?(\d{1,2})\b`, "i"), plus: 0 },
  { re: new RegExp(String.raw`\b(?:aged\s+)?(?:under|below|less\s+than|younger\s+than)\s+(\d{1,2})\s*(?:years?|yrs?)(?:\s*-?\s*old|\s+of\s+age)?\b`, "i"), plus: 0 },
  { re: new RegExp(String.raw`\baged\s+(?:under|below|less\s+than|younger\s+than)\s+(\d{1,2})\b${NOT_AGE}`, "i"), plus: 0 },
  { re: new RegExp(String.raw`\b(?:child(?:ren)?|persons?|people|lives|insureds?|members?)\s+(?:who\s+are\s+)?(?:under|below|less\s+than|younger\s+than)\s+(\d{1,2})\b${NOT_AGE}`, "i"), plus: 0 },
  { re: /\bnot\s+(?:yet\s+)?reached\s+(?:the\s+)?age\s+(?:of\s+)?(\d{1,2})\b/i, plus: 0 },
  { re: /\baged?\s+(?:between\s+)?0\s*(?:-|–|to|and)\s*(\d{1,2})\b/i, plus: 1 },
  { re: new RegExp(String.raw`\baged\s+(\d{1,2})\s*(?:years?\s+)?(?:or|and)\s+(?:under|less|below|younger)\b`, "i"), plus: 1 },
  { re: /\bup\s+to\s+(?:the\s+)?age\s+(?:of\s+)?(\d{1,2})\b/i, plus: 1 },
  { re: /\bU(\d{2})s?\b/, plus: 0 },
  { re: /\bunder-(\d{1,2})s?\b/i, plus: 0 },
];
const CHILD_SUBJECT = /\b(?:(?:insured\s+(?:child(?:ren)?|minors?|juveniles?)|(?:for|to)\s+(?:an?\s+|the\s+|each\s+|every\s+|any\s+)?(?:insured\s+|covered\s+|eligible\s+)?child(?:ren)?|child(?:ren)?\s+(?:aged|under|below|less\s+than|younger\s+than|up\s+to)|child(?:ren)?['’]s?\s+(?:limit|benefit|death|cover|sum|share)|(?:dependent|dependant)\s+child(?:ren)?|minors?|juveniles?|young\s+persons?|students?)\b|children\s+of\s+(?:the\s+)?[\p{L}])/iu;
/** A sentence or limits row that starts with the child class as its label ("Children: ...", "Child - ...", "CHILDREN The
 * death benefit ...", "Child GBP 3,000", "Sons and daughters of the policyholder: ..."). */
const CHILD_LABEL = /^\s*(?:(?:insured\s+|dependent\s+|dependant\s+)?(?:child(?:ren)?|minors?|juveniles?|kids|infants)|sons?\s+and\s+daughters?)\b(?!\s+care)/i;
// (b) A limiting word, a share or a money figure in the same sentence.
const LIMITING = /\b(?:limited|limits?|maximum|max|up\s+to|only|reduced|restricted|not\s+payable|nothing\s+(?:is\s+)?payable|no\s+benefit|not\s+covered|excluded|capped)\b|%|\bper\s?cent\b|(?:\b[A-Z]{3}|[£$€¥₹]|\bRM|\bS\$)\s?\d|\d[\d,.]*\s?(?:\b[A-Z]{3}\b|[£€])/i;
/** Not a limit on an insured child's own benefit (gate R6-H2): premiums and discounts, who is paid, a payment to a parent or
 * guardian, child care, school fees, a parent staying with or an allowance for a parent. */
const NOT_CHILD_LIMIT = /\b(?:premiums?|discounts?|paid\s+to|payable\s+to|payment\s+(?:is\s+|will\s+be\s+)?made\s+to|on\s+behalf\s+of|guardian|child\s*care|school\s+fees?|tuition|education|staying\s+with|parent['’]?s?\s+(?:allowance|accommodation)|accommodation)\b/i;
/** A row's own cell printing its share with a child's share after it ("100% of the Sum Insured. For an insured child under
 * 18, limited to 25% of the Sum Insured."): that sentence is that row's own rule, not a note for the document. */
function ownCellChildSentence(cell: string): string | null {
  const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s?cent)\s+of\s+(?:the\s+)?sum\s+(?:insured|assured)\b/i.exec(cell);
  if (!m) return null;
  const limit = childLimitIn(cell, Number(m[1]));
  if (!limit) return null;
  const rest = withoutChildLimit(cell, limit).replace(/[\s.;]+$/, "");
  return new RegExp(String.raw`^\s*${m[0].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(rest) ? limit.words : null;
}
/** Decision (2): the child-limit sentences a document prints outside one row's own cell (`own`: that cell's page and its
 * range in the page's text): a sentence (any page, a note, a footnote, a heading joined to its rule, a line naming a
 * person, a row of a table) that has both (a) a phrase or label whose subject is an insured child or a young life, by
 * closed lists, and (b) a limiting word, a share or a money figure, and is not about premiums, payments to someone,
 * child care or school fees. Another row's own cell that prints only its share and an allow-listed child's share
 * (ownCellChildSentence) is that row's own rule. `age`: the highest age the sentences print, or null when none does. */
export function childLimitNotes(pages: { page: number; text: string }[], own: { page: number; from: number; to: number } | null, people: string[] = []): { found: boolean; age: number | null } {
  let found = false, age: number | null = null;
  // The row's own cell taken out first, then another row's own cell with an allow-listed child's share (that row's rule).
  const rest = pages.map((pg) => {
    const cut = own && pg.page === own.page ? `${pg.text.slice(0, own.from)}\n\t\n${pg.text.slice(own.to)}` : pg.text;
    return { page: pg.page, text: cut.split("\n").map((line) => !line.includes("\t") ? line
      : line.split("\t").map((c) => { const w = ownCellChildSentence(c); return w ? withoutChildLimit(c, { words: w }) : c; }).join("\t")).join("\n") };
  });
  for (const u of textUnits(rest, null, people)) for (const sentence of noteSentences(u)) {
    const ages = AGE_PHRASES.flatMap(({ re, plus }) => { const m = re.exec(sentence); return m ? [Number(m[1]) + plus] : []; }).filter((n) => n >= 1 && n <= 30);
    if (!(ages.length || CHILD_SUBJECT.test(sentence) || CHILD_LABEL.test(sentence)) || !LIMITING.test(sentence) || NOT_CHILD_LIMIT.test(sentence)) continue;
    found = true;
    for (const n of ages) age = Math.max(age ?? 0, n);
  }
  return { found, age };
}
/** Whether a person's own line proves they are not the child a document's child-limit sentences are about, on every day
 * given: a printed date of birth at or over the sentences' age (18 when they print none) proves it on its own, whatever
 * the relationship says, unless the relationship is a child one (child, son, daughter); with no date of birth, a
 * relationship on the closed adult list proves it only when the age is 18 or under (gate R5-M1, R5-L1). */
export function provenAdult(life: PrintedLife | null | undefined, age: number | null, days: number[]): { adult: true } | { adult: false; why: string } {
  const over = Math.max(age ?? 18, 1);
  if (!days.length) return { adult: false, why: "has no day to settle it on" };
  const rel = relationClass(life?.relationship);
  if (rel === "child") return { adult: false, why: `prints the relationship "${life!.relationship!.trim()}"` };
  if (life?.birth) {
    const side = ageSide(life.birth, days, over);
    return side === "over" ? { adult: true } : { adult: false, why: side === "under" ? `prints a date of birth (${life.birth}) under ${over}` : `prints a date of birth (${life.birth}) that does not settle whether they are ${over} or over on every day of the period of insurance` };
  }
  if (rel === "adult" && over <= 18) return { adult: true };
  return { adult: false, why: rel === "adult" ? `does not print a date of birth to show they are ${over} or over` : "does not print a date of birth" };
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
