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
    row("b", "(b) Other than angioplasty and other invasive", "(b) Other than “Angioplasty and Other Invasive : 100% of Prevailing Insured Amount"),
    // A label longer than the row's name carries words the name does not: no rule (TE pr209).
    row("n", "(b) Other than angioplasty", "(b) Other than “Angioplasty and Other Invasive : 100% of Prevailing Insured Amount"),
    row("c", "Early stage cancer", "Early stage cancer: 25% of the current sum assured"),
    row("a", "(a) Angioplasty", "(a) Angioplasty and Other Invasive Treatment for : 10% of Prevailing Insured Amount, up to maximum"),
    row("m", "(a) Angioplasty", "Angioplasty: 10% of Prevailing Insured Amount, subject to a maximum of S$25,000"),
    row("l", "Carcinoma in situ", "Carcinoma in situ 20% of the current sum insured, limited to S$50,000 per life"),
    row("s", "Death", "Death: 100% of the sum insured"),
    row("t", "Bypass", "Bypass: 100% of Prevailing Insured Amount, not exceeding S$500,000"),
    row("u", "Bypass", "Bypass: 100% of Prevailing Insured Amount less any amount paid under (a)"),
    row("w", "Bypass", "Bypass: 30% of the prevailing sum insured or S$25,000, whichever is lower"),
    row("y", "Bypass", "Bypass: 100% of Prevailing Insured Amount after any payment under (a)"),
  ] as never).map((b) => [b.id, b]));
  assert.equal(out.get("b")!.formulaKind, "sum_insured"); assert.equal(out.get("b")!.formulaValue, 1);
  assert.ok(out.get("b")!.conditions.includes(PREVAILING_NOTE));
  assert.equal(out.get("c")!.formulaKind, "sum_insured"); assert.equal(out.get("c")!.formulaValue, 0.25);
  assert.ok(out.get("c")!.conditions.includes(PREVAILING_NOTE));
  for (const id of ["n", "a", "m", "l", "t", "u", "w", "y"]) assert.equal(out.get(id)!.formulaKind, "none", id);
  // A plain sum insured gets no prevailing note.
  assert.equal(out.get("s")!.formulaKind, "sum_insured");
  assert.ok(!out.get("s")!.conditions.includes(PREVAILING_NOTE));
  // A model-read rule over the same wording is checked the same way, and gets the note when it stands.
  const v = (quote: string, value: number, benefitName: string | null = "Angioplasty") =>
    validateCatalogFormula({ kind: "sum_insured", value, currency: null, quote, factKey: null, offsetDays: null, maximumDays: null, benefitName }).formulaKind;
  assert.equal(v("100% of Prevailing Insured Amount", 1), "sum_insured");
  assert.equal(v("10% of Prevailing Insured Amount, up to maximum S$25,000", 0.1), "none");
  assert.equal(v("100% of Prevailing Insured Amount", 0.5), "none");
  // Only "label: N% of [the] prevailing insured amount" stands; any other wording after it, or a second share, is no rule.
  for (const tail of [", but no more than 25,000 in total", ", payable once in the lifetime of the policy", " for each child", " of the rider",
    ", tertakluk kepada RM25,000", "; 5% if the policy is under 1 year old", ". The total of all claims is twenty five thousand dollars."])
    assert.equal(v("Angioplasty: 10% of Prevailing Insured Amount" + tail, 0.1), "none", tail);
  assert.equal(v("Angioplasty: 10% of 50% of Prevailing Insured Amount", 0.5), "none");
  assert.equal(v("Angioplasty: 10% of 50% of Prevailing Insured Amount", 0.1), "none");
  // The label and what follows carry nothing else: no comma, bracket or figure in the label, no reference after (Critic R408, TE).
  for (const q of ["Major cancer: 100% of Prevailing Insured Amount (see Section 4)", "Angioplasty: 10% of Prevailing Insured Amount (see Maximum Limit below)",
    "Angioplasty (subject to a maximum of twenty thousand dollars): 10% of Prevailing Insured Amount", "Angioplasty, payable once only: 10% of Prevailing Insured Amount",
    "Angioplasty (limited to one claim) - 10% of Prevailing Insured Amount", "Angioplasty, for each child: 10% of Prevailing Insured Amount",
    "Angioplasty (rider): 10% of Prevailing Insured Amount", "Angioplasty 2: 10% of Prevailing Insured Amount",
    "Angioplasty: 10% of Prevailing Insured Amount, no more than 25,000 dollars", "Angioplasty: 10% of the Prevailing Insured Amount of the Basic Plan",
    "Early cancer: 25% of current sum insured, and the remaining 75% on later diagnosis"])
    assert.equal(v(q, q.includes("100%") ? 1 : q.includes("25%") ? 0.25 : 0.1), "none", q);
  // A label that is not the row's own name, or any label with no name to compare, is no rule.
  for (const q of ["Angioplasty payable once only: 10% of Prevailing Insured Amount", "Angioplasty for each child: 10% of Prevailing Insured Amount",
    "Angioplasty rider - 10% of Prevailing Insured Amount", "Angioplasty limited to one claim per lifetime: 10% of Prevailing Insured Amount"])
    assert.equal(v(q, 0.1), "none", q);
  assert.equal(v("Angioplasty: 10% of Prevailing Insured Amount", 0.1, null), "none");
  assert.equal(v("10% of Prevailing Insured Amount", 0.1, null), "sum_insured");
  for (const [q, name] of [["(a) Angioplasty: 10% of Prevailing Insured Amount", "Angioplasty"], ["(ii) Key-hole surgery - 10% of the prevailing sum assured.", "Key-hole surgery"],
    ["a. Angioplasty & stents: 10% of Prevailing Insured Amount", "(a) Angioplasty & stents"]])
    assert.equal(v(q, 0.1, name), "sum_insured", q);
  const stored = repairStoredRules([row("x", "Major cancer", "100% of Prevailing Insured Amount", { formulaKind: "sum_insured", formulaValue: 1 })] as never)[0];
  assert.ok(stored.conditions.includes(PREVAILING_NOTE));
});
