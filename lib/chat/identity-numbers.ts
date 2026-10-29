/**
 * A national identity number in a chat answer is shown masked, the way a group certificate prints it ("S****567D"), for any
 * household in any market: in every word of the answer, its citations' excerpts, and the turn report kept with it.
 *
 * It runs where every chat path meets: lib/chat/store.ts saveTurn masks before anything is saved or returned, and
 * lib/chat/monetary-boundary.ts sanitizeStoredAnswer masks what was saved earlier when a chat or a finished job is reopened,
 * so answers stored before this rule are masked when shown without the stored rows being changed.
 *
 * Before this, only the simple chat masked, and only Singapore's NRIC/FIN shape; answers saved 22-24 Oct carried a full
 * NRIC in their citation excerpts and reopened with it.
 *
 * Shapes no policy number takes are masked wherever they appear. A value that could equally be a policy or member number
 * (a UK National Insurance number, a passport, a 12-digit MyKad without its dashes) is masked only when the text labels it
 * an identity number. The household's own page text and the document viewer are not changed: the document is theirs.
 */

// Bounded by any non-alphanumeric, not \b: a file name joins an ID with "_" ("Certificate_S1234567D.pdf"), and "_" is a
// word character, so \b would leave it whole (TE pr153 F1).
const SHAPES: [RegExp, string][] = [
  // Singapore NRIC / FIN.
  [/(?<![A-Za-z0-9])([STFGM])\d{4}(\d{3}[A-Z])(?![A-Za-z0-9])/g, "$1****$2"],
  // Hong Kong identity card, with its bracketed check digit.
  [/(?<![A-Za-z0-9])([A-Z]{1,2})\d{3}(\d{3})\(([0-9A])\)/g, "$1***$2($3)"],
];
// Malaysia MyKad as printed with its dashes, whose first six digits are a birth date (YYMMDD): "Group policy 123456-78-0001"
// is not one. A dashed US Social Security number is masked only after its label: unlabelled, "123-45-6789" is as likely a
// claim reference (Critic R262 M1).
const MYKAD = /(?<![A-Za-z0-9])(\d{2})(\d{2})(\d{2})-\d{2}-(\d{4})(?![A-Za-z0-9])/g;

/** A label that says the value after it is a person's identity number; "policy no." and "member ID" are not among them. */
const LABEL = String.raw`(?:NRIC|FIN|NIRC|I\/?C|(?:No\.?\s*)?K\/P|Kad\s+Pengenalan|MyKad|MyKid|Birth\s+Cert(?:ificate)?|HKID|NINO|SSN|TFN|PAN|Aadhaar|National\s+Insurance|NI|Passport|National\s+ID(?:entity)?|Identity(?:\s+Card)?|Identification|ID|Social\s+Security|Tax\s+File)`;
const NOT_A_PERSON = String.raw`(?<!\b(?:policy|member|membership|claim|group|plan|certificate|scheme|account|staff|employee|card|reference|case|invoice|receipt)\s{1,3})`;
const LABELLED = new RegExp(String.raw`${NOT_A_PERSON}\b(${LABEL}\b(?:\s*(?:No\.?|Number|#))?\s*[:.]?\s*(?:(?:is|was)\s+)?)([A-Z0-9][A-Z0-9 -]{4,22}[A-Z0-9])(?![A-Z0-9*])`, "gi");
// "ID" and "NI" alone are only labels when a number word follows them ("ID No.", "NI number"), never "ID: ..." on a membership card.
const BARE_SHORT = /^(?:ID|NI|PAN|FIN)\s*[:.]?\s*(?:(?:is|was)\s+)?$/i;

function maskValue(value: string) {
  const chars = [...value];
  const keep = new Set<number>();
  for (let i = chars.length - 1, seen = 0; i >= 0 && seen < 4; i--) if (/[A-Z0-9]/i.test(chars[i])) { keep.add(i); seen++; }
  return chars.map((c, i) => (/[A-Z0-9]/i.test(c) && !keep.has(i) ? "*" : c)).join("");
}

export function maskIdentityText(text: string): string {
  let out = text;
  for (const [re, to] of SHAPES) out = out.replace(re, to);
  out = out.replace(MYKAD, (all, _yy: string, mm: string, dd: string, last: string) =>
    Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31 ? "******-**-" + last : all);
  return out.replace(LABELLED, (all, label: string, value: string) => {
    const digits = value.replace(/\D/g, "").length;
    if (digits < 5 || BARE_SHORT.test(label)) return all;
    // Only the number is masked: a sentence that runs on after it ("ID No. S1234567D and plan A") keeps its words, and a
    // label word that starts a sentence about something else ("Identity theft cover up to 50000", "Passport replacement
    // costs 25000") is not followed by a number at all (Critic R262 H1). A number printed in groups ("QQ 12 34 56 C") is one.
    // The letter groups of a spaced number are capitals ("QQ 12 34 56 C"): "National Insurance at 12500 a year" has none (TE pr153 C20).
    const number = value.match(/^(?:[A-Z]{1,2}\s+)?[A-Za-z0-9-]*\d[A-Za-z0-9-]*(?:\s+[A-Za-z0-9-]*\d[A-Za-z0-9-]*)*(?:\s+[A-Z](?![A-Za-z0-9]))?/)?.[0];
    if (!number) return all;
    return label + maskValue(number) + value.slice(number.length);
  });
}

/** Masks every string in place, through objects and arrays, and returns the same value. */
export function maskIdentityNumbers<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return maskIdentityText(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
    if (v && typeof v === "object") { for (const k of Object.keys(v)) (v as Record<string, unknown>)[k] = walk((v as Record<string, unknown>)[k]); return v; }
    return v;
  };
  return walk(value) as T;
}

/** A field that names a row rather than saying anything ("id", "policy_id", "coverKey", "documentIds"): sent back to the
 * server as is (a link's section and cover keys, a row's id), so never changed. */
const IDENTIFIER_FIELD = /^(?:id|key)s?$|_(?:id|key)s?$|(?:Id|Key)s?$/;
/** What a summary screen sends to the browser (Coverage, the benefit table, the benefit schedule), masked as a chat answer
 * is: every quote, excerpt, condition and name, through objects and arrays. Fields that identify a row are left exactly as
 * they are. Returns a masked copy; the value passed in is not changed. */
export function maskShownText<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return maskIdentityText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, IDENTIFIER_FIELD.test(k) ? x : walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
