/** Checking a page's text before anything reads it (Charmaine's new documents, 24 Oct: two Prudential schedules whose
 * text came out with every label first and every value after, and neighbouring figures glued together, so no row could
 * be tied to its amount).
 *
 * A page whose text shows those signs is read a second time from its image. The page is used only when both readings
 * agree line by line: the same figures, and each figure beside the same label in both. The text reading, the document's
 * own words, is what is stored; the image reading only confirms it. A page they do not agree on, or one whose text puts no
 * label beside its figures (one reading of the pairing is not two), is "unchecked": its text stays searchable, but
 * nothing reads an amount from it, and the document says it was read in part. Nothing here uses a model. */

/** "50,000.0050,000.00": a complete decimal amount with a second one straight after it. A rate or date with more
 * decimals ("1.235", "4.125%", "01.10.2026") is not glued (TE U-F3). */
const GLUED = /\d\.\d{2}\d[\d,]*\.\d{2}(?!\d)/;
const UNGLUE = /(\d\.\d{2})(?=\d[\d,]*\.\d{2}(?!\d))/g;
/** An amount: two decimals or comma groups. A page number or an age is not one. */
const AMOUNT = /\d[\d,]*\.\d{2}(?!\d)|\d{1,3}(?:,\d{3})+/;
// Every number on the line, small amounts and percentages too ("S$300", "25%"): two readings that pair them differently
// must not agree (Critic R175-1).
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;
const NUMBERS_ONLY = /^[\s\d,.\-–—%$SGDU]*\d[\s\d,.\-–—%$SGDU]*$/;
const LABEL_ONLY = (line: string) => line.length >= 3 && line.length <= 60 && !/\d/.test(line) && /[A-Za-z]{3}/.test(line);

/** Signs that a page's table text came out scrambled: glued figures, or a run of labels with no figures followed by a run
 * of lines holding only figures (labels read before values). */
export function scrambleSigns(text: string): string[] {
  const signs: string[] = [];
  if (GLUED.test(text)) signs.push("figures printed side by side came out glued together");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let labels = 0;
    while (i + labels < lines.length && LABEL_ONLY(lines[i + labels])) labels++;
    let values = 0, amounts = 0;
    while (i + labels + values < lines.length && NUMBERS_ONLY.test(lines[i + labels + values])) amounts += Number(AMOUNT.test(lines[i + labels + values++]));
    // A table's own column header over its rows ("Age  Male  Female" over "35  120.50  110.20") is not scrambled, and
    // a contents list's page numbers are not amounts (TE U-F2).
    const cells = (line: string) => line.split("\t").length;
    // Only a header whose rows carry their own key in the first cell ("35" for an age) pairs each row; rows of amounts
    // alone under "Sum Assured  Premium" still leave the plan labels above unpaired (TE UC-2).
    const rows = lines.slice(i + labels, i + labels + values);
    const header = labels > 0 && cells(lines[i + labels - 1]) >= 2 && values > 0 && rows.every((r) => cells(r) === cells(lines[i + labels - 1]) && !AMOUNT.test(r.split("\t")[0]));
    if (labels >= 3 && values >= 3 && amounts >= 2 && !header) { signs.push("labels came out before their values"); break; }
    i += Math.max(0, labels - 1);
  }
  return signs;
}
export const looksScrambled = (text: string) => scrambleSigns(text).length > 0;

const unglue = (text: string) => text.replace(UNGLUE, "$1 ");
const figuresIn = (text: string) => (unglue(text).match(FIGURE) ?? []).map((f) => Number(f.replace(/,/g, ""))).filter((n) => n > 0);

/** Whether the page's image reading agrees with its text reading: every line of each that prints figures has a line in
 * the other with the same words and figures in the same order (a line printed twice must be printed twice), and the image
 * reading prints figures at all. A figure line with no label in the text reading has nothing to agree on. */
/** Why two readings did not agree, in words that quote nothing from the page: what is kept in the processing history
 * (TE P115-1: a label or an amount there would outlive the deleted document). */
export type DisagreeKind = "image prints no figures" | "figures differ" | "figure line with no label" | "pairing differs";
export function readingsAgree(textReading: string, imageReading: string, pageNumber?: number): { agree: true } | { agree: false; why: string; kind: DisagreeKind } {
  const check = checkLines(textReading, imageReading, pageNumber);
  return check.agree ? { agree: true } : { agree: false, why: check.why, kind: check.kind! };
}

