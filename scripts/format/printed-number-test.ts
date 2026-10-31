/**
 * A money figure is read whole and in the grouping its market prints: "€50.000" is fifty thousand, "Rp 1.500.000" one
 * and a half million, "5,00,000" five lakh. A figure that could be read two ways is no figure. Made-up rows and passages
 * from several markets; no database, no network, no model.
 */
import test from "node:test";
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

test("every common grouping reads as printed; an ambiguous one reads as nothing", async () => {
  const { printedNumber } = await import("@/lib/format/printed-number");
  for (const [raw, value] of [["1500", 1500], ["12.5", 12.5], ["1,500,000.00", 1500000], ["5,00,000", 500000], ["1,50,00,000", 15000000],
    ["1.500.000", 1500000], ["50.000", 50000], ["2.500,50", 2500.5], ["10'000", 10000], ["10 000", 10000]] as const)
    assert.equal(printedNumber(raw), value, raw);
  for (const raw of ["12,50", "1,5", "1.2345", "1,50,000.0.0", "", "1.500,000"]) assert.equal(printedNumber(raw), null, raw);
  // A three-decimal currency: "BHD 1.500" is one and a half dinars.
  assert.equal(printedNumber("1.500", "BHD"), 1.5);
  assert.equal(printedNumber("1.500", "EUR"), 1500);
});

test("a table cell, a stored limit and a share's cap keep the whole figure in any market", async () => {
  const { typedValue } = await import("@/lib/policies/catalog-builder");
  const { parseBenefitValue } = await import("@/lib/policies/benefit-rows");
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  for (const [cell, value] of [["€50.000", 50000], ["€ 1.500.000", 1500000], ["EUR 2.500,50", 2500.5], ["Rp50.000.000", 50000000],
    ["₹5,00,000", 500000], ["S$1,250", 1250], ["£12.5", 12.5]] as const) {
    assert.equal(typedValue("policy_year_limit", cell), value, cell);
    assert.equal(parseBenefitValue(cell, {})?.value, value, cell);
  }
  // Never part of the figure: "US$12,50" is no amount, not twelve.
  assert.equal(typedValue("policy_year_limit", "US$12,50"), null);
  assert.equal(parseBenefitValue("US$12,50", {}), null);
  assert.deepEqual(shareBound("10% of the Sum Insured, up to €25.000", "Angioplasty"), { kind: "cap", amount: 25000, currency: "EUR" });
  assert.deepEqual(shareBound("10% of the Sum Insured, up to Rp50.000.000", "Angioplasty"), { kind: "cap", amount: 50000000, currency: "IDR" });
  // A cap figure that reads two ways leaves the share unused, even beside a readable second figure.
  assert.equal(shareBound("10% of the Sum Insured, up to US$12,50", "Angioplasty").kind, "unsure");
  assert.equal(shareBound("10% of the Sum Insured, up to €12,50 or S$5,000, whichever is lower", "Angioplasty").kind, "unsure");
  assert.equal(fetches, 0);
});

test("rows printed in rupiah and rupees are read as rows", async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const rows = benefitRowsFromText("Rawat Inap\tRp 5.000.000 per hari\nPembedahan\tRp50.000.000\nSurgery\tRs 5,00,000\nICU\t₹20,000 per day\n");
  assert.deepEqual(rows.map(r => r.label), ["Rawat Inap", "Pembedahan", "Surgery", "ICU"]);
});
