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
/** A title only an amending document prints, as one of the first lines of its first page ("ENDORSEMENT NO. 2 - REDUCTION
 * OF SUM ASSURED", "Policy alteration", "Endorsement No. 2 to policy TW-TL-440187", "Notice of policy alteration",
 * "Changes to your policy"). A closed list; a remark in brackets ("(fictional)") is taken off first. */
const AMENDMENT_TITLE = [
  /^(?:policy\s+)?(?:endorsement|alteration|amendment)s?(?:\s+(?:no\.?|number)\s*\d+[a-z]?)?(?:\s*[-–:]\s*.{1,60}|\s+to\s+(?:the\s+|your\s+)?policy\b.{0,40})?$/i,
  /^(?:notice|confirmation|letter)\s+of\s+(?:policy\s+)?(?:alteration|amendment|endorsement|change)s?\b.{0,40}$/i,
  /^changes?\s+to\s+(?:your|the)\s+policy\b.{0,40}$/i,
];
/** A sentence only an amending document prints, anywhere in it. A closed list: what a policy may do ("may be amended",
 * "amended from time to time") or what any endorsement does ("all endorsements form part of the policy") is not one. */
const AMENDMENT_ACT = [
  /\bthis\s+endorsement\s+(?:forms\s+part\s+of|is\s+attached\s+to|amends|records)\b/i,
  /\b(?:the\s+)?(?:policy|sum\s+(?:assured|insured)|premium|cover(?:age)?|schedule)\s+(?:is|are|has\s+been|have\s+been)\s+(?:hereby\s+)?(?:amended|altered|changed|reduced|increased)\s+(?:as\s+follows|with\s+effect\s+from)\b/i,
  /\bthe\s+following\s+(?:alterations?|amendments?|changes?)\s+(?:has|have)\s+been\s+made\b/i,
];
/** Whether a document's own text is an amendment of its policy: an amendment title among the first lines of its first
 * page, or an amending sentence. The reader's document type alone never makes one: an ordinary page (a wording, a
 * schedule, a booklet that mentions endorsements) is not an amendment (fails closed). pagesText: pages joined by "\f". */
export function amendmentWording(pagesText: string): boolean {
  // A contents entry ("Endorsements ........ 14", "Endorsement - Terrorism<tab>14") names a page further on, not this document.
  const first = String(pagesText ?? "").split("\f")[0].split(/\r?\n/).filter((l) => l.trim())
    .slice(0, 12).filter((l) => !/\.{3,}|…|\t\s*(?:p(?:age|g)\.?\s*)?\d+\s*$/i.test(l)).map((l) => l.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
  for (const l of first) {
    // Below a wording's or a contents heading, a line is a clause or a section of that document, not its title.
    if (/^(?:general\s+)?(?:conditions|exclusions|definitions)$|\bpolicy\s+wording\b|\bterms\s+and\s+conditions\b|^(?:table\s+of\s+)?contents$/i.test(l)) break;
    // A title, not a sentence: no words of a clause ("you may", "we will") and no full stop at its end.
    if (/\b(?:you|we|our|us|may|must|will|shall|can|should)\b|\.$/i.test(l)) continue;
    if (AMENDMENT_TITLE.some((re) => re.test(l))) return true;
  }
  const text = String(pagesText ?? "").replace(/\s+/g, " ");
  return AMENDMENT_ACT.some((re) => re.test(text));
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
    const amenders = g.filter((d) => d.d && amendmentWording(pages.get(d.id) ?? "")).sort((a, b) => String(b.d).localeCompare(String(a.d)));
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
