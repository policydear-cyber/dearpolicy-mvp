/**
 * Round 10: reading the documents real families upload -- phone photos taken
 * sideways or upside down, scans with no text layer, three policies in one
 * PDF, pages out of order, the same schedule as a photo and as a PDF, insurer
 * letters, claim decisions, hospital bills, app screenshots and the family's
 * own notes. Plain code only (no I/O, no model): every rule here reads what is
 * printed, so the same upload is always read the same way.
 */
import type { PdfPage } from "./pdf";

// ---------------------------------------------------------------------------
// What kind of paper this is
// ---------------------------------------------------------------------------
/** Uploads that are not policies: they never create cover, benefits, ledger rows or premiums. */
export type CorrespondenceRole = "insurer_letter" | "claim_decision" | "medical_bill" | "app_screenshot" | "personal_notes";
export const NON_COVER_ROLES: ReadonlySet<string> = new Set<CorrespondenceRole>(["insurer_letter", "claim_decision", "medical_bill", "app_screenshot", "personal_notes"]);
/** Payment papers: they state premiums, not cover. */
export const PAYMENT_ROLES: ReadonlySet<string> = new Set(["premium_receipt", "renewal_statement", "annual_statement"]);
/** Roles intake never reads into the benefit table or the ledger (lib/rag/ingest.ts); Home does not wait for them. */
export const NO_COVER_READING_ROLES: readonly string[] = [...PAYMENT_ROLES, ...NON_COVER_ROLES];
/** In household words. */
export const ROLE_WORDS: Record<CorrespondenceRole, string> = {
  insurer_letter: "a letter from the insurer",
  claim_decision: "the insurer's decision on a claim",
  medical_bill: "a hospital or medical bill",
  app_screenshot: "a screenshot of the insurer's app",
  personal_notes: "your own notes",
};

const FURNITURE = /DPTEST-|^[A-Za-z0-9+/=]{40,}$|^:DPTEST/;
/** The page's printed lines, without blank lines or synthetic-test furniture. */
export function printedLines(text: string): string[] {
  return String(text ?? "").replace(/DPTEST-EXTRACTION:[\s\S]*?:DPTEST-END/g, "").split("\n").map((l) => l.trim()).filter((l) => l && !FURNITURE.test(l));
}
const TITLE = /\b(?:policy schedule|schedule of (?:insurance|benefits)|certificate of (?:group )?insurance|policy contract|renewal certificate|certificate of renewal|annual (?:policy )?statement|policy wording|product summary|benefit (?:illustration|summary)|policy information page)\b/i;

/** A title on a line of its own. "SCHEDULE PAGE" is one only here: a letter that says "your revised schedule page will
 * follow" is still a letter (TE #160 F3). */
const TITLE_LINE = new RegExp("^(?:" + TITLE.source + "|\\bschedule page\\b)(?:\\s*\\(continued\\))?$", "i");

/** The words a printed person's name is never made of: a value such as "Refer To Page 2", "To Be Advised" or "Plan Holder
 * And Spouse" names nobody. */
const NOT_A_NAME = /\b(?:and|or|of|the|to|be|see|refer|as|per|by|for|plan|holder|spouse|member|members|employee|employees|child|children|dependants?|name|insured|assured|owner|advised|page|schedule|policy|sample|specimen|any|all|each|every|who|whose|which|payable|amount|sum|ltd|limited|pte|plc|inc|bhd|berhad|sdn|llp|llc|company|co|corporation|union|association|society|trust|bank|insurance|date|birth|gender|sex|age|aged|signature|class|occupation|nric|id|identity|number|no|smoker|status|relationship|nationality|address|premium|benefit|benefits|cover|signed|main|joint|second|life|not|applicable|confirmed|self)\b/i;
/** A label that starts its line ("LIFE INSURED", "Policy Owner :", "Assured\t:") and the value beside it, up to the next
 * column. */
const PERSON_CELL = /^(?:life\s+insured|life\s+assured|insured(?:\s+person)?|assured|policy\s*owner|policy\s*holder|owner|name\s+of\s+(?:the\s+)?insured)\s*(?:[:：]\s*|\t+\s*:?\s*|\s{2,})([^\t]+?)(?:\t|\s{2,}|$)/i;
/** A person's name as printed: two to five words of letters, each starting with a capital letter, except the particles a
 * name may carry in between ("Siti Aminah binti Ahmad", "Kumar a/l Rajan", "Jan van Dijk"). */
