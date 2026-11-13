/** A schedule that prints several covers in one table, and a certificate whose one column of figures is not a plan
 * (test-household run TE-ACC-20261113, defects 3 and 6b). General rules, each tested on several made-up documents in
 * different currencies, layouts and wordings, with negative controls. No model, database or network. The readings are
 * written by hand from each page's own text (a reconstruction of what the reader returns, not a recorded reading).
 *
 *   1. A table row is placed under the cover whose own printed row it is, also when that row's last cell wraps onto the
 *      next line ("... up to 365 days per" / "policy year"), and when the cover was quoted by its label cell alone. A block
 *      of several rows, a label two lives' covers share, or a label followed by more words than a figure, places nothing.
 *   2. A share of another cover's sum named in the row's own words ("100% of the death sum assured") is worked out on the
 *      same person's cover of exactly that name, on the same document, product and policy number. Never another person's,
 *      another policy's (a shared number never joins people), another document's, or one of two same-named covers.
 *   3. A column heading made only of figure words ("Limit per insured person", "Sum assured / amount") is the document's
 *      one column of figures, not a plan, when it is the only column heading the document prints.
 *   4. A row the document says is for each insured person, or a daily or periodic rate it prints once for that benefit,
 *      is every holder's on that document. A lump sum that is no one's own sum, or a rate printed once per life, is no one's.
 *   5. A bare "$" stays a figure with its currency not stated: never dropped, never given a currency.
 *   npm run benefit-table:multi-cover-table-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, figureText, NOT_TOLD_WHY, OWN_LINE_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "dddddddd-0000-4000-8000-000000000001";
const DOC2 = "dddddddd-0000-4000-8000-000000000002";
const page = (id: string, text: string, name = "Schedule.pdf"): SourceDoc => ({ id, name, readable: true, pages: [{ page: 1, text }] });
const reading = (product: string, people: string[], covers: unknown[], benefits: unknown[], plan: string | null = null) =>
  ({ document: { kind: "personal_proof", product, insurer: null, namedPeople: people, plan, periodFrom: null, periodTo: null }, covers, benefits });
const cover = (o: Record<string, unknown>) => ({ plan: null, riderOf: null, policyNumber: "P-1", sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, ...o });
const row = (o: Record<string, unknown>) => ({ section: null, column: null, value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const shown = (t: ReturnType<typeof assembleTable>, i = 0) => t.people[i].rows.map((x) => `${x.cover} | ${x.benefit} | ${figureText(x.figure)}`);
const noLink = (id: string, column: string | null = null) => [{ section: sectionKeyOf(id, { section: null, column }), cover: null, why: "this schedule lists several covers together, so no single cover fits" }];

// ---------------------------------------------------------------- 1. a cover's own row, wrapped or quoted by its label

/** A term-life schedule: three covers in one table, the rider's cell wrapped onto a second line. */
function lifeSchedule(sign: string, riderQuote: "row" | "label") {
  const text = `ACME LIFE TERM PLAN - POLICY SCHEDULE\nPolicy number: P-1\tLife assured: Asha Rao\nBenefit\tSum assured / amount\nDeath\t${sign}300,000\nTotal and permanent disability\t100% of the death sum assured\nHospital income rider\t${sign}100 per day in hospital, up to 365 days per\npolicy year\nThe hospital income rider does not pay for the first 2 days of any hospital stay.`;
  const riderRow = `Hospital income rider\t${sign}100 per day in hospital, up to 365 days per\npolicy year`;
  const r = checkReading(page(DOC, text), reading("ACME LIFE TERM PLAN", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "ACME LIFE TERM PLAN", cover: "Death", sumInsured: 300000, quote: `Death\t${sign}300,000` }),
    cover({ person: "Asha Rao", product: "ACME LIFE TERM PLAN", cover: "Total and permanent disability", quote: "Total and permanent disability\t100% of the death sum assured" }),
    cover({ person: "Asha Rao", product: "ACME LIFE TERM PLAN", cover: "Hospital income rider", riderOf: "ACME LIFE TERM PLAN", quote: riderQuote === "row" ? riderRow : "Hospital income rider" }),
  ], [
    row({ benefit: "Death", pays: "amount", value: 300000, quote: `Death\t${sign}300,000` }),
    row({ benefit: "Total and permanent disability", pays: "percent", value: 100, percentOf: "other", quote: "Total and permanent disability\t100% of the death sum assured" }),
    row({ benefit: "Hospital income rider", pays: "per_day", value: 100, maxDays: 365, quote: riderRow, conditions: ["The hospital income rider does not pay for the first 2 days of any hospital stay."] }),
  ]));
  return r;
}
const asha: FamilyMember[] = [{ id: "a", display_name: "Asha Rao" }, { id: "b", display_name: "Ben Rao" }];

