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

// FWD re-read (5 Nov): a schedule term (a limit, a family maximum, a deductible) whose quote prints one figure per plan
// was shown with its first column's figure ("Overall limit^ S$300 S$800 S$1,500" as a limit of S$300 for a Business plan
// holder). It is held like any plan row: no figure from the quote; the person's plan column only from their own reading.
test("a schedule term that prints one figure per plan is held, never shown with its first column", async () => {
  const { repairStoredRules, describeScheduleTerm } = await import("@/lib/policies/benefit-catalog");
  const { PLAN_COLUMNS_NOTE } = await import("@/lib/insurance/scale-limit");
  const term = (id: string, rowKind: string, quote: string, value: number, o: { tier?: string | null; reviewedAt?: string | null } = {}) =>
    ({ ...row(id, quote, value, o), formulaKind: "none" as never, rowKind, benefitName: quote.replace(/\s+(?:S\$|RM|£|\$).*$/, "") });
  const held = repairStoredRules([
    term("t1", "policy_year_limit", "Overall limit^ S$300 S$800 S$1,500", 300),
    term("t2", "policy_year_limit", "Overall limit for family plan* S$18,750 S$25,000 S$37,500", 18_750),
    term("t3", "family_limit", "Family maximum RM 5,000 RM 8,000 RM 12,000", 5_000),
    term("t4", "deductible", "Excess £100 £50 Nil", 100),
    term("t5", "co_payment_cap", "Co-payment cap S$3,000 S$2,000", 3_000),
  ] as never) as { id: string; formulaValue: number | null; conditions: string[] }[];
  for (const b of held) {
    assert.equal(b.formulaValue, null, b.id);
    assert.ok(b.conditions.includes(PLAN_COLUMNS_NOTE), b.id);
  }
  // Kept: one figure in every column, one figure only, a row read for one plan, and a row a person corrected.
  const kept = repairStoredRules([
    term("k1", "policy_year_limit", "Overall limit S$5,000 S$5,000 S$5,000", 5_000),
    term("k2", "policy_year_limit", "Policy year limit S$150,000", 150_000),
    term("k3", "policy_year_limit", "Overall limit S$300 S$800 S$1,500", 800, { tier: "Business" }),
    term("k4", "policy_year_limit", "Overall limit S$300 S$800 S$1,500", 800, { reviewedAt: "2026-11-01T00:00:00Z" }),
  ] as never) as { id: string; formulaValue: number | null }[];
  assert.deepEqual(kept.map((b) => b.formulaValue), [5_000, 150_000, 800, 800]);
  // Its period is the one its own words print, never one made up.
  assert.equal(describeScheduleTerm("policy_year_limit", 5_000, "SGD", "Overall limit per insured person per trip S$5,000"), "Limit of SGD 5,000 a trip");
  assert.equal(describeScheduleTerm("policy_year_limit", 150_000, "SGD", "Policy year limit S$150,000"), "Limit of SGD 150,000 a policy year");
  assert.equal(describeScheduleTerm("policy_year_limit", 150_000, "SGD", "Annual limit S$150,000"), "Limit of SGD 150,000 a policy year");
  assert.equal(describeScheduleTerm("policy_year_limit", 5_000, "SGD", "Overall limit S$5,000"), "Limit of SGD 5,000");
  assert.equal(describeScheduleTerm("policy_year_limit", 5_000, "SGD", "Overall limit S$5,000 per trip, up to S$20,000 per policy year"), "Limit of SGD 5,000");
  assert.equal(describeScheduleTerm("policy_year_limit", null, null, "Overall limit^ S$300 S$800 S$1,500"), "Limit (see the schedule)");
  assert.equal(describeScheduleTerm("policy_year_limit", 150_000, "SGD"), "Limit of SGD 150,000 a policy year");
});

test("a term printing two different figures in one currency is held unless each carries its own unit; one plan's own limits keep their figure (TE pr361)", async () => {
  const { termFiguresDifferByPlan } = await import("@/lib/insurance/scale-limit");
  const { repairStoredRules } = await import("@/lib/policies/benefit-catalog");
  const term = (id: string, quote: string, value: number) =>
    ({ ...row(id, quote, value), formulaKind: "none" as never, rowKind: "policy_year_limit", benefitName: "Overall limit" });
  const heldQuotes = [
    "Overall limit per insured person per trip: Classic S$200,000 | Elite S$500,000 | Premier S$1,000,000",
    "Overall limit: Plan A S$200,000; Plan B S$500,000",
    "Overall limit S$200,000 | S$500,000 | S$1,000,000",
    "Overall limit S$200,000 (Classic), S$500,000 (Elite)",
    "Annual limit: Silver RM 50,000, Gold RM 100,000",
    "Maximum per trip Standard £5,000 / Superior £10,000",
    "Overall limit Individual S$300; Family S$800",
    "Overall limit Adult S$300; Child S$150",
    "Overall limit: Gold - S$500,000, Silver - S$250,000",
    "Overall limit: silver S$100,000 / gold S$250,000",
    "Overall limit S$200,000 or S$500,000 depending on the plan chosen",
    "Medical expenses up to S$150,000 for Basic and S$300,000 for Premier",
    "Overall limit Classic S$200 per trip | Elite S$500 per trip",
    "Excess: Plan 1: S$100 / Plan 2: S$250",
    "Overall limit S$200,000, or S$500,000 if the injury is caused by an accident",
  ];
  const keptQuotes = [
    "Overall limit S$300 per trip, S$1,500 per year",
    "Overall limit S$300 (per trip), S$1,500 (per year)",
    "Overall limit S$5,000 per trip, up to S$20,000 per policy year",
    "Annual limit S$150,000, of which S$5,000 for outpatient",
    "Room and board S$300 / day, overall S$3,000 per policy year",
    // One family plan's own two limits: each figure says whom it is for.
    "Overall limit S$300 per person, S$800 per family",
    "Overall limit S$200,000 | S$200,000",
    "Overall limit S$500,000",
    "Overall limit S$1,000,000 US$750,000",
  ];
  for (const q of heldQuotes) assert.equal(termFiguresDifferByPlan(q), true, q);
  for (const q of keptQuotes) assert.equal(termFiguresDifferByPlan(q), false, q);
  const out = repairStoredRules([...heldQuotes, ...keptQuotes].map((q, i) => term("q" + i, q, 200_000)) as never) as { formulaValue: number | null }[];
  assert.deepEqual(out.map((b) => b.formulaValue === null), [...heldQuotes.map(() => true), ...keptQuotes.map(() => false)]);
});

