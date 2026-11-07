/**
 * Round 7: a later amending document of the same policy (an endorsement that
 * reduces the sum assured, a policy alteration) replaces the figures it
 * changes in the earlier documents of that policy. The amending document
 * prints the old figure itself ("Death sum assured  S$300,000  S$250,000",
 * Before / After), so a figure in an older document of the same policy
 * number that the amendment prints and replaces is no longer current, and is
 * never shown as the current cover -- in chat answers or claims.
 *
 * Only when it is certain: the same policy number, both documents dated, the
 * amending document strictly later and printing amendment wording of its own
 * (amendmentWording), and the amendment printing the figure.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";

export type Replacement = { byDocId: string; byDate: string; byProduct: string | null; amounts: Set<number>;
  /** Round 7 (port): the amendment's own Before / After rows ("Annual premium  S$2,040.00  S$1,712.00"), with their page. */
  rows: { before: number; after: number; label: string; page: number; line: string }[] };
/** A title only an amending document prints, on its own line near the top of one of its first two pages. A closed list;
 * a remark in brackets ("(made up)") is taken off first. A "label: value" line of a schedule ("Endorsements: Nil",
 * "Endorsement: Applicable") is never a title: a description after a dash or colon counts only after "No. <n>", n >= 1,
 * and never when it says there is none. */
const AMENDMENT_TITLE = [
  /^(?:policy\s+|rider\s+)?(?:endorsement|alteration|amendment)(?:\s+(?:schedule|certificate|notice))?$/i,
  /^(?:policy\s+)?(?:endorsement|alteration|amendment)\s+(?:no\.?|number)\s*0*[1-9]\d*[a-z]?(?:\s*[-–:]\s*.{1,60}|\s+to\s+(?:the\s+|your\s+)?policy\b.{0,40})?$/i,
  /^(?:policy\s+)?endorsement\s*[-–:]\s*(?:change|reduction|increase|alteration)\b.{0,50}$/i,
  /^(?:notice|confirmation|letter)\s+of\s+(?:policy\s+)?(?:alteration|amendment|endorsement|change)s?\b.{0,40}$/i,
  /^changes?\s+(?:to|of|in)\s+(?:your\s+|the\s+)?(?:policy|plan|cover(?:age)?)\b.{0,40}$/i,
  /^(?:change|reduction|increase)\s+(?:of|in)\s+(?:the\s+)?sum\s+(?:assured|insured)\b.{0,40}$/i,
  /^(?:policy\s+)?(?:alteration|amendment|endorsement)s?\s+(?:of|to)\s+(?:the\s+|your\s+)?policy\b.{0,40}$/i,
];
/** An empty value after a label ("Endorsements: Nil", "Alteration: none", "Endorsements - see attached", "Amendments to your
 * policy this year: none") or a code list: a schedule's form line, never a title. */
const NO_VALUE = /(?:[-–:]|\bthis\s+year\b:?)\s*(?:nil|none|n\/?a|not\s+applicable|applicable|see\s+attached|-|0|[A-Z]{1,3}\d{1,3}\b.*)\s*$/i;
/** The title of a document that is not an amendment (a schedule, a wording, a booklet, a summary, an illustration, a
 * statement, a notice). The first title line decides: below it, an amendment title is a section of that document. */
const OTHER_TITLE = /\b(?:policy\s+schedule|schedule\s+of\s+(?:insurance|benefits)|certificate\s+of\s+insurance|policy\s+wording|terms\s+and\s+conditions|booklet|brochure|(?:product|policy|benefits?)\s+summary|(?:benefit|policy)\s+illustration|(?:annual|policy|yearly)\s+statement|renewal\s+(?:notice|certificate)|premium\s+(?:notice|reminder))\b|^(?:schedule|certificate|statement|illustration|summary)$/i;
/** A heading of a wording, a contents list or a clause: below it a line is part of that document, never its title. */
const BODY_HEADING = /^(?:general\s+)?(?:conditions|exclusions|definitions)$|^(?:table\s+of\s+)?contents$|^section\s+\d+\b/i;
/** Main's amendment wording, unchanged: an endorsement number, "policy alteration", "reduction of sum assured" or "is
 * amended" anywhere in the text. Wider sentence catches are left for a later change. */