for (const [sign, code] of [["S$", "SGD"], ["RM ", "MYR"], ["A$", "AUD"]] as const) for (const quote of ["row", "label"] as const) {
  test(`${code}, rider quoted by its ${quote}: every cover of a multi-cover table gets its own row, and the table is not unlinked`, () => {
    const r = lifeSchedule(sign, quote);
    assert.equal(r.covers.length, 3, "covers check against the page");
    assert.equal(r.benefits.length, 3, "rows check against the page");
    const t = assembleTable([r], asha, noLink(DOC));
    const rider = t.people[0].rows.find((x) => x.benefit === "Hospital income rider");
    assert.ok(rider, shown(t).join("\n"));
    assert.equal(rider!.cover, "Hospital income rider");
    assert.equal(rider!.linkWhy, OWN_LINE_WHY);
    assert.deepEqual(rider!.figure, { kind: "printed", amount: 100, currency: code, unit: "per_day", period: null });
    assert.deepEqual(t.unlinkedSections, [], "every row was placed");
    assert.deepEqual(t.people[1].rows, [], "never another person's");
  });
}

test("a cover quoted as a block of two printed rows is not one row: it places neither row", () => {
  const text = "POLICY SCHEDULE\nInsured: Asha Rao\nBasic plan\tUSD 200,000\nAccident rider\tUSD 50,000\nEnd.";
  const r = checkReading(page(DOC, text), reading("Basic plan", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Basic plan", cover: "Basic plan", sumInsured: 200000, quote: "Basic plan\tUSD 200,000\nAccident rider\tUSD 50,000" }),
  ], [
    row({ benefit: "Accident rider", pays: "amount", value: 50000, quote: "Accident rider\tUSD 50,000" }),
    row({ benefit: "Basic plan and rider", pays: "words", quote: "Basic plan\tUSD 200,000\nAccident rider\tUSD 50,000" }),
  ]));
  const t = assembleTable([r], asha, noLink(DOC));
  assert.deepEqual(t.people[0].rows, [], shown(t).join("\n"));
  assert.equal(t.unlinkedSections.length, 1, "still said to be unlinked");
});

test("a label two lives' covers share (a joint schedule) places neither life's row by its label", () => {
  const text = "JOINT POLICY SCHEDULE\nPolicy number: P-1\nAsha Rao\nHospital income rider\tGBP 80 per day\nBen Rao\nHospital income rider\tGBP 120 per day\nEnd.";
  const r = checkReading(page(DOC, text), reading("Joint Plan", ["Asha Rao", "Ben Rao"], [
    cover({ person: "Asha Rao", product: "Joint Plan", cover: "Hospital income rider", quote: "Hospital income rider" }),
    cover({ person: "Ben Rao", product: "Joint Plan", cover: "Hospital income rider", quote: "Hospital income rider" }),
  ], [
    row({ benefit: "Hospital income rider", pays: "per_day", value: 80, quote: "Hospital income rider\tGBP 80 per day" }),
    row({ benefit: "Hospital income rider", pays: "per_day", value: 120, quote: "Hospital income rider\tGBP 120 per day" }),
  ]));
  const t = assembleTable([r], asha, noLink(DOC));
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], "no one is shown another life's rate");
});

test("a label followed by more words than a figure ('Death benefit (accidental) ...' under a 'Death' cover) is not that cover's row", () => {
  const text = "SCHEDULE\nInsured: Asha Rao\nDeath\nDeath benefit (accidental only)\tEUR 50,000\nEnd.";
  const r = checkReading(page(DOC, text), reading("Euro Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Euro Life", cover: "Death", quote: "Death" }),
  ], [row({ benefit: "Death benefit (accidental only)", pays: "amount", value: 50000, quote: "Death benefit (accidental only)\tEUR 50,000" })]));
  const t = assembleTable([r], asha, noLink(DOC));
  assert.deepEqual(t.people[0].rows, [], shown(t).join("\n"));
});

// ---------------------------------------------------------------- 2. a share of another named cover's sum

for (const [sign, code] of [["S$", "SGD"], ["RM ", "MYR"], ["A$", "AUD"]] as const) {
  test(`${code}: "100% of the death sum assured" is worked out on the same person's Death cover of the same policy`, () => {
    const t = assembleTable([lifeSchedule(sign, "row")], asha, noLink(DOC));
    const tpd = t.people[0].rows.find((x) => x.benefit === "Total and permanent disability")!;
    assert.equal(tpd.figure.kind, "worked_out", figureText(tpd.figure));
    assert.equal((tpd.figure as { amount: number }).amount, 300000);
    assert.equal((tpd.figure as { currency: string }).currency, code);
    assert.equal(tpd.base, 300000);
    assert.equal(tpd.baseSource?.excerpt.startsWith("Death"), true, "its base cites the Death line");
    assert.equal(tpd.cover, "Total and permanent disability", "the row stays under its own cover");
  });
}

