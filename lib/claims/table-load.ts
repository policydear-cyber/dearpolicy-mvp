/** The person's benefit table for a claim (lib/claims/table-benefits.ts), read from stored readings only: no model call.
 * Empty where the benefit table is off for the account or cannot be read, so a claim never waits on it. */
import { NO_TABLE, type ClaimTable } from "./table-benefits";

export async function claimTableFor(accountId: string, familyMemberId: string): Promise<ClaimTable> {
  try {
    const { benefitTableLive, appDb } = await import("@/lib/benefit-table/app");
    if (!(await benefitTableLive(accountId))) return NO_TABLE;
    const { tableFor } = await import("@/lib/benefit-table/service");
    const person = (await tableFor(appDb, accountId)).table.people.find((p) => p.id === familyMemberId);
    return person ? { rows: person.rows, covers: person.covers } : NO_TABLE;
  } catch (error) {
    console.warn("Benefit table unavailable for the claim:", error instanceof Error ? error.message : error);
    return NO_TABLE;
  }
}
