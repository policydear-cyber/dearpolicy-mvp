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
/** A first title naming a document whose figures are projections or a summary: its sentences never amend a policy. */
const NEVER_AMENDS = /\b(?:illustration|summary|brochure|booklet)\b/i;
/** A heading of a wording, a contents list or a clause: below it a line is part of that document, never its title. */
const BODY_HEADING = /^(?:general\s+)?(?:conditions|exclusions|definitions)$|^(?:table\s+of\s+)?contents$|^section\s+\d+\b/i;
/** A sentence only an amending document prints, anywhere in it. A closed list: what a policy may do ("may be amended",
 * "amended from time to time") or what any endorsement does is not one, nor a change "as follows: none". "With effect
 * from" counts only with "hereby", or with a date after it. */
const DATE = String.raw`(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})`;
const AMENDMENT_ACT = [
  /\b(?:the\s+)?(?:policy|sum\s+(?:assured|insured)|premium|cover(?:age)?|schedule)\s+(?:is|are|has\s+been|have\s+been)\s+(?:hereby\s+)?(?:amended|altered|changed|reduced|increased)\s+as\s+follows(?!\s*:?\s*(?:none|nil|n\/a)\b)/i,
  /\b(?:the\s+)?(?:policy|sum\s+(?:assured|insured)|premium|cover(?:age)?|schedule)\s+(?:is|are|has\s+been|have\s+been)\s+hereby\s+(?:amended|altered|changed|reduced|increased)\b/i,
  new RegExp(String.raw`\b(?:the\s+)?(?:policy|sum\s+(?:assured|insured)|premium|cover(?:age)?|schedule)\s+(?:is|are|has\s+been|have\s+been)\s+(?:amended|altered|changed|reduced|increased)\s+with\s+effect\s+from\s+(?:the\s+)?` + DATE, "i"),
  /\bthe\s+following\s+(?:alterations?|amendments?|changes?)\s+(?:has|have)\s+been\s+made\b/i,
  /\bwe\s+have\s+(?:reduced|increased|changed|amended|altered)\s+(?:your|the)\s+(?:policy|plan|cover(?:age)?|premium|sum\s+(?:assured|insured))\b/i,
];
/** The document's first title line, among the first 25 lines of its first two pages (contents entries and lines written
 * as sentences or form lines left out), and whether it is an amendment title. Null when none is printed above a wording,
 * contents or clause heading. */
function firstTitle(pages: string[]): { line: string; amends: boolean; page: number } | null {
  for (const [index, page] of pages.slice(0, 2).entries()) {
    const lines = page.split(/\r?\n/).filter((l) => l.trim())
      // A contents entry ("Endorsements ........ 14", "Endorsement - Terrorism<tab>15") names a page further on.
      .filter((l) => !/\.{3,}|…|\t\s*(?:p(?:age|g)\.?\s*)?\d+\s*$/i.test(l))
      .map((l) => l.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 25);
    for (const l of lines) {
      if (BODY_HEADING.test(l)) break;
      // A title, not a sentence or a form line: no words of a clause, no full stop at its end, no empty value.
      if (/\b(?:you|we|our|us|may|must|will|shall|can|should)\b|\.$/i.test(l) || NO_VALUE.test(l)) continue;
      if (AMENDMENT_TITLE.some((re) => re.test(l))) return { line: l, amends: true, page: index };
      if (OTHER_TITLE.test(l)) return { line: l, amends: false, page: index };
    }
  }
  return null;
}
/** Whether a document's own text is an amendment of its policy (fails closed: an ordinary page, a wording, a schedule or
 * a booklet that mentions endorsements is not one):
 *  - its first title line is an amendment title (AMENDMENT_TITLE);
 *  - or, unless its first title names an illustration, a summary, a brochure or a booklet: "this endorsement forms part
 *    of / is attached to" on its first page above any heading; an amending sentence (AMENDMENT_ACT); a Before / After
 *    table (a line naming both, then a line with two amounts).
 * pagesText: pages joined by "\f". */
export function amendmentWording(pagesText: string): boolean {
  const pages = String(pagesText ?? "").split("\f");
  const title = firstTitle(pages);
  if (title?.amends) return true;
  if (title && NEVER_AMENDS.test(title.line)) return false;
  const first = pages[0].split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 25);
  for (const l of first) {
    if (BODY_HEADING.test(l) || (OTHER_TITLE.test(l) && NEVER_AMENDS.test(l))) break;
    if (/\bthis\s+endorsement\s+(?:forms\s+part\s+of|is\s+attached\s+to)\b(?![^.]*\b(?:only\s+if|if\s+shown|where\s+shown|when\s+shown)\b)/i.test(l)) return true;
  }
  const text = String(pagesText ?? "").replace(/\s+/g, " ");
  if (AMENDMENT_ACT.some((re) => re.test(text))) return true;
  for (const page of pages) {
    const lines = page.split(/\r?\n/);
    const at = lines.findIndex((l) => /\bbefore\b[^\n]*\bafter\b/i.test(l));
    if (at >= 0 && lines.slice(at + 1).some((l) => (l.match(/(?:S\$|SGD\s?|US\$|USD\s?|\$)\s?\d[\d,]*(?:\.\d+)?/g) ?? []).length === 2)) return true;
  }
  return false;
}
/** A document the reader typed "endorsement" whose own text says it is not one: a form line with an empty value
 * ("Endorsements: Nil"), or a first title naming a wording, a booklet, a brochure, a summary or an illustration. Only
 * then is the reader's type set aside; otherwise it stands (a lost amendment leaves an old figure shown). */
export function endorsementTypeVetoed(pagesText: string): boolean {
  const pages = String(pagesText ?? "").split("\f");
  if (pages.slice(0, 2).some((p) => p.split(/\r?\n/).some((l) => /^\s*(?:endorsements?|amendments?|alterations?)\b[^:\n-–]{0,30}[:\-–]\s*(?:nil|none|n\/?a|not\s+applicable|-|see\s+attached)\s*$/i.test(l)))) return true;
  const title = firstTitle(pages);
  return !!title && !title.amends && (NEVER_AMENDS.test(title.line) || /\b(?:policy\s+wording|terms\s+and\s+conditions)\b/i.test(title.line));
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