test("a short form in the row ('50% of the TPD sum insured') names the Total and Permanent Disability cover, capped as printed", () => {
  const text = "SCHEDULE\nPolicy number: K-9\tInsured: Asha Rao\nTotal and Permanent Disability\tHKD 400,000\nTerminal illness advance\t50% of the TPD sum insured, up to HKD 150,000\nEnd.";
  const r = checkReading(page(DOC, text), reading("Harbour Protect", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Harbour Protect", cover: "Total and Permanent Disability", policyNumber: "K-9", sumInsured: 400000, quote: "Total and Permanent Disability\tHKD 400,000" }),
    cover({ person: "Asha Rao", product: "Harbour Protect", cover: "Terminal illness advance", policyNumber: "K-9", quote: "Terminal illness advance\t50% of the TPD sum insured, up to HKD 150,000" }),
  ], [row({ benefit: "Terminal illness advance", pays: "percent", value: 50, percentOf: "sum_insured", cap: 150000, capQuote: "up to HKD 150,000", quote: "Terminal illness advance\t50% of the TPD sum insured, up to HKD 150,000" })]));
  const t = assembleTable([r], asha, noLink(DOC));
  const ti = t.people[0].rows.find((x) => x.benefit === "Terminal illness advance")!;
  assert.ok(ti, shown(t).join("\n"));
  assert.equal(ti.figure.kind, "worked_out", figureText(ti.figure));
  assert.equal((ti.figure as { amount: number }).amount, 150000, "50% of HKD 400,000 is more than the HKD 150,000 cap");
});

test("negative controls: another person's, another policy's, another document's, or one of two same-named covers is never the base", () => {
  const text = (pn2: string) => `JOINT SCHEDULE\nPolicy number: P-1\nAsha Rao\tTotal and permanent disability\t100% of the death sum assured\nBen Rao\tDeath\tS$500,000\nPolicy number: ${pn2}\nAsha Rao\tDeath\tS$200,000\nEnd.`;
  // Ben's Death cover is on the same document and policy, but is Ben's; Asha's own Death cover is on another policy number.
  const r = checkReading(page(DOC, text("P-2")), reading("Shared Life", ["Asha Rao", "Ben Rao"], [
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Total and permanent disability", quote: "Asha Rao\tTotal and permanent disability\t100% of the death sum assured" }),
    cover({ person: "Ben Rao", product: "Shared Life", cover: "Death", sumInsured: 500000, quote: "Ben Rao\tDeath\tS$500,000" }),
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Death", policyNumber: "P-2", sumInsured: 200000, quote: "Asha Rao\tDeath\tS$200,000" }),
  ], [row({ benefit: "Total and permanent disability", pays: "percent", value: 100, percentOf: "other", quote: "Asha Rao\tTotal and permanent disability\t100% of the death sum assured" })]));
  const t = assembleTable([r], asha, noLink(DOC));
  const tpd = t.people[0].rows.find((x) => x.benefit === "Total and permanent disability");
  assert.ok(tpd, shown(t).join("\n"));
  assert.equal(tpd!.figure.kind, "none", `never Ben's S$500,000 nor another policy's S$200,000: ${figureText(tpd!.figure)}`);
  assert.ok(!t.people[1].rows.some((x) => x.benefit === "Total and permanent disability"), "never shown for Ben");

  // The Death cover printed on another document: not this row's base.
  const d1 = checkReading(page(DOC, "SCHEDULE\nPolicy number: P-1\tInsured: Asha Rao\nTotal and permanent disability\t100% of the death sum assured\nEnd."), reading("Shared Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Total and permanent disability", quote: "Total and permanent disability\t100% of the death sum assured" }),
  ], [row({ benefit: "Total and permanent disability", pays: "percent", value: 100, percentOf: "other", quote: "Total and permanent disability\t100% of the death sum assured" })]));
  const d2 = checkReading(page(DOC2, "CERTIFICATE\nPolicy number: P-1\tInsured: Asha Rao\nDeath\tS$250,000\nEnd.", "Cert.pdf"), reading("Shared Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Death", sumInsured: 250000, quote: "Death\tS$250,000" }),
  ], []));
  const t2 = assembleTable([d1, d2], asha, noLink(DOC));
  const tpd2 = t2.people[0].rows.find((x) => x.benefit === "Total and permanent disability")!;
  assert.equal(tpd2.figure.kind, "none", figureText(tpd2.figure));

  // Two Death covers for her on the same policy with different sums: which one is not told.
  const two = checkReading(page(DOC, "SCHEDULE\nPolicy number: P-1\tInsured: Asha Rao\nDeath\tS$100,000\nDeath\tS$150,000\nTotal and permanent disability\t100% of the death sum assured\nEnd."), reading("Shared Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Death", sumInsured: 100000, quote: "Death\tS$100,000" }),
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Death", sumInsured: 150000, quote: "Death\tS$150,000" }),
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Total and permanent disability", quote: "Total and permanent disability\t100% of the death sum assured" }),
  ], [row({ benefit: "Total and permanent disability", pays: "percent", value: 100, percentOf: "other", quote: "Total and permanent disability\t100% of the death sum assured" })]));
  const t3 = assembleTable([two], asha, noLink(DOC));
  const tpd3 = t3.people[0].rows.find((x) => x.benefit === "Total and permanent disability")!;
  assert.equal(tpd3.figure.kind, "none", figureText(tpd3.figure));
});

