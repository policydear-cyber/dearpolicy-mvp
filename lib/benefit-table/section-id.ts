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
const CODE = String.raw`(\d{1,3}(?:\.\d{1,2}){0,2}(?:\s?\([a-z0-9]{1,2}\)|[a-z](?![a-z0-9]))?)`;
const LEAD = new RegExp(String.raw`^\s*${WORD}${CODE}(?![\d])`, "i");
/** What may follow a number for it to be a section's code and not a figure: the end, or a separator ("." ")" ":" "-" "–"
 * "—" "|" or a space) — but never a figure's continuation ("1,000", "2.5"), a unit or a percentage ("24 hours",
 * "18 years", "50%", "2 x"). */
const AFTER = /^(?:$|\s|[.):|\-–—])/;
const NOT_CODE = /^\s*(?:[,.]\d|%|(?:percent|per\s*cent|years?|yrs?|months?|weeks?|days?|nights?|hours?|hrs?|minutes?|mins?|times|x)\b|[£$€¥₹])/i;

/** The section's code and label, or null when it does not start with a section number. */
export function sectionIdOf(section: string | null | undefined): SectionId | null {
  const s = section ?? "";
  const m = LEAD.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  if (NOT_CODE.test(rest) || !AFTER.test(rest)) return null;
  const code = m[1].replace(/\s+/g, "");
  const label = rest.replace(/^\s*[.):]?\s*(?:[-–—:|]\s*)?/, "").trim();
  return { code, number: /^\d{1,3}$/.test(code) ? Number(code) : null, label };
}