const AMENDS = /\bendorsement\s+(?:no\.?|number)\s*\d|\bpolicy (?:is|has been) altered\b|\bpolicy alteration\b|\b(?:reduction|increase) of (?:the )?sum (?:assured|insured)\b|\b(?:is|are|hereby|has been|have been) amended\b/i;
/** The document's first title line, among the first 25 lines of its first two pages (contents entries and lines written
 * as sentences or form lines left out), and whether it is an amendment title. Null when none is printed above a wording,
 * contents or clause heading. */
function firstTitle(pages: string[]): { line: string; raw: string; amends: boolean; page: number } | null {
  for (const [index, page] of pages.slice(0, 2).entries()) {
    const lines = page.split(/\r?\n/).filter((l) => l.trim())
      // A contents entry ("Endorsements ........ 14", "Endorsement - Terrorism<tab>15") names a page further on.
      .filter((l) => !/\.{3,}|…|\t\s*(?:p(?:age|g)\.?\s*)?\d+\s*$/i.test(l))
      .map((l) => ({ raw: l.replace(/\s+/g, " ").trim(), l: l.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() })).filter((x) => x.l).slice(0, 25);
    for (const { raw, l } of lines) {
      if (BODY_HEADING.test(l)) break;
      // A title, not a sentence or a form line: no words of a clause, no full stop at its end, no empty value.
      if (/\b(?:you|we|our|us|may|must|will|shall|can|should)\b|\.$/i.test(l) || NO_VALUE.test(l)) continue;
      if (AMENDMENT_TITLE.some((re) => re.test(l))) return { line: l, raw, amends: true, page: index };
      if (OTHER_TITLE.test(l)) return { line: l, raw, amends: false, page: index };
    }
  }
  return null;
}
/** Whether a document's own text is an amendment of its policy: main's wording (AMENDS), or its first title line is an
 * amendment title (AMENDMENT_TITLE; a title further down is a section of another document), it dates its own change
 * (DATED_CHANGE) and prints the policy number it changes (OWN_POLICY_NUMBER), and it is not a form, an option, an illustration or a clause that applies only if shown
 * (NOT_A_CHANGE). pagesText: pages joined by "\f". */
/** The first-title catch is off: each round of fresh documents found another quotation, brochure or form page with a
 * listed title, a policy number and a date (te-pr375-amend.ts E11, p375d.ts Q1-Q5). Off, amendment wording is main's. */
export const FIRST_TITLE_CATCH = false;
/** ownAmendment ships off: three review rounds of fresh documents each found new pages it took for amendments (offers,
 * refusals, reversals, another policy's change, examples; TE r381, Critic p381/p381b). Off, amendment wording is main's. */
export const OWN_AMENDMENT = false;
export function amendmentWording(pagesText: string, o: { firstTitleCatch?: boolean; ownAmendment?: boolean } = {}): boolean {
  const text = String(pagesText ?? "");
  if (AMENDS.test(text) || ((o.ownAmendment ?? OWN_AMENDMENT) && ownAmendment(text))) return true;
  if (!(o.firstTitleCatch ?? FIRST_TITLE_CATCH) || !firstTitle(text.split("\f"))?.amends) return false;
  const flat = text.replace(/\s+/g, " ");
  return DATED_CHANGE.test(flat) && OWN_POLICY_NUMBER.test(flat) && !NOT_A_CHANGE.test(flat);
}
/** The whole titles only an amending document of a policy prints (a closed list; the line is the title and nothing else,
 * a remark in brackets taken off). */