test("a name that is not exactly a cover's ('of the accidental death sum assured' beside a 'Death' cover) gives no amount", () => {
  const text = "SCHEDULE\nPolicy number: P-1\tInsured: Asha Rao\nDeath\tS$300,000\nDismemberment\t50% of the accidental death sum assured\nEnd.";
  const r = checkReading(page(DOC, text), reading("Shared Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Death", sumInsured: 300000, quote: "Death\tS$300,000" }),
    cover({ person: "Asha Rao", product: "Shared Life", cover: "Dismemberment", quote: "Dismemberment\t50% of the accidental death sum assured" }),
  ], [row({ benefit: "Dismemberment", pays: "percent", value: 50, percentOf: "other", quote: "Dismemberment\t50% of the accidental death sum assured" })]));
  const t = assembleTable([r], asha, noLink(DOC));
  const d = t.people[0].rows.find((x) => x.benefit === "Dismemberment")!;
  assert.equal(d.figure.kind, "none", figureText(d.figure));
});

// ---------------------------------------------------------------- 3 and 4. a certificate's one column of figures, for each insured

/** A couple's travel certificate: one column "Limit per insured person", figures in a bare "$". */
function travel(column: string, extraColumn: string | null = null) {
  const text = `ACME TRAVEL - CERTIFICATE\nCertificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)\nBenefit\t${column}${extraColumn ? `\t${extraColumn}` : ""}\nOverseas medical expenses\t$500,000${extraColumn ? "\t$1,000,000" : ""}\nTrip cancellation\t$5,000${extraColumn ? "\t$10,000" : ""}\nEnd.`;
  const c = (person: string) => cover({ person, product: "Acme Travel", cover: "Annual multi-trip travel insurance", plan: "couple plan", policyNumber: "T-5", quote: "Certificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)" });
  const rows = [row({ column, benefit: "Overseas medical expenses", pays: "up_to", value: 500000, quote: `Overseas medical expenses\t$500,000` }),
    row({ column, benefit: "Trip cancellation", pays: "up_to", value: 5000, quote: `Trip cancellation\t$5,000` })];
  if (extraColumn) rows.push(row({ column: extraColumn, benefit: "Trip cancellation", pays: "up_to", value: 10000, quote: `$10,000` }));
  const r = checkReading(page(DOC, text), reading("Acme Travel", ["Asha Rao", "Ben Rao"], [c("Asha Rao"), c("Ben Rao")], rows, "couple plan"));
  const key = coverKeyOf({ product: "Acme Travel", cover: "Annual multi-trip travel insurance", plan: "couple plan" });
  return { r, links: [{ section: sectionKeyOf(DOC, { section: null, column }), cover: key, why: "the certificate's benefits" }] };
}

test("a sole figure column that does not say each insured ('Sum insured / amount') is linked, but its limits are not given to either person by guess", () => {
  const { r, links } = travel("Sum insured / amount");
  const t = assembleTable([r], asha, links);
  assert.deepEqual(t.refusedLinks, [], "not refused as a plan");
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], []);
  assert.equal(t.unlinkedSections[0]?.why, NOT_TOLD_WHY, "said, never dropped silently");
});
for (const column of ["Limit per insured person", "Maximum amount payable each insured person", "Benefit limit per person"]) {
  test(`a sole figure column "${column}" is not a plan: both insured see each limit, its currency not stated`, () => {
    const { r, links } = travel(column);
    const t = assembleTable([r], asha, links);
    assert.deepEqual(t.refusedLinks, []);
    for (const i of [0, 1]) assert.deepEqual(shown(t, i), [
      "Annual multi-trip travel insurance | Overseas medical expenses | up to $500,000 (currency not stated)",
      "Annual multi-trip travel insurance | Trip cancellation | up to $5,000 (currency not stated)",
    ], `person ${i}`);
    for (const x of t.people[0].rows) assert.equal((x.figure as { currency: unknown }).currency, null, "a bare $ is never given a currency");
    assert.deepEqual(t.unlinkedSections, []);
  });
}

