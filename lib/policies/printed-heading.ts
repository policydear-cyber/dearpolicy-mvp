/** The heading a letter or notice prints at the top of its first page, so two papers about one policy ("Notice of Lapse",
 * "Confirmation of Reinstatement") read apart in an answer where their titles cannot (#564: titles, never file names). */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { maskIdentityText } from "@/lib/chat/identity-numbers";

export const isPolicyRole = (role: string | null) => ["", "unknown", "personal_schedule", "schedule", "policy", "policy_document", "policy_schedule", "certificate"].includes(role ?? "");
/** The heading a letter or notice prints near the top of its first page ("CONFIRMATION OF REINSTATEMENT" -> "Confirmation
 * of Reinstatement"): a line of two to six capitalised words, with no digits, among its first ten lines, that names a kind
 * of paper (an allow-list), never the insurer, the addressee or a handling line. Nothing when no line is that shape. */
const DOCUMENT_WORD = /\b(?:NOTICE|CONFIRMATION|LETTER|STATEMENT|ENDORSEMENT|REINSTATEMENT|LAPSE|RENEWAL|DECISION|APPROVAL|REJECTION|ACKNOWLEDGEMENT|RECEIPT|INVOICE|BILL|SUMMARY|ADVICE|REMINDER|CERTIFICATE|SCHEDULE|AMENDMENT|CANCELLATION|TERMINATION|CLAIM|PAYMENT)S?\b/;
export function headingIn(pageText: string, insurer: string | null = null): string | null {
  const lines = pageText.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
  const own = (insurer ?? "").toUpperCase();
  for (const raw of lines) {
    // "RE: POLICY LAPSE" is a heading after its "Re:"; a Title Case line ("Confirmation of Reinstatement") is read as capitals.
    const re = raw.replace(/^RE\s*:\s*/i, "");
    const titleCase = /^(?:[A-Z][a-z'’]*|of|and|the|for|to|in|on|a|an)(?:\s+(?:[A-Z][a-z'’]*|of|and|the|for|to|in|on|a|an))+$/.test(re);
    // A heading names the paper only: what follows "to"/"for" is who it is addressed to ("Notice to Mr …"), and a Title
    // Case line counts only when the paper word ends it, so a field label ("Bill To", "Payment Due Date") is not read as
    // one (TE #564 L-H1b, L-H3). A possessive ("<name>'s Claim") is a person's, never the paper's kind.
    const upper = (titleCase ? re.toUpperCase() : re).replace(/\s+(?:TO|FOR)\b.*$/, "").trim();
    if (titleCase && !new RegExp(DOCUMENT_WORD.source + "$").test(upper)) continue;
    if (/['’]S\b|^(?:YOUR|OUR|MY)\b/.test(upper)) continue;
    const l = upper;
    if (!/^[A-Z][A-Z&'’ -]+[A-Z]$/.test(l) || /\d/.test(l)) continue;
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 6 || /^DEAR\b/.test(l) || (own && (own.includes(l) || l.includes(own)))) continue;
    if (/\b(?:PTE|LTD|LIMITED|BERHAD|BHD|INSURANCE|ASSURANCE|BRANCH)\b/.test(l)) continue;
    // Only a line that names a kind of paper: never the addressee ("MR <NAME>") or a handling line ("PRIVATE AND
    // CONFIDENTIAL"), which insurers print above the heading (Critic #564 MED-1).
    if (/^(?:MR|MRS|MS|MDM|DR|MISS|MADAM|PATIENT|INSURED|POLICYHOLDER|POLICY OWNER|ATTN|ATTENTION)\b|\bUNTITLED\b|\b(?:CONFIDENTIAL|BY EMAIL|URGENT)\b/.test(l)) continue;
    // A sender line ("CLAIMS DEPARTMENT", "PAYMENT SERVICES UNIT") names who wrote it, not what it is.
    if (/\b(?:DEPARTMENT|DIVISION|SECTION|TEAM|UNIT|CENTRE|CENTER|SERVICES|OFFICE)\b/.test(l)) continue;
    if (!DOCUMENT_WORD.test(l)) continue;
    return maskIdentityText(words.map((w, k) => k > 0 && /^(?:OF|AND|THE|FOR|TO|IN|ON|A|AN)$/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase()).join(" "));
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