const AMENDING_TITLE = /^(?:policy\s+endorsement|(?:policy\s+)?(?:endorsement\s+(?:schedule|certificate)|rider\s+endorsement|alteration\s+(?:notice|schedule)|notice\s+of\s+(?:policy\s+)?(?:change|alteration|amendment|endorsement)s?|confirmation\s+of\s+(?:policy\s+)?(?:changes?|alterations?|amendments?)|confirmation\s+of\s+(?:the\s+)?change\s+(?:of|in)\s+(?:the\s+)?sum\s+(?:assured|insured)|amendments?\s+to\s+(?:the\s+|your\s+)?policy(?:\s+schedule)?|alterations?\s+(?:of|to)\s+(?:the\s+|your\s+)?policy))$/i;
/** Titles an amending letter prints that a quotation, a brochure or an option page also prints. */
const CHANGE_TITLE = /^(?:changes?\s+to\s+your\s+policy|change\s+of\s+(?:the\s+)?sum\s+(?:assured|insured)|change\s+of\s+plan)$/i;
const MONEY_AT = String.raw`(?:S\$|SGD\s?|US\$|USD\s?|\$)\s?\d`;
/** What a change is made to: a figure, a named plan or rider ("to Gold", "to Premier Plus"), or a clause that now
 * includes or covers something. */
const CHANGED_TO = String.raw`\bto\s+(?:` + MONEY_AT + String.raw`|[A-Z][\w&'-]*|include\b|cover\b)`;
/** A closed, positive statement that a change HAS BEEN made, in the past or present tense, and nothing else:
 *  - "we have reduced / increased / changed / amended / altered / updated ... to <figure or item>";
 *  - "... has been / have been / was / is reduced / increased / changed / amended / altered (from X) to <figure or item>";
 *  - "... is now <figure>", "... are now <figure>";
 *  - "<a rider or benefit> has been added to / removed from your policy".
 * A Before / After row of two figures is the other statement (beforeAfterRow). */
const made = () => new RegExp([
  String.raw`\b[Ww]e\s+have\s+(?:reduced|increased|changed|amended|altered|updated)\b[^.;]{0,60}?` + CHANGED_TO,
  String.raw`\b(?:has|have)\s+been\s+(?:reduced|increased|changed|amended|altered|updated)\s+(?:from\s+[^.;]{1,40}?\s+)?` + CHANGED_TO,
  String.raw`\b(?:is|are|was|were)\s+(?:reduced|increased|changed|amended|altered|updated)\s+(?:from\s+[^.;]{1,40}?\s+)?` + CHANGED_TO,
  String.raw`\b(?:is|are)\s+now\s+` + MONEY_AT,
  String.raw`\b(?:has|have)\s+been\s+(?:added\s+to|removed\s+from|attached\s+to)\s+(?:your|the)\s+policy\b`,
].join("|"));
/** A page that says a change was not made, was reversed, or is about another policy: never an amendment of this one
 * (TE r381). An endorsement's closing "all other terms remain unchanged" is stripped first. */
const PAGE_VETO = /\b(?:unchanged|revers\w*|revert\w*|cancel\w*|rescind\w*|void\w*|not\s+been\s+(?:made|changed|approved|accepted)|not\s+changed|no\s+changes?|remains?|another\s+polic(?:y|ies)|other\s+polic(?:y|ies)|previous|earlier|former|free[\s-]look|in\s+error|mistake\w*|provisional\w*|temporar\w*|suppose\w*|imagine|hypothetical\w*|standard\s+(?:endorsements?|clauses?|wordings?|terms|conditions)|later|back\s+to|renewal|anniversary|asked|go\s+ahead|accept\w*|reply|respond|here\s+is|looks?\s+like|compare\w*|spouse\w*|partner\w*)\b/i;
/** A word that makes a statement not a change already made: the future, a condition, a request, an option, a refusal,
 * an example or a question. Any one in the sentence and the sentence says nothing (fails closed). */
