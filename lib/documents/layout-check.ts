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

type Token = string | number;
/** Each line that prints a figure, as its words and figures in printed order. Every word counts, "A" and "B" too, and
 * order counts, so two pairs swapped within one line, or "Plan A" and "Plan B" swapped, do not agree (TE U-F1).
 * Currency marks and "%" are left out: the two readings may print them differently. */
function figureLines(text: string): Token[][] {
  return unglue(text).split("\n")
    .map((line) => (line.replace(/US\$|S\$|\$|\b(?:SGD|USD)\b/gi, " ").toLowerCase().match(/\d[\d,]*(?:\.\d+)?|[a-z]+/g) ?? [])
      .map((t): Token => (/\d/.test(t) ? Number(t.replace(/,/g, "")) : t)))
    .filter((l) => l.some((t) => typeof t === "number" && t > 0));
}
const sameFigures = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.005);
const sameLine = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => (typeof t === "number" ? typeof b[i] === "number" && Math.abs(t - (b[i] as number)) < 0.005 : t === b[i]));
const figuresOf = (l: Token[]) => l.filter((t): t is number => typeof t === "number");
const labelOf = (l: Token[]) => l.filter((t) => typeof t === "string").join(" ");
/** Whether the page's image reading agrees with its text reading: the same figures (as many times each, reading glued ones
 * apart), and every line of each that prints figures has a line in the other with the same words and figures in the same
 * order. A figure line with no label in the text reading has nothing to agree on. */
export function readingsAgree(textReading: string, imageReading: string): { agree: true } | { agree: false; why: string } {
  const a = figuresIn(textReading).sort((x, y) => x - y), b = figuresIn(imageReading).sort((x, y) => x - y);
  if (!b.length) return { agree: false, why: "the image reading prints no figures" };
  if (!sameFigures(a, b)) return { agree: false, why: "the two readings print different figures" };
  // A page number or a date on a line of its own pairs nothing; its figures are still counted above (TE UC-3). Any other
  // label-less line is refused below.
  // One lone number is the page number; several are values whose labels are elsewhere, and stay to be refused.
  const alone = (t: string) => {
    const lines = t.split("\n"), numbers = lines.filter((l) => LONE_NUMBER.test(l)).length;
    return lines.filter((l) => !LONE_DATE.test(l) && !(numbers === 1 && LONE_NUMBER.test(l))).join("\n");
  };
  const text = figureLines(alone(textReading)), image = figureLines(alone(imageReading));
  for (const l of text) {
    if (!labelOf(l)) return { agree: false, why: `the text reading prints ${figuresOf(l).join(", ")} with no label beside it` };
    if (!image.some((o) => sameLine(l, o))) return { agree: false, why: `the image reading does not print ${figuresOf(l).join(", ")} beside "${labelOf(l)}" in that order` };
  }
  for (const l of image) if (!text.some((o) => sameLine(l, o))) return { agree: false, why: `the text reading does not print ${figuresOf(l).join(", ")} beside "${labelOf(l)}" in that order` };
  return { agree: true };
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
export const uncheckedText = (text: string) => text.startsWith(UNCHECKED_PAGE) ? text
  : [UNCHECKED_PAGE, ...text.split("\n").filter((l) => l.trim() && !/\d/.test(l.replace(LABELLED, " ")))].join("\n");

type CheckedPage = { pageNumber: number; text: string; extractionMethod?: string; unreadable?: boolean; unchecked?: boolean };
/** The pages to read again from their image at upload: text pages whose table text shows a scramble sign. */
export const suspectPages = (pages: CheckedPage[]) => pages.filter((p) => p.extractionMethod !== "ocr" && !p.unreadable && !p.unchecked && looksScrambled(p.text)).map((p) => p.pageNumber);
/** Checks the given pages against their image reading. A page is kept as it is (the document's own words) only when the
 * image reading confirms it; otherwise, and when the image could not be read, it becomes unchecked, its text replaced by
 * uncheckedText. `readImage` returns null when the reading failed. */
export async function crossCheckPages<P extends CheckedPage>(pages: P[], numbers: number[], readImage: (numbers: number[]) => Promise<CheckedPage[] | null>): Promise<P[]> {
  if (!numbers.length) return pages;
  const second = await readImage(numbers).catch(() => null);
  return pages.map((p) => {
    if (!numbers.includes(p.pageNumber)) return p;
    const image = second?.find((s) => s.pageNumber === p.pageNumber);
    return image && image.extractionMethod === "ocr" && !image.unreadable && readingsAgree(p.text, image.text).agree ? p : { ...p, text: uncheckedText(p.text), unchecked: true };
  });
}

/** The note a document gets when some pages could not be checked. */
export function uncheckedPagesNote(pageNumbers: number[]): string | null {
  if (!pageNumbers.length) return null;
  const list = pageNumbers.length === 1 ? `Page ${pageNumbers[0]}` : `Pages ${pageNumbers.slice(0, -1).join(", ")} and ${pageNumbers[pageNumbers.length - 1]}`;
  return `Read in part. ${list} could not be checked: a second reading from the page image did not agree with ${pageNumbers.length === 1 ? "its" : "their"} text, so no amount on ${pageNumbers.length === 1 ? "it" : "them"} is used.`;
}
export const READ_IN_PART = /^Read in part\b/;