test("with a second column on the document ('Limit per family'), the figure columns are not told apart from plans: still refused", () => {
  const { r, links } = travel("Limit per insured person", "Limit per family");
  const t = assembleTable([r], asha, links);
  assert.equal(t.refusedLinks.length, 1, JSON.stringify(t.refusedLinks));
  assert.deepEqual(shown(t, 0), []);
});

test("the same lone figure column in scheme terms or a wording (not the person's own certificate) is still refused for a plan holder", () => {
  const { r, links } = travel("Limit per insured person");
  const terms = { ...r, kind: "scheme_terms" as const, covers: [] };
  const own = checkReading(page(DOC2, "ACME TRAVEL - CERTIFICATE\nCertificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)\nEnd.", "Cert.pdf"), reading("Acme Travel", ["Asha Rao", "Ben Rao"],
    ["Asha Rao", "Ben Rao"].map((person) => cover({ person, product: "Acme Travel", cover: "Annual multi-trip travel insurance", plan: "couple plan", policyNumber: "T-5", quote: "Certificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)" })), [], "couple plan"));
  const t = assembleTable([own, terms], asha, links);
  assert.equal(t.refusedLinks.length, 1, JSON.stringify(t.refusedLinks));
  assert.deepEqual(shown(t, 0), []);
});

test("a plan-like sole column ('Gold') is still refused for a couple plan cover", () => {
  const { r, links } = travel("Gold");
  const t = assembleTable([r], asha, links);
  assert.equal(t.refusedLinks.length, 1);
  assert.deepEqual(shown(t, 0), []);
});

/** A family schedule: each life's sum insured, then one table of benefits for every insured. */
function familySchedule(hospitalLines: string[]) {
  const text = `FAMILY ACCIDENT SCHEDULE\nPolicy number: F-1\nInsured person\tSum Insured\nAsha Rao\tEUR 100,000\nBen Rao\tEUR 80,000\nTABLE OF BENEFITS\n${hospitalLines.join("\n")}\nLump sum for burns\tEUR 7,500\nEnd.`;
  const c = (person: string, sum: number) => cover({ person, product: "Family Accident", cover: "Family accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tEUR ${sum.toLocaleString("en-US")}` });
  const r = checkReading(page(DOC, text), reading("Family Accident", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 100000), c("Ben Rao", 80000)], [
    ...hospitalLines.map((l) => row({ section: "TABLE OF BENEFITS", benefit: "Hospital cash", pays: "per_day", value: Number(/EUR (\d+)/.exec(l)![1]), quote: l })),
    row({ section: "TABLE OF BENEFITS", benefit: "Lump sum for burns", pays: "amount", value: 7500, quote: "Lump sum for burns\tEUR 7,500" }),
  ]));
  return { r, links: [{ section: sectionKeyOf(DOC, { section: "TABLE OF BENEFITS", column: null }), cover: coverKeyOf({ product: "Family Accident", cover: "Family accident", plan: null }), why: "the family table of benefits" }] };
}

test("a daily rate a family schedule prints once, with no word saying it is each insured person's, stays no one's (main's rule from #449); so does a lump sum that is no one's own sum", () => {
  const { r, links } = familySchedule(["Hospital cash\tEUR 50 per day in hospital"]);
  const t = assembleTable([r], asha, links);
  for (const i of [0, 1]) assert.deepEqual(shown(t, i), [], `person ${i}`);
  assert.equal(t.unlinkedSections[0]?.why, NOT_TOLD_WHY, "the lump sum is still said to be no one's");
});

test("a daily rate printed once for each life (two rates, no heading saying whose) is no one's", () => {
  const { r, links } = familySchedule(["Hospital cash\tEUR 50 per day in hospital", "Hospital cash\tEUR 70 per day in hospital"]);
  const t = assembleTable([r], asha, links);
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], []);
});

