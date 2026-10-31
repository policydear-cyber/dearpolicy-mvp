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
  for (const [raw, value] of [["1500", 1500], ["12.5", 12.5], ["1,500,000.00", 1500000],
    ["1.500.000", 1500000], ["50.000", 50000], ["2.500,50", 2500.5], ["10'000", 10000]] as const)
    assert.equal(printedNumber(raw), value, raw);
  for (const raw of ["12,50", "1,5", "1.2345", "1,50,000.0.0", "", "1.500,000", "10 000", "500 365", "0.500", "0,250"]) assert.equal(printedNumber(raw), null, raw);
  // A three-decimal currency: "BHD 1.500" is one and a half dinars.
  assert.equal(printedNumber("1.500", "BHD"), 1.5);
  assert.equal(printedNumber("1.500", "EUR"), 1500);
  // Lakh grouping only beside a rupee or taka sign (TE pr239 M29); before a multiplier one dot is a decimal (Critic R478 H1).
  assert.equal(printedNumber("1,50,000"), null);
  assert.equal(printedNumber("5,00,000", null, { lakh: true }), 500000);
  assert.equal(printedNumber("1,50,00,000", "INR"), 15000000);
  assert.equal(printedNumber("1.25", null, { scaled: true }), 1.25);
  for (const raw of ["1.250", "1.500", "1.000", "1,500"]) assert.equal(printedNumber(raw, null, { scaled: true }), null, raw);
  assert.equal(printedNumber("2,5", null, { scaled: true }), 2.5);
  assert.equal(printedNumber("1,500", null, { scaled: true }), null);
  assert.equal(printedNumber("1.000.000", null, { scaled: true }), null);
});

test("a multiplier is applied where it is read and never left off where it is not", async () => {
  const { typedValue } = await import("@/lib/policies/catalog-builder");
  const { parseBenefitValue } = await import("@/lib/policies/benefit-rows");
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  const { capReading } = await import("@/lib/insurance/cover-conditions");
  for (const [cap, amount, currency] of [["US$1.25 million", 1250000, "USD"], ["£1.25M", 1250000, "GBP"], ["€2 Mrd.", 2000000000, "EUR"],
    ["₹2 crore", 20000000, "INR"], ["Rs. 5 lakh", 500000, "INR"], ["RM1.5 juta", 1500000, "MYR"], ["S$1.5k", 1500, "SGD"]] as const)
    assert.deepEqual(shareBound("10% of the Sum Insured, up to " + cap, "Angioplasty"), { kind: "cap", amount, currency }, cap);
  assert.deepEqual(capReading({ amount: 1250000, amountBasis: null, quote: "We pay up to S$1.25 million per life." } as never), { kind: "cap", amount: 1250000 });
  // Three digits after the dot before a multiplier read two ways a thousand apart: no cap (TE pr239 D3).
  for (const cap of ["S$1.125 million", "US$2.250m", "€1.500 Mio.", "HK$1.000 million"])
    assert.equal(shareBound("10% of the Sum Insured, up to " + cap, "Angioplasty").kind, "unsure", cap);
  // A cell or a check that does not apply the multiplier gives no figure: never S$1.5 or S$1,250.
  for (const cell of ["S$1.5 million", "Up to S$1.250 million", "US$2m", "₹2 crore", "S$1.5k", "RM 2 juta", "£1.25M", "€1.500 Mio.", "€2 Mrd."]) {
    assert.equal(typedValue("policy_year_limit", cell), null, cell);
    assert.equal(parseBenefitValue(cell, {}), null, cell);
  }
  // Space grouping and lakh grouping outside a rupee market read as nothing, never as their first group.
  for (const cell of ["€10 000", "S$500 365", "HK$1,50,000"]) {
    assert.equal(typedValue("policy_year_limit", cell), null, cell);
    assert.equal(parseBenefitValue(cell, {}), null, cell);
  }
  assert.equal(shareBound("10% of the Sum Insured, up to HK$1,50,000", "Angioplasty").kind, "unsure");
  assert.equal(shareBound("10% of the Sum Insured, up to €10 000", "Angioplasty").kind, "unsure");
  assert.equal(parseBenefitValue("CHF 10'000", {})?.currency, "CHF");
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
