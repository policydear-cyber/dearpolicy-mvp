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

const flat = (v: string) => v.toLowerCase().replace(/\s+/g, " ");
/** A label naming the person who is covered: life assured or insured (never "sum assured" or "sum insured"), insured or
 * covered person or member. */
const INSURED_ROLE = /\b(?:life\s+(?:assured|insured)|(?<!\b(?:sum|amount)\s+)(?:assured|insured)(?:\s+(?:person|member|life|name))?|covered\s+(?:person|member)|person\s+covered|name\s+of\s+(?:the\s+)?(?:insured|assured|life\s+assured)|insured\s+member|member\s+name|employee\s+name)\b/i;
/** A label naming someone else on the policy: who owns or pays for it, or who is paid if the insured dies. */
const OTHER_ROLE = /\b(?:policy\s*holder|policy\s*owner|owner|proposer|payer|payor|nominee|beneficiar(?:y|ies)|trustee|assignee|applicant|paid\s+by|issued\s+to|on\s+behalf\s+of)\b/i;
/** Whether the document names this person as the one covered: a line printing their name beside an insured label, or
 * printing only their name under a line with one ("Life Assured" then "JOHN TAN"). A policyholder, payer or nominee is not
 * the insured (Test engineer #506 F2). */
export function namedAsInsured(documentText: string, name: string): boolean {
  const lines = String(documentText ?? "").split("\n");
  return lines.some((line, i) => {
    if (!personPrinted(line, name) || OTHER_ROLE.test(line)) return false;
    if (INSURED_ROLE.test(line)) return true;
    let j = i - 1; while (j >= 0 && !lines[j].trim()) j--;
    const label = j >= 0 ? lines[j] : "";
    return INSURED_ROLE.test(label) && !OTHER_ROLE.test(label);
  });
}
/** A printed name that can identify one person: two words or more (a surname alone, "TAN", names many people). */
const fullName = (n: string) => n.trim().split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w)).length >= 2;
/** Every start of `name` in `text` (both flattened), so the name nearest the quote can be found. */
function starts(text: string, name: string): number[] {
  const n = flat(name).trim(); const out: number[] = [];
  if (n.length < 3) return out;
  for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + 1)) out.push(i);
  return out;
}
/** `names`: the printed names linked to this person on the document. `others`: every other person's printed name on it (a
 * second life on a joint schedule). On a page that also names someone else, the line must be the person's own: no other
 * person is named on the quote's own line, and the last name printed before the quote is theirs (Critic #506 H1: on a
 * two-life page a rider the reader put under the wrong life must not make that life Covered). */
export function heldOnPage(pageText: string | null | undefined, quote: string | null | undefined, names: readonly string[], others: readonly string[] = [],
  documentText: string = String(pageText ?? "")): boolean {
  const text = String(pageText ?? "");
  if (!text.trim() || String(quote ?? "").trim().length < 8) return false;
  const span = locatePassage(text, quote);
  if (!span) return false;
  // The person's own full name, printed on this page, and named as the insured somewhere in the document.
  const own = names.filter((n) => fullName(n) && personPrinted(text, n) && namedAsInsured(documentText, n));
  if (!own.length) return false;
  const other = others.filter((n) => n.trim().length > 0 && !own.some((o) => flat(o).trim() === flat(n).trim()) && personPrinted(text, n));
  if (!other.length) return true;
  const lineStart = text.lastIndexOf("\n", span.start) + 1, nextBreak = text.indexOf("\n", span.end);
  const line = text.slice(lineStart, nextBreak < 0 ? text.length : nextBreak);
  if (other.some((n) => personPrinted(line, n))) return false;
  // A layout with one column per person ("John | Mary" on one line, rows below) says nothing about whose a row is (Critic
  // #506): any line printing this person beside someone else leaves the line unproven.
  if (text.split("\n").some((l) => own.some((n) => personPrinted(l, n)) && other.some((n) => personPrinted(l, n)))) return false;
  const before = flat(text.slice(0, span.start));
  const last = (list: string[]) => Math.max(-1, ...list.flatMap((n) => starts(before, n)));
  return last(own) > last(other);
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
  // Only the person's own proof of cover: a personal schedule or certificate the household confirmed as personal (Test
  // engineer #506 F2: an illustration or product summary that prints the name is not the person's cover).
  const pages = await query<{ policy_id: string; page_number: number; text: string | null }>(
    `SELECT pp.policy_id::text AS policy_id,pp.page_number,pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE pp.account_id=$1 AND pp.policy_id=ANY($2::uuid[]) AND ${OWN_WORDS} AND p.personal_coverage_confirmed=true AND p.document_role IN ('personal_schedule','certificate') ORDER BY pp.page_number`,
    [accountId, policies]);
  // Every printed name on these documents, the person's own and everyone else's (another life on a joint schedule).
  const names = await query<{ policy_id: string; detected_name: string; mine: boolean }>(
    `SELECT pd.policy_id::text AS policy_id,pd.detected_name,(pd.matched_family_member_id IS NOT DISTINCT FROM $3::uuid) AS mine FROM policy_detected_people pd WHERE pd.account_id=$1 AND pd.policy_id=ANY($2::uuid[])`,
    [accountId, policies, memberId]);
  const page = new Map(pages.rows.map((p) => [`${p.policy_id}|${p.page_number}`, p.text]));
  return lines.map((l) => {
    if (l.source_page == null) return false;
    const on = names.rows.filter((n) => n.policy_id === String(l.policy_id));
    const whole = pages.rows.filter((p) => p.policy_id === String(l.policy_id)).map((p) => p.text ?? "").join("\n");
    return heldOnPage(page.get(`${l.policy_id}|${l.source_page}`), l.evidence_text, on.filter((n) => n.mine).map((n) => n.detected_name), on.filter((n) => !n.mine).map((n) => n.detected_name), whole);
  });
}
