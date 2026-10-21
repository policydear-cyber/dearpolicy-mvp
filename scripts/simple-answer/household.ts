/** The simple baseline's whole view of a household: every active document's stored page text, with the
 * document's name, type, role, dates and the people it is linked to. Nothing else -- no benefit records, no
 * search index, no verification layer. This is the "upload, read, answer from the pages" design DC asked about,
 * built only to be compared against the current pipeline (scripts/simple-answer/compare.ts).
 *
 * Household isolation: every query filters on account_id, and loadHouseholdFromDb re-checks each returned row's
 * account_id in code before it reaches a prompt (lib/simple-chat/library.ts). The database is opened read-only. */
import { readFileSync } from "node:fs";

export { readHousehold, type Household, type HouseholdDocument, type HouseholdPage, type ReadOnlyQuery } from "../../lib/simple-chat/library";
import { readHousehold, type Household } from "../../lib/simple-chat/library";

/** A household snapshot written earlier (or a synthetic fixture). The file must name the household it holds. */
export function loadHouseholdFromFile(path: string, expectedAccountId?: string): Household {
  const household = JSON.parse(readFileSync(path, "utf8")) as Household;
  if (!household?.accountId || !Array.isArray(household.documents)) throw new Error(`${path} is not a household snapshot`);
  if (expectedAccountId && household.accountId !== expectedAccountId)
    throw new Error(`${path} holds household ${household.accountId}, not ${expectedAccountId}`);
  return household;
}

/** Reads one household from DATABASE_URL inside a READ ONLY transaction (lib/db/client's pool and TLS rules). */
export async function loadHouseholdFromDb(accountId: string): Promise<Household> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("accountId must be a household uuid");
  const { pool } = await import("../../lib/db/client");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const household = await readHousehold(accountId, async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("ROLLBACK");
    return household;
  } finally {
    client.release();
    await pool.end();
  }
}
