/** Whether a schedule line that was not confirmed (lib/coverage/cover-verdict.ts provenLine) still shows the person holds
 * the cover: its own quote is printed on its cited page, and so is one of the names the household linked to this person on
 * that document. Its figure stays unconfirmed and is never shown as the person's amount; only the cover is held.
 *
 * Why (16 Nov, live library): every unconfirmed line printed the person's name, its quote and its figure on its page, and
 * failed only because the reader recorded a currency the line does not print. Home called those covers "On file, please
 * confirm"; DC: "If it's covered, it's covered". A line whose quote is not on its page, or whose page does not name the
 * person, proves nothing and stays unconfirmed. Pure: no database access. */
import { locatePassage } from "@/lib/documents/evidence";
import { personPrinted } from "@/lib/documents/fact-check";

export function heldOnPage(pageText: string | null | undefined, quote: string | null | undefined, names: readonly string[]): boolean {
  const text = String(pageText ?? "");
  if (!text.trim() || String(quote ?? "").trim().length < 8) return false;
  if (!locatePassage(text, quote)) return false;
  return names.some((n) => n.trim().length > 0 && personPrinted(text, n));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = <T extends Record<string, any>>(sql: string, params: unknown[]) => Promise<{ rows: T[] }>;
/** Only pages whose words are the page's own (the allow-list the benefit table reads, lib/benefit-table/service.ts). */
const OWN_WORDS = `coalesce(to_jsonb(pp)->>'extraction_method','') IN ('','native','ocr','part_checked')`;

/** For each unconfirmed line (policy, page, quote), whether heldOnPage holds, reading the cited page and the names linked
 * to the person on that document. Lines are keyed by their index in `lines`. */
export async function heldLines(query: Query, accountId: string, memberId: string,
  lines: readonly { policy_id: string; source_page: number | null; evidence_text: string | null }[]): Promise<boolean[]> {
  const wanted = lines.filter((l) => l.source_page != null && (l.evidence_text ?? "").trim().length >= 8);
  if (!wanted.length) return lines.map(() => false);
  const policies = [...new Set(wanted.map((l) => l.policy_id))];
  const pages = await query<{ policy_id: string; page_number: number; text: string | null }>(
    `SELECT pp.policy_id::text AS policy_id,pp.page_number,pp.text FROM policy_pages pp WHERE pp.account_id=$1 AND pp.policy_id=ANY($2::uuid[]) AND ${OWN_WORDS}`,
    [accountId, policies]);
  const names = await query<{ policy_id: string; detected_name: string }>(
    `SELECT pd.policy_id::text AS policy_id,pd.detected_name FROM policy_detected_people pd WHERE pd.account_id=$1 AND pd.policy_id=ANY($2::uuid[]) AND pd.matched_family_member_id=$3`,
    [accountId, policies, memberId]);
  const page = new Map(pages.rows.map((p) => [`${p.policy_id}|${p.page_number}`, p.text]));
  return lines.map((l) => l.source_page != null && heldOnPage(page.get(`${l.policy_id}|${l.source_page}`),
    l.evidence_text, names.rows.filter((n) => n.policy_id === String(l.policy_id)).map((n) => n.detected_name)));
}
