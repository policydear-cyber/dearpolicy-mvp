/** A row's section as the reader wrote it, split into the section's own number or code and the label after it.
 *
 * The reader writes a section heading "as printed", and printed headings come in many forms: "3", "3.", "3.1", "3(a)",
 * "Section 3", "SECTION 2 - MEDICAL BENEFITS", "3 Fracture of arm, wrist or leg", "3. Fracture ...", "3 – Fracture ...",
 * "Benefit 2: Group personal accident". Whatever follows the number, the number is what tells two sections apart, so every
 * parser that compares a section with a note, a line or another row reads it through here (TE-ACC-20261115-R4: the reader
 * gave "3 Fracture of arm, wrist or leg" where R3's gave "3", and five bare-number parsers lost three right figures).
 *
 * Only a leading number counts. A section that does not start with one (an optional section word such as "Section",
 * "Part", "Item", "Benefit", "Clause", "Sec." or "No." first) gives null, and each caller then keeps its own handling of
 * it unchanged. The label is never used to tell sections apart: two sections are the same only when their codes are. */
export type SectionId = {
  /** The section's code as printed, without spaces: "3", "3.1", "3(a)", "2B". */
  code: string;
  /** The code as a whole number when it is one ("3"), else null ("3.1", "3(a)"). */
  number: number | null;
  /** What follows the code, without its separator ("Fracture of arm, wrist or leg"); "" when nothing does. */
  label: string;
};

/** The optional section word before the number. */
const WORD = String.raw`(?:(?:section|sect|sec|part|item|benefit|clause|no|§)\.?\s*)?`;
/** The code: 1-3 digits, optional ".N" levels, and an optional sub-mark "(a)" or one letter ("2B"). */
const CODE = String.raw`(\d{1,3}(?:\.\d{1,2}){0,2}(?:\s?\([a-z0-9]{1,2}\)|[a-wyz](?![a-z0-9]))?)`;
const LEAD = new RegExp(String.raw`^\s*${WORD}${CODE}(?![\d])`, "i");
/** What may follow a number for it to be a section's code and not a figure: the end, or a separator ("." ")" ":" "-" "–"
 * "—" "|" or a space) — but never a figure's continuation ("1,000", "2.5"), a unit or a percentage ("24 hours",
 * "18 years", "50%", "2 x"). */
const AFTER = /^(?:$|\s|[.):|\-–—])/;
const UNIT = String.raw`(?:percent|per\s*cent|per|years?|yrs?|months?|weeks?|days?|nights?|hours?|hrs?|minutes?|mins?|times|x|monthly|weekly|daily|nightly|hourly|yearly|annual|annually|fortnightly|quarterly)`;
/** A count's noun: a number before one is a quantity ("2 adults", "4 wheel drive", "3 dozen"), never a section's code. */
const COUNT = String.raw`(?:adults?|child(?:ren)?|kids?|persons?|people|members?|lives|life|dependants?|dependents?|passengers?|travell?ers?|seats?|wheels?|doors?|beds?|rooms?|units?|pairs?|dozens?|hundreds?|thousands?|millions?|billions?|k|m|bn)`;
const NOT_CODE = new RegExp(String.raw`^(?:\s*(?:[,.]\d|%|[£$€¥₹])|\s*[-–—]?\s*(?:${UNIT}|${COUNT})(?![\w-])|\s*[-–—]\s*\d|\s+\d)`, "i");
/** A label holding a figure of its own ("2 adults and 2 children", "1 000 benefit"): the leading number is a count. */
const LABEL_FIGURE = /\d/;

/** The section's code and label, or null when it does not start with a section number. */
export function sectionIdOf(section: string | null | undefined): SectionId | null {
  const s = section ?? "";
  const m = LEAD.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  if (NOT_CODE.test(rest) || !AFTER.test(rest)) return null;
  const code = m[1].replace(/\s+/g, "");
  const label = rest.replace(/^\s*[.):]?\s*(?:[-–—:|]\s*)?/, "").trim();
  if (LABEL_FIGURE.test(label)) return null;
  return { code, number: /^\d{1,3}$/.test(code) ? Number(code) : null, label };
}

const flatWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The leading number or code of a row's own printed line: its first cell ("4\tFracture of skull ..."), or, with the
 * cells joined by spaces as a quote may give them, a number right before the row's own label ("4 Fracture of skull ..."). */
function lineLead(line: string | null | undefined, benefit: string | null | undefined): string | null {
  const m = /^\s*(\d{1,3}[a-z]?)[.)]?([\t ]+)/i.exec(line ?? "");
  if (!m) return null;
  const label = flatWords(benefit ?? "");
  return m[2].includes("\t") || (!!label && `${flatWords((line ?? "").slice(m[0].length))} `.startsWith(`${label} `)) ? m[1] : null;
}

/** A row's own section code, an allow-list (section-label gate SL-H1): a section's leading number may be a cover heading's
 * ("Section 3 Personal accident" over row 4), so it is the row's own only when nothing says otherwise.
 * 1. The section has no leading number: null (the caller keeps its own handling, as before).
 * 2. The row's own printed line starts with a number or code (`line`: its first cell, or a number right before the row's
 *    own label): that one, whatever the heading.
 * 3. Otherwise the section's code, only when its label is empty or is the row's own label (`benefit`): "3", "Section 3",
 *    "3 Fracture of arm, wrist or leg" on that row. Any other label (a cover heading): null.
 * Callers pass `line` only when it is the row's own line; a candidate line being tested against the row is never passed. */
export function rowSectionCode(section: string | null | undefined, benefit: string | null | undefined, line?: string | null): string | null {
  const id = sectionIdOf(section);
  if (!id) return null;
  const lead = lineLead(line, benefit);
  if (lead) return lead;
  return !id.label || flatWords(id.label) === flatWords(benefit ?? "") ? id.code : null;
}
/** rowSectionCode as a whole number ("3"), or null ("3.1", "3(a)", none). */
export const rowSectionNumber = (section: string | null | undefined, benefit: string | null | undefined, line?: string | null): number | null => {
  const c = rowSectionCode(section, benefit, line);
  return c != null && /^\d{1,3}$/.test(c) ? Number(c) : null;
};
