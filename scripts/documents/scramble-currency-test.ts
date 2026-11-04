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
  "Swiss francs (CHF, apostrophe thousands)": ["CHF 250.00", "CHF 500.00", "CHF 12'000.00", "CHF 30’000.00"],
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
    // Capitals glued to a symbol are a currency only when they are a market's own prefix (Critic #329 L3).
    ["MAX$1,500.00", "MAX$2,500.00", "MAX$12,000.00", "MAX$30,000.00"],
  ]) assert.ok(!scrambleSigns(scrambled(values)).includes(SIGN), values[0]);
});

test("a table's own column header still pairs its rows, in another currency too", () => {
  const table = ["Premium table", "Ringgit Malaysia", "Annual premium by age", "Age\tMale\tFemale", "35\tRM 1,200.50\tRM 1,100.20", "40\tRM 1,400.00\tRM 1,250.00", "45\tRM 1,700.00\tRM 1,500.00"].join("\n");
  assert.deepEqual(scrambleSigns(table), []);
  // A contents list's page numbers are not amounts.
  assert.deepEqual(scrambleSigns(["Contents", "Definitions", "Benefits", "Exclusions", "3", "7", "12", "15"].join("\n")), []);
});

// TE #329 blind gate: what counts as an amount on a value line, in any market's way of writing numbers.
test("space thousands are amounts: a kronor, złoty or euro table written '2 500' is seen as scrambled", () => {
  for (const values of [
    ["2 500 kr", "5 000 kr", "120 000 kr", "300 000 kr"],
    ["2 500 kr", "5 000 kr", "120 000 kr", "300 000 kr"], // no-break space
    ["2 500 zł", "5 000 zł", "120 000 zł", "300 000 zł"], // narrow no-break space
    ["2 500 €", "5 000 €", "120 000 €", "300 000 €"],
    ["SEK 2 500", "SEK 5 000", "SEK 120 000", "SEK 300 000"],
    ["2 500", "5 000", "120 000", "300 000"],
  ]) {
    assert.ok(scrambleSigns(scrambled(values)).includes(SIGN), values[0]);
    assert.ok(!scrambleSigns(paired(values)).includes(SIGN), values[0] + " paired");
  }
});

test("a date is never an amount, and years side by side are no space thousands", () => {
  for (const values of [
    ["01.10.2026", "01.11.2026", "01.11.2027"],
    ["01/10/2026", "01/11/2026", "01/11/2027"],
    ["2026-10-01", "2026-11-01", "2027-11-01"],
    ["2019 2021", "2022 2024", "2025 2026"], // years side by side are not space thousands
  ]) assert.deepEqual(scrambleSigns(scrambled(values)), [], values[0]);
  // The safe reading stays: one dot group with nothing to say it is a rate is thousands, so it is checked.
  assert.ok(scrambleSigns(scrambled(["250", "1.500", "12.000", "400"])).includes(SIGN));
  assert.ok(scrambleSigns(scrambled(["Rp 250.000", "Rp 500.000", "Rp 750.000", "Rp 900.000"])).includes(SIGN));
  // Dates among amounts do not hide the amounts.
  assert.ok(scrambleSigns(scrambled(["01.10.2026", "12,000.00", "1,500.00", "400.00"])).includes(SIGN));
});

test("one dot group is always thousands, whatever else its run prints: the safe reading (TE #330)", () => {
  for (const values of [
    ["Rp 250.000", "Rp 750.000", "Rp 500.000", "2.5%"],
    ["Rp 250.000", "Rp 750.000", "Rp 500.000", "0.5"],
    ["250.000 đ", "750.000 đ", "500.000 đ", "1.25"],
    ["€ 1.500", "€ 2.500", "€ 4.000", "0.75"],
    ["1.500", "2.500", "4.000", "12.5%"], // a percent beside bare dot groups: they stay thousands
  ]) assert.ok(scrambleSigns(scrambled(values)).includes(SIGN), values.join(" "));
  // Labels in any script count: Vietnamese labels have no three Latin letters in a row.
  assert.ok(scrambleSigns(["Bảng quyền lợi", "Nằm viện", "Phẫu thuật", "Chuyên khoa", "Hệ số", "250.000 đ", "750.000 đ", "500.000 đ", "1.25"].join("\n")).includes(SIGN));
  // The currency printed only in the table's heading: bare values beside a bare decimal are still amounts (TE #330 round 2).
  assert.ok(scrambleSigns(["Tabel Manfaat (Rp)", ...LABELS, "250.000", "750.000", "500.000", "0.5"].join("\n")).includes(SIGN));
  assert.ok(scrambleSigns(["Tabel Manfaat (Rp)", ...LABELS, "250.000", "750.000", "500.000", "1.5"].join("\n")).includes(SIGN));
  // So a rate card is checked against the image too: one reading call, never amounts paired by guess.
  assert.ok(scrambleSigns(scrambled(["1.235", "2.450", "3.875", "0.925"])).includes(SIGN));
  // Yen, yuan and won written with their own character are currencies.
  assert.ok(scrambleSigns(scrambled(["5,000円", "12,000円", "30,000円", "100,000円"])).includes(SIGN));
  assert.ok(scrambleSigns(scrambled(["5,000元", "12,000元", "30,000元", "100,000元"])).includes(SIGN));
  assert.ok(scrambleSigns(scrambled(["50,000원", "120,000원", "300,000원", "1,000,000원"])).includes(SIGN));
});
