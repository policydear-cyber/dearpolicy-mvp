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