/** What is stored, searched and read in place of a page the two readings did not agree on: a notice, and the page's lines
 * that print no amount (the policy's name, number and status), so the policy is not missing from answers (Critic R175-c).
 * Storing it in place of the page text keeps every reader of the page, search included, off its amounts (TE U-F5). */
export const UNCHECKED_PAGE = "[This page could not be checked against the page image, so no amount on it is used. Say its amounts are not shown.]";
// Only lines with no figure at all, or a number or date by its own label ("Policy Number: 63639755"): a bare "Sum Assured
// 13500" on a page whose pairing is not checked is still an amount (Critic R176-2).
// The labelled number or date is taken out first, and the line kept only when no other figure is left on it, so "Policy
// number TE-1 Annual limit 150000" is dropped (TE UC-1).
// A real month only: "Expiry 30 days 1500" is not a date (Critic R179-1).
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const DATE = String.raw`(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+${MONTH}\s+\d{4}|${MONTH}\s+\d{1,2},?\s+\d{4})`;
const LABELLED = new RegExp(String.raw`\b(?:policy|certificate|contract|member|account)\s*(?:no\.?|number)\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9/-]*`
  + String.raw`|\b(?:date(?:\s+of\s+[a-z]+)?|dated|(?:commencement|expiry|issue|start|end)(?:\s+date)?|issued(?:\s+on)?)\s*[:-]?\s*` + DATE, "gi");
const LONE_NUMBER = /^\s*(?:page\s+)?\d{1,3}(?:\s+of\s+\d{1,3})?\s*$/i;
const LONE_DATE = new RegExp(String.raw`^\s*` + DATE + String.raw`\s*$`, "i");

type Token = string | number;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WHOLE_DATE = new RegExp(String.raw`^` + DATE + String.raw`$`, "i");
/** A date is one token, whatever its separators: "01.10.2026", "1/10/2026" and "1 Oct 2026" are one date, so two readings
 * that print it differently still agree on its line, and its parts are never read as figures (Critic plan step 3). */
function dateToken(printed: string): string {
  const t = printed.toLowerCase(), month = (m: string) => MONTHS.findIndex((x) => m.startsWith(x)) + 1;
  let d = 0, m = 0, y = 0, p: RegExpMatchArray | null;
  if ((p = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, m, d] = [+p[1], +p[2], +p[3]];
  else if ((p = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) [d, m, y] = [+p[1], +p[2], +p[3]];
  else if ((p = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/))) [d, m, y] = [+p[1], month(p[2]), +p[3]];
  else if ((p = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) [m, d, y] = [month(p[1]), +p[2], +p[3]];
  else return `date ${t}`;
  return `date ${d}-${m}-${y}`;
}
const isDate = (t: Token) => typeof t === "string" && t.startsWith("date ");
/** A line's words and figures in printed order. Every word counts, "A" and "B" too, and order counts, so two pairs swapped
 * within one line, or "Plan A" and "Plan B" swapped, do not agree (TE U-F1). Currency marks and "%" are left out: the two
 * readings may print them differently. */
function lineTokens(line: string): Token[] {
  const tokens = unglue(line).replace(/US\$|S\$|\$|\b(?:SGD|USD)\b/gi, " ").toLowerCase().match(new RegExp(DATE + String.raw`|\d[\d,]*(?:\.\d+)?|[a-z]+`, "gi")) ?? [];
  return tokens.map((t): Token => (WHOLE_DATE.test(t) ? dateToken(t) : /^\d/.test(t) ? Number(t.replace(/,/g, "")) : t));
}
const figureLine = (l: Token[]) => l.some((t) => (typeof t === "number" ? t > 0 : isDate(t)));
const sameLine = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => (typeof t === "number" ? typeof b[i] === "number" && Math.abs(t - (b[i] as number)) < 0.005 : t === b[i]));
const sameFigures = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.005);
const figuresOf = (l: Token[]) => l.filter((t): t is number => typeof t === "number");
const labelOf = (l: Token[]) => l.filter((t) => typeof t === "string" && !isDate(t)).join(" ");

/** The lines that pair nothing: a page number or a date on a line of its own (TE UC-3). One lone number is the page
 * number; several are values whose labels are elsewhere, and stay to be refused. The page number is "Page 3" or "3 of 12"
 * anywhere, the page's own number anywhere (a footer the text layer puts before its footer line, Critic R189-1), or a one-
 * or two-digit number as the first or last line, unless the line beside it is a label alone: a value under its label
 * ("Hospital Cash per day" over "150", first or last or mid-page) stays to be refused (TE N8, P122-1, Critic R189-2). */