test("a benefit row's own sub-items keep their figure; only side-by-side plan cells hold a benefit (Critic R361b M1)", async () => {
  const { repairStoredRules } = await import("@/lib/policies/benefit-catalog");
  const quotes = ["Ward S$300; ICU S$600", "Room & Board S$500; Surgical S$3,000", "Classic S$200 | Elite S$500"];
  const out = repairStoredRules(quotes.map((q, i) => ({ ...row("b" + i, q, 300), rowKind: "benefit" })) as never) as { formulaValue: number | null }[];
  // Benefit rows are judged by side-by-side cells only, as on main; the labelled-plans test is for schedule terms.
  assert.deepEqual(out.map((b) => b.formulaValue), [300, 300, 300]);
});

test("a plan table that prints each benefit's cells, then the line that explains it, binds the row to the household's plan", async () => {
  const { planColumnFigure } = await import("@/lib/insurance/scale-limit");
  const reading = (excerpt: string, amount: number, column: string | null = "Voyager", page = 4) => ({ documentId: "docT", page, excerpt, column, qualifier: null,
    figure: { kind: "printed", amount, currency: "SGD" }, figureText: "up to S$" + amount.toLocaleString("en-SG") });
  // Made-up three-plan travel wordings: a name line, the cells, then the line that says what it pays for (the row is
  // stored as that line then the cells).
  const cases: [string, string, number][] = [
    ["If you need to put off your journey from home", "S$400 S$800 S$1,200", 800],
    ["Paying for a relative to arrange the return of remains", "S$4,000 S$6,000 S$9,000", 6000],
    ["Kennel fees if your return home is delayed", "S$150 S$300 S$450", 300],
    ["Cover for your emergency calls while overseas", "S$200 S$300 S$400", 300],
  ];
  for (const [name, run, amount] of cases) {
    const row = { policyId: "docT", sourcePage: 4, quote: `${name} ${run}`, benefitName: name };
    const cells = run.split(" ").join("\t");
    assert.deepEqual(planColumnFigure(row, [reading(`${cells}\n${name}`, amount)]), { plan: "Voyager", figureText: "up to S$" + amount.toLocaleString("en-SG") }, name);
    // Fails closed: any other words in the excerpt, another line below the cells, another page, the cells of another
    // benefit, or a row with words after its cells.
    for (const [why, readings, at] of [
      ["more words", [reading(`${cells}\n${name}\nTrip delay`, amount)], row],
      ["other line", [reading(`${cells}\nPaying for a family member to visit you in hospital`, amount)], row],
      ["name line too", [reading(`Trip postponement\n${cells}\n${name} and more`, amount)], row],
      ["other page", [reading(`${cells}\n${name}`, amount, "Voyager", 5)], row],
      ["not a cell", [reading(`${cells}\n${name}`, amount + 1)], row],
      ["no column", [reading(`${cells}\n${name}`, amount, null)], row],
      ["words after cells", [reading(`${cells}\n${name}`, amount)], { ...row, quote: `${name} ${run} per trip` }],
      ["two plans", [reading(`${cells}\n${name}`, amount), reading(`${cells}\n${name}`, amount * 1.5, "Nomad")], row],
    ] as [string, ReturnType<typeof reading>[], typeof row][])
      assert.equal(planColumnFigure(at, readings), null, `${name}: ${why}`);
  }
});

test("once the household's plan figure is known, the 'which plan is yours is not shown' note is no longer shown", async () => {
  const { PLAN_COLUMNS_NOTE, conditionsWithPlan } = await import("@/lib/insurance/scale-limit");
  const kept = "Only for a trip booked before the insured event";
  assert.deepEqual(conditionsWithPlan([PLAN_COLUMNS_NOTE, kept], { plan: "Voyager", figureText: "up to S$800" }), [kept]);
  assert.deepEqual(conditionsWithPlan([PLAN_COLUMNS_NOTE, kept], null), [PLAN_COLUMNS_NOTE, kept]);
  assert.deepEqual(conditionsWithPlan([kept], { plan: "Voyager", figureText: "up to S$800" }), [kept]);
  // The Benefits route sends the row's conditions through it.
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../../app/api/benefits/route.ts", import.meta.url), "utf8"), /conditions:conditionsWithPlan\(stub\.conditions,planFigure\)/);
});
