/** The household's home country from its stored documents (lib/claims/home-country.ts explains the rule). */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { homeCountryFromCurrencies } from "./home-country";

/** The household's home country, read from the currencies its own active policies state (cover lines and premiums). */
export async function householdHomeCountry(accountId: string): Promise<string | null> {
  const rows = await query<{ currency: string | null }>(
    `SELECT c.currency FROM policy_coverages c JOIN policies p ON p.id=c.policy_id AND p.account_id=c.account_id
       WHERE c.account_id=$1 AND ${activePredicate("p")} AND c.currency IS NOT NULL
     UNION ALL
     SELECT r.currency FROM premium_records r JOIN policies p ON p.id=coalesce(r.source_document_id,r.policy_id) AND p.account_id=r.account_id
       WHERE r.account_id=$1 AND ${activePredicate("p")} AND r.currency IS NOT NULL`, [accountId]).catch(() => ({ rows: [] as { currency: string | null }[] }));
  return homeCountryFromCurrencies(rows.rows.map((r) => r.currency));
}
