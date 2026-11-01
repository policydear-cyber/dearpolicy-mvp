/**
 * The premiums Home's "Current insurance cost" counts for one person, with where each was read and the totals, so Home
 * and Payments show the same figures from one computation. A premium is counted from a premium record, or from the
 * premium line the policy's own schedule prints (the person's benefit table), never only one of them on one page.
 * Totals are per stated currency (a ringgit premium is not Singapore dollars; RM + £ is no total), and a premium whose
 * record does not state its currency is listed but left out of every total, with a note naming it. No model call.
 */
import { summarisePremiums, type PremiumItem, type PremiumSummaryMemo, type TablePremiumCover } from "@/lib/policies/premium-summary";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { premiumSourceKind, type PremiumSourceKind } from "@/lib/format/premium-source";
import type { ClaimPerson } from "@/lib/claims/person";

export type CountedPremium = PremiumItem & { source: PremiumSourceKind | null };
export type CountedPremiums = { monthly: number | null; annual: number | null; currency: string | null;
  totals: { currency: string; monthly: number; annual: number }[]; items: CountedPremium[];
  /** Premiums the record says are paid once (a single trip): listed with their source, never in the monthly or yearly cost. */
  oneOff: CountedPremium[];
  cashAnnual: number | null; medisaveAnnual: number | null; missing: string[];
  /** This person's policies whose premium is on file under another family member (counted in that person's total). */
  countedElsewhere: { name: string; owner: string }[]; complete: boolean; note: string | null };

/** Each person's covers in the household's benefit table (by family member id), or null when the table is not live here. */
export async function tableCoversByMember(accountId: string): Promise<Map<string, TablePremiumCover[]> | null> {
  const { benefitTableLive, appDb } = await import("@/lib/benefit-table/app");
  if (!(await benefitTableLive(accountId))) return null;
  const { tableFor } = await import("@/lib/benefit-table/service");
  const loaded = await tableFor(appDb, accountId);
  return new Map(loaded.table.people.map((p) => [p.id, p.covers]));
}

/** The premiums counted for one person. `tableCovers` is that person's benefit-table covers, or null when the table is not live. */
/** `memo`, shared across one household's people, reads what they share once. */
export async function countedPremiums(accountId: string, member: ClaimPerson, tableCovers: TablePremiumCover[] | null, memo?: PremiumSummaryMemo): Promise<CountedPremiums> {
  // Every premium component (plan and rider under one policy number), with the MediSave portion added back where the
  // evidence prints it, and the policies with no premium evidence named -- never the rider alone. A policy with no
  // premium record is counted from the premium its own document prints (the benefit table's checked line).
  const summary = await summarisePremiums(accountId, member, tableCovers ? { covers: tableCovers, today: singaporeDay(new Date()) } : undefined, memo);
  // Each counted premium says where it was read (a policy schedule, or a payment record by its source document's role;
  // null when not known), so the page names the real source or the neutral "from your documents".
  const items = summary.items.map((i) => ({ ...i, source: premiumSourceKind(i) }));
  const totals = new Map<string, { currency: string; monthly: number; annual: number }>(), unstated: string[] = [];
  for (const i of items) {
    if (!i.currencyStated) { unstated.push(i.product_name ?? i.insurer ?? "One policy"); continue; }
    const t = totals.get(i.currency) ?? { currency: i.currency, monthly: 0, annual: 0 }; t.monthly += i.monthly; t.annual += i.annual; totals.set(i.currency, t);
  }
  const list = [...totals.values()].sort((a, b) => b.annual - a.annual);
  const one = list.length === 1 ? list[0] : null;
  // Nothing on file is 0; premiums in two currencies, or none with a stated currency, have no one figure (null).
  const none = !items.length;
  const unstatedNote = unstated.length ? `The total ${summary.note ? "also " : ""}leaves out ${[...new Set(unstated)].slice(0, 4).join(", ")}: ${unstated.length === 1 ? "its record does not say" : "their records do not say"} which currency the premium is in.` : null;
  return { monthly: one?.monthly ?? (none ? 0 : null), annual: one?.annual ?? (none ? 0 : null), currency: one?.currency ?? null, totals: list, items, oneOff: summary.oneOff.map((i) => ({ ...i, source: premiumSourceKind(i) })),
    cashAnnual: summary.cashAnnual, medisaveAnnual: summary.medisaveAnnual, missing: summary.missing, countedElsewhere: summary.countedElsewhere ?? [], complete: summary.complete && !unstated.length,
    note: [summary.note, unstatedNote].filter(Boolean).join(" ") || null };
}
