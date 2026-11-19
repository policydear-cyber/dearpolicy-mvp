/** When each policy ends or renews, for Home's "Policy dates" list (DC 19 Nov 2026: "it is important information to show"
 * for real users; the earlier "assume every policy is in force" was for testing).
 *
 * Only dates a document prints are used, each already checked against its page when it was read: a cover's own start and
 * end in the benefit table (lib/benefit-table/check.ts dateOnPage), else the policy's printed expiry or renewal date
 * (lib/rag/ingest.ts crossCheckPrintedFacts). No date is ever worked out or guessed; a policy printing none says so.
 *
 * A printed end date that has passed never makes a policy "ended" on its own (DC 19 Nov: a renewal often comes with only a
 * receipt, and the insurer sends no new wording). It asks the household for proof of renewal instead. A premium record of
 * the same policy (its document, or its policy number with the same insurer and person) paid or running after that date is
 * that proof: the policy shows as renewed, with the receipt's own period end when the receipt prints one, else only the
 * payment date. The schedule and wording keep giving the terms.
 *
 * Pure: no database, no network. Works for any insurer and any date style the reader keeps ("17-Nov-2101", "27 JUN 2112",
 * "04/10/2026", "2026-10-04").
 *   Test: scripts/policies/policy-dates-test.ts */

import { printedDay } from "@/lib/benefit-table/dates";
import { canonicalDeathInsurer } from "@/lib/claims/death-evidence";
import { normalizedIdentifier } from "@/lib/policies/document-name";

/** A printed date as a day count (UTC midnight), or null. Accepts what printedDay accepts plus "17-Nov-2101" and
 * "17 Nov. 2101" shapes. */
