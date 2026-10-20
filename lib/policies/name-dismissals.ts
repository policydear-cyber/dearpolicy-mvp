import { query } from "@/lib/db/client";

/** "Not in my family" (sql/detected-name-dismissals.sql): names read from a
 * document that the household said are not its people. GET /api/policies
 * leaves them out of detected_people and the review counts skip them. Until
 * that file is applied the table is absent and nothing is left out, exactly
 * as before. */
let ready: Promise<boolean> | null = null;
export function dismissalsReady(): Promise<boolean> {
  ready ??= query<{ t: string | null }>("SELECT to_regclass('public.policy_name_dismissals')::text AS t")
    .then((r) => !!r.rows[0]?.t).catch(() => false)
    // Only a present table is remembered, so applying the file needs no restart.
    .then((ok) => { if (!ok) ready = null; return ok; });
  return ready;
}

/** The form a name is matched in, for a column or SQL parameter: "  Jane   TAN " and "jane tan" are the same name. */
export function nameKeySql(expr: string): string {
  return `lower(regexp_replace(btrim(${expr}),'\\s+',' ','g'))`;
}

/** "NOT EXISTS(...)" for a detected name (row alias `pd`) its own household has not dismissed, or "" before the table exists.
 * The dismissal must belong to the row's own household and document, so one household's answer never hides another's name. */
export async function notDismissedCondition(alias = "pd"): Promise<string> {
  if (!await dismissalsReady()) return "";
  return `NOT EXISTS (SELECT 1 FROM policy_name_dismissals nd WHERE nd.account_id=${alias}.account_id AND nd.policy_id=${alias}.policy_id AND nd.name_key=${nameKeySql(`${alias}.detected_name`)})`;
}

/** notDismissedCondition() as " AND ...", or "". */
export async function notDismissedClause(alias = "pd"): Promise<string> {
  const condition = await notDismissedCondition(alias);
  return condition ? ` AND ${condition}` : "";
}

/** nameKeySql() in JS, for names already in hand. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name keys a household dismissed on one document (empty before the table exists). */
export async function dismissedNameKeys(accountId: string, policyId: string): Promise<Set<string>> {
  if (!await dismissalsReady()) return new Set();
  const r = await query<{ name_key: string }>("SELECT name_key FROM policy_name_dismissals WHERE account_id=$1 AND policy_id=$2", [accountId, policyId]);
  return new Set(r.rows.map((row) => row.name_key));
}

/** The parts of a document's review reason that come from names left unlinked and coverage left unverified; every
 * other part (a "check this is the right person" from reading, an unreadable-page note) belongs to whoever wrote it. */
const RECOUNTED_REASON = /named insured (?:person is|people are) not linked|coverage items? could not be source-verified/;

/** A document's review flag and reason after its unlinked names and unverified items are counted again: those two
 * parts are replaced, every other part is kept as it was. */
export function recountedReview(previous: string | null, unmatched: number, unverified: number): { needsReview: boolean; reason: string | null } {
  const kept = (previous ?? "").split("; ").map((part) => part.trim()).filter((part) => part && !RECOUNTED_REASON.test(part));
  const counted = [
    unmatched ? `${unmatched} named insured ${unmatched === 1 ? "person is" : "people are"} not linked` : null,
    unverified ? `${unverified} coverage item${unverified === 1 ? "" : "s"} could not be source-verified` : null,
  ].filter((part): part is string => !!part);
  const parts = [...counted, ...kept];
  return { needsReview: parts.length > 0, reason: parts.length ? parts.join("; ") : null };
}
