/**
 * Round 5: what a household member's policies cost, from their premium
 * evidence.
 *
 * One Integrated Shield policy number carries two premiums -- the plan and
 * its rider -- and a renewal notice prints the plan's cash portion after a
 * MediSave deduction. Keeping only the latest record per policy number
 * showed the rider alone (S$758/year) as the whole cost. Each premium
 * component (plan, rider) is its own line; a MediSave portion printed beside
 * a cash amount is added back, so the total is the premium, with the cash
 * and MediSave split shown; and a policy with no premium evidence is named
 * as missing rather than silently counted as zero.
 */
import { query } from "@/lib/db/client";
import { annualisePremium } from "@/lib/insurance";
import { SHORT_TERM_DAYS } from "@/lib/benefit-table/assemble";
import { normalizeCurrencyCode, statedCurrencyCode } from "@/lib/format/currency";
import { loadPolicyInventory, normalizedIdentifier } from "@/lib/policies/inventory";
import type { ClaimPerson } from "@/lib/claims/person";

export type PremiumRecordRow = { id: string; policy_id: string | null; family_member_id: string | null; insurer: string | null; product_name: string | null; policy_number: string | null;
  amount: string; currency: string | null; frequency: string | null; payment_date: string | null; period_start: string | null; period_end?: string | null; created_at: string; notes?: string | null };
export type PremiumItem = Omit<PremiumRecordRow, "amount" | "currency"> & { amount: number; currency: string; shared: boolean;
  /** Round 16: the record states its currency (false: `currency` is only this summary's display default, never a fact to total or show). */
  currencyStated: boolean;
  /** What the record's amount is: the whole premium, or only the cash paid after MediSave. */
  cash: number | null; medisave: number | null; total: number; annual: number; monthly: number; cashAnnual: number | null; medisaveAnnual: number | null;
  /** A premium paid once for its own cover period (a single trip), not a recurring one: never annualised or totalled. */
  oneOff: boolean };
export type PremiumSummary = { monthly: number; annual: number; cashAnnual: number | null; medisaveAnnual: number | null; items: PremiumItem[];
  /** One-off premiums for a cover period (see PremiumItem.oneOff): listed, never in the totals or treated as missing. */
  oneOff: PremiumItem[];
  /** Policies on file with no premium evidence: the total leaves them out. */
  missing: string[]; complete: boolean; note: string | null };