export function dayOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const direct = printedDay(text);
  if (direct != null) return direct;
  const spaced = text.trim().replace(/^(\d{1,2})[-./\s]+([A-Za-z]{3,9})\.?[-./\s]+(\d{4})$/, "$1 $2 $3");
  return spaced === text.trim() ? null : printedDay(spaced);
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "17 Nov 2101" for a day count. */
export function dayText(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

export type DatedDocument = { id: string; effective_date: string | null; renewal_or_expiry_date: string | null };
export type DatedContract = { id: string; ownerId: string; name: string; insurer: string | null; documents: (DatedDocument & { policy_number: string | null; group_policy_number?: string | null })[] };
/** One cover line of the person's benefit table: its own printed dates and where they are printed. */
export type DatedCover = { documentId: string; name: string; startDate: string | null; endDate: string | null; page: number | null };
export type PaymentRecord = { policy_id: string | null; source_document_id: string | null; family_member_id: string | null; insurer: string | null; policy_number: string | null;
  payment_date: string | null; period_start: string | null; period_end: string | null; created_at: string | null };

/** not_renewed: the household said it did not renew the policy after its printed end date (lib/policies/not-renewed.ts):
 * their own statement, shown as theirs, and taken back with Undo. */
export type PolicyDateState = "until" | "ends_soon" | "renewal_due" | "renewed" | "no_date" | "not_renewed";
export type PolicyDate = {
  key: string; name: string; insurer: string | null; state: PolicyDateState;
  /** The policy's own documents (its schedule, certificate or newer copies). */
  documentIds: string[];
  /** The last printed end date of the policy's covers (ISO), and its document and page. */
  endsOn: string | null; endsText: string | null; source: { documentId: string; page: number | null } | null;
  /** Days from today to endsOn (negative once it has passed). */
  daysLeft: number | null;
  startedOn: string | null;
  /** Covers of the policy that end before the policy's last date, each with its own printed date. */
  sooner: { name: string; endsOn: string; endsText: string; ended: boolean }[];
  /** The premium record that shows the policy was renewed after endsOn. `until` only when that record prints a period end. */
  renewal: { paidOn: string | null; paidText: string | null; until: string | null; untilText: string | null; documentId: string | null } | null;
  /** Set when one of its documents prints more than one of the person's policies: "I didn't renew it" is not offered. */
  severalPolicies?: boolean;
};

/** How many days ahead an end date counts as soon (a renewal notice usually comes a month or two before). */
export const ENDS_SOON_DAYS = 60;

/** Whether a premium record belongs to this contract: its own document, or its printed policy number with the same insurer,
 * never another person's (the rule lib/policies/currentness.ts matchPremiumEvidence uses). */
function sameContract(contract: DatedContract, row: PaymentRecord): boolean {
  if (row.family_member_id && row.family_member_id !== contract.ownerId) return false;
  const ids = new Set(contract.documents.map((d) => d.id));
  if (row.policy_id && ids.has(row.policy_id)) return true;
  const number = normalizedIdentifier(row.policy_number);
  if (!number) return false;
  const own = new Set(contract.documents.map((d) => normalizedIdentifier(d.policy_number)).filter(Boolean));
  const group = new Set(contract.documents.map((d) => normalizedIdentifier(d.group_policy_number)).filter(Boolean));
  // A scheme's group number is shared by every member on it: it counts only for a record that names this person (Critic L2).
  if (!own.has(number) && !(group.has(number) && row.family_member_id === contract.ownerId)) return false;
  const insurer = canonicalDeathInsurer(contract.insurer), theirs = canonicalDeathInsurer(row.insurer);
  if (insurer && theirs) return insurer === theirs;
  // With an insurer missing on either side, a number alone counts only when it is long enough not to collide (Critic L3).
  return number.length >= 6;
}

/** The product a policy's reading prints, to name a policy whose documents store none (TE F4): the base cover whose printed
 * policy number is the policy's own; else, only when its document's base covers print exactly one product, that one. A
 * document printing several policies never lends one policy another's name (Critic MED-10). Null: keep the stored name. */
export function printedProductName(contract: Pick<DatedContract, "documents">, covers: { documentId: string; product: string | null; policyNumber: string | null; riderOf: string | null }[]): string | null {
  const ids = new Set(contract.documents.map((d) => d.id));
  const numbers = new Set(contract.documents.map((d) => normalizedIdentifier(d.policy_number)).filter(Boolean));
  const base = covers.filter((c) => ids.has(c.documentId) && !c.riderOf && c.product?.trim());
  const own = [...new Set(base.filter((c) => numbers.has(normalizedIdentifier(c.policyNumber))).map((c) => c.product!.trim()))];
  if (own.length === 1) return own[0];
  if (own.length > 1) return null;
  for (const id of ids) {
    // A cover printing another policy's number is that policy's, never this one's (Critic MED-10b).
    const products = [...new Set(base.filter((c) => c.documentId === id && (!numbers.size || !normalizedIdentifier(c.policyNumber) || numbers.has(normalizedIdentifier(c.policyNumber)))).map((c) => c.product!.trim()))];
    if (products.length === 1) return products[0];
    if (products.length > 1) return null;
  }
  return null;
}

/** The person's contracts that share a document with another of their contracts: a document that holds more than one
 * of their policies, which "I didn't renew it" must not take off Home as a whole (Critic MED-3, MED-6). */
export function sharingDocuments(contracts: Pick<DatedContract, "id" | "documents">[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const c of contracts) for (const d of c.documents) owners.set(d.id, new Set([...(owners.get(d.id) ?? []), c.id]));
  return new Set([...owners.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]));
}

/** A premium record shows renewal past `endDay` only when it pays for the next term (Critic MED-1, TE F1):
 *  - a record that prints its period is decided by that period alone: it runs past endDay by more than a week (an old
 *    term printed "1 Dec 2025 to 1 Dec 2026" against a schedule's "30 Nov 2026" is not a renewal: Critic L1), or it starts
 *    no more than a week before endDay. When or whether it was paid or uploaded late never matters;
 *  - a record printing no period counts only when it was paid on or after endDay. A payment before the date, even one
 *    uploaded after it (a monthly payer's last instalment, a trip's own purchase receipt), proves nothing about the next
 *    term, so the household is still asked. */
export const PERIOD_SLACK_DAYS = 7;
export function renewalAfter(rows: PaymentRecord[], endDay: number): PaymentRecord | null {
  let best: { row: PaymentRecord; day: number } | null = null;
  for (const row of rows) {
    const paid = dayOf(row.payment_date), start = dayOf(row.period_start), end = dayOf(row.period_end);
    // A start printed with no end needs to start on or after endDay: a monthly instalment printed with its start alone is
    // not the next term (Critic, b05d380 LOW). The week's slack applies only when an end is printed too.
    const renews = end != null || start != null
      ? (end != null && end > endDay + PERIOD_SLACK_DAYS && (start == null || start >= endDay - PERIOD_SLACK_DAYS)) || (end == null && start != null && start >= endDay)
      : paid != null && paid >= endDay;
    if (!renews) continue;
    const day = end ?? start ?? paid ?? 0;
    if (!best || day > best.day) best = { row, day };
  }
  return best?.row ?? null;
}