for (const labels of [["Daily hospital income (Asha Rao)", "Daily hospital income (Ben Rao)"], ["Daily hospital income - Insured", "Daily hospital income - Spouse"], ["Daily hospital income (child)", null],
  ["Daily hospital income Mum", "Daily hospital income Dad"], ["Daily hospital income Life Assured 1", "Daily hospital income Life Assured 2"], ["Daily hospital income Insured A", "Daily hospital income Insured B"],
  ["Daily hospital income AR", "Daily hospital income BR"], ["Hospital cash", "Hospital cash for a child under 18"], ["Hospital cash", "Daily hospital income"]] as [string, string | null][]) {
  test(`TE D1: a rate whose label names a life or role ("${labels[0]}") is never every insured person's`, () => {
    const lines = labels.filter((l): l is string => !!l).map((l, i) => `${l}\tPHP ${i ? 500 : 1000} per day, up to 90 days`);
    const text = `FAMILY PERSONAL ACCIDENT\nPolicy number: F-1\nAsha Rao\tPHP 1,000,000\nBen Rao\tPHP 500,000\nBENEFITS\n${lines.join("\n")}\nEnd.`;
    const c = (person: string, sum: number) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tPHP ${sum.toLocaleString("en-US")}` });
    const r = checkReading(page(DOC, text), reading("Family PA", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 1000000), c("Ben Rao", 500000)],
      lines.map((l, i) => row({ section: "BENEFITS", benefit: l.split("\t")[0], pays: "per_day", value: i ? 500 : 1000, maxDays: 90, quote: l }))));
    const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: null }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
    assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], "no one is shown another life's rate");
  });
}

test("Critic 1: 'per insured person' on two lives' rows with different figures is no one's; 'each insured event' is not 'each insured person'", () => {
  for (const [a, b] of [["GBP 80 per day per insured person", "GBP 120 per day per insured person"], ["GBP 3,000 each insured event", "GBP 5,000 each insured event"]]) {
    const text = `FAMILY SCHEDULE\nPolicy number: F-1\nAsha Rao\tGBP 100,000\nBen Rao\tGBP 80,000\nBENEFITS\nHospital cash\t${a}\nHospital cash\t${b}\nEnd.`;
    const c = (person: string, sum: number) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tGBP ${sum.toLocaleString("en-US")}` });
    const v = (t: string) => Number(/GBP ([\d,]+)/.exec(t)![1].replace(/,/g, ""));
    const r = checkReading(page(DOC, text), reading("Family PA", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 100000), c("Ben Rao", 80000)],
      [a, b].map((x) => row({ section: "BENEFITS", benefit: "Hospital cash", pays: /per day/.test(x) ? "per_day" : "up_to", value: v(x), quote: `Hospital cash\t${x}` }))));
    const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: null }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
    assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], a);
  }
  const once = checkReading(page(DOC, "FAMILY SCHEDULE\nPolicy number: F-1\nAsha Rao\tGBP 100,000\nBen Rao\tGBP 80,000\nBENEFITS\nMedical expenses\tGBP 3,000 each insured event\nEnd."), reading("Family PA", ["Asha Rao", "Ben Rao"],
    [["Asha Rao", 100000], ["Ben Rao", 80000]].map(([person, sum]) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tGBP ${Number(sum).toLocaleString("en-US")}` })),
    [row({ section: "BENEFITS", benefit: "Medical expenses", pays: "up_to", value: 3000, quote: "Medical expenses\tGBP 3,000 each insured event" })]));
  const t1 = assembleTable([once], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: null }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
  assert.deepEqual([...shown(t1, 0), ...shown(t1, 1)], [], "an event limit printed once says nothing about whose");
});

test("Critic 2: one 'Limit per insured person' column under ADULT and CHILD headings is not the sole column; no one sees both limits", () => {
  const text = "ACME TRAVEL - CERTIFICATE\nCertificate number T-5\tInsured: Asha Rao and Ben Rao (family plan)\nADULT\nBenefit\tLimit per insured person\nOverseas medical expenses\t$500,000\nCHILD\nBenefit\tLimit per insured person\nOverseas medical expenses\t$100,000\nEnd.";
  const c = (person: string) => cover({ person, product: "Acme Travel", cover: "Travel", plan: "family plan", policyNumber: "T-5", quote: "Certificate number T-5\tInsured: Asha Rao and Ben Rao (family plan)" });
  const r = checkReading(page(DOC, text), reading("Acme Travel", ["Asha Rao", "Ben Rao"], [c("Asha Rao"), c("Ben Rao")], [
    row({ section: "ADULT", column: "Limit per insured person", benefit: "Overseas medical expenses", pays: "up_to", value: 500000, quote: "Overseas medical expenses\t$500,000" }),
    row({ section: "CHILD", column: "Limit per insured person", benefit: "Overseas medical expenses", pays: "up_to", value: 100000, quote: "Overseas medical expenses\t$100,000" }),
  ], "family plan"));
  const key = coverKeyOf({ product: "Acme Travel", cover: "Travel", plan: "family plan" });
  const t = assembleTable([r], asha, ["ADULT", "CHILD"].map((section) => ({ section: sectionKeyOf(DOC, { section, column: "Limit per insured person" }), cover: key, why: "x" })));
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], []);
});

test("Critic 4: a cover quoted as a block that runs into a row nobody quoted ('Ben Rao Critical illness S$250,000') is not one row", () => {
  const text = "JOINT SCHEDULE\nPolicy number: P-1\nAsha Rao\tCritical illness\tS$100,000\nBen Rao\tCritical illness\tS$250,000\nEnd.";
  const block = "Asha Rao\tCritical illness\tS$100,000\nBen Rao\tCritical illness\tS$250,000";
  const r = checkReading(page(DOC, text), reading("Joint Life", ["Asha Rao", "Ben Rao"], [
    cover({ person: "Asha Rao", product: "Joint Life", cover: "Critical illness", sumInsured: 100000, quote: block }),
  ], [row({ benefit: "Critical illness", pays: "amount", value: 250000, quote: block })]));
  const t = assembleTable([r], asha, noLink(DOC));
  assert.deepEqual(shown(t, 0), [], "never Ben's S$250,000 for Asha");
});

test("Critic 5: a label followed by other words and a number ('Death TPD 50,000') is not a 'Death' cover's row", () => {
  const r = checkReading(page(DOC, "SCHEDULE\nInsured: Asha Rao\nDeath\nDeath TPD 50,000\nEnd."), reading("Life", ["Asha Rao"], [
    cover({ person: "Asha Rao", product: "Life", cover: "Death", quote: "Death" }),
  ], [row({ benefit: "Death TPD", pays: "amount", value: 50000, quote: "Death TPD 50,000" })]));
  assert.deepEqual(shown(assembleTable([r], asha, noLink(DOC))), []);
});

for (const where of ["row", "column"] as const) test(`TE D1-labelled: per-life rates that also say 'per insured person' (in the ${where}) are no one's`, () => {
  for (const [a, b] of [["Mum", "Dad"], ["Life Assured 1", "Life Assured 2"], ["Insured A", "Insured B"], ["AR", "BR"], ["Mother", "Father"], ["First insured", "Second insured"]]) {
    const col = where === "column" ? "Limit per insured person" : null, tail = where === "row" ? " per insured person" : "";
    const lines = [[a, 1000], [b, 500]].map(([x, v]) => `Daily hospital income ${x}\tPHP ${Number(v).toLocaleString("en-US")} per day${tail}`);
    const text = `FAMILY PA\nPolicy number: F-1\nAsha Rao\tPHP 1,000,000\nBen Rao\tPHP 500,000\nBENEFITS\n${lines.join("\n")}\nEnd.`;
    const c = (person: string, sum: number) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tPHP ${sum.toLocaleString("en-US")}` });
    const r = checkReading(page(DOC, text), reading("Family PA", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 1000000), c("Ben Rao", 500000)],
      lines.map((l, i) => row({ section: "BENEFITS", column: col, benefit: l.split("\t")[0], pays: "per_day", value: i ? 500 : 1000, quote: l }))));
    const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: col }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
    assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], `${a}/${b}`);
  }
});

test("Critic O (documented, fails closed): on a 'per insured person' list, rows whose names differ by one word are shown to both when they print the same figure, and to no one when they print different figures", () => {
  const lines = [["Loss of baggage", 3000], ["Loss of passport", 500], ["Personal accident death", 100000], ["Personal accident disablement", 100000], ["Overseas medical expenses", 500000]] as const;
  const text = `ACME TRAVEL - CERTIFICATE\nCertificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)\nBenefit\tLimit per insured person\n${lines.map(([l, v]) => `${l}\t$${v.toLocaleString("en-US")}`).join("\n")}\nEnd.`;
  const c = (person: string) => cover({ person, product: "Acme Travel", cover: "Travel", plan: "couple plan", policyNumber: "T-5", quote: "Certificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)" });
  const col = "Limit per insured person";
  const r = checkReading(page(DOC, text), reading("Acme Travel", ["Asha Rao", "Ben Rao"], [c("Asha Rao"), c("Ben Rao")],
    lines.map(([l, v]) => row({ column: col, benefit: l, pays: "up_to", value: v, quote: `${l}\t$${v.toLocaleString("en-US")}` })), "couple plan"));
  const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: null, column: col }), cover: coverKeyOf({ product: "Acme Travel", cover: "Travel", plan: "couple plan" }), why: "x" }]);
  for (const i of [0, 1]) assert.deepEqual(t.people[i].rows.map((x) => x.benefit), ["Personal accident death", "Personal accident disablement", "Overseas medical expenses"], shown(t, i).join("\n"));
  assert.equal(t.unlinkedSections[0]?.why, NOT_TOLD_WHY, "the two loss rows are said to be withheld, never dropped silently");
});

test("Critic Q, R: a tag of any length before or after a one-word or two-word benefit name ('Mum hospital cash', 'Accident Mum') is one benefit per life", () => {
  for (const [a, b] of [["Mum hospital cash", "Dad hospital cash"], ["Insured A hospital cash", "Insured B hospital cash"], ["Accident Mum", "Accident Dad"], ["Hospitalisation Mum", "Hospitalisation Dad"],
    ["Hospital cash Main Insured", "Hospital cash Joint Life"], ["Hospital cash Account Holder", "Hospital cash Co Applicant"], ["Hospital cash First Life", "Hospital cash Second Insured"],
    ["Hospital cash", "Daily hospital income Dad"]]) {
    const lines = [[a, 80], [b, 120]].map(([x, v]) => `${x}\tGBP ${v} per day per insured person`);
    const text = `FAMILY PA\nPolicy number: F-1\nAsha Rao\tGBP 100,000\nBen Rao\tGBP 80,000\nBENEFITS\n${lines.join("\n")}\nEnd.`;
    const c = (person: string, sum: number) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tGBP ${sum.toLocaleString("en-US")}` });
    const r = checkReading(page(DOC, text), reading("Family PA", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 100000), c("Ben Rao", 80000)],
      lines.map((l, i) => row({ section: "BENEFITS", benefit: l.split("\t")[0], pays: "per_day", value: i ? 120 : 80, quote: l }))));
    const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: null }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
    assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], `${a}/${b}`);
  }
});