const NAME_PARTICLE = /^(?:bin|binti|bte|bt|a\/l|a\/p|s\/o|d\/o|van|von|der|den|de|da|das|dos|del|della|di|du|le|la|al|el|ibn)$/i;
function nameShaped(value: string): boolean {
  const words = value.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && /^[A-Z]/.test(words[0]) && /^[A-Z]/.test(words[words.length - 1])
    && words.every((w) => /^[A-Z][A-Za-z.'’-]*$/.test(w) || NAME_PARTICLE.test(w));
}

/** A page that is a policy's own schedule: a schedule title on one of its first four lines ("Policy Schedule",
 * "SCHEDULE PAGE"), the policy's own number beside its label, and a person's name in a cell that starts with a person
 * label ("LIFE INSURED  Lim Wei Jie"). A pack that sends the schedule behind a cover letter and before the contract
 * wording holds one. Default-safe (TE #160 F1, F2): a wording's "Schedule of Benefits", a value that is not a name
 * ("Refer to page 2", "Plan holder and spouse", "Sum Assured payable on death"), a company, a group or master policy, and
 * a specimen or sample page are not one. Returns its page number, or null. */
export function schedulePage(pages: Pick<PdfPage, "pageNumber" | "text">[]): number | null {
  const SCHEDULE_LINE = /^(?:policy schedule|schedule page|schedule of insurance)(?:\s*\(continued\))?(?:\s+[^\x00-\x7F].*)?$/i;
  const OWN_NUMBER = /\bpolicy\s+(?:number|no\.?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9-]{5,})/i;
  const LONE_NUMBER = /^[A-Z0-9][A-Z0-9-]{5,}$/i;
  // A real number: four or more digits ("XXXXXXXX", "to be issued" and a blank are not one) (Critic R289 H1).
  const realNumber = (x: string) => (x.match(/\d/g) ?? []).length >= 4;
  // An endorsement that reissues the schedule page says so ("Endorsement No. 3", "this endorsement") on or before that
  // page: it stays an endorsement (Critic R289 M1). An endorsement attached after the schedule is part of the pack (TE G1).
  const ENDORSED = /\bendorsement\s+(?:no\.?|number)\s*\d|\bthis\s+endorsement\b/i;
  for (const p of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    if (ENDORSED.test(p.text)) return null;
    const lines = printedLines(p.text);
    if (!lines.slice(0, 4).some((l) => SCHEDULE_LINE.test(l))) continue;
    if (/\b(?:specimen|sample|illustrat(?:ion|ive)|dummy|quotation)\b/i.test(p.text) || /\b(?:group|master)\b(?:\s+\w+){0,2}\s+polic(?:y|ies)\b/i.test(p.text)) continue;
    const numbered = lines.some((l, i) => {
      if (!/\bpolicy\s+(?:number|no\.?)\b/i.test(l)) return false;
      const own = OWN_NUMBER.exec(l)?.[1];
      if (own) return realNumber(own);
      // "2492015437" above or below a "POLICY NUMBER" line of its own.
      return /^policy\s+(?:number|no\.?)$/i.test(l) && [lines[i - 1], lines[i + 1]].some((x) => !!x && LONE_NUMBER.test(x) && realNumber(x));
    });
    if (!numbered) continue;
    const named = lines.some((l) => {
      const value = PERSON_CELL.exec(l)?.[1]?.trim();
      return !!value && nameShaped(value) && !NOT_A_NAME.test(value);
    });
    if (named) return p.pageNumber;
  }
  return null;
}

/** Letters, claim decisions, bills, app screenshots and notes, by what the page itself prints; null for anything else. */
export function correspondenceRole(pages: Pick<PdfPage, "text" | "legibility">[]): CorrespondenceRole | null {
  const first = pages.slice(0, 6).map((p) => printedLines(p.text).join("\n")).join("\n");
  const head = printedLines(pages[0]?.text ?? "").slice(0, 12);
  const headText = head.join("\n");
  const titled = TITLE.test(headText);
  const letter = isLetter(first);
  // A decision on a claim: its claim number and what was decided.
  if (/\bclaim (?:number|no\.?|reference|ref\.?)\b/i.test(first)
    && /\b(?:unable to (?:admit|accept|pay)|regret|not (?:payable|admissible|covered)|declin(?:e|ed|ing)\b|reject(?:ed|ion)?\b|repudiat\w+|amount payable|we are pleased to|has been (?:approved|admitted|settled|paid))/i.test(first)
    && (letter || /\bamount (?:claimed|payable|approved)\b/i.test(first))) return "claim_decision";
  // A hospital or clinic bill: a bill or invoice number, or its title, and a patient.
  if ((/^(?:final bill|tax invoice|hospital bill|interim bill|final bill\s*\/\s*tax invoice|invoice)\b/im.test(headText) || /\b(?:bill|invoice) (?:number|no\.?)\b/i.test(first) || /\bamount payable by (?:the )?patient\b/i.test(first))
    && /\b(?:patient|admission|admitted|discharge|ward)\b/i.test(first) && !titled) return "medical_bill";
  // A phone screenshot of an insurer's app: the status bar (a clock, the battery) and the app's own navigation.
  if (pages.length === 1 && /^\d{1,2}:\d{2}\b/.test(head[0] ?? "") && /\b\d{1,3}\s?%/.test(head.slice(0, 2).join(" "))
    && /\b(?:my polic(?:y|ies)|view (?:policy|policies|policy documents)|home\s+polic(?:y|ies)\s+claims|in force)\b/i.test(first)) return "app_screenshot";
  // The family's own notes: typed ("my notes", "to do") or handwritten (the reader could only partly read it).
  if (!titled && (/\b(?:my|our) (?:own )?(?:insurance |policy |family )?notes\b|\bnotes? (?:for|to) (?:myself|self)\b|^\s*to[- ]do\b/im.test(headText) || /\bnot from the insurer/i.test(first))) return "personal_notes";
  if (!titled && pages.length <= 3 && pages.some((p) => p.legibility === "poor") && !/\b(?:policy|certificate) (?:no\.?|number)\b/i.test(first)) return "personal_notes";
  // A cover letter sent with the policy itself ("Your policy is now ready", then the policy schedule on page 3) is the
  // policy, not correspondence: a later page that opens with a line that IS a document title encloses that document.
  const enclosesDocument = pages.slice(1, 6).some((p) => printedLines(p.text).slice(0, 4).some((line) => TITLE_LINE.test(line)));
  // Any other letter -- unless it is a notice the policy's own status rests on (renewal, premium due, lapse, receipt).
  if (letter && !titled && !enclosesDocument && !/\b(?:renewal notice|premium notice|premium reminder|notice of lapse|lapsed|grace period|reinstate\w*|official receipt|premium receipt|certificate)\b/i.test(first)) return "insurer_letter";
  return null;
}

const isLetter = (text: string) => /^\s*dear\s+(?:mr|mrs|ms|mdm|madam|dr|sir|customer|policy\s?holder|valued)\b|^\s*dear\s+[A-Z][\p{L}'’-]+/imu.test(text)
  && /\byours (?:sincerely|faithfully|truly)\b|^\s*(?:best |kind |warm )?regards\b/im.test(text);
// The only ways a status notice may name a schedule or certificate: as a reference to the one the household already
// holds ("please refer to your policy schedule", "keep this with your certificate of insurance", "your policy schedule is
// unchanged", "Policy schedule: no change"). Allow-list (Critic R330 H1): any other mention ("REVISED POLICY SCHEDULE",
// "Policy Schedule No. 2", "your updated policy schedule is enclosed", "serves as your certificate") means the document
// may carry the schedule itself, and it keeps the old rules.
const DOC_NAME = String.raw`(?:policy schedule|schedule|certificate of insurance)`;
// A reference ends its sentence (at . ! ? or the end of the text, never at a wrapped line, ";" or ",": TE #184 round 5), or
// ends with a known tail: "see your policy schedule attached", "refer to the policy
// schedule enclosed" and "the changes in your policy schedule are as follows" point at an enclosed schedule (Critic R332 H1).
const REFERENCE_END = String.raw`(?:\s+(?:for\s+(?:full\s+|more\s+)?(?:details|information)|for\s+the\s+(?:benefits|cover)(?:\s+that\s+(?:has|have)\s+ended)?|(?:has\s+)?ended(?:\s+on\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})?))?(?=\s*(?:[.!?]|$))`;
const REFERENCE_PHRASES = [
  new RegExp(String.raw`\b(?:refer(?:ring)?\s+to|keep\s+(?:this|it)\s+(?:together\s+)?with|as\s+(?:shown|stated|set\s+out)\s+in|see|check)\s+(?:your|the)\s+(?:existing\s+|current\s+)?` + DOC_NAME + String.raw`\b` + REFERENCE_END, "gi"),
  new RegExp(String.raw`\b(?:your|the)\s+` + DOC_NAME + String.raw`\s+(?:is\s+unchanged|remains\s+(?:valid|the\s+same|unchanged)|stays\s+the\s+same|no\s+longer\s+applies|is\s+no\s+longer\s+valid)` + REFERENCE_END, "gi"),
  new RegExp(String.raw`\bpolicy\s+schedule\s*:\s*no\s+change` + REFERENCE_END, "gi"),
  // An opening clause: "As shown in your policy schedule, premium S$99.00 was due on 1 March 2026."
  new RegExp(String.raw`\bas\s+(?:shown|stated|set\s+out)\s+in\s+(?:your|the)\s+` + DOC_NAME + String.raw`\s*,`, "gi"),
  // "The cover in your policy schedule ended on 1 March 2026."
  new RegExp(String.raw`\b(?:cover|benefits?)\s+(?:in|under)\s+(?:your|the)\s+` + DOC_NAME + REFERENCE_END, "gi"),
];
const DOCUMENT_ITSELF = /\b(?:policy schedule|schedule of (?:insurance|benefits)|schedule page|jadual polisi|certificate of (?:group )?insurance|certificate (?:no\.?|number)|insurance certificate|renewal certificate|certificate of renewal|policy certificate|policy contract|policy wording|policy information page|endorsement|serves as)\b|(?<!\b(?:payment|premium|instalment)\s)\bschedule\b/im;
const NOTICE_TITLE_LINE = /^(?:(?:final|first|second|overdue)\s+)?(?:notice of (?:policy\s+)?(?:lapse|reinstatement|renewal|termination)|(?:policy\s+)?lapse (?:notice|notification)|premium (?:reminder|notice|due notice)|(?:reminder\s*:\s*)?premium overdue|grace period (?:reminder|notice)|renewal notice|reinstatement(?: notice| of (?:your |the )?policy)?|notis peringatan premium|notis luput(?: polisi)?|official receipt|premium receipt|payment receipt|payment acknowledge?ment)(?:\s*[-–—:/]\s*[^.;]{0,60})?$/i;
// What happened to this policy, never a term a schedule prints ("Grace period: 30 days", "a lapsed policy may be
// reinstated within 2 years") (Critic R331 H1): a letter without a notice title needs one of these.
const STATUS_EVENT = /\b(?:has|have|had)\s+(?:now\s+)?(?:lapsed|been\s+(?:reinstated|terminated|cancelled))\b|\blapsed\s+on\b|\bwas\s+(?:reinstated|terminated)\b|\breinstated\s+with\s+effect\b|\bnot\s+(?:been\s+)?(?:received|paid)\b|\bwas\s+due\s+on\b|\bis\s+(?:now\s+)?(?:in|within)\s+(?:the|its)\s+(?:\d+-day\s+)?grace\s+period\b|\bgrace\s+period\s+(?:ends|will\s+end|expires)\b|\boverdue\b|\bwe\s+have\s+received\s+(?:your\s+)?(?:premium|payment)\b/i;
// What happened to the policy outweighs the payment words a notice also prints ("the renewal premium was not received",
// "an official receipt will be sent once paid"): such a notice is never payment evidence (TE #184).
// Grace-period wording alone does not demote a renewal notice: many print theirs (TE #184 R1).
const LAPSE_OR_DUE = /\b(?:laps(?:e|ed|es|ing)|reminder|overdue|terminat\w+|reinstat\w*|luput|peringatan|not (?:been )?(?:received|paid))\b/i;
// A receipt that only promises one ("will be sent once paid") records no payment.
const NO_PAYMENT_YET = /\bnot\s+(?:been\s+)?(?:received|paid)\b|\bwill\s+be\s+(?:sent|issued)\b|\bonce\s+(?:paid|payment)\b|\bupon\s+payment\b/i;
// A sentence that records a payment: "Received with thanks S$88.20", "Amount received: RM 180.00", "S$99.00 received". A
// footnote ("premiums not received by the due date may lapse") or a promise ("a copy will be sent") does not undo it (TE #184 R4/R5).
const PAID_AMOUNT = /(?:S\$|SGD|RM|MYR|£|GBP|US\$|USD)\s?\d[\d,]*(?:\.\d{2})?/i;
const PAID_PHRASE = /\breceived\s+with\s+thanks\b|\b(?:amount|premium|payment|sum)\s+(?:received|paid)\b|\bwe\s+have\s+received\b|\b(?:has|have)\s+been\s+(?:received|paid)\b|\b(?:was|were)\s+(?:received|paid)\s+on\b|\breceived\s+on\s+\d/i;
const NOT_PAID = /\bnot\s+(?:been\s+)?(?:received|paid)\b|\b(?:once|when|if|upon)\s+(?:paid|payment|received)\b|\b(?:to\s+be|must\s+be|should\s+be|is\s+to\s+be)\s+paid\b|\bdishono(?:u)?red\b|\b(?:returned|reversed|bounced|rejected|unsuccessful)\b/i;
const recordsPayment = (text: string) => {
  const lines = text.split("\n");
  const sentences = text.split(/\n|(?<=[.!?])\s+/);
  if (sentences.some((l) => PAID_AMOUNT.test(l) && PAID_PHRASE.test(l) && !NOT_PAID.test(l))) return true;
  // "Amount Received" above "S$88.20" (a label-above-value layout: TE #184 R14).
  return lines.some((l, i) => /^\s*(?:amount|premium|payment)\s+(?:received|paid)\s*:?\s*$/i.test(l) && PAID_AMOUNT.test(lines[i + 1] ?? "")) && !NOT_PAID.test(text.replace(/premiums?\s+not\s+received\s+by\s+the\s+due\s+date[^.]*\./gi, " "));
};
const RECEIPT_WORDS = /\b(?:(?:premium|official|payment) receipt|payment acknowledge?ment)\b/i;
const noticeLetter = (text: string) => /^\s*dear\s+\S|^\s*tuan\s*\/\s*puan\b/im.test(text)
  && /\byours (?:sincerely|faithfully|truly)\b|^\s*(?:best |kind |warm )?regards\b|^\s*(?:many thanks|thank you|sincerely|yang benar|yang ikhlas)\b|\bcomputer[- ]generated (?:letter|notice)\b/im.test(text);

/** A short notice about the policy's status (a lapse notice, a premium reminder, a reinstatement, a renewal notice, a
 * receipt) that only refers to the policy schedule ("please refer to your policy schedule"): it is not the schedule. It
 * is titled as a notice on a line of its own near its top, or it is a letter that says what happened to the policy.
 * Default-safe: a document of more than three pages, one that names a schedule, certificate, wording or endorsement in
 * any way other than a known reference phrase, or one holding a policy's own schedule page is never one. */
export function statusNotice(pages: Pick<PdfPage, "text">[]): boolean {
  if (!pages.length || pages.length > 3) return false;
  const lines = pages.flatMap((p) => printedLines(p.text));
  const text = lines.join("\n");
  if (DOCUMENT_ITSELF.test(REFERENCE_PHRASES.reduce((t, re) => t.replace(re, " "), text))) return false;
  if (schedulePage(pages.map((p, i) => ({ pageNumber: i + 1, text: p.text }))) != null) return false;
  // What the pages carry decides before any wording (Critic R334): a later page with a policy's own particulars is an
  // enclosed schedule, whatever the letter calls it, and on page 1 only a notice title outweighs them.
  if (pages.slice(1).some((p) => policyParticulars(p.text))) return false;
  if (printedLines(pages[0].text).slice(0, 12).some((l) => NOTICE_TITLE_LINE.test(l))) return true;
  if (policyParticulars(pages[0].text)) return false;
  // A letter without a notice title that sends something with it ("attached", "enclosed", "overleaf") may send the schedule.
  if (/\benclos\w*|\battach\w*|\boverleaf\b|\bherewith\b|\bfollows?\b|\bbelow\b/i.test(text)) return false;
  return noticeLetter(text) && STATUS_EVENT.test(text);
}

/** A page that prints a policy's own particulars: its policy number, a person's name in a person cell ("Life Assured:
 * Ravi Kumar") and a sum assured, sum insured or benefit figure. */
function policyParticulars(text: string): boolean {
  const lines = printedLines(text);
  const numbered = lines.some((l) => /\bpolicy\s+(?:number|no\.?)\s*[:#.]?\s*[A-Z0-9-]*\d{4}/i.test(l));
  const named = lines.some((l) => { const v = PERSON_CELL.exec(l)?.[1]?.trim(); return !!v && nameShaped(v) && !NOT_A_NAME.test(v); });
  const sum = lines.some((l) => /\b(?:sum\s+(?:assured|insured)|benefit\s+amount|death\s+benefit|amount\s+(?:assured|insured|of\s+cover)|cover(?:age)?\s+amount)\b[^\n]*\d/i.test(l));
  return numbered && named && sum;
}

/** The role a status notice keeps, decided by its title first (Critic R330 M2): a receipt that records a payment is a
 * receipt; a lapse, reminder, termination or reinstatement notice is a notice ("other"), whatever payment words it prints;
 * a renewal notice is a renewal statement unless it says the premium is overdue or was not received. */
export function statusNoticeRole(pages: Pick<PdfPage, "text">[]): "other" | "renewal_statement" | "premium_receipt" {
  const text = pages.map((p) => printedLines(p.text).join("\n")).join("\n");
  const title = printedLines(pages[0]?.text ?? "").slice(0, 12).filter((l) => NOTICE_TITLE_LINE.test(l)).join("\n");
  // A receipt titled as one records a payment (for a reinstatement, or within the grace period: TE #184 R2/R3) unless it
  // only promises one.
  if (RECEIPT_WORDS.test(title) && (recordsPayment(text) || !NO_PAYMENT_YET.test(text))) return "premium_receipt";
  if (title && LAPSE_OR_DUE.test(title)) return "other";
  if (/\brenewal notice\b/i.test(title)) return LAPSE_OR_DUE.test(text) ? "other" : "renewal_statement";
  if (LAPSE_OR_DUE.test(text) || NO_PAYMENT_YET.test(text)) return "other";
  if (/\brenewal (?:notice|statement|premium)\b/i.test(text)) return "renewal_statement";
  return RECEIPT_WORDS.test(text) ? "premium_receipt" : "other";
}

// ---------------------------------------------------------------------------
// Figures a scan prints unclearly
// ---------------------------------------------------------------------------
const CONFUSABLE = /[OoIl|]/;
/** Appended to a money pattern's number: a figure immediately followed by a
 * letter a scan confuses with a digit (S$5O,000; S$2,l84) is not that figure. */
export const NOT_AN_OCR_FRAGMENT = String.raw`(?![,.]?[OoIl|])`;
export const NOT_AFTER_OCR_FRAGMENT = String.raw`(?<![\d][,.]?[OoIl|]+[,.]?)`;
export type UnclearFigure = { token: string; clean: string; value: number; page: number };
/** Money tokens on a page whose whole-number part carries a letter where a digit belongs. */
export function unclearFigures(text: string, page = 0): UnclearFigure[] {
  const out: UnclearFigure[] = [];
  for (const m of String(text ?? "").matchAll(/(S\$|SGD\s?|\$)\s?([0-9OoIl|][0-9OoIl|,]*(?:\.[0-9OoIl|]{1,2})?)(?![A-Za-z0-9])/g)) {
    const body = m[2];
    const whole = body.split(".")[0];
    if (!/\d/.test(body) || !CONFUSABLE.test(whole)) continue;
    const cleanBody = body.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    if (!/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(cleanBody)) continue;
    out.push({ token: m[0], clean: m[0].replace(body, cleanBody), value: Number(cleanBody.replace(/,/g, "")), page });
  }
  return out;
}
const formatted = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** The value printed clearly as money somewhere in the text (any thousands grouping, optional cents). */
function printedClearly(text: string, value: number) {
  const whole = Math.trunc(value), cents = Math.round((value - whole) * 100);
  const digits = String(whole), groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  const body = groups.join(",?") + (cents ? "\\." + String(cents).padStart(2, "0") : "(?:\\.00?)?");
  return new RegExp(String.raw`(?:S\$|SGD\s?|\$)\s?` + body + String.raw`(?![\d,.]*[\dOoIl|])`, "i").test(text);
}
/**
 * A transcribed page prints "S$5O,000". It is read as S$50,000 only when the
 * same document prints S$50,000 clearly somewhere else (the rule: the letter
 * O and the letters I/l/| become 0 and 1 inside a figure, and the document
 * must agree); the page text then carries the clean figure and a note says so.
 * Otherwise the figure is left exactly as transcribed -- every figure parser
 * refuses it (NOT_AN_OCR_FRAGMENT) -- and a note says it could not be read with
 * certainty. Only transcribed (OCR) pages are touched.
 */
export function settleOcrFigures(pages: PdfPage[]): { pages: PdfPage[]; notes: string[]; unclear: UnclearFigure[] } {
  const notes: string[] = [], unclear: UnclearFigure[] = [];
  const all = pages.map((p) => p.text).join("\n");
  const out = pages.map((page) => {
    if (page.extractionMethod !== "ocr") return page;
    let text = page.text;
    for (const f of unclearFigures(page.text, page.pageNumber)) {
      const elsewhere = all.split(f.token).join(" ");
      if (printedClearly(elsewhere, f.value)) {
        text = text.split(f.token).join(f.clean);
        notes.push(`On page ${page.pageNumber} the scan prints “${f.token}”; DearPolicy read it as S$${formatted(f.value)} because the document prints the same figure clearly elsewhere.`);
      } else {
        unclear.push(f);
        notes.push(`On page ${page.pageNumber} the scan prints “${f.token}”, which can’t be read with certainty, so DearPolicy does not use it as a figure. Check it against the paper copy.`);
      }
    }
    return text === page.text ? page : { ...page, text };
  });
  return { pages: out, notes: [...new Set(notes)], unclear };
}
/** A figure or year a scan printed unclearly, as shown to the household:
 * "up to S$12,5OO" becomes "up to an unclear amount (the scan shows “12,5OO”)"
 * and "1 July 2O18" becomes "1 July (the year is unclear on the scan: “2O18”)"
 * -- never a figure anything reads as money or a date. A reader's
 * "[illegible]" becomes "(illegible)". Idempotent. */
export function flagUnclearFigures(line: string): string {
  let out = String(line ?? "").replace(/\[illegible\]/gi, "(illegible)");
  // A reference number whose digits a scan confused with letters ("SSI-GY-77l0293") is shown as printed, said to be unclear.
  out = out.replace(/\b([A-Z]{2,}(?:-[A-Z0-9]{1,6})*-)([0-9OolI|]{5,})\b(?! \(some characters)/g, (whole, lead: string, tail: string) =>
    /\d/.test(tail) && /[OolI|]/.test(tail) ? whole + " (some characters are unclear on the scan)" : whole);
  for (const f of unclearFigures(out)) {
    const body = f.token.replace(/^(?:S\$|SGD\s?|\$)\s?/, "");
    out = out.split(f.token).join("an unclear amount (the scan shows “" + body + "”)");
  }
  // Only the cents unclear ("S$1,962.0O"): the dollars are printed clearly, the cents are said to be unclear.
  out = out.replace(/(S\$|SGD\s?)(\d{1,3}(?:,\d{3})*|\d+)\.([0-9OoIl|]{1,2})(?![A-Za-z0-9])/g, (whole, mark: string, dollars: string, cents: string) =>
    /[OoIl|]/.test(cents) ? mark + dollars + " (the cents are unclear on the scan: “" + dollars + "." + cents + "”)" : whole);
  return out.replace(/\b((?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December))\s+([12][0-9OoIl|]{3})\b/g,
    (whole, lead: string, year: string) => /[OoIl|]/.test(year) ? lead + " (the year is unclear on the scan: “" + year + "”)" : whole);
}

/**
 * A transcribed table often comes back with its columns broken: a cell on a
 * line of its own ("Early stage cancer" / "25% of sum assured, up to" /
 * "S$12,5OO"), or two cells separated by spaces instead of a tab
 * ("Angioplasty (once only)  10% of sum assured"). Read line by line, the label
 * and its amount fall apart. On transcribed pages only, a short label line
 * followed by the lines of its value is joined back into one row (label TAB
 * value), and a run of two or more spaces between two cells becomes a TAB.
 * Nothing is added or reworded: only line breaks and spaces change.
 */
export function mendOcrRows(text: string): string {
  // A word with a digit a scan confused for a letter ("Ear1y", "Po1icy", "SilverShie1d") is that word:
  // only a 1 or 0 between letters, in a word of letters -- never a code, number or policy number.
  const words = (l: string) => l.replace(/\b([A-Za-z]{2,})([10])([a-z]{1,})\b/g, (_m, a: string, d: string, b: string) => a + (d === "1" ? "l" : "o") + b)
    .replace(/\b([A-Z][a-z]{1,})([10])([a-z]{1,})\b/g, (_m, a: string, d: string, b: string) => a + (d === "1" ? "l" : "o") + b);
  const lines = String(text ?? "").split("\n").map((l) => words(l).replace(/(\S) {2,}(?=\S)/g, "$1\t"));
  const out: string[] = [];
  const isLabel = (l: string) => !!l && !l.includes("\t") && l.length <= 48 && !/(?<![A-Za-z])\d/.test(l) && !/[.:;!?]$/.test(l) && /^[A-Z]/.test(l) && !/^[A-Z0-9 &'-]+$/.test(l);
  const startsValue = (l: string) => /^(?:\d|S\$|SGD|\$|up to\b|nil\b|as charged\b|not covered\b)/i.test(l);
  const continues = (l: string) => /(?:\bup to|\bof|,|\bper)$/i.test(l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isLabel(line) && i + 1 < lines.length && startsValue(lines[i + 1]) && !lines[i + 1].includes("\t")) {
      let value = lines[i + 1], j = i + 1;
      while (continues(value) && j + 1 < lines.length && startsValue(lines[j + 1]) && !lines[j + 1].includes("\t") && value.length < 120) { value += " " + lines[j + 1]; j++; }
      out.push(line + "\t" + value);
      i = j;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Pages out of order, and several policies in one file
// ---------------------------------------------------------------------------
const PAGE_LABEL = /\bpage\s+(\d{1,3})\s+of\s+(\d{1,3})\b/i;
/** "Page X of N" as printed on each page (the last such label on the page), or null. */
export function printedPageLabel(text: string): { page: number; of: number } | null {
  const all = [...String(text ?? "").matchAll(new RegExp(PAGE_LABEL.source, "gi"))];
  const m = all.at(-1);
  return m ? { page: Number(m[1]), of: Number(m[2]) } : null;
}
/** When every page prints "Page X of N" for one N that covers the whole file, and the file's order
 * is not the printed order: the file's page numbers in printed order. Null when in order or unknown. */
export function printedOrder(pages: Pick<PdfPage, "pageNumber" | "text">[]): number[] | null {
  if (pages.length < 2) return null;
  const labels = pages.map((p) => printedPageLabel(p.text));
  if (labels.some((l) => !l) || new Set(labels.map((l) => l!.of)).size !== 1 || labels[0]!.of !== pages.length) return null;
  if (new Set(labels.map((l) => l!.page)).size !== pages.length) return null;
  const order = pages.map((p, i) => ({ n: p.pageNumber, printed: labels[i]!.page })).sort((a, b) => a.printed - b.printed).map((x) => x.n);
  return order.every((n, i) => n === pages[i].pageNumber) ? null : order;
}

const NUMBER_FIELD = /\b(?:policy|certificate|contract)\s+(?:no\.?|number)\s*[:#.]?\s*([A-Z0-9][A-Z0-9/-]{4,})/i;
/** One policy's pages inside a file that holds several. */
export type BundleSegment = { from: number; to: number; number: string; title: string };
/**
 * Several policies scanned or saved into one PDF: a new policy starts on a
 * page whose top prints a schedule or certificate title AND a policy or
 * certificate number different from the one before it (a page numbered "Page
 * 1 of N" confirms it). Null unless at least two policies with different
 * numbers are found. Pages before the first title stay with the first policy.
 */
export function bundleSegments(pages: Pick<PdfPage, "pageNumber" | "text">[]): BundleSegment[] | null {
  if (pages.length < 2) return null;
  const starts: { index: number; number: string; title: string }[] = [];
  for (const [index, page] of pages.entries()) {
    const lines = printedLines(page.text);
    const top = lines.slice(0, 8).join("\n");
    const titleLine = lines.slice(0, 8).find((l) => TITLE.test(l) && !/\b(?:policy wording|product summary)\b/i.test(l));
    const number = lines.slice(0, 16).join("\n").match(NUMBER_FIELD)?.[1]?.replace(/[.,;:]+$/, "");
    if (!titleLine || !number) continue;
    const label = printedPageLabel(page.text);
    if (label && label.page !== 1) continue;
    if (starts.length && starts[starts.length - 1].number.toUpperCase() === number.toUpperCase()) continue;
    if (!/\b(?:insured|life assured|policyholder|policy owner|insured person|name)\b/i.test(top + "\n" + lines.slice(0, 16).join("\n"))) continue;
    starts.push({ index, number, title: titleLine });
  }
  if (starts.length < 2 || new Set(starts.map((s) => s.number.toUpperCase())).size < 2) return null;
  return starts.map((s, i) => ({ from: pages[i === 0 ? 0 : s.index].pageNumber, to: pages[(starts[i + 1]?.index ?? pages.length) - 1].pageNumber, number: s.number, title: s.title }));
}

// ---------------------------------------------------------------------------
// The same policy uploaded twice (a photo and a PDF), or an older schedule of it
// ---------------------------------------------------------------------------
/** A policy number with the letters a scan confuses with digits read as digits, and punctuation dropped. */
export function policyNumberKey(value: string): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL|]/g, "1");
}
/** Does the text print this policy number (allowing a scan's O/0 and l/1 confusions)? */
export function printsPolicyNumber(text: string, number: string): boolean {
  const key = policyNumberKey(number);
  if (key.length < 6) return false;
  for (const m of String(text ?? "").matchAll(/[A-Za-z0-9|][A-Za-z0-9|/-]{4,}[A-Za-z0-9|]/g)) if (policyNumberKey(m[0]) === key) return true;
  return false;
}
