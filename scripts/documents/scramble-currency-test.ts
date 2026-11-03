/**
 * A table whose labels came out before their values is seen as scrambled in any currency (lib/documents/layout-check.ts
 * scrambleSigns), not only in dollars: ringgit, pounds, rupiah, euro, rupees, Hong Kong dollars, by symbol, ISO code or
 * the market's own short form (TE #324 note). A line holding any other word stays a label line, a table's own column
 * header still pairs its rows, and the dollar cases are unchanged. Pure, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { scrambleSigns } from "@/lib/documents/layout-check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const LABELS = ["Hospital Room and Board", "Intensive Care Unit", "Surgical Fees", "Outpatient Cancer Treatment"];
const scrambled = (values: string[]) => [...LABELS, ...values].join("\n");
const paired = (values: string[]) => LABELS.map((l, i) => `${l}\t${values[i]}`).join("\n");
const SIGN = "labels came out before their values";

const MARKETS: Record<string, string[]> = {
  "ringgit (RM)": ["RM 250.00", "RM 500.00", "RM 12,000.00", "RM 30,000.00"],
  "ringgit (MYR)": ["MYR 250.00", "MYR 500.00", "MYR 12,000.00", "MYR 30,000.00"],
  "pounds (£)": ["£250.00", "£500.00", "£12,000.00", "£30,000.00"],
  "pounds (GBP)": ["250.00 GBP", "500.00 GBP", "12,000.00 GBP", "30,000.00 GBP"],
  "rupiah (Rp)": ["Rp 2,500,000", "Rp 5,000,000", "Rp 120,000,000", "Rp 300,000,000"],
  "rupiah (IDR)": ["IDR 2,500,000", "IDR 5,000,000", "IDR 120,000,000", "IDR 300,000,000"],
  "euro (€)": ["€ 250,00", "€ 500,00", "€ 12.000,00", "€ 30.000,00"],
  "rupees (₹)": ["₹2,500.00", "₹5,000.00", "₹1,20,000.00", "₹3,00,000.00"],
  "rupees (Rs.)": ["Rs. 2,500.00", "Rs. 5,000.00", "Rs. 1,20,000.00", "Rs. 3,00,000.00"],
  "Hong Kong dollars (HK$)": ["HK$250.00", "HK$500.00", "HK$12,000.00", "HK$30,000.00"],
  "Singapore dollars (S$)": ["S$250.00", "S$500.00", "S$12,000.00", "S$30,000.00"],
  "Singapore dollars (SGD)": ["SGD 250.00", "SGD 500.00", "SGD 12,000.00", "SGD 30,000.00"],
  "plain figures": ["250.00", "500.00", "12,000.00", "30,000.00"],
};

test("labels before values is seen in every currency, and labels beside values is not", () => {
  for (const [market, values] of Object.entries(MARKETS)) {
    assert.ok(scrambleSigns(scrambled(values)).includes(SIGN), `${market}: scrambled`);
    assert.ok(!scrambleSigns(paired(values)).includes(SIGN), `${market}: paired`);
  }
});

test("a line with any other word is still a label line: no scramble from rows that carry their own words", () => {
  for (const values of [
    ["Day 1 250.00", "Day 2 500.00", "Day 3 12,000.00", "Day 4 30,000.00"],
    ["Plan A 1,000.00", "Plan B 2,000.00", "Plan C 3,000.00", "Plan D 4,000.00"],
    ["Age 35 1,000.00", "Age 40 2,000.00", "Age 45 3,000.00", "Age 50 4,000.00"],
    ["RMX 250.00", "RMX 500.00", "RMX 12,000.00", "RMX 30,000.00"],
  ]) assert.ok(!scrambleSigns(scrambled(values)).includes(SIGN), values[0]);
});

test("a table's own column header still pairs its rows, in another currency too", () => {
  const table = ["Premium table", "Ringgit Malaysia", "Annual premium by age", "Age\tMale\tFemale", "35\tRM 1,200.50\tRM 1,100.20", "40\tRM 1,400.00\tRM 1,250.00", "45\tRM 1,700.00\tRM 1,500.00"].join("\n");
  assert.deepEqual(scrambleSigns(table), []);
  // A contents list's page numbers are not amounts.
  assert.deepEqual(scrambleSigns(["Contents", "Definitions", "Benefits", "Exclusions", "3", "7", "12", "15"].join("\n")), []);
});
