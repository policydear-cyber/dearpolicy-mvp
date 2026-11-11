/** A percentage row is worked out only on the base its own row names, and only under a cap in the same currency.
 * Made-up policies in SGD, MYR, GBP and USD; no model, no network. (Critic audit of 5c1075d7, A1 and A2.) */
import assert from "node:assert/strict";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

async function main() {
  const { checkReading } = await import("@/lib/benefit-table/check");
  const { assembleTable, coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  type Doc = Parameters<typeof checkReading>[0];
  const family = [{ id: "p1", display_name: "Jane Doe" }];
  const row = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "percent", value: null, percentOf: "sum_insured", baseAmount: null, baseQuote: null,
    cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 7, ...o });
  const table = (o: { cover: string; sum: number; sumText: string; lines: string[]; benefits: Record<string, unknown>[]; riderOf?: string }) => {
    const sched: Doc = { id: "s1", name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: `POLICY SCHEDULE\n${o.cover}\nJane Doe\t${o.sumText}` }] };
    const terms: Doc = { id: "t1", name: "Benefits.pdf", readable: true, pages: [{ page: 7, text: o.lines.join("\n") }] };
    const cover = { person: "Jane Doe", product: "Prod", cover: o.cover, plan: null, riderOf: o.riderOf ?? null, policyNumber: null, sumInsured: o.sum, premium: null, premiumFrequency: null,
      asOf: null, startDate: null, endDate: null, page: 1, quote: `Jane Doe\t${o.sumText}` };
    const meta = { kind: "personal_proof", product: "Prod", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null };
    const a = checkReading(sched, { document: meta, covers: [cover], benefits: [] } as never);
    const b = checkReading(terms, { document: { ...meta, kind: "scheme_terms" }, covers: [], benefits: o.benefits.map((x) => row({ section: o.cover, ...x })) } as never);
    return assembleTable([a, b], family, [{ section: sectionKeyOf("t1", { section: o.cover, column: null }), cover: coverKeyOf({ product: "Prod", cover: o.cover, plan: null, riderOf: o.riderOf ?? null }), why: "x" }])
      .people.flatMap((p) => p.rows);
  };
  const one = (cover: string, sum: number, sumText: string, line: string, b: Record<string, unknown>) => {
    const rows = table({ cover, sum, sumText, lines: [cover, line], benefits: [{ quote: line, ...b }] });
    assert.equal(rows.length, 1, `one row for ${line}`);
    return rows[0];
  };
  let passed = 0;
  const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok ${name}`); };

  for (const [base, line] of [
    ["the Death Benefit", "Terminal illness\t50% of the Death Benefit"],
    ["the annual premium", "Premium refund\t10% of the annual premium"],
    ["the Account Value", "Partial withdrawal\t20% of the Account Value"],
    ["Fund Value", "Loyalty bonus\t2% of Fund Value"],
    ["the Fracture Benefit", "Broken bones\t50% of the Fracture Benefit"],
    ["no 'of', premium", "Premium refund\t10% annual premium"],
    ["no 'of', Basic Premium", "Bonus\t10% Basic Premium"],
    ["no 'of', single premium", "Bonus\t5% single premium"],
    ["no 'of', Initial Investment Amount", "Bonus\t5% Initial Investment Amount"],
    ["'on' the premium paid", "Refund\t10% on the premium paid"],
    ["total premiums paid", "Maturity\t105% of total premiums paid"],
    ["a wrapped 'of' line", "Refund\t10%\nof the annual premium"],
    ["a bracketed base", "Refund\t10% (annual premium)"],
    ["a bracketed 'of' base", "Refund\t10% (of the annual premium)"],
    ["a dash, then a base", "Refund\t10% - annual premium"],
    ["a colon, then a base", "Refund\t10%: annual premium"],
    ["'and', then another benefit", "Refund\t10% and premium refund"],
  ] as const) test(`A1: a share of ${base} read as of the sum insured gets no amount; the row keeps its words`, () => {
    const value = Number(line.match(/(\d+)%/)![1]);
    const r = one("Life Cover", 200000, "S$200,000", line, { benefit: line.split("\t")[0], value });
    assert.equal(r.figure.kind, "none");
    assert.doesNotMatch(JSON.stringify(r.figure), /200,000|20,000|40,000|100,000/);
  });
  for (const [cur, sumText, sum, line, expect] of [
    ["SGD", "S$200,000", 200000, "Terminal illness\t50% of Sum Insured", 100000],
    ["SGD", "S$200,000", 200000, "Terminal illness\t50% of the Basic Sum Assured", 100000],
    ["SGD", "S$200,000", 200000, "Angioplasty\t10% of Prevailing Insured Amount, up to $25,000", 20000],
    ["SGD", "S$200,000", 200000, "Terminal illness\t50% Sum Insured", 100000],
    ["MYR", "RM100,000", 100000, "Hilang upaya\t25% daripada Jumlah Diinsuranskan", 25000],
    ["GBP", "£80,000", 80000, "Loss of one eye\t50% of the sum insured", 40000],
    ["SGD", "S$200,000", 200000, "Terminal illness\t25% of S.I.", 50000],
    ["SGD", "S$200,000", 200000, "Terminal illness\t100% (one hundred per cent) of the Sum Assured", 200000],
    ["SGD", "S$200,000", 200000, "Hospital cash\t1% per day", 2000],
    ["SGD", "S$200,000", 200000, "Burns\t50%", 100000],
    ["SGD", "S$200,000", 200000, "Terminal illness\t50% - Sum Insured", 100000],
    ["SGD", "S$200,000", 200000, "Angioplasty\t10%, up to $25,000", 20000],
  ] as const) test(`control (${cur}): ${line.split("\t")[1]} is still worked out on the sum insured`, () => {
    const value = Number(line.match(/(\d+)%/)![1]);
    const r = one("Main Cover", sum, sumText, line, { benefit: line.split("\t")[0], value, ...(/up to/.test(line) ? { cap: 25000, capQuote: "up to $25,000" } : {}) });
    assert.equal(r.figure.kind, "worked_out", JSON.stringify(r.figure));
    assert.equal((r.figure as { amount: number }).amount, expect);
  });
  test("A2: a cap printed in S$ under a US$ sum insured gets no amount; the share and its cap stay as printed", () => {
    const line = "Angioplasty\t10% of Sum Insured, up to S$15,000";
    const r = one("Critical Cover", 100000, "US$100,000", line, { benefit: "Angioplasty", value: 10, cap: 15000, capQuote: "up to S$15,000" });
    assert.equal(r.figure.kind, "none");
    assert.doesNotMatch(JSON.stringify(r.figure), /USD 10,000|US\$10,000/);
    assert.match(JSON.stringify(r.figure), /S\$15,000/);
  });
  test("B2: a bare $ cap on a page that declares US dollars, under a S$ sum insured, gets no amount", () => {
    const line = "Angioplasty\t10% of Sum Insured, up to $15,000";
    const rows = table({ cover: "Crit", sum: 100000, sumText: "S$100,000", lines: ["All amounts are in US dollars", "Crit", line],
      benefits: [{ benefit: "Angioplasty", value: 10, cap: 15000, capQuote: "up to $15,000", quote: line }] });
    assert.equal(rows[0].figure.kind, "none");
  });
  test("B2 control: a bare $ cap under a S$ sum insured, on a page that declares nothing, still limits the amount", () => {
    const line = "Angioplasty\t10% of Sum Insured, up to $5,000";
    const r = one("Crit", 100000, "S$100,000", line, { benefit: "Angioplasty", value: 10, cap: 5000, capQuote: "up to $5,000" });
    assert.equal(r.figure.kind, "worked_out");
    assert.equal((r.figure as { amount: number }).amount, 5000);
  });
  test("a rider's share of the basic plan's sum assured is not worked out on the rider's own sum", () => {
    const line = "Early CI\t20% of the Basic Plan Sum Assured";
    const rows = table({ cover: "Early CI Rider", sum: 50000, sumText: "S$50,000", lines: ["Early CI Rider", line], riderOf: "Life Plan",
      benefits: [{ benefit: "Early CI", value: 20, quote: line }] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].figure.kind, "none");
    assert.doesNotMatch(JSON.stringify(rows[0].figure), /10,000/);
  });
  test("A2 control: a cap in the same currency still limits the amount", () => {
    const line = "Angioplasty\t10% of Sum Insured, up to US$5,000";
    const r = one("Critical Cover", 100000, "US$100,000", line, { benefit: "Angioplasty", value: 10, cap: 5000, capQuote: "up to US$5,000" });
    assert.equal(r.figure.kind, "worked_out");
    assert.equal((r.figure as { amount: number }).amount, 5000);
  });
  test("A2 control: an RM cap under an RM sum insured still limits the amount", () => {
    const line = "Angioplasty\t10% of Sum Insured, up to RM8,000";
    const r = one("Critical Cover", 100000, "RM100,000", line, { benefit: "Angioplasty", value: 10, cap: 8000, capQuote: "up to RM8,000" });
    assert.equal(r.figure.kind, "worked_out");
    assert.equal((r.figure as { amount: number }).amount, 8000);
  });
  test("a fixed base printed on another page keeps the row with its share and no amount", () => {
    const line = "Broken bones\t50% of the Fracture Benefit";
    const r = one("PA Cover", 100000, "S$100,000", line, { benefit: "Broken bones", value: 50, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Fracture Benefit S$5,000" });
    assert.equal(r.figure.kind, "none");
    assert.doesNotMatch(JSON.stringify(r.figure), /2,500|50,000/);
  });
  test("a quote holding two percentages keeps the row with no figure, and the next row keeps its own", () => {
    const l1 = "Hospital income\t1% of Sum Insured per day, maximum 30% of Sum Insured per year", l2 = "Death\t100% of Sum Insured";
    const rows = table({ cover: "Hospital Cover", sum: 100000, sumText: "S$100,000", lines: ["Hospital Cover", l1, l2],
      benefits: [{ benefit: "Hospital income", value: 1, quote: l1 }, { benefit: "Death", value: 100, quote: l2 }] });
    const hi = rows.find((r) => r.benefit === "Hospital income")!, death = rows.find((r) => r.benefit === "Death")!;
    assert.equal(hi.figure.kind, "none");
    assert.doesNotMatch(JSON.stringify(hi.figure), /1,000|30,000/);
    assert.equal(death.figure.kind, "worked_out");
    assert.equal((death.figure as { amount: number }).amount, 100000);
  });
  console.log(`benefit-table percent base: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