const NOT_MADE = /\b(?:will|would|shall|might|can|could|should|must|once|if|when|whenever|after|upon|unless|until|pending|subject|request(?:s|ed)?|application|apply|applied|approv\w*|declin\w*|reject\w*|unable|not|no|never|cannot|example|e\.g|instance|illustrat\w*|withdraw\w*|cancel\w*|propos\w*|quot\w*|options?|wish|sign|please|tick|next)\b|\?/i;
/** A sentence saying the policy's own sum assured was changed, with no title needed: "We have reduced your sum assured to
 * S$500,000", "The sum assured has been reduced to S$400,000", "... has been reduced with effect from 1 March 2026",
 * "Your sum assured was increased to S$300,000 on 1 May 2026". */
const sumChanged = () => new RegExp(String.raw`\bwe\s+have\s+(?:reduced|increased)\s+(?:your|the)\s+sum\s+(?:assured|insured)\s+to\s+` + MONEY_AT
  + String.raw`|\b(?:your|the)\s+sum\s+(?:assured|insured)\s+(?:(?:has|have)\s+been|was)\s+(?:reduced|increased)\s+(?:to\s+` + MONEY_AT + String.raw`|with\s+effect\s+from\s+` + DATE + ")", "i");
const dateOfIssue = () => new RegExp(String.raw`\b(?:date\s+of\s+issue|issue\s+date|date\s+issued|issued\s+on)\s*:?\s*` + DATE, "i");
/** The page's sentences that state a change made: one MADE statement and no NOT_MADE word. "As you requested" and "at your
 * request" say why it was made, and an endorsement's closing "all other terms remain unchanged" says nothing either way. */