// "S$1,050.00 is payable from MediSave" (amount first) or "MediSave
// deduction S$1,050" (amount after). The amount-first form is tried first so
// "... from MediSave and S$234.00 in cash" never reads the cash as MediSave.
const MEDISAVE_BEFORE = /(?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)[^0-9$]{0,40}?\b(?:from|by|via|through|using)\s+medisave/i;
const MEDISAVE = /medisave[^0-9]{0,60}?(?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)/i;
/** Reads the MediSave split a premium record's evidence prints. */
export function premiumSplit(amount: number, notes: string | null | undefined): { total: number; cash: number | null; medisave: number | null } {
  let text = notes ?? "";
  // A renewal notice prints ONE MediSave split for the plan ("MediSave pays
  // S$1,050.00; cash payable S$362.00") and ingestion copies that line onto
  // every premium it read from the notice, the rider included. The split
  // belongs only to the premium whose amount is that cash figure; on any
  // other line (a cash-only rider) it is not this premium's MediSave.
  const printed = text.match(/As printed:\s*([^·]*)/i)?.[1] ?? "";
  const printedCash = printed.match(/cash payable (?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)/i)?.[1];
  if (printedCash != null && Math.abs(Number(printedCash.replace(/,/g, "")) - amount) > 0.005) text = text.replace(/As printed:[^·]*/i, "");
  const m = text.match(MEDISAVE_BEFORE) ?? text.match(MEDISAVE);
  const medisave = m ? Number(m[1].replace(/,/g, "")) : null;
  if (medisave == null) return { total: amount, cash: /\bcash\b/i.test(text) ? amount : null, medisave: null };
  // "cash portion after MediSave S$1,050": the recorded amount is the cash.
  if (/\bcash\b|after medisave|less[: ]+medisave/i.test(text) && !/of which/i.test(text)) return { total: amount + medisave, cash: amount, medisave };
  // "S$1,284, of which S$1,050 is payable from MediSave": the amount is the total.
  return { total: amount, cash: Math.max(0, Math.round((amount - medisave) * 100) / 100), medisave };
}
function component(row: PremiumRecordRow) {
  const product = (row.product_name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (normalizedIdentifier(row.policy_number) || row.policy_id || (row.insurer ?? "")) + "|" + product;
}
const RECURRING = /month|quarter|semi|half.?year|6 month|week|fortnight|year|annum|annual|\bp\.?\s*a\b\.?|bulanan|tahunan/i;
/** A premium paid once for a short cover period the record itself prints (a single trip, 29 Sep to 4 Oct) is a one-off
 * premium for that period: S$73.17 for a six-day trip is not S$73.17 a year, and once the trip has ended it is not a current
 * cost either (Home tile showed "S$6.10/month", 27 Oct). A renewal notice for a year (1 Jan to 31 Dec) stored with no
 * frequency stays a yearly premium (Critic R263): only a printed period of at most SHORT_TERM_DAYS counts as one-off. */
export function isOneOffPremium(row: Pick<PremiumRecordRow, "frequency" | "period_start" | "period_end">) {
  if (/single|one[- ]?off|for the period/i.test(row.frequency ?? "")) return true;
  if (RECURRING.test(row.frequency ?? "") || !row.period_start || !row.period_end) return false;
  const days = (Date.parse(row.period_end.slice(0, 10)) - Date.parse(row.period_start.slice(0, 10))) / 86_400_000;
  return Number.isFinite(days) && days >= 0 && days <= SHORT_TERM_DAYS;
}
export function summariseRecords(rows: PremiumRecordRow[]): PremiumItem[] {
  // rows arrive newest first: the latest record of each premium component.
  const latest = new Map<string, PremiumRecordRow>();
  for (const row of rows) if (!latest.has(component(row))) latest.set(component(row), row);
  return [...latest.values()].map((row) => {
    const amount = Number(row.amount), split = premiumSplit(amount, row.notes);
    const annual = annualisePremium(split.total, row.frequency);
    return { ...row, amount, currency: normalizeCurrencyCode(row.currency, "SGD"), currencyStated: !!statedCurrencyCode(row.currency), shared: row.family_member_id == null, cash: split.cash, medisave: split.medisave, total: split.total,
      oneOff: isOneOffPremium(row), annual, monthly: annual / 12, cashAnnual: split.cash == null ? null : annualisePremium(split.cash, row.frequency), medisaveAnnual: split.medisave == null ? null : annualisePremium(split.medisave, row.frequency) };
  });
}
export async function summarisePremiums(accountId: string, member: ClaimPerson): Promise<PremiumSummary> {
  const r = await query<PremiumRecordRow>(
    `SELECT pr.id,pr.policy_id,pr.family_member_id,pr.insurer,pr.product_name,pr.policy_number,pr.amount::text,pr.currency,pr.frequency,pr.payment_date::text,pr.period_start::text,pr.period_end::text,pr.created_at::text,pr.notes
       FROM premium_records pr
      WHERE pr.account_id=$1 AND (pr.family_member_id=$2 OR (pr.family_member_id IS NULL AND pr.policy_id IS NOT NULL AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=pr.policy_id AND pm.account_id=pr.account_id AND pm.family_member_id=$2)))
      ORDER BY COALESCE(pr.payment_date,pr.period_start,pr.created_at::date) DESC,pr.created_at DESC`, [accountId, member.id]);
  const all = summariseRecords(r.rows), items = all.filter((i) => !i.oneOff), oneOff = all.filter((i) => i.oneOff);
  const annual = items.reduce((sum, item) => sum + item.annual, 0);
  const cashAnnual = items.some((i) => i.cashAnnual != null) ? items.reduce((sum, i) => sum + (i.cashAnnual ?? i.annual), 0) : null;
  const medisaveAnnual = items.some((i) => i.medisaveAnnual != null) ? items.reduce((sum, i) => sum + (i.medisaveAnnual ?? 0), 0) : null;
  // Which of this person's policies have no premium evidence at all.
  let missing: string[] = [];
  try {
    const inventory = await loadPolicyInventory(accountId, [member]);
    missing = inventory.contracts.filter((c) => {
      const ids = new Set([...c.documents, ...c.references].map((d) => d.id));
      const numbers = new Set(c.documents.map((d) => normalizedIdentifier(d.policy_number)).filter(Boolean));
      return !all.some((i) => (i.policy_id && ids.has(i.policy_id)) || (normalizedIdentifier(i.policy_number) && numbers.has(normalizedIdentifier(i.policy_number))));
    }).map((c) => c.name);
  } catch { missing = []; }
  missing = [...new Set(missing)];
  const note = missing.length
    ? "The total leaves out " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? " and " + (missing.length - 4) + " more" : "") + ": no premium is printed in the documents on file for " + (missing.length === 1 ? "it" : "them") + "."
    : null;
  return { monthly: annual / 12, annual, cashAnnual, medisaveAnnual, items, oneOff, missing, complete: missing.length === 0 && items.length > 0, note };
}
