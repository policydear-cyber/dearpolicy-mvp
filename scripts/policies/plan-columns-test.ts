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
  id, policyId: "p1", productName: "Example Travel", benefitName: "Travel benefit " + id.toUpperCase() + " cover", traits: ["other"] as never[], formulaKind: "fixed" as never,
  formulaValue: value, currency: "SGD", factKey: null, offsetDays: null, maximumDays: null, sourcePage: 5, quote, conditions: [] as string[],
  requirements: [] as never[], needsReview: false, basisInferred: false, needsConfirmation: false, reviewedAt: o.reviewedAt ?? null, tier: o.tier ?? null,
});

test("which quotes print a different figure per plan", async () => {
  const { figuresDifferByPlan } = await import("@/lib/insurance/scale-limit");
  for (const q of ["If you have to cancel your trip S$7,500 S$10,000 S$15,000", "Reinstatement fees Not Applicable S$1,000 S$1,500", "Not covered S$500 S$1,000",
    "Class C $2,000 $2,750", "Kos perubatan RM 200 RM 300 RM 500", "Personal belongings £1,500 £2,500", "Overall limit^ S$300 S$800 S$1,500", "Golf equipment N/A S$500",
    // A unit after each column, and plans that do not have the benefit (TE pr190 F1, F2).
    "Hospital cash S$100 per day S$200 per day S$300 per day", "S$100/day S$200/day", "Elaun hospital RM150 sehari RM250 sehari", "Hotel £50 per night £100 per night",
    "Nil S$500", "Tidak dilindungi RM300", "Not Included S$1,000", "Overseas medical 250,000 500,000 1,000,000",
    "Hospital cash S$100 daily S$200 daily", "Hotel £50 each night £100 each night", "Excluded S$500", "Not available S$1,000",
    // A larger second figure is a higher plan's column, never a sum and its premium (TE pr190 r3 D41).
    "Emergency evacuation S$40,000 S$1,000,000", "Trip delay S$100.00 S$500", "Kos perubatan RM 2,000 RM 50,000.00"])
    assert.equal(figuresDifferByPlan(q), true, q);
  for (const q of ["Table 6 A/B/C $3,540 $3,540 $3,540", "Sports equipment S$2,000 S$2,000 S$2,000", "Proton beam therapy – Category 1 $400 per treatment",
    "S$100 per day up to S$3,000", "Death S$1,000,000", "Cash payouts provide 2026 $689", "Hospital cash S$100 S$100.00", "Pays 50% of S$10,000 after 2 years", "",
    // A sum assured and its premium, and figures in two currencies, are not plan columns (TE pr190 F3, Critic R351).
    "Basic Plan S$100,000 S$1,234.56", "CI rider RM 200,000 RM 840.00", "Overall limit S$1,000,000 US$750,000", "S$100 per day S$100 per day",
    "Policy 1,234 sum 50,000", "Plan 200,000 300,000", "Benefit 100,000 100,000 100,000",
    "Basic Plan SGD 100,000.00 SGD 1,234.56", "Basic Plan S$100,000 S$1,234"])
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

test("a held row is never read again from its quote as a percentage (Critic R351 H1)", async () => {
  const { repairStoredRules } = await import("@/lib/policies/benefit-catalog");
  const out = repairStoredRules([
    row("p", "Medical expenses up to 10% of sum insured, max S$5,000 S$10,000", 5000),
    row("q", "Accidental death 100% of the sum insured S$50,000 S$100,000 S$200,000", 50000),
    { ...row("r", "Accidental death 100% of the sum insured S$50,000 S$100,000 S$200,000", 0), formulaKind: "none", formulaValue: null },
  ] as never);
  for (const b of out) {
    assert.equal(b.formulaKind, "none", b.id);
    assert.equal(b.formulaValue, null, b.id);
  }
});

test("a held row takes its plan's column only from a checked reading of the same page that names one plan", async () => {
  const { planColumnFigure } = await import("@/lib/insurance/scale-limit");
  const at = { policyId: "doc1", sourcePage: 5, quote: "If you have to cancel your entire trip S$7,500 S$10,000 S$15,000" };
  const reading = (o: Partial<{ documentId: string; page: number; excerpt: string; column: string | null; qualifier: string | null; amount: number; kind: string }> = {}) => ({
    documentId: o.documentId ?? "doc1", page: o.page ?? 5, excerpt: o.excerpt ?? "If you have to cancel\nyour entire trip S$7,500  S$10,000  S$15,000",
    column: o.column === undefined ? "Gold" : o.column, qualifier: o.qualifier ?? null,
    figure: { kind: o.kind ?? "printed", amount: o.amount ?? 10000, currency: "SGD" }, figureText: "up to S$" + (o.amount ?? 10000).toLocaleString("en-SG") });
  assert.deepEqual(planColumnFigure(at, [reading()]), { plan: "Gold", figureText: "up to S$10,000" });
  // The same plan read twice (two people on one plan) still names one figure.
  assert.deepEqual(planColumnFigure(at, [reading(), reading()]), { plan: "Gold", figureText: "up to S$10,000" });
  // Anything unsure gives none: another document or page, an excerpt without the row's cells, two plans (two people on
  // different plans), a figure that is none of the row's cells, a qualified column, no column, a figure not printed.
  for (const [why, readings] of [
    ["none", []], ["other document", [reading({ documentId: "doc2" })]], ["other page", [reading({ page: 6 })]],
    ["other row", [reading({ excerpt: "If you have to postpone your trip S$500 S$1,000 S$1,500", amount: 1000 })]],
    ["two plans", [reading(), reading({ column: "Platinum", amount: 15000 })]], ["not a cell", [reading({ amount: 12000 })]],
    ["qualified", [reading({ qualifier: "per family" })]], ["no column", [reading({ column: null })]], ["worked out", [reading({ kind: "worked_out" })]],
    ["one reading unsure", [reading(), reading({ column: null })]], ["blank column", [reading({ column: "  " })]],
    // A neighbouring row's reading whose excerpt also prints this row's cells, or other words before them (TE #197 H1,
    // Critic R370): never this row's figure.
    ["neighbour's excerpt", [reading({ excerpt: "If you have to cancel your entire trip S$7,500 S$10,000 S$15,000\nLoss of passport S$50 S$100 S$150", amount: 10000 })]],
    ["other words", [reading({ excerpt: "Trip curtailment S$7,500 S$10,000 S$15,000" })]],
  ] as [string, ReturnType<typeof reading>[]][])
    assert.equal(planColumnFigure(at, readings), null, why);
  // A reading in another currency, or a row with no words before its cells, gives none.
  assert.equal(planColumnFigure(at, [{ ...reading(), figure: { kind: "printed", amount: 10000, currency: "MYR" } }]), null);
  assert.equal(planColumnFigure({ ...at, quote: "S$7,500 S$10,000 S$15,000" }, [reading({ excerpt: "S$7,500 S$10,000 S$15,000" })]), null);
  // A quote with two runs of cells, or none, or no page, gives none.
  assert.equal(planColumnFigure({ ...at, quote: at.quote + " Family S$18,750 S$25,000 S$37,500" }, [reading()]), null);
  assert.equal(planColumnFigure({ ...at, quote: "If you have to cancel your entire trip" }, [reading()]), null);
  assert.equal(planColumnFigure({ ...at, sourcePage: null }, [reading()]), null);
});

test("a reading that quotes only the row's cells gives the plan's figure only when the cells are the page's alone", async () => {
  const { planColumnFigure, planCellRun } = await import("@/lib/insurance/scale-limit");
  const at = { policyId: "doc1", sourcePage: 7, quote: "If you are liable for accidental death, injury or damage to S$500,000 S$750,000 S$1,000,000" };
  const cells = (o: Partial<{ excerpt: string; benefit: string; column: string | null; amount: number; page: number; qualifier: string | null }> = {}) => ({
    documentId: "doc1", page: o.page ?? 7, excerpt: o.excerpt ?? "S$500,000\tS$750,000\tS$1,000,000", column: o.column === undefined ? "Gold" : o.column,
    qualifier: o.qualifier ?? null, figure: { kind: "printed", amount: o.amount ?? 750000, currency: "SGD" },
    figureText: "up to S$" + (o.amount ?? 750000).toLocaleString("en-SG"), benefit: o.benefit ?? "Liability to others while travelling" });
  const one = { runIsUnique: true };
  assert.deepEqual(planColumnFigure(at, [cells()], one), { plan: "Gold", figureText: "up to S$750,000" });
  // The same benefit read for two people on one plan still names one figure.
  assert.deepEqual(planColumnFigure(at, [cells(), cells()], one), { plan: "Gold", figureText: "up to S$750,000" });
  // Another stored row of the page prints the same cells: none.
  assert.equal(planColumnFigure(at, [cells()], { runIsUnique: false }), null);
  // The row's stored name counts as its words too.
  assert.deepEqual(planColumnFigure({ ...at, quote: "Cover S$500,000 S$750,000 S$1,000,000", benefitName: "Personal liability" }, [cells()], one), { plan: "Gold", figureText: "up to S$750,000" });
  assert.equal(planColumnFigure(at, [cells()]), null);
  for (const [why, readings] of [
    // Two benefits read with these cells, or one reading that prints them with other words: whose cells they are is unsure.
    ["two benefits", [cells(), cells({ benefit: "Legal costs abroad" })]],
    ["other words", [cells(), cells({ excerpt: "Legal costs abroad S$500,000 S$750,000 S$1,000,000" })]],
    ["cells and a note", [cells({ excerpt: "S$500,000 S$750,000 S$1,000,000 per family" })]],
    ["no name", [cells({ benefit: "" })]],
    ["other page", [cells({ page: 8 })]],
    ["two plans", [cells(), cells({ column: "Platinum", amount: 1000000 })]],
    ["qualified", [cells({ qualifier: "per family" })]],
    ["not a cell", [cells({ amount: 800000 })]],
    ["no column", [cells({ column: null })]],
    // A reading of another benefit, whose own row was not stored, never lends its cells (TE pr200 G6, Critic R389 L1).
    ["another benefit", [cells({ benefit: "Loss of passport while on your trip" })]],
    ["another benefit's legal costs", [cells({ benefit: "Legal expenses" })]],
  ] as [string, ReturnType<typeof cells>[]][])
    assert.equal(planColumnFigure(at, readings, one), null, why);
  // A row with no words before its cells still gives none.
  assert.equal(planColumnFigure({ ...at, quote: "S$500,000 S$750,000 S$1,000,000" }, [cells()], one), null);
  // The run the caller compares rows by: one run, spaced, or none.
  assert.equal(planCellRun(at.quote), "S$500,000 S$750,000 S$1,000,000");
  assert.equal(planCellRun("Liability\tS$500,000\tS$750,000  S$1,000,000"), "S$500,000 S$750,000 S$1,000,000");
  assert.equal(planCellRun("Death S$1,000,000"), null);
  assert.equal(planCellRun(at.quote + " Family S$1,000,000 S$1,500,000"), null);
});