test("Critic S: two lives' figures read as different kinds ('up to GBP 3,000' and 'GBP 5,000') are still one benefit per life", () => {
  const lines = ["Medical expenses Main Insured\tup to GBP 3,000 per insured person", "Medical expenses Joint Life\tGBP 5,000 per insured person"];
  const text = `JOINT SCHEDULE\nPolicy number: F-1\nAsha Rao\tGBP 100,000\nBen Rao\tGBP 80,000\nBENEFITS\n${lines.join("\n")}\nEnd.`;
  const c = (person: string, sum: number) => cover({ person, product: "Family PA", cover: "Personal accident", policyNumber: "F-1", sumInsured: sum, quote: `${person}\tGBP ${sum.toLocaleString("en-US")}` });
  const r = checkReading(page(DOC, text), reading("Family PA", ["Asha Rao", "Ben Rao"], [c("Asha Rao", 100000), c("Ben Rao", 80000)], [
    row({ section: "BENEFITS", benefit: "Medical expenses Main Insured", pays: "up_to", value: 3000, quote: lines[0] }),
    row({ section: "BENEFITS", benefit: "Medical expenses Joint Life", pays: "amount", value: 5000, quote: lines[1] }),
  ]));
  const t = assembleTable([r], asha, [{ section: sectionKeyOf(DOC, { section: "BENEFITS", column: null }), cover: coverKeyOf({ product: "Family PA", cover: "Personal accident", plan: null }), why: "x" }]);
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], []);
});

