/**
 * The household's own currency setting (Account settings; lib/documents/household-currency). Stored in
 * accounts.currency (sql/household-currency.sql). Code deployed before that file is applied keeps working: the column is
 * read through to_jsonb, so a database without it reads as "not chosen" (nothing assumed), and saving says the setting is not
 * available yet.
 */
import { query } from "@/lib/db/client";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { NotFoundError } from "@/lib/household/repo";
import { effectiveHouseholdCurrency, parseHouseholdCurrencySetting, type HouseholdCurrency, type HouseholdCurrencySetting } from "@/lib/documents/household-currency";

/** The stored choice for a household, or null when it has not chosen (or the column is not there yet). */
export async function storedHouseholdCurrency(userId: string, householdId: string): Promise<HouseholdCurrencySetting | null> {
  return createUserSupabaseClient(userId, async (client) => {
    const row = (await client.query<{ currency: string | null }>(`select to_jsonb(a)->>'currency' as currency from accounts a where a.id = $1`, [householdId])).rows[0];
    return parseHouseholdCurrencySetting(row?.currency);
  });
}

/** The currency a document reading may use for this household's bare amounts, or null when it chose "Don't assume" or has not chosen. A failed read
 * gives null: nothing is assumed when the setting cannot be read. */
export async function householdCurrencyOf(accountId: string): Promise<HouseholdCurrency | null> {
  try {
    const row = (await query<{ currency: string | null }>(`SELECT to_jsonb(a)->>'currency' AS currency FROM accounts a WHERE a.id=$1`, [accountId])).rows[0];
    if (!row) return null;
    return effectiveHouseholdCurrency(row.currency);
  } catch {
    return null;
  }
}

export class HouseholdCurrencyNotAvailable extends Error {}

/** Owner-only, like the household's name: RLS's accounts_update policy filters a non-owner to zero rows. */
export async function setHouseholdCurrency(userId: string, householdId: string, setting: HouseholdCurrencySetting): Promise<void> {
  await createUserSupabaseClient(userId, async (client) => {
    try {
      const { rowCount } = await client.query(`update accounts set currency = $1 where id = $2`, [setting, householdId]);
      if (rowCount === 0) throw new NotFoundError("Household not found");
    } catch (error) {
      if ((error as { code?: string })?.code === "42703") throw new HouseholdCurrencyNotAvailable();
      throw error;
    }
  });
}
