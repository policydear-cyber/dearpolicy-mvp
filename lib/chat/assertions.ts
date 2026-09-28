/**
 * V1.1 Task 2: the source-verified answer boundary.
 *
 * Every material statement an answer makes is first a structured Assertion.
 * verifyAssertions() keeps only the ones whose cited passage, document
 * version and ownership actually support them; everything else is dropped
 * with a reason. Nothing that fails a check is rendered -- not softened, not
 * caveated, omitted.
 *
 * Checks, in order:
 *  - the document exists, belongs to this household, is active (not deleted
 *    or pending deletion), is not superseded and was released by the
 *    document-safety gate;
 *  - the subject is one of the people the question is about, and the
 *    document speaks for that person (personal member, or wording matched to
 *    that person's contract);
 *  - the cited version (checksum) is the document's current one;
 *  - a page is recorded and the passage is found on that page;
 *  - every number, currency, date and condition the assertion states is in
 *    the passage (so a citation to the wrong clause does not count);
 *  - no recorded conflict between versions/pages (a conflict is withheld and
 *    explained, never resolved by picking one);
 *  - an indicative estimate never passes here: only the deterministic claim
 *    calculators may produce one.
 */
import { currenciesStatedIn, currencyStatedIn } from "@/lib/claims/currency-evidence";

export type Assertion = {
  kind: "policy_fact" | "possible_benefit" | "indicative_estimate";
  text: string; subjectId: string; policyId: string;
  documentHash: string | null; page: number | null; passage: string;
  amount?: number | null; currency?: string | null; date?: string | null; conditions?: string[];
  /** Additive (V1.1): the ingestion evidence flags for the stored fact. */
  conflictNote?: string | null; passageVerified?: boolean | null;
};
export type AssertionDocument = {
  id: string; accountId: string; lifecycleState: string; supersededAt: string | null; quarantineStatus: string | null;
  fileHash: string | null;
  /** The people this document may speak for in this answer. */
  subjectIds: string[];
};
export type VerifyContext = {
  accountId: string; people: { id: string }[];
  documents: Record<string, AssertionDocument>;
  /** Stored text of a page, or null when the page is unknown. */
  pageText: (policyId: string, page: number) => string | null;
};
export type Rejection = { assertion: Assertion; reason: string };