/** The dates of one policy. `today` is a day count in Singapore (lib/benefit-table/dates.ts singaporeDay). */
/** `notRenewed` holds the household's "I didn't renew it" answers (lib/policies/not-renewed.ts notRenewedKey): one counts only
 * for the same policy and the same printed end date, and only while no renewal evidence after that date is on file. */
export function policyDates(contract: DatedContract, covers: DatedCover[], payments: PaymentRecord[], today: number, notRenewed?: ReadonlySet<string>): PolicyDate {
  const ids = new Set(contract.documents.map((d) => d.id));
  const own = covers.filter((c) => ids.has(c.documentId));
  type End = { day: number; name: string; documentId: string; page: number | null };
  const ends: End[] = own.flatMap((c) => { const day = dayOf(c.endDate); return day == null ? [] : [{ day, name: c.name, documentId: c.documentId, page: c.page }]; });
  // A policy no cover line dates falls back to its document's printed expiry or renewal date.
  if (!ends.length) for (const d of contract.documents) { const day = dayOf(d.renewal_or_expiry_date); if (day != null) ends.push({ day, name: contract.name, documentId: d.id, page: null }); }
  const starts = [...own.map((c) => dayOf(c.startDate)), ...contract.documents.map((d) => dayOf(d.effective_date))].filter((d): d is number => d != null);
  const startedOn = starts.length ? isoOf(Math.min(...starts)) : null;
  const base = { key: contract.id, name: contract.name, insurer: contract.insurer, documentIds: contract.documents.map((d) => d.id), startedOn };
  if (!ends.length) return { ...base, state: "no_date", endsOn: null, endsText: null, source: null, daysLeft: null, sooner: [], renewal: null };
  const last = ends.reduce((a, b) => (b.day > a.day ? b : a));
  const soonerByName = new Map<string, number>();
  for (const e of ends) if (e.day < last.day && e.name !== contract.name) soonerByName.set(e.name, Math.max(soonerByName.get(e.name) ?? -Infinity, e.day));
  // A cover printed with two end dates (a renewal schedule beside the old one) keeps only its latest: an earlier copy is not
  // a cover that ends sooner when the same cover runs on to the policy's last date.
  for (const e of ends) if (e.day === last.day) soonerByName.delete(e.name);
  const sooner = [...soonerByName].map(([name, day]) => ({ name, endsOn: isoOf(day), endsText: dayText(day), ended: day < today })).sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  const daysLeft = last.day - today;
  const dated = { endsOn: isoOf(last.day), endsText: dayText(last.day), source: { documentId: last.documentId, page: last.page }, daysLeft, sooner };
  if (daysLeft >= 0) return { ...base, ...dated, state: daysLeft <= ENDS_SOON_DAYS ? "ends_soon" : "until", renewal: null };
  const proof = renewalAfter(payments.filter((row) => sameContract(contract, row)), last.day);
  if (!proof) return { ...base, ...dated, state: notRenewed?.has(`${contract.id}|${isoOf(last.day)}`) ? "not_renewed" : "renewal_due", renewal: null };
  const paid = dayOf(proof.payment_date), until = dayOf(proof.period_end);
  return { ...base, ...dated, state: "renewed", renewal: { paidOn: paid != null ? isoOf(paid) : null, paidText: paid != null ? dayText(paid) : null,
    until: until != null && until > last.day ? isoOf(until) : null, untilText: until != null && until > last.day ? dayText(until) : null, documentId: proof.source_document_id ?? proof.policy_id } };
}

/** The household's list: policies needing proof of renewal first, then the soonest end, then those printing no date, then
 * those the household said it did not renew. */
export function householdPolicyDates(contracts: DatedContract[], covers: DatedCover[], payments: PaymentRecord[], today: number, notRenewed?: ReadonlySet<string>): PolicyDate[] {
  const rank: Record<PolicyDateState, number> = { renewal_due: 0, ends_soon: 1, until: 2, renewed: 2, no_date: 3, not_renewed: 4 };
  return contracts.map((c) => policyDates(c, covers, payments, today, notRenewed))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999") || a.name.localeCompare(b.name));
}
