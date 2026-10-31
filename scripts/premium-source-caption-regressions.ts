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
const record = (id: string, product: string, sourceRole: string | null = "premium_receipt", paid: string | null = "2026-09-01", notes: string | null = null): PremiumRecordRow =>
  ({ id, policy_id: "rec-doc-" + id, family_member_id: "m1", insurer: "Example Insurance", product_name: product, policy_number: "EX-" + id, amount: "1200.00", currency: "SGD",
    frequency: "Yearly", payment_date: paid, period_start: null, period_end: null, created_at: "2026-09-01", notes, source_role: sourceRole });
const scheduleItems = tablePremiumItems([scheduleCover("doc-lim", "Lim Ah Kow Critical Shield"), scheduleCover("doc-tan", "Tan Mei Ling Term Guard")], [], { id: "m1" }, TODAY).items;
const recordItems = summariseRecords([record("1", "Example Hospital Plan"), record("2", "Example Home Cover")]);
const caption = (items: Parameters<typeof premiumSourceKind>[0][]) => premiumSourceCaption(items.map(premiumSourceKind));

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
  // #228 moved the counting into lib/policies/counted-premiums.ts, which Home calls: each counted item still carries its source.
  const counted = readFileSync("lib/policies/counted-premiums.ts", "utf8");
  assert.match(route, /\bcountedPremiums\(/);
  assert.match(counted, /summary\.items\.map\(\(i\) => \(\{ \.\.\.i, source: premiumSourceKind\(i\) \}\)\)/);
  assert.match(counted, /oneOff: summary\.oneOff\.map\(\(i\) => \(\{ \.\.\.i, source: premiumSourceKind\(i\) \}\)\)/);
});

// Critic H1 / TE: premium_records also hold premiums read off a personalised schedule at upload (lib/rag/ingest.ts "Extracted
// current premium from personalised policy document", "Rider premium printed on the schedule of ...") and rows from a
// schedule's own payment table (lib/policies/linking.ts). Only a record whose source document is payment evidence
// (premium receipt, renewal or annual statement) and that carries a payment date or period is a "payment record".
test("a premium record read off the household's own policy schedule names the schedule, never a payment record", () => {
  const items = summariseRecords([
    record("s1", "Lim Ah Kow Critical Shield", "personal_schedule", null, "Extracted current premium from personalised policy document"),
    record("s2", "Lim Ah Kow Early CI Rider", "personal_schedule", null, "Rider premium printed on the schedule of Lim Ah Kow Critical Shield"),
  ]);
  assert.equal(caption(items), "from your policy schedules");
  assert.equal(caption(summariseRecords([record("c1", "Tan Mei Ling Term Guard", "certificate", null)])), "from your policy schedule");
  // A dated row from the schedule's own payment table (lib/policies/linking.ts) is still the schedule, not a receipt.
  assert.equal(caption(summariseRecords([record("s3", "Tan Mei Ling Term Guard", "personal_schedule", "2026-03-01")])), "from your policy schedule");
});
test("a receipt, renewal statement or annual statement with a payment date names a payment record", () => {
  assert.equal(caption(summariseRecords([record("r1", "Example Hospital Plan", "premium_receipt")])), "from your payment record");
  assert.equal(caption(summariseRecords([record("r2", "Example Hospital Plan", "renewal_statement"), record("r3", "Example Home Cover", "annual_statement")])), "from your payment records");
  const periodOnly = { ...record("r4", "Example Hospital Plan", "renewal_statement", null), period_start: "2026-01-01", period_end: "2026-12-31" };
  assert.equal(caption(summariseRecords([periodOnly])), "from your payment record");
});
test("schedule records together with schedule table premiums never say payment record", () => {
  const fromSchedule = summariseRecords([record("s4", "Lim Ah Kow Critical Shield", "personal_schedule", null, "Extracted current premium from personalised policy document")]);
  const text = caption([...fromSchedule, ...scheduleItems]);
  assert.equal(text, "from your policy schedules");
  assert.doesNotMatch(text, /payment record/);
});
test("a record whose source role is unknown, missing or not payment evidence gives the neutral caption", () => {
  for (const role of [null, "other", "insurer_letter", "endorsement", "policy_wording", "toString", "Premium_Receipt"])
    assert.equal(caption(summariseRecords([record("u-" + role, "Example Hospital Plan", role)])), "from your documents", String(role));
  // A payment-evidence role with no payment date or period: not shown as a payment record either.
  assert.equal(caption(summariseRecords([record("u-nodate", "Example Hospital Plan", "premium_receipt", null)])), "from your documents");
  // A role-less record mixed with a schedule premium does not borrow either name.
  assert.equal(caption([...summariseRecords([record("u-mix", "Example Hospital Plan", null)]), ...scheduleItems]), "from your documents");
});
test("the dashboard's premium records carry their source document's role, read only from a current document", () => {
  const summary = readFileSync("lib/policies/premium-summary.ts", "utf8");
  assert.match(summary, /LEFT JOIN policies sd ON sd\.id=pr\.source_document_id AND sd\.account_id=pr\.account_id AND \$\{activePredicate\("sd"\)\}/);
  assert.match(summary, /sd\.document_role AS source_role/);
});
