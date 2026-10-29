/**
 * A table row that prints one figure per plan ("S$5,000  S$10,000  S$15,000", "Not covered  S$500  S$1,000"), stored
 * with no plan of its own, is not a figure for this household: chat and the Benefits page take no amount from it, as the
 * Coverage ledger already does. A row whose columns all print one figure, a row read for one plan, and a row a person
 * corrected keep their figure. Made-up rows, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const row = (id: string, quote: string, value: number, o: { tier?: string | null; reviewedAt?: string | null } = {}) => ({
  id, policyId: "p1", productName: "Example Travel", benefitName: "Benefit " + id, traits: ["other"] as never[], formulaKind: "fixed" as never,
  formulaValue: value, currency: "SGD", factKey: null, offsetDays: null, maximumDays: null, sourcePage: 5, quote, conditions: [] as string[],
  requirements: [] as never[], needsReview: false, basisInferred: false, needsConfirmation: false, reviewedAt: o.reviewedAt ?? null, tier: o.tier ?? null,
});

test("which quotes print a different figure per plan", async () => {
  const { figuresDifferByPlan } = await import("@/lib/insurance/scale-limit");
  for (const q of ["If you have to cancel your trip S$7,500 S$10,000 S$15,000", "Reinstatement fees Not Applicable S$1,000 S$1,500", "Not covered S$500 S$1,000",
    "Class C $2,000 $2,750", "Kos perubatan RM 200 RM 300 RM 500", "Personal belongings £1,500 £2,500", "Overall limit^ S$300 S$800 S$1,500", "Golf equipment N/A S$500"])
    assert.equal(figuresDifferByPlan(q), true, q);
  for (const q of ["Table 6 A/B/C $3,540 $3,540 $3,540", "Sports equipment S$2,000 S$2,000 S$2,000", "Proton beam therapy – Category 1 $400 per treatment",
    "S$100 per day up to S$3,000", "Death S$1,000,000", "Cash payouts provide 2026 $689", "Hospital cash S$100 S$100.00", "Pays 50% of S$10,000 after 2 years", ""])
    assert.equal(figuresDifferByPlan(q), false, q);
});

test("chat and the Benefits page take no figure from a plan-column row; the rest keep theirs", async () => {
  const { repairStoredRules } = await import("@/lib/policies/benefit-catalog");
  const { PLAN_COLUMNS_NOTE } = await import("@/lib/insurance/scale-limit");
  const out = repairStoredRules([
    row("a", "If you need to return home earlier than planned S$5,000 S$10,000 S$15,000", 5000),
    row("b", "Not covered S$500 S$1,000", 500),
    row("c", "Table 6 A/B/C $3,540 $3,540 $3,540", 3540),
    row("d", "Trip cancellation S$7,500 S$10,000 S$15,000", 10000, { tier: "Plus" }),
    row("e", "Trip cancellation S$7,500 S$10,000 S$15,000", 15000, { reviewedAt: "2026-10-01" }),
  ] as never);
  const by = new Map(out.map((b) => [b.id, b]));
  for (const id of ["a", "b"]) {
    assert.equal(by.get(id)!.formulaValue, null, id);
    assert.equal(by.get(id)!.formulaKind, "none", id);
    assert.ok(by.get(id)!.conditions.includes(PLAN_COLUMNS_NOTE), id);
  }
  assert.equal(by.get("c")!.formulaValue, 3540);
  assert.equal(by.get("d")!.formulaValue, 10000, "a row read for one plan keeps its figure");
  assert.equal(by.get("e")!.formulaValue, 15000, "a row a person corrected keeps its figure");
});