function pairingNothing(t: string, pageNumber?: number): Set<number> {
  const lines = t.split("\n"), numbers = lines.filter((l) => LONE_NUMBER.test(l)).length;
  const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const first = filled[0], last = filled[filled.length - 1];
  const beside = (i: number) => lines[i === first ? filled[1] : filled[filled.length - 2]]?.trim() ?? "";
  const edge = (i: number) => /page|of/i.test(lines[i]) || Number(lines[i].trim()) === pageNumber
    || ((i === first || i === last) && /^\s*\d{1,2}\s*$/.test(lines[i]) && !LABEL_ONLY(beside(i)));
  return new Set(lines.map((l, i) => (LONE_DATE.test(l) || (numbers === 1 && LONE_NUMBER.test(l) && edge(i)) ? i : -1)).filter((i) => i >= 0));
}

/** What an unconfirmed figure is shown as: the line keeps its words, and the reader is told the amount was not checked. */
export const NOT_CHECKED = "[amount not checked]";
// A figure never ends in a comma: the sentence's own comma after it stays.
const ANY_FIGURE = new RegExp(String.raw`(?:US\$|S\$|\$)?(?:` + DATE + String.raw`|\d(?:[\d,]*\d)?(?:\.\d+)?%?)`, "gi");
const notChecked = (line: string) => unglue(line).replace(ANY_FIGURE, NOT_CHECKED);

/** One figure as the history keeps it: its kind and where it sits on the page, never its digits or the words beside it. */
type Seen = { key: string; shape: string; where: string };
function shapeOf(printed: string): string {
  if (WHOLE_DATE.test(printed)) return "date";
  if (printed.endsWith("%")) return "percent";
  if (/\.\d{2}$/.test(printed)) return printed.includes(",") ? "comma decimal amount" : "decimal amount";
  if (printed.includes(".")) return "other decimal";
  if (printed.includes(",")) return "comma amount";
  return printed.length <= 2 ? "1-2 digit number" : "3+ digit whole number";
}
function seenFigures(text: string): Seen[] {
  const lines = text.split("\n"), filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  return lines.flatMap((line, i) => {
    const at = filled.indexOf(i);
    const where = at >= 0 && at < 3 ? "first lines" : at >= filled.length - 3 ? "last lines" : labelOf(lineTokens(line)) ? "labelled line" : "line with no label";
    return (unglue(line).match(new RegExp(DATE + String.raw`|\d[\d,]*(?:\.\d+)?%?`, "gi")) ?? [])
      .map((printed) => ({ printed, key: WHOLE_DATE.test(printed) ? dateToken(printed) : Number(printed.replace(/[,%]/g, "")).toFixed(2) }))
      .filter((f) => f.key.startsWith("date ") || Number(f.key) > 0)
      .map((f) => ({ key: f.key, shape: shapeOf(f.printed), where }));
  });
}
function only(a: Seen[], b: Seen[]): Seen[] {
  const left = [...b];
  return a.filter((f) => { const i = left.findIndex((o) => o.key === f.key); if (i < 0) return true; left.splice(i, 1); return false; });
}
const tally = (xs: string[]) => [...new Set(xs)].sort().map((x) => `${x} ${xs.filter((y) => y === x).length}`).join(", ");
const described = (xs: Seen[]) => (xs.length ? `${xs.length} (${tally(xs.map((x) => x.shape))}; ${tally(xs.map((x) => x.where))})` : "0");

/** The page's text reading checked line by line against its image reading. Each figure line of the text is kept word for
 * word only when the image reading prints a line with the same words and the same figures in the same order (each image
 * line confirms one text line). A figure line with no label confirms nothing. `text` is the page as it may be stored: null
 * when no figure line was confirmed (the whole page is unchecked), otherwise every unconfirmed line with its figures shown
 * as NOT_CHECKED. `log` says what kind of difference it was, in counts and fixed words only (Critic plan step 1). */
