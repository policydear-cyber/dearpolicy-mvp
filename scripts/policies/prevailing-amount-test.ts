/**
 * "N% of Prevailing Insured Amount" (or "current sum assured") is read as a share of the sum insured, with a note that an
 * earlier claim may have reduced that amount, and only when the quote states no cap the rule would need. Made-up rows;
 * no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "p", productName: "Example Critical Cover", traits: [], formulaKind: "none", formulaValue: null, currency: null, factKey: null,
  offsetDays: null, maximumDays: null, conditions: [] as string[], requirements: [], needsReview: false, basisInferred: false, sourcePage: 34, tier: null, reviewedAt: null };
const row = (id: string, benefitName: string, quote: string, o: Record<string, unknown> = {}) => ({ ...base, id, benefitName, quote, ...o });

test("a share of the prevailing or current insured amount is a sum-insured rule with a note; a capped one is no rule", async () => {
  const { repairStoredRules, validateCatalogFormula, PREVAILING_NOTE } = await import("@/lib/policies/benefit-catalog");
  const out = new Map(repairStoredRules([
    row("b", "(b) Other than angioplasty", "(b) Other than “Angioplasty and Other Invasive : 100% of Prevailing Insured Amount"),
    row("c", "Early stage cancer", "Early stage cancer: 25% of the current sum assured"),
    row("a", "(a) Angioplasty", "(a) Angioplasty and Other Invasive Treatment for : 10% of Prevailing Insured Amount, up to maximum"),
    row("m", "(a) Angioplasty", "Angioplasty: 10% of Prevailing Insured Amount, subject to a maximum of S$25,000"),
    row("l", "Carcinoma in situ", "Carcinoma in situ 20% of the current sum insured, limited to S$50,000 per life"),
    row("s", "Death", "Death: 100% of the sum insured"),
  ] as never).map((b) => [b.id, b]));
  assert.equal(out.get("b")!.formulaKind, "sum_insured"); assert.equal(out.get("b")!.formulaValue, 1);
  assert.ok(out.get("b")!.conditions.includes(PREVAILING_NOTE));
  assert.equal(out.get("c")!.formulaKind, "sum_insured"); assert.equal(out.get("c")!.formulaValue, 0.25);
  assert.ok(out.get("c")!.conditions.includes(PREVAILING_NOTE));
  for (const id of ["a", "m", "l"]) assert.equal(out.get(id)!.formulaKind, "none", id);
  // A plain sum insured gets no prevailing note.
  assert.equal(out.get("s")!.formulaKind, "sum_insured");
  assert.ok(!out.get("s")!.conditions.includes(PREVAILING_NOTE));
  // A model-read rule over the same wording is checked the same way, and gets the note when it stands.
  const v = (quote: string, value: number) => validateCatalogFormula({ kind: "sum_insured", value, currency: null, quote, factKey: null, offsetDays: null, maximumDays: null }).formulaKind;
  assert.equal(v("100% of Prevailing Insured Amount", 1), "sum_insured");
  assert.equal(v("10% of Prevailing Insured Amount, up to maximum S$25,000", 0.1), "none");
  assert.equal(v("100% of Prevailing Insured Amount", 0.5), "none");
  const stored = repairStoredRules([row("x", "Major cancer", "100% of Prevailing Insured Amount", { formulaKind: "sum_insured", formulaValue: 1 })] as never)[0];
  assert.ok(stored.conditions.includes(PREVAILING_NOTE));
});
