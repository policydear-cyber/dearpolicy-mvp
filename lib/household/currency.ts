/**
 * The household's own currency setting (Account settings; lib/documents/household-currency). Stored in
 * accounts.currency (sql/household-currency.sql). Code deployed before that file is applied keeps working: the column is
 * read through to_jsonb, so a database without it reads as "not chosen" (nothing assumed), and saving says the setting is not
 * available yet.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { NotFoundError } from "@/lib/household/repo";
import { HOUSEHOLD_CURRENCY_NOTE, effectiveHouseholdCurrency, parseHouseholdCurrencySetting, type HouseholdCurrency, type HouseholdCurrencySetting } from "@/lib/documents/household-currency";

/** The stored choice for a household, or null when it has not chosen (or the column is not there yet). */
export async function storedHouseholdCurrency(userId: string, householdId: string): Promise<HouseholdCurrencySetting | null> {
  return createUserSupabaseClient(userId, async (client) => {
    const row = (await client.query<{ currency: string | null }>(`select to_jsonb(a)->>'currency' as currency from accounts a where a.id = $1 and ${activePredicate("a")}`, [householdId])).rows[0];
    return parseHouseholdCurrencySetting(row?.currency);
  });
}

/** The currency a document reading may use for this household's bare amounts, or null when it chose "Don't assume" or has not chosen. A failed read
 * gives null: nothing is assumed when the setting cannot be read. */
export async function householdCurrencyOf(accountId: string): Promise<HouseholdCurrency | null> {
  try {
    const row = (await query<{ currency: string | null }>(`SELECT to_jsonb(a)->>'currency' AS currency FROM accounts a WHERE a.id=$1 AND ${activePredicate("a")}`, [accountId])).rows[0];
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
      const { rowCount } = await client.query(`update accounts set currency = $1 where id = $2 and ${activePredicate()}`, [setting, householdId]);
      if (rowCount === 0) throw new NotFoundError("Household not found");
    } catch (error) {
      if ((error as { code?: string })?.code === "42703") throw new HouseholdCurrencyNotAvailable();
      throw error;
    }
  });
}

const numberKey = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The page text of the household's other active documents of the same policy (by policy number): a schedule, an
 * endorsement, a renewal. A currency any of them names decides for this one too (Test engineer #526 F2). */
export async function relatedPolicyTexts(accountId: string, policyId: string, policyNumbers: (string | null | undefined)[]): Promise<string[]> {
  const keys = [...new Set(policyNumbers.map(numberKey).filter((k) => k.length >= 3))];
  if (!keys.length) return [];
  const rows = await query<{ text: string }>(
    `SELECT pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE p.account_id=$1 AND p.id<>$2 AND ${activePredicate("p")}
        AND regexp_replace(upper(coalesce(p.policy_number,'')),'[^A-Z0-9]','','g') = ANY($3::text[])`,
    [accountId, policyId, keys]);
  return rows.rows.map((r) => r.text);
}

/** Takes back amounts whose currency came from the household's setting (they carry its note), so a wrong currency never
 * stays on screen: after the setting changes (all of them but those already in the new currency; Test engineer #526
 * F4), and when another document of the same policy turns out to print another currency (F2). They return to how they
 * were before the setting: no amount shown, until the document is read again. */
export async function withdrawHouseholdCurrency(accountId: string, opts: { keep?: string | null; policyIds?: string[] } = {}): Promise<number> {
  // The currency each amount carried before it is withdrawn: only a ledger row still in that currency took it from here.
  const result = await query(
    `WITH old AS (
       SELECT id, currency FROM policy_coverages
        WHERE account_id=$1 AND position($2 in coalesce(notes,''))>0
          AND ($3::text IS NULL OR currency IS DISTINCT FROM $3)
          AND ($4::uuid[] IS NULL OR policy_id = ANY($4::uuid[]))
        FOR UPDATE)
     UPDATE policy_coverages pc SET currency=NULL, confirmed=false, evidence_verified=false,
            notes=NULLIF(btrim(replace(replace(pc.notes, ' · ' || $2, ''), $2, '')), '')
       FROM old WHERE pc.id=old.id
     RETURNING pc.id::text AS id, old.currency AS currency`,
    [accountId, HOUSEHOLD_CURRENCY_NOTE, opts.keep ?? null, opts.policyIds ?? null]);
  const withdrawn = result.rows as { id: string; currency: string | null }[];
  const ids = withdrawn.map((r) => r.id);
  // The Coverage ledger's machine rows seeded from those amounts carry the currency too: a row nobody edited is removed,
  // and seeded again from the amount as it now stands (lib/ledger/store.ts seedLedger). A person's own row is kept.
  // A row a person edited keeps their words, but not the money figure the setting gave a currency to (Test engineer #526
  // N1): the ledger's currency column can't be empty, and an amount with no currency is never shown (DC's rule), so its
  // money figure is taken off instead. A percentage stays (it is not money). Only a row still in the currency the setting
  // gave is touched: a currency a person set on the row themselves is theirs (Critic #526).
  if (ids.length) {
    const seeded = `c.account_id=$1 AND c.seed_key LIKE 'coverage:%' AND split_part(split_part(c.seed_key,'|',1),':',2) = ANY($2::text[])`;
    await query(`DELETE FROM coverage_rules c WHERE ${seeded} AND c.origin<>'person' AND c.status<>'rejected' AND c.updated_at=c.created_at`, [accountId, ids])
      .catch((error) => console.warn("household currency: ledger rows not removed:", error instanceof Error ? error.message : error));
    const pairs = withdrawn.filter((r) => r.currency);
    if (pairs.length) {
      await query(
        `UPDATE coverage_rules c SET amount = CASE WHEN c.pays_kind='percent_of_sum' THEN c.amount ELSE NULL END, sum_basis=NULL
           FROM unnest($2::text[], $3::text[]) AS w(id, currency)
          WHERE c.account_id=$1 AND c.seed_key LIKE 'coverage:%' AND split_part(split_part(c.seed_key,'|',1),':',2) = w.id
            AND c.currency = w.currency`,
        [accountId, pairs.map((r) => r.id), pairs.map((r) => r.currency)])
        .catch((error) => console.warn("household currency: ledger amounts not cleared:", error instanceof Error ? error.message : error));
    }
  }
  return ids.length;
}

/** The household's other documents of the same policy whose amounts took the household's currency: when this document
 * prints any other currency, those amounts are taken back (Test engineer #526 F2, the later document first). */
export async function withdrawRelatedHouseholdCurrency(accountId: string, policyId: string, policyNumbers: (string | null | undefined)[], named: string[]): Promise<number> {
  const keys = [...new Set(policyNumbers.map(numberKey).filter((k) => k.length >= 3))];
  if (!keys.length || !named.length) return 0;
  const ids = (await query<{ id: string }>(
    `SELECT p.id FROM policies p WHERE p.account_id=$1 AND p.id<>$2 AND ${activePredicate("p")}
        AND regexp_replace(upper(coalesce(p.policy_number,'')),'[^A-Z0-9]','','g') = ANY($3::text[])`,
    [accountId, policyId, keys])).rows.map((r) => r.id);
  if (!ids.length) return 0;
  // Only an amount in a currency every name here agrees with is kept.
  const codes = [...new Set(named)];
  return withdrawHouseholdCurrency(accountId, { policyIds: ids, keep: codes.length === 1 && codes[0] !== "$" && codes[0] !== "?" ? codes[0] : "__none__" });
}