export function checkLines(textReading: string, imageReading: string, pageNumber?: number):
  { agree: boolean; kind: DisagreeKind | null; why: string; text: string | null; log: string } {
  const lines = textReading.split("\n"), skipText = pairingNothing(textReading, pageNumber), skipImage = pairingNothing(imageReading, pageNumber);
  const imageLinesAll = imageReading.split("\n");
  // A line is confirmed only under the same heading in both readings: the nearest label-only line above it that both
  // readings print. Headings only one reading prints are passed over (Critic R211-3).
  const headingsOf = (ls: string[]) => ls.map((l) => lineTokens(l)).map((t) => (t.length && !figureLine(t) ? t.join(" ") : null));
  const textHeads = headingsOf(lines), imageHeads = headingsOf(imageLinesAll);
  const shared = new Set(textHeads.filter((h) => h && imageHeads.includes(h)));
  const under = (heads: (string | null)[]) => { let h = ""; return heads.map((x) => (x && shared.has(x) ? (h = x) : h)); };
  const textUnder = under(textHeads), imageUnder = under(imageHeads);
  const pool = imageLinesAll.map((l, i) => ({ t: skipImage.has(i) ? [] : lineTokens(l), h: imageUnder[i] })).filter((o) => figureLine(o.t));
  const imageLines = pool.length;
  const unconfirmed: number[] = [];
  let figureLines = 0, noLabel = -1, why = "";
  lines.forEach((line, i) => {
    if (skipText.has(i)) return;
    const tokens = lineTokens(line);
    if (!figureLine(tokens)) return;
    figureLines++;
    const at = labelOf(tokens) ? pool.findIndex((o) => sameLine(tokens, o.t) && o.h === textUnder[i]) : -1;
    if (at >= 0) { pool.splice(at, 1); return; }
    unconfirmed.push(i);
    if (!labelOf(tokens) && noLabel < 0) noLabel = i;
    why ||= labelOf(tokens) ? `the image reading does not print ${figuresOf(tokens).join(", ")} beside "${labelOf(tokens)}" in that order` : `the text reading prints ${figuresOf(tokens).join(", ")} with no label beside it`;
  });
  if (!why && pool.length) why = `the text reading does not print ${figuresOf(pool[0].t).join(", ")} beside "${labelOf(pool[0].t)}" in that order`;
  const a = figuresIn(textReading).sort((x, y) => x - y), b = figuresIn(imageReading).sort((x, y) => x - y);
  let kind: DisagreeKind | null = !b.length ? "image prints no figures" : !unconfirmed.length && !pool.length ? null
    : !sameFigures(a, b) ? "figures differ" : noLabel >= 0 ? "figure line with no label" : "pairing differs";
  // A masked line takes its row and table with it (Critic R211-1, R211-2): a continuation ("or up to S$50,000, whichever
  // is lesser") read without the row's own figure would stand as the row's whole limit, and a masked row that starts a
  // run of tab-cell rows is their column header, without which no figure under it can be tied to its plan or age.
  // A continuation starts lower-case or with a connective or cap word (the same words lib/benefit-table/check.ts joins).
  const continues = (l: string) => /^[ \t,;:(]*[a-z]/.test(l) || /^[ \t,;:(]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|min(?:imum)?|limit(?:ed)?|capped|not\s+(?:to\s+)?exceed(?:ing)?)\b/i.test(l);
  const cells = (l: string) => l.split("\t").filter((c) => c.trim()).length;
  const isFig = (i: number) => !skipText.has(i) && figureLine(lineTokens(lines[i]));
  const spread = new Set(unconfirmed);
  for (const i of unconfirmed) {
    for (let j = i + 1; j < lines.length && continues(lines[j]); j++) if (isFig(j)) spread.add(j);
    for (let j = i; j > 0 && continues(lines[j]); j--) if (isFig(j - 1)) spread.add(j - 1);
    if (cells(lines[i]) >= 3) for (let j = i + 1; j < lines.length && cells(lines[j]) === cells(lines[i]); j++) if (isFig(j)) spread.add(j);
  }
  // A lone date or a lone number under its label ("Expiry date" over "30/09/2027") pairs nothing, so it is checked as the
  // figures of all such lines, in printed order: unless the image reading prints the same ones in the same order on its own
  // lines that pair nothing, none of them is used. That covers a value the image prints with another figure, beside its
  // label, on its own line, in another order, or not at all (TE P139-1, A26-A31, N8).
  const loneFigures = (ls: string[], skip: Set<number>) => ls.flatMap((l, i) => (skip.has(i) ? lineTokens(l).filter((t) => typeof t !== "string" || isDate(t)) : []));
  const loneText = loneFigures(lines, skipText), loneImage = loneFigures(imageLinesAll, skipImage);
  if (!sameLine(loneText, loneImage)) skipText.forEach((i) => { if (figureLine(lineTokens(lines[i]))) spread.add(i); });
  if (kind === null && spread.size) {
    kind = !sameFigures(a, b) ? "figures differ" : "pairing differs";
    why = "the lines that print a date or a number alone do not print the same ones in the same order";
  }
  const confirmed = figureLines - [...spread].filter((i) => !skipText.has(i)).length;
  const seenText = seenFigures(textReading), seenImage = seenFigures(imageReading);
  const log = `figure lines ${figureLines} in text, ${imageLines} in image, ${confirmed} confirmed; figures ${seenText.length} in text, ${seenImage.length} in image; `
    + `only in text ${described(only(seenText, seenImage))}; only in image ${described(only(seenImage, seenText))}`;
  if (!b.length) return { agree: false, kind, why: "the image reading prints no figures", text: null, log };
  const text = !spread.size ? textReading : confirmed ? lines.map((l, i) => (spread.has(i) ? notChecked(l) : l)).join("\n") : null;
  return { agree: kind === null, kind, why, text, log };
}
export const uncheckedText = (text: string) => text.startsWith(UNCHECKED_PAGE) ? text
  : [UNCHECKED_PAGE, ...text.split("\n").filter((l) => l.trim() && !/\d/.test(l.replace(LABELLED, " ")))].join("\n");

type CheckedPage = { pageNumber: number; text: string; extractionMethod?: string; unreadable?: boolean; unchecked?: boolean; uncheckedWhy?: string; partChecked?: boolean; checkLog?: string };
/** The pages to read again from their image at upload: text pages whose table text shows a scramble sign. */
export const suspectPages = (pages: CheckedPage[]) => pages.filter((p) => p.extractionMethod !== "ocr" && !p.unreadable && !p.unchecked && !p.partChecked && looksScrambled(p.text)).map((p) => p.pageNumber);
/** Checks the given pages against their image reading. A page is kept as it is (the document's own words) only when the
 * image reading confirms it; otherwise, and when the image could not be read, it becomes unchecked, its text replaced by
 * uncheckedText, and uncheckedWhy says why in fixed words, for the processing history. `readImage` returns null when the reading failed. */
export async function crossCheckPages<P extends CheckedPage>(pages: P[], numbers: number[], readImage: (numbers: number[]) => Promise<CheckedPage[] | null>): Promise<P[]> {
  if (!numbers.length) return pages;
  const second = await readImage(numbers).catch(() => null);
  return pages.map((p) => {
    if (!numbers.includes(p.pageNumber)) return p;
    const image = second?.find((s) => s.pageNumber === p.pageNumber);
    // The reason is a fixed phrase: nothing from the page (TE P115-1).
    const check = !second ? { agree: false as const, kind: "image reading failed", text: null, log: undefined }
      : !image || image.extractionMethod !== "ocr" ? { agree: false as const, kind: "image reading gave no text for this page", text: null, log: undefined }
      : image.unreadable ? { agree: false as const, kind: "image unreadable", text: null, log: undefined }
      : checkLines(p.text, image.text, p.pageNumber);
    if (check.agree) return p;
    // Every figure line confirmed, and the image prints a line the text does not: nothing on the page is unconfirmed.
    if (check.text === p.text) return { ...p, checkLog: check.log };
    // Some lines confirmed: those are kept word for word, the rest keep their words and lose their figures (Critic plan step 2).
    if (check.text) return { ...p, text: check.text, partChecked: true, uncheckedWhy: check.kind ?? undefined, checkLog: check.log };
    return { ...p, text: uncheckedText(p.text), unchecked: true, uncheckedWhy: check.kind ?? undefined, checkLog: check.log };
  });
}

/** The note a document gets when some pages could not be checked, or some lines on them. */
const pageList = (n: number[]) => n.length === 1 ? `page ${n[0]}` : `pages ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
export function uncheckedPagesNote(pageNumbers: number[], partChecked: number[] = []): string | null {
  if (!pageNumbers.length && !partChecked.length) return null;
  const whole = pageNumbers.length ? `${pageList(pageNumbers).replace(/^p/, "P")} could not be checked: a second reading from the page image did not agree with ${pageNumbers.length === 1 ? "its" : "their"} text, so no amount on ${pageNumbers.length === 1 ? "it" : "them"} is used.` : null;
  const part = partChecked.length ? `Some amounts on ${pageList(partChecked)} could not be checked against the page image, so they are shown as not checked and not used; the rest of ${partChecked.length === 1 ? "that page" : "those pages"} agreed and is used.` : null;
  return ["Read in part.", whole, part].filter(Boolean).join(" ");
}
export const READ_IN_PART = /^Read in part\b/;
