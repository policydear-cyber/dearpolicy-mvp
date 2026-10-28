/**
 * Home's cost counts a policy with no premium record from the premium its own document prints, as the benefit table has
 * checked it (lib/policies/premium-summary.ts tablePremiumItems), and only when what is paid now is certain. Made-up
 * households in three markets. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tablePremiumItems, type TablePremiumCover } from "@/lib/policies/premium-summary";
import { printedDay } from "@/lib/benefit-table/dates";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const day = (s: string) => printedDay(s)!;
const src = (documentId: string, excerpt = "Instalment Premium : 100.00") => ({ documentId, document: documentId + ".pdf", page: 1, excerpt });
const cover = (over: Partial<TablePremiumCover> & { doc?: string }): TablePremiumCover => {
  const { doc = "doc-a", ...rest } = over;
  return { product: "Harbour Critical Illness", cover: "Critical Illness Benefit", plan: null, policyNumber: null, premium: 100, premiumFrequency: "Monthly", currency: "SGD",
    premiumCurrency: "SGD", premiumNote: null, firstYearPremium: null, startDate: null, documentPeriodFrom: "01/03/2026", source: src(doc) as never, premiumSource: null, ended: null, ...rest };
};
const member = { id: "m1" };
const amounts = (covers: TablePremiumCover[], today = day("28/10/2026"), records: { policy_id: string | null; policy_number: string | null; product_name: string | null }[] = []) =>
  tablePremiumItems(covers, records, member, today).map((i) => [i.product_name, i.amount, i.currency, Math.round(i.annual * 100) / 100]);

test("a monthly premium in each market's currency is counted yearly, in its own currency", () => {
  assert.deepEqual(amounts([cover({})]), [["Harbour Critical Illness", 100, "SGD", 1200]]);
  assert.deepEqual(amounts([cover({ product: "Pelan Kritikal", currency: "MYR", premiumCurrency: "MYR", premiumFrequency: "Bulanan", premium: 85.5 })]), [["Pelan Kritikal", 85.5, "MYR", 1026]]);
  assert.deepEqual(amounts([cover({ product: "Thames Income Protection", currency: "GBP", premiumCurrency: "GBP", premiumFrequency: "Annually", premium: 640 })]), [["Thames Income Protection", 640, "GBP", 640]]);
  // The premium line's own currency, never the cover's (check.ts premiumCurrency).
  assert.deepEqual(amounts([cover({ currency: "SGD", premiumCurrency: "USD" })]), [["Harbour Critical Illness", 100, "USD", 1200]]);
});

test("a page that prints a first-year premium: that figure in the first policy year, the other from the anniversary", () => {
  const c = cover({ premium: 470.85, firstYearPremium: 376.68, premiumNote: "the page prints a different premium for the first policy year", documentPeriodFrom: "19/10/2026" });
  const [first] = tablePremiumItems([c], [], member, day("28/10/2026"));
  assert.equal(first.amount, 376.68); assert.equal(Math.round(first.annual * 100) / 100, 4520.16);
  assert.equal(first.detail, "first policy year; S$470.85 monthly from 19 October 2027");
  assert.equal(tablePremiumItems([c], [], member, day("18/10/2027"))[0].amount, 376.68, "the day before the anniversary");
  assert.equal(tablePremiumItems([c], [], member, day("19/10/2027"))[0].amount, 470.85, "from the anniversary");
  assert.equal(tablePremiumItems([c], [], member, day("19/10/2027"))[0].detail, null);
  // Before cover starts, the first premium due is the first-year one.
  assert.equal(tablePremiumItems([c], [], member, day("01/10/2026"))[0].amount, 376.68);
  // The cover's own start date wins over its document's.
  assert.equal(tablePremiumItems([{ ...c, startDate: "19/10/2025" }], [], member, day("28/10/2026"))[0].amount, 470.85);
  // A policy that starts on 29 February has its anniversary on 1 March.
  const leap = { ...c, documentPeriodFrom: "29/02/2028" };
  assert.equal(tablePremiumItems([leap], [], member, day("28/02/2029"))[0].amount, 376.68);
  assert.equal(tablePremiumItems([leap], [], member, day("01/03/2029"))[0].amount, 470.85);
});

test("anything unsure is left out, never guessed", () => {
  const none = (c: TablePremiumCover, why: string) => assert.deepEqual(amounts([c]), [], why);
  none(cover({ premiumCurrency: null, currency: null }), "no currency");
  none(cover({ premiumCurrency: undefined, currency: null }), "no currency on the cover either");
  none(cover({ premiumFrequency: null }), "no payment frequency: a trip's premium is not yearly");
  none(cover({ premiumFrequency: "Single" }), "a single premium");
  none(cover({ premiumFrequency: "One-off" }), "a one-off premium");
  none(cover({ premium: null }), "no premium");
  none(cover({ premium: 0 }), "a zero premium");
  none(cover({ ended: "04/10/2026" }), "a trip that has ended");
  none(cover({ firstYearPremium: 80, documentPeriodFrom: null }), "a first-year premium with no start date");
  none(cover({ premiumNote: "the page prints a different premium for the first policy year", firstYearPremium: null }), "a first-year premium the page prints but that could not be read");
  none(cover({ firstYearPremium: 80, documentPeriodFrom: "sometime in 2026" }), "a start date that is not a date");
});

test("a policy a premium record covers is never counted twice", () => {
  const c = cover({ policyNumber: "HCI-0042" });
  assert.deepEqual(amounts([c], undefined, [{ policy_id: "doc-a", policy_number: null, product_name: null }]), [], "a record from the same document");
  assert.deepEqual(amounts([c], undefined, [{ policy_id: "receipt-1", policy_number: "hci 0042", product_name: null }]), [], "a record with the same policy number");
  assert.deepEqual(amounts([c], undefined, [{ policy_id: "receipt-1", policy_number: null, product_name: "HARBOUR critical-illness" }]), [], "a record with the same product");
  assert.equal(amounts([c], undefined, [{ policy_id: "receipt-1", policy_number: "OTHER-1", product_name: "Travel Insurance" }]).length, 1, "another policy's record changes nothing");
});

test("one premium per policy: a schedule read as two covers counts once; two documents that disagree count neither", () => {
  const death = cover({ cover: "Death Benefit" });
  assert.equal(amounts([cover({}), death]).length, 1, "a benefit and its death benefit print one premium");
  // A basic plan and its rider, each with its own premium line on one schedule, are two premiums.
  const rider = cover({ product: "Harbour Early CI Rider", premium: 30, source: src("doc-a", "Early CI Rider\t30.00") as never });
  assert.deepEqual(amounts([cover({}), rider]).map((x) => x[1]), [100, 30]);
  // The same product from a schedule and a later notice: which premium is now is not known.
  assert.deepEqual(amounts([cover({}), cover({ doc: "doc-b", premium: 120 })]), []);
  assert.deepEqual(amounts([cover({ policyNumber: "P-1" }), cover({ doc: "doc-b", product: "Renamed plan", policyNumber: "P1", premium: 120 })]), [], "one printed policy number, two documents");
  // Two different policies are two premiums.
  assert.equal(amounts([cover({}), cover({ doc: "doc-b", product: "Thames Term", policyNumber: "TT-9" })]).length, 2);
});

test("no household, insurer or product is written into the premium code", async () => {
  const { readFile } = await import("node:fs/promises");
  const code = await readFile("lib/policies/premium-summary.ts", "utf8");
  assert.doesNotMatch(code, /Singlife|Desmond|Charmaine|Comprehensive Critical|470\.85|376\.68/i);
});