test("Critic M (documented, fails closed): one figure column under two benefit headings is not the sole column, so the link is refused", () => {
  const text = "ACME TRAVEL - CERTIFICATE\nCertificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)\nMEDICAL\nOverseas medical expenses\t$500,000\nTRAVEL\nTrip cancellation\t$5,000\nEnd.";
  const c = (person: string) => cover({ person, product: "Acme Travel", cover: "Travel", plan: "couple plan", policyNumber: "T-5", quote: "Certificate number T-5\tInsured: Asha Rao and Ben Rao (couple plan)" });
  const col = "Limit per insured person";
  const r = checkReading(page(DOC, text), reading("Acme Travel", ["Asha Rao", "Ben Rao"], [c("Asha Rao"), c("Ben Rao")], [
    row({ section: "MEDICAL", column: col, benefit: "Overseas medical expenses", pays: "up_to", value: 500000, quote: "Overseas medical expenses\t$500,000" }),
    row({ section: "TRAVEL", column: col, benefit: "Trip cancellation", pays: "up_to", value: 5000, quote: "Trip cancellation\t$5,000" }),
  ], "couple plan"));
  const key = coverKeyOf({ product: "Acme Travel", cover: "Travel", plan: "couple plan" });
  const t = assembleTable([r], asha, ["MEDICAL", "TRAVEL"].map((section) => ({ section: sectionKeyOf(DOC, { section, column: col }), cover: key, why: "x" })));
  assert.deepEqual([...shown(t, 0), ...shown(t, 1)], [], "hidden, never shown wrongly (as on main)");
});

console.log(`benefit-table multi-cover table: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
