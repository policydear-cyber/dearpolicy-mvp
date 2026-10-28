/**
 * Home's "Current insurance cost" names where its figure comes from (lib/format/premium-source.ts): the policy's own
 * schedule, the household's payment records, or both; any source kind not on the list gives the neutral "from your
 * documents", never a wrong source. Before this, the caption always said "from the latest payment evidence", also when
 * every premium counted was printed on a policy schedule. Made-up households. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { premiumSourceCaption, premiumSourceKind } from "@/lib/format/premium-source";
import { summariseRecords, tablePremiumItems, type PremiumRecordRow, type TablePremiumCover } from "@/lib/policies/premium-summary";
import { printedDay } from "@/lib/benefit-table/dates";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const TODAY = printedDay("28/10/2026")!;
const scheduleCover = (doc: string, product: string): TablePremiumCover => ({ product, cover: "Critical Illness Benefit", plan: null, policyNumber: null, premium: 100,
  premiumFrequency: "Monthly", currency: "SGD", premiumCurrency: "SGD", premiumNote: null, firstYearPremium: null, firstYearFrom: null, startDate: null, endDate: null,
  documentPeriodFrom: "01/03/2026", documentPeriodTo: "01/03/2046", documentKind: "personal_proof",
  source: { documentId: doc, document: doc + ".pdf", page: 1, excerpt: "Instalment Premium : 100.00" } as never, premiumSource: null, ended: null });
const record = (id: string, product: string): PremiumRecordRow => ({ id, policy_id: "rec-doc-" + id, family_member_id: "m1", insurer: "Example Insurance", product_name: product,
  policy_number: "EX-" + id, amount: "1200.00", currency: "SGD", frequency: "Yearly", payment_date: "2026-09-01", period_start: null, period_end: null, created_at: "2026-09-01" });
const scheduleItems = tablePremiumItems([scheduleCover("doc-lim", "Lim Ah Kow Critical Shield"), scheduleCover("doc-tan", "Tan Mei Ling Term Guard")], [], { id: "m1" }, TODAY).items;
const recordItems = summariseRecords([record("1", "Example Hospital Plan"), record("2", "Example Home Cover")]);
const caption = (items: { fromTable?: boolean }[]) => premiumSourceCaption(items.map(premiumSourceKind));

test("premiums read from policy schedules only say so", () => {
  assert.equal(scheduleItems.length, 2);
  assert.equal(caption(scheduleItems), "from your policy schedules");
  assert.equal(caption(scheduleItems.slice(0, 1)), "from your policy schedule");
});
test("premiums from payment records only say so (negative control: the payment-records case keeps naming payments)", () => {
  assert.equal(recordItems.length, 2);
  assert.equal(caption(recordItems), "from your payment records");
  assert.equal(caption(recordItems.slice(0, 1)), "from your payment record");
});
test("both sources are both named", () => {
  assert.equal(caption([...recordItems, ...scheduleItems]), "from your policy schedules and payment records");
  assert.equal(caption([recordItems[0], scheduleItems[0]]), "from your policy schedule and payment record");
});
test("an unknown or missing source kind gives the neutral caption, never a wrong one", () => {
  assert.equal(premiumSourceCaption(["policy_schedule", "broker_quote"]), "from your documents");
  assert.equal(premiumSourceCaption(["toString"]), "from your documents");
  assert.equal(premiumSourceCaption(["payment_record", undefined]), "from your documents");
  assert.equal(premiumSourceCaption([]), "from your documents");
});
test("Home shows the caption from the counted items' sources, not a fixed phrase", () => {
  const page = readFileSync("app/page.tsx", "utf8"), route = readFileSync("app/api/dashboard/route.ts", "utf8");
  assert.doesNotMatch(page, /latest payment evidence/);
  assert.match(page, /per year \{premiumSourceCaption\(data\.premiums\.items\.map\(i=>i\.source\)\)\}\./);
  assert.match(route, /premiumSummary\.items\.map\(\(i\)=>\(\{\.\.\.i,source:premiumSourceKind\(i\)\}\)\)/);
});
