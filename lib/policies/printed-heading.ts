/** The heading a letter or notice prints at the top of its first page, so two papers about one policy ("Notice of Lapse",
 * "Confirmation of Reinstatement") read apart in an answer where their titles cannot (#564: titles, never file names). */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";

export const isPolicyRole = (role: string | null) => ["", "unknown", "personal_schedule", "schedule", "policy", "policy_document", "certificate"].includes(role ?? "");
/** The heading a letter or notice prints near the top of its first page ("CONFIRMATION OF REINSTATEMENT" -> "Confirmation
 * of Reinstatement"): a line of two to six capitalised words, with no digits, among its first ten lines, other than the
 * insurer's own name or a greeting. Nothing when no line is that shape. */
export function headingIn(pageText: string, insurer: string | null = null): string | null {
  const lines = pageText.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
  const own = (insurer ?? "").toUpperCase();
  for (const l of lines) {
    if (!/^[A-Z][A-Z&'’ -]+[A-Z]$/.test(l) || /\d/.test(l)) continue;
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 6 || /^DEAR\b/.test(l) || (own && (own.includes(l) || l.includes(own)))) continue;
    if (/\b(?:PTE|LTD|LIMITED|BERHAD|BHD|INSURANCE|ASSURANCE|BRANCH)\b/.test(l)) continue;
    return words.map((w, k) => k > 0 && /^(?:OF|AND|THE|FOR|TO|IN|ON|A|AN)$/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
  }
  return null;
}
export async function printedHeadings(accountId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (await query<{ id: string; text: string; insurer: string | null }>(
    `SELECT pp.policy_id::text AS id, pp.text, p.insurer FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE pp.account_id=$1 AND pp.page_number=1 AND pp.policy_id::text=ANY($2::text[]) AND ${activePredicate("p")}`, [accountId, ids]).catch(() => ({ rows: [] }))).rows;
  return new Map(rows.flatMap((r) => { const h = headingIn(r.text, r.insurer); return h ? [[r.id, h] as [string, string]] : []; }));
}