function statedChanges(page: string, statement: RegExp): string[] {
  // Lines are joined only where a sentence wraps onto a line that starts in lower case, so a letterhead or a title line
  // never runs into the sentence below it.
  const flat = page.replace(/\r/g, "").replace(/\n(?=[ \t]*[a-z(S$])/g, " ").replace(/[ \t]+/g, " ")
    // A "No." label is no sentence end and no "no".
    .replace(/\b(policy|proposal|certificate|endorsement|reference|ref)\s+no\b\.?/gi, "$1 number")
    .replace(/\b(?:as\s+(?:you\s+)?requested|at\s+your\s+request)\b/gi, " ")
    .replace(/\b(?:all\s+)?other\s+(?:terms|conditions|benefits|details|provisions)[^.]*?\b(?:remain|are|stay)\s+unchanged\b[^.]*\.?/gi, " ");
  // "may" is a modal; "May" is a modal only when it opens the sentence and no day or year follows ("1 May 2026").
  const modalMay = (s: string) => /\bmay\b/.test(s) || /^\s*May\b(?!\s+\d)/.test(s);
  return flat.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/).filter((s) => statement.test(s) && !NOT_MADE.test(s) && !modalMay(s));
}
function pageVetoed(page: string): boolean {
  const flat = page.replace(/\s+/g, " ").replace(/\b(?:all\s+)?other\s+(?:terms|conditions|benefits|details|provisions)[^.]*?\b(?:remain|are|stay)\s+unchanged\b[^.]*\.?/gi, " ");
  if (PAGE_VETO.test(flat)) return true;
  // Two different policy numbers on the page: the change may be another policy's.
  const ids = new Set([...flat.matchAll(/\bpolicy\s+(?:no\.?|number|#)\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{2,})|\bpolicy\s+([A-Z]{1,5}-[A-Z0-9\-\/]{2,})/gi)]
    .map((m) => (m[1] ?? m[2]).toUpperCase()).filter((id) => /\d/.test(id)));
  return ids.size > 1;
}
/** The document's first title line on its first two pages (as firstTitle reads them), sorted into an amending title, a
 * change title, another document's title, or none, with its page. */
function ownTitle(pages: string[]): { kind: "amends" | "change" | "other"; page: number } | null {
  for (const [index, page] of pages.slice(0, 2).entries()) {
    const lines = page.split(/\r?\n/).filter((l) => l.trim())
      .filter((l) => !/\.{3,}|…|\t\s*(?:p(?:age|g)\.?\s*)?\d+\s*$/i.test(l))
      .map((l) => l.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 25);
    for (const l of lines) {
      if (BODY_HEADING.test(l)) return null;
      if (AMENDING_TITLE.test(l)) return { kind: "amends", page: index };
      if (CHANGE_TITLE.test(l)) return { kind: "change", page: index };
      if (/\b(?:you|we|our|us|may|must|will|shall|can|should)\b|\.$/i.test(l) || NO_VALUE.test(l)) continue;
      if (OTHER_TITLE.test(l) || AMENDMENT_TITLE.some((re) => re.test(l))) return { kind: "other", page: index };
    }
  }
  return null;
}
/** Whether a document says by itself that it amends its policy, beyond main's wording (AMENDS). A closed, positive rule;
 * anything else fails closed and reads as on main:
 *  - its first title is on the amending list (AMENDING_TITLE) or the change list (CHANGE_TITLE), and the SAME page states
 *    a change made (statedChanges with MADE) or prints a Before / After row; or, with no title on any list and no other
 *    document's title first, a sentence on its first two pages says the sum assured was changed (sumChanged);
 *  - it prints the policy number it changes (OWN_POLICY_NUMBER), or, under an amending title, its date of issue or the
 *    date its change takes effect;
 *  - it is not a quotation, proposal, form, option, illustration or brochure (NOT_A_CHANGE), and no line of the page says
 *    the change was not made, reversed, provisional, hypothetical, an offer or about another policy (pageVetoed). */
export function ownAmendment(pagesText: string): boolean {
  const text = String(pagesText ?? "");
  const pages = text.split("\f");
  const flat = text.replace(/\s+/g, " ");
  // "as you requested" says why a change was made; "requested effective date" is a form's.
  if (NOT_A_CHANGE.test(flat.replace(/\b(?:as\s+(?:you\s+)?requested|at\s+your\s+request)\b/gi, " "))) return false;
  const title = ownTitle(pages);
  const numbered = OWN_POLICY_NUMBER.test(flat);
  if (title?.kind === "amends" || title?.kind === "change") {
    const page = pages[title.page] ?? "";
    if (pageVetoed(page)) return false;
    const stated = statedChanges(page, made()).length > 0 || beforeAfterRow([page]);
    if (!stated) return false;
    return numbered || (title.kind === "amends" && (dateOfIssue().test(flat) || DATED_CHANGE.test(flat)));
  }
  if (title || !numbered) return false;
  return pages.slice(0, 2).some((page) => !pageVetoed(page) && statedChanges(page, sumChanged()).length > 0);
}
function beforeAfterRow(pages: string[]): boolean {
  return pages.some((page) => {
    const lines = page.split(/\r?\n/);
    const at = lines.findIndex((l) => /\bbefore\b[^\n]*\bafter\b/i.test(l));
    return at >= 0 && lines.slice(at + 1).some((l) => (l.match(/(?:S\$|SGD\s?|US\$|USD\s?|\$)\s?\d[\d,]*(?:\.\d+)?/g) ?? []).length === 2);
  });
}
/** Amendment evidence of a document's own: an "Endorsement No. <n>" line (n >= 1) on its first two pages, a word or
 * phrase of change ("reduced to", "previously", "was S$", "formerly", "now reads", "becomes", "supersedes", "replaces",
 * "new ... limit", "updated", "revised", "re-issued"), a date a change takes effect from ("with effect from", "effective
 * 1 March 2026", "from 1 April 2026"), a first title on the amendment list, or a Before / After table. Wide on purpose: evidence only keeps the reader's type,
 * so a wider list can never drop an amendment. */
const DATE = String.raw`(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})`;
const CHANGE_WORDS = new RegExp(String.raw`\b(?:(?:is|are|has\s+been|have\s+been|was|were)\s+)?(?:reduced|increased|changed|amended|altered|revised|updated|replaced)\s+(?:to|from|by)\b|\b(?:previously|formerly|was|were)\s*:?\s*(?:S\$|SGD|US\$|USD|\$)|\bnow\s+reads\b|\bbecomes?\b|\bsupersed|\breplac|\bre-?issu|\bupdated\b|\brevised\b|\bnew\s+(?:\w+\s+){0,3}(?:limit|sum|premium|cover(?:age)?|benefit|amount|plan)\b|\bwith\s+effect\s+from\b|\beffective\s+(?:from\s+)?(?:the\s+)?` + DATE + String.raw`|\bfrom\s+(?:the\s+)?` + DATE, "i");
/** The date the document's own change takes effect: "with effect from 1 March 2026", "Effective 1 May 2026", "Effective
 * date: 01/05/2026", "From 1 June 2026 your death benefit is S$250,000". */
const DATED_CHANGE = new RegExp(String.raw`\b(?:with\s+effect\s+from|effective(?:\s+(?:from|on|date))?\s*:?|from)\s+(?:the\s+)?` + DATE, "i");
/** The policy number the document changes, printed with its label: "Policy No. TL-1", "Policy number: HG-55120". A
 * bare year ("policy 2026") is no id, and a shared "Proposal / Policy No." label names a proposal. A brochure or a
 * booklet names no policy of its own. */
const OWN_POLICY_NUMBER = /(?<!\b(?:proposal|application|quotation|quote)\s*(?:\/|or|and)\s*)\bpolicy\s+(?:no\.?|number|#)\s*:?\s*(?!(?:19|20)\d\d\b)(?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{2,}\b/i;
/** A page that only describes a change someone may make, or a clause that may apply: a form to fill in, an option, an
 * illustration, a brochure, a quotation or proposal, a requested change "subject to acceptance", "applies only if shown in
 * your schedule". */
const NOT_A_CHANGE = /\b(?:quot(?:e|ation)s?\b|proposals?\b|proposed|requested|subject\s+to\s+(?:acceptance|approval|underwriting)|if\s+accepted|not\s+a\s+contract|to\s+be\s+completed|please\s+complete|request\s+form|application\s+form|options?\b|illustration|brochure|(?:applies|apply)\s+only\s+if|only\s+if\s+shown|if\s+shown\s+in)|_{3,}/i;
function ownAmendmentEvidence(pages: string[]): boolean {
  if (pages.slice(0, 2).some((p) => p.split(/\r?\n/).some((l) => /\b(?:endorsement|alteration|amendment)\s+(?:no\.?|number)\s*0*[1-9]/i.test(l)))) return true;
  if (CHANGE_WORDS.test(pages.join(" ").replace(/\s+/g, " "))) return true;
  if (firstTitle(pages)?.amends) return true;
  return pages.some((page) => {
    const lines = page.split(/\r?\n/);
    const at = lines.findIndex((l) => /\bbefore\b[^\n]*\bafter\b/i.test(l));
    return at >= 0 && lines.slice(at + 1).some((l) => (l.match(/(?:S\$|SGD\s?|US\$|USD\s?|\$)\s?\d[\d,]*(?:\.\d+)?/g) ?? []).length === 2);
  });
}
/** A document the reader typed "endorsement" whose own text says it is not one. A closed allow-list, all of:
 *  - its first title is a plain schedule or certificate with nothing added (PLAIN_KIND);
 *  - it prints an empty endorsement field ("Endorsements: Nil", "Endorsements this year: none", "Endorsements - see
 *    attached"; a fee, premium or charge field is not one);
 *  - no other line says amend, alter, endorse, rider, supplement, added, removed or change, and it shows no amendment
 *    evidence of its own (ownAmendmentEvidence).
 * Otherwise the reader's type stands, as on main (a lost amendment leaves an old figure shown). */
const PLAIN_KIND = /^(?:policy\s+schedule|schedule(?:\s+of\s+insurance)?|certificate(?:\s+of\s+insurance)?|policy\s+certificate)$/i;
const EMPTY_FIELD = /^\s*(?:endorsements?|amendments?|alterations?)\b(?![^:\n]*\b(?:fees?|premiums?|charges?|costs?)\b)[^:\n\-–]{0,30}[:\-–]\s*(?:nil|none|n\/?a|not\s+applicable|-|see\s+attached)\s*$/i;
const CHANGE_WORD = /\b(?:amend|alter|endors|rider|supplement|added\b|removed\b|change)/i;
export function endorsementTypeVetoed(pagesText: string): boolean {
  const pages = String(pagesText ?? "").split("\f");
  const title = firstTitle(pages);
  if (!title || !PLAIN_KIND.test(title.line)) return false;
  const lines = pages.flatMap((p) => p.split(/\r?\n/));
  if (!lines.slice(0, 200).some((l) => EMPTY_FIELD.test(l))) return false;
  if (lines.some((l) => !EMPTY_FIELD.test(l) && CHANGE_WORD.test(l))) return false;
  return !ownAmendmentEvidence(pages);
}
const MONEY = /(?:S\$|SGD\s?|US\$|USD\s?)\s?(\d[\d,]*(?:\.\d+)?)/g;

/** Older documents (by id) whose printed figures a later amendment of the same policy replaces. */
export async function replacedFigures(accountId: string, docIds?: string[]): Promise<Map<string, Replacement>> {
  const out = new Map<string, Replacement>();
  const docs = (await query<{ id: string; policy_number: string | null; document_role: string | null; product_name: string | null; d: string | null }>(
    `SELECT p.id::text AS id,p.policy_number,p.document_role,p.product_name,coalesce(to_jsonb(p)->>'document_date',p.effective_date::text) AS d
       FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.policy_number IS NOT NULL AND p.processing_status='ready'`, [accountId]).catch(() => ({ rows: [] as never[] }))).rows;
  const byNumber = new Map<string, typeof docs>();
  for (const d of docs) { const k = String(d.policy_number).toUpperCase().replace(/[^A-Z0-9]/g, ""); if (k) (byNumber.get(k) ?? byNumber.set(k, []).get(k)!).push(d); }
  const groups = [...byNumber.values()].filter((g) => g.length > 1 && (!docIds || g.some((d) => docIds.includes(d.id))));
  if (!groups.length) return out;
  const ids = groups.flat().map((d) => d.id);
  const pages = new Map<string, string>();
  for (const r of (await query<{ policy_id: string; text: string }>(`SELECT policy_id::text AS policy_id,string_agg(text,E'\\f' ORDER BY page_number) AS text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) GROUP BY 1`, [accountId, ids])).rows) pages.set(r.policy_id, r.text);
  for (const g of groups) {
    const amenders = g.filter((d) => d.d && (amendmentWording(pages.get(d.id) ?? "") || (d.document_role === "endorsement" && !endorsementTypeVetoed(pages.get(d.id) ?? "")))).sort((a, b) => String(b.d).localeCompare(String(a.d)));
    const latest = amenders[0];
    if (!latest || (amenders[1] && amenders[1].d === latest.d)) continue;
    const amounts = new Set([...(pages.get(latest.id) ?? "").matchAll(MONEY)].map((m) => Number(m[1].replace(/,/g, ""))));
    const rows: Replacement["rows"] = [];
    (pages.get(latest.id) ?? "").split("\f").forEach((pageText, i) => {
      if (!/\bbefore\b[^\n]*\bafter\b/i.test(pageText)) return;
      for (const line of pageText.split(/\r?\n/)) {
        const m = [...line.matchAll(MONEY)];
        if (m.length !== 2) continue;
        const label = line.slice(0, m[0].index).replace(/\s+/g, " ").trim();
        if (label) rows.push({ before: Number(m[0][1].replace(/,/g, "")), after: Number(m[1][1].replace(/,/g, "")), label, page: i + 1, line: line.replace(/\s+/g, " ").trim() });
      }
    });
    for (const d of g) if (d.id !== latest.id && d.d && String(d.d).slice(0, 10) < String(latest.d).slice(0, 10))
      out.set(d.id, { byDocId: latest.id, byDate: String(latest.d).slice(0, 10), byProduct: latest.product_name, amounts, rows });
  }
  return out;
}
