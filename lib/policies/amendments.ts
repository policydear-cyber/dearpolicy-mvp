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
 * amending document strictly later, and the amendment printing the figure.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";

export type Replacement = { byDocId: string; byDate: string; byProduct: string | null; amounts: Set<number>;
  /** Round 7 (port): the amendment's own Before / After rows ("Annual premium  S$2,040.00  S$1,712.00"), with their page. */
  rows: { before: number; after: number; label: string; page: number; line: string }[] };
const AMENDS = /\bendorsement\s+(?:no\.?|number)\s*\d|\bpolicy (?:is|has been) altered\b|\bpolicy alteration\b|\b(?:reduction|increase) of (?:the )?sum (?:assured|insured)\b|\b(?:is|are|hereby|has been|have been) amended\b/i;
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
    const amenders = g.filter((d) => d.d && (d.document_role === "endorsement" || AMENDS.test(pages.get(d.id) ?? ""))).sort((a, b) => String(b.d).localeCompare(String(a.d)));
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