const RELEASED = new Set(["scan_clean", "not_scanned_prototype"]);
export function normalPassage(text: string) {
  return text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim().toLowerCase();
}
function numbersIn(text: string) {
  return (text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
/** `amount` is literally present in `passage` (thousands separators and
 * trailing .00 tolerated; nothing else -- 100 is not "1,000"). */
export function amountAppears(amount: number, passage: string) {
  if (!Number.isFinite(amount)) return false;
  return numbersIn(passage).some((n) => Math.abs(n - amount) < 1e-9);
}
function dateVariants(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [iso];
  const [, y, mo, d] = m; const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const name = months[Number(mo) - 1], short = name.slice(0, 3), day = String(Number(d));
  return [iso.slice(0, 10), `${d}/${mo}/${y}`, `${day}/${Number(mo)}/${y}`, `${d}.${mo}.${y}`, `${day} ${name} ${y}`, `${day} ${short} ${y}`, `${d} ${short} ${y}`, `${name} ${day}, ${y}`, `${short} ${day}, ${y}`, `${d}-${short}-${y}`];
}
export function dateAppears(date: string, passage: string) {
  const p = normalPassage(passage);
  return dateVariants(date).some((v) => p.includes(normalPassage(v)));
}
/** A condition is stated in the passage: verbatim, or every number and every
 * meaningful word of it is there. */
export function conditionAppears(condition: string, passage: string) {
  const c = normalPassage(condition).replace(/[.;:,]+$/, ""), p = normalPassage(passage);
  if (!c) return true;
  if (p.includes(c)) return true;
  const numbers = numbersIn(condition), have = numbersIn(passage);
  if (!numbers.every((n) => have.some((h) => Math.abs(h - n) < 1e-9))) return false;
  const words = c.match(/[a-z]{4,}/g) ?? [];
  return words.length > 0 && words.every((w) => p.includes(w));
}
function passageOnPage(passage: string, page: string) {
  const p = normalPassage(passage);
  return p.length >= 3 && normalPassage(page).includes(p);
}

export function verifyAssertion(a: Assertion, ctx: VerifyContext): string | null {
  if (a.kind === "indicative_estimate") return "an indicative estimate can only come from a claim calculator with reviewed evidence";
  const doc = ctx.documents[a.policyId];
  if (!doc) return "the cited document is not one of this household's current documents";
  if (doc.accountId !== ctx.accountId) return "the cited document belongs to another household";
  if (doc.lifecycleState !== "active") return "the cited document has been deleted";
  if (doc.supersededAt) return "the cited document has been replaced by a newer version";
  if (!RELEASED.has(doc.quarantineStatus ?? "")) return "the cited document has not been released for reading";
  if (!ctx.people.some((p) => p.id === a.subjectId)) return "the assertion is about someone this question is not about";
  if (!doc.subjectIds.includes(a.subjectId)) return "the cited document does not belong to this person";
  if (a.documentHash && doc.fileHash && a.documentHash !== doc.fileHash) return "the cited version is not the document's current version";
  if (a.conflictNote) return "conflict: " + a.conflictNote;
  if (a.passageVerified === false) return "the stored figure could not be re-found in its passage";
  if (a.page == null || !(a.page > 0)) return "the page of the supporting passage is not recorded";
  const page = ctx.pageText(a.policyId, a.page);
  if (!page) return "the cited page's text is not stored";
  if (!a.passage || !passageOnPage(a.passage, page)) return "the supporting passage is not on the cited page";
  if (a.amount != null && !amountAppears(a.amount, a.passage)) return "the amount is not in the cited passage";
  if (a.amount != null && !a.currency) return "the currency of the amount is not stated";
  if (a.currency && !currencyStatedIn(a.currency, a.passage)) return "the currency is not written in the cited passage";
  if (a.date && !dateAppears(a.date, a.passage)) return "the date is not in the cited passage";
  for (const condition of a.conditions ?? []) if (!conditionAppears(condition, a.passage)) return "a condition is not in the cited passage";
  // The rendered sentence itself may not carry a figure or currency that the
  // passage does not.
  const passageNumbers = numbersIn(a.passage);
  for (const n of numbersIn(a.text)) if (!passageNumbers.some((h) => Math.abs(h - n) < 1e-9)) return "the wording states a number the passage does not";
  for (const code of currenciesStatedIn(a.text)) if (!currencyStatedIn(code, a.passage)) return "the wording states a currency the passage does not";
  return null;
}

export function verifyAssertions(list: Assertion[], ctx: VerifyContext): { kept: Assertion[]; rejected: Rejection[] } {
  const kept: Assertion[] = [], rejected: Rejection[] = [];
  for (const assertion of list) {
    const reason = verifyAssertion(assertion, ctx);
    if (reason) rejected.push({ assertion, reason }); else kept.push(assertion);
  }
  return { kept, rejected };
}

/** Words that change what a policy pays or when. A rephrasing may not add
 * one the verified assertions do not already contain. */
const CONDITION_WORDS = /\b(?:unless|except|excluding|excluded|exclusions?|only if|provided that|subject to|waiting period|survival period|deductible|co-?insurance|capped|maximum|minimum|limit(?:ed)?|within \d+|after \d+|before \d+|guaranteed|not covered|no cover|uninsured|approved|will pay|will receive|entitled)\b/gi;
/** True when `text` (a model's rephrasing) adds no number, currency,
 * condition word or negative that the verified assertions lack. */
export function rephrasingIsFaithful(text: string, kept: Assertion[]) {
  const source = kept.map((a) => a.text + " " + a.passage + " " + (a.conditions ?? []).join(" ")).join(" ");
  const have = numbersIn(source);
  for (const n of numbersIn(text)) if (!have.some((h) => Math.abs(h - n) < 1e-9)) return false;
  for (const code of currenciesStatedIn(text)) if (!currenciesStatedIn(source).includes(code)) return false;
  if (/\$\s?\d/.test(text) && !/\$\s?\d/.test(source)) return false;
  const lower = normalPassage(source);
  for (const word of text.match(CONDITION_WORDS) ?? []) if (!lower.includes(normalPassage(word))) return false;
  return true;
}
