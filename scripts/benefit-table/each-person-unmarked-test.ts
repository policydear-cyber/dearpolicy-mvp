/** A family schedule's plain table row with no forWhom from the reader (TE-ACC-20261115-R4 H1-C: the reader left forWhom
 * out on "5 Hospital cash" and "6 Medical expenses", which R3's reader had marked "each_named_insured", so hospital cash
 * was shown to no one). Whether such a row is each named insured person's now comes only from what the document prints
 * (assemble.ts perPersonRows with plainTable, one policy, no benefit printed twice, each life its own different sum
 * insured, and another row paid as a share of the Sum Insured): the R4 shape (no forWhom) and the R3 shape (forWhom given) give the same
 * figures for every person. Mainly S$ family schedules, with US$ and the R4 GBP schedule as secondary checks; negatives
 * keep main's behaviour: per-person or per-plan columns, a "per insured person" column the reader did not mark, a row
 * naming one person, a "children only" or "main life only" row, a two-policy household (two schedules, and one schedule
 * printing two policies), a cell printing different figures per person, a document-wide child note, a neighbour the reader
 * says is for some, a shared limit, and #464/#466's adversarial matrix with every row left unmarked.
 * Synthetic data only: names, insurers and figures are invented. No model, database or network.
 *   npm run benefit-table:each-person-unmarked-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, figureText, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { BASE_FAMILY, CASES, NAME, build, type Case } from "./per-person-adversarial-cases";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const NOW = new Date("2026-11-15T00:00:00Z");
const DOC_A = "eeeeeeee-0000-4000-8000-00000000e0a1", DOC_B = "eeeeeeee-0000-4000-8000-00000000e0b2";
const FAMILY: FamilyMember[] = [
  { id: "m", display_name: "Mei Lin Tan", date_of_birth: "1985-03-11" } as FamilyMember,
  { id: "w", display_name: "Wei Jie Tan", date_of_birth: "1983-07-22" } as FamilyMember,
  { id: "k", display_name: "Kai Tan", date_of_birth: "2016-09-05" } as FamilyMember,
  { id: "o", display_name: "Ah Kow Tan", date_of_birth: "1950-01-01" } as FamilyMember,
];
const NAMED = ["m", "w", "k"];
/** sym: as printed on the schedule; shown: as the table shows it (never another currency's sign). */
type Money = { sym: string; words: string; shown: string };
const SGD: Money = { sym: "S$", words: "Singapore dollars (SGD)", shown: "S$" }, USD: Money = { sym: "US$", words: "US dollars (USD)", shown: "USD " },
  GBP: Money = { sym: "GBP ", words: "Pounds sterling (GBP)", shown: "GBP " };
const shownAs = (m: Money, n: number) => `${m.shown}${n.toLocaleString("en-US")}`;
const fmt = (m: Money, n: number) => `${m.sym}${n.toLocaleString("en-US")}`;
type Life = { name: string; role: string; dob: string; sum: number };
const LIVES: Life[] = [{ name: "Mei Lin Tan", role: "Policyholder", dob: "11/03/1985", sum: 100000 }, { name: "Wei Jie Tan", role: "Spouse", dob: "22/07/1983", sum: 80000 },
  { name: "Kai Tan", role: "Child", dob: "05/09/2016", sum: 20000 }];

type Row = { n: string; benefit: string; cell: (m: Money) => string; pays: string; value: number; percentOf?: string; cap?: number; capQuote?: (m: Money) => string; fromDay?: number;
  maxDays?: number; conditions?: (m: Money) => string[]; forWhom?: string | null; column?: string | null };
const ROWS: Row[] = [
  { n: "1", benefit: "Accidental death", cell: () => "100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured.", pays: "percent", value: 100, percentOf: "sum_insured",
    conditions: () => ["For an insured child under 18, limited to 25% of the Sum Insured."], forWhom: "some_insured" },
  { n: "2", benefit: "Permanent total disablement", cell: () => "100% of the Sum Insured", pays: "percent", value: 100, percentOf: "sum_insured" },
  { n: "3", benefit: "Fracture of skull, spine or pelvis", cell: () => "5% of the Sum Insured per accident", pays: "percent", value: 5, percentOf: "sum_insured" },
  { n: "4", benefit: "Hospital cash", cell: (m) => `${fmt(m, 50)} per day in hospital, payable from the third consecutive day, up to 30 days per accident`, pays: "per_day", value: 50, fromDay: 3, maxDays: 30,
    conditions: () => ["payable from the third consecutive day, up to 30 days per accident"] },
  { n: "5", benefit: "Medical expenses", cell: (m) => `Up to ${fmt(m, 2500)} per accident, after an excess of ${fmt(m, 100)} per claim`, pays: "up_to", value: 2500,
    conditions: (m) => [`after an excess of ${fmt(m, 100)} per claim`] },
];
const FIXED = ["Hospital cash", "Medical expenses"];
/** R3's reader: the fixed rows marked for each named insured person. R4's reader: left out. */
const mark = (rows: Row[], forWhom: string | null) => rows.map((r) => FIXED.includes(r.benefit) ? { ...r, forWhom } : r);
const withRow = (rows: Row[], benefit: string, change: Partial<Row>) => rows.map((r) => r.benefit === benefit ? { ...r, ...change } : r);

type Opts = { id?: string; money?: Money; rows?: Row[]; header?: string; notes?: string[]; lives?: Life[]; policyOf?: (l: Life) => string; numbered?: "label" | "bare"; printedPolicies?: string[] };
/** A family PA schedule, read by hand from its own page text: page 1 the insured persons, page 2 one table of benefits. */
function schedule(o: Opts = {}) {
  const m = o.money ?? SGD, rows = o.rows ?? ROWS, lives = o.lives ?? LIVES, id = o.id ?? DOC_A;
  const policyOf = o.policyOf ?? (() => "MPA-20417-S");
  const product = "FAMILY PERSONAL ACCIDENT PLAN";
  const policies = o.printedPolicies ?? [...new Set(lives.map(policyOf))];
  const page1 = ["Merlion Mutual Assurance Ltd", `${product} - SCHEDULE`, ...policies.map((p) => `Policy number: ${p}\tPeriod of insurance: 1 March 2026 to 28 February 2027`),
    `Currency of this policy: ${m.words}`, "Insured person\tRelationship\tDate of birth\tSum Insured", ...lives.map((l) => `${l.name}\t${l.role}\t${l.dob}\t${fmt(m, l.sum)}`),
    `Annual premium: ${fmt(m, 312)}.00, payable by monthly direct debit of ${fmt(m, 26)}.00.`].join("\n");
  const lines = rows.map((r) => `${r.n}\t${r.benefit}\t${r.cell(m)}`);
  const page2 = ["TABLE OF BENEFITS", o.header ?? "Section\tBenefit\tAmount payable", ...lines, ...(o.notes ?? []),
    "Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.",
    "How to claim: notify Merlion Mutual within 30 days of the accident and send the completed claim form with the hospital discharge summary."].join("\n");
  const doc: SourceDoc = { id, name: "Family-PA-Schedule-2026.pdf", readable: true, pages: [{ page: 1, text: page1 }, { page: 2, text: page2 }] };
  const section = (r: Row) => (o.numbered ?? "label") === "label" ? `${r.n} ${r.benefit}` : r.n;
  const reading = {
    document: { kind: "personal_proof", product, insurer: "Merlion Mutual Assurance Ltd", namedPeople: lives.map((l) => l.name), plan: null, periodFrom: "1 March 2026", periodTo: "28 February 2027" },
    covers: lives.map((l) => ({ person: l.name, product, cover: "Personal accident", plan: null, riderOf: null, policyNumber: policyOf(l), sumInsured: l.sum, premium: null, premiumFrequency: null,
      asOf: null, startDate: "1 March 2026", endDate: "28 February 2027", page: 1, quote: `${l.name}\t${l.role}\t${l.dob}\t${fmt(m, l.sum)}` })),
    benefits: rows.map((r, i) => ({ section: section(r), column: r.column ?? null, benefit: r.benefit, pays: r.pays, value: r.value, period: null, basis: null, asOf: null, percentOf: r.percentOf ?? null,
      baseAmount: null, baseQuote: null, cap: r.cap ?? null, capQuote: r.capQuote?.(m) ?? null, fromDay: r.fromDay ?? null, maxDays: r.maxDays ?? null, conditions: r.conditions?.(m) ?? [],
      page: 2, quote: lines[i], ...(r.forWhom ? { forWhom: r.forWhom } : {}) })),
  };
  const r = checkReading(doc, reading);
  assert.equal(r.benefits.length, rows.length, `rows check against the page: ${JSON.stringify(r.dropped)}`);
  const key = coverKeyOf({ product, cover: "Personal accident", plan: null });
  const links = [...new Set(r.benefits.map((b) => sectionKeyOf(id, b)))].map((s) => ({ section: s, cover: key, why: "the schedule's table of benefits" }));
  return { r, links };
}
const table = (...docs: ReturnType<typeof schedule>[]) => assembleTable(docs.map((d) => d.r), FAMILY, docs.flatMap((d) => d.links), [], NOW);
type T = ReturnType<typeof table>;
/** Every row each person is shown with a figure, with its first paid day and most days: what must match between readers. */
const everyone = (t: T) => Object.fromEntries(t.people.map((p) => [p.id, p.rows.filter((x) => x.figure.kind !== "none")
  .map((x) => `${x.benefit} | ${figureText(x.figure)}${x.fromDay ? ` | from day ${x.fromDay}` : ""}${x.maxDays ? ` | up to ${x.maxDays} days` : ""}`).sort()]));
const fixedOf = (t: T, id: string) => t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none" && FIXED.some((f) => x.benefit.startsWith(f))).map((x) => `${x.benefit} | ${figureText(x.figure)}`);
const noneFixed = (t: T, what: string) => { for (const id of [...NAMED, "o"]) assert.deepEqual(fixedOf(t, id), [], `${what}: ${id}`); };

// ---------------------------------------------------------------- positives: R4 shape gives what R3 shape gives
for (const [money, label] of [[SGD, "S$"], [USD, "US$"], [GBP, "GBP (R4 schedule shape)"]] as const) {
  for (const numbered of ["label", "bare"] as const) {
    test(`${label}, sections ${numbered === "label" ? "\"4 Hospital cash\"" : "bare numbers"}: hospital cash and medical rows with no forWhom are each named person's, as with forWhom`, () => {
      const r4 = table(schedule({ money, numbered, rows: mark(ROWS, null) })), r3 = table(schedule({ money, numbered, rows: mark(ROWS, "each_named_insured") }));
      assert.deepEqual(everyone(r4), everyone(r3), "the same figures for every person whether or not the reader set forWhom");
      for (const id of NAMED) assert.deepEqual(fixedOf(r4, id), [`Hospital cash | ${shownAs(money, 50)} a day`, `Medical expenses | up to ${shownAs(money, 2500)}`], id);
      const cash = r4.people.find((p) => p.id === "k")!.rows.find((x) => x.benefit === "Hospital cash")!;
      // 5 days in hospital, paid from the third: 3 paid days of 50 = 150 (the figures the chat's day count works from).
      assert.equal(cash.figure.kind === "printed" && cash.figure.unit === "per_day" ? cash.figure.amount : null, 50);
      assert.equal(cash.fromDay, 3);
      assert.equal(cash.maxDays, 30);
      assert.deepEqual(fixedOf(r4, "o"), [], "a household member the schedule does not name gets nothing");
    });
  }
}
test("S$, mixed reader (hospital cash marked, medical expenses not): the same figures as both marked", () => {
  const mixed = table(schedule({ rows: withRow(mark(ROWS, null), "Hospital cash", { forWhom: "each_named_insured" }) }));
  assert.deepEqual(everyone(mixed), everyone(table(schedule({ rows: mark(ROWS, "each_named_insured") }))));
});
test("S$: the shares of each person's own sum are unchanged (each their own worked-out figure)", () => {
  const t = everyone(table(schedule({ rows: mark(ROWS, null) })));
  assert.ok(t.w.some((x) => x.startsWith("Permanent total disablement | S$80,000")), t.w.join("; "));
  assert.ok(t.k.some((x) => x.startsWith("Fracture of skull, spine or pelvis | S$1,000")), t.k.join("; "));
});

// ---------------------------------------------------------------- negatives: any doubt keeps main's behaviour (no one)
for (const [what, forWhom] of [["no forWhom (R4 shape)", null], ["forWhom given (R3 shape)", "each_named_insured"]] as const) {
  const base = mark(ROWS, forWhom);
  const cases: [string, Opts][] = [
    ["per-life columns (Adult / Child)", { header: "Section\tBenefit\tAdult\tChild", rows: base.map((r) => FIXED.includes(r.benefit) ? { ...r, column: "Adult" } : r) }],
    ["a row naming one person", { rows: withRow(withRow(base, "Hospital cash", { benefit: "Hospital cash - Kai Tan" }), "Medical expenses", { benefit: "Medical expenses - Mei Lin Tan" }) }],
    ["a children-only row", { rows: withRow(withRow(base, "Hospital cash", { benefit: "Hospital cash (children only)" }), "Medical expenses", { benefit: "Medical expenses (children only)" }) }],
    ["a main-life-only row", { rows: withRow(withRow(base, "Hospital cash", { benefit: "Hospital cash (main life only)" }), "Medical expenses", { benefit: "Medical expenses (main life only)" }) }],
    ["a cell printing different figures per person", { rows: withRow(withRow(base, "Hospital cash", { cell: (m) => `${fmt(m, 50)} per day in hospital (${fmt(m, 25)} per day for Kai Tan), payable from the third consecutive day, up to 30 days per accident` }),
      "Medical expenses", { cell: (m) => `Up to ${fmt(m, 2500)} / ${fmt(m, 1000)} per accident, after an excess of ${fmt(m, 100)} per claim` }) }],
    ["a cell printing one figure for adults and another for children", { rows: withRow(withRow(base, "Hospital cash", { cell: (m) => `${fmt(m, 50)} per day in hospital (children ${fmt(m, 25)}), payable from the third consecutive day, up to 30 days per accident` }),
      "Medical expenses", { cell: (m) => `Up to ${fmt(m, 2500)} per accident (child ${fmt(m, 1000)}), after an excess of ${fmt(m, 100)} per claim` }) }],
    ["a document-wide child note", { notes: ["Benefits for insured children under 18 are 50% of the amounts shown."] }],
    ["a shared limit line", { notes: ["Limits are per family unless stated otherwise."] }],
    ["a shared limit in the row", { rows: withRow(withRow(base, "Hospital cash", { cell: (m) => `${fmt(m, 50)} per day in hospital for all insured persons together, payable from the third consecutive day, up to 30 days per accident` }),
      "Medical expenses", { cell: (m) => `Up to ${fmt(m, 2500)} per accident per family, after an excess of ${fmt(m, 100)} per claim` }) }],
    ["one schedule printing two policies (Kai on his own policy)", { policyOf: (l) => l.name === "Kai Tan" ? "MPA-20418-S" : "MPA-20417-S" }],
  ];
  for (const [neg, o] of cases) test(`${what}: ${neg} gives no one the fixed rows`, () => noneFixed(table(schedule(o)), neg));
}
test("per-person columns (a column per insured person): Kai's column is his alone, with or without forWhom, never Mei Lin's or Wei Jie's", () => {
  const opts = (forWhom: string | null): Opts => ({ header: "Section\tBenefit\tMei Lin Tan\tWei Jie Tan\tKai Tan", rows: mark(ROWS, forWhom).map((r) => FIXED.includes(r.benefit) ? { ...r, column: "Kai Tan" } : r) });
  const r4 = table(schedule(opts(null))), r3 = table(schedule(opts("each_named_insured")));
  assert.deepEqual(everyone(r4), everyone(r3));
  for (const id of ["m", "w", "o"]) assert.deepEqual(fixedOf(r4, id), [], id);
});
test("no forWhom: a neighbour row the reader says is for some (\"Child hospital top-up\") keeps hospital cash from everyone", () => {
  const rows = [...mark(ROWS, null), { n: "6", benefit: "Hospital cash top-up", cell: (m: Money) => `${fmt(m, 25)} per day in hospital`, pays: "per_day", value: 25, forWhom: "some_insured" }];
  const t = table(schedule({ rows }));
  for (const id of [...NAMED, "o"]) assert.deepEqual(fixedOf(t, id).filter((x) => x.startsWith("Hospital cash |")), [], id);
});
test("no forWhom: a benefit printed twice at two figures with no heading saying whose (S$50 and S$30 hospital cash) keeps every fixed row from everyone", () => {
  const rows = [...mark(ROWS, null), { n: "6", benefit: "Hospital cash", cell: (m: Money) => `${fmt(m, 30)} per day in hospital`, pays: "per_day", value: 30 }];
  noneFixed(table(schedule({ rows })), "printed per life");
});
test("no forWhom: \"Hospital cash for an insured child S$25 per day\" printed away from the S$50 row keeps hospital cash from everyone", () => {
  const rows = [{ n: "0", benefit: "Hospital cash for an insured child", cell: (m: Money) => `${fmt(m, 25)} per day in hospital`, pays: "per_day", value: 25 }, ...mark(ROWS, null)];
  const t = table(schedule({ rows }));
  for (const id of [...NAMED, "o"]) assert.deepEqual(fixedOf(t, id).filter((x) => x.startsWith("Hospital cash")), [], id);
});
test("no forWhom: a table with no row paid as a share of the Sum Insured gives no proof it is read per person: no one (main's #449 rule), while the reader's mark still gives it", () => {
  const rows = ROWS.filter((r) => r.pays !== "percent");
  noneFixed(table(schedule({ rows: mark(rows, null) })), "no share row");
  for (const id of NAMED) assert.equal(fixedOf(table(schedule({ rows: mark(rows, "each_named_insured") })), id).length, 2, id);
});
test("no forWhom: the only share-of-sum row is one the reader says is for some (a child limit on its line): no one", () => {
  const rows = ROWS.filter((r) => r.pays !== "percent" || r.forWhom === "some_insured");
  noneFixed(table(schedule({ rows: mark(rows, null) })), "share row for some");
});
test("no forWhom: every life printing the same sum insured (one sum shared, as on a joint-life schedule) gives no one the fixed rows", () => {
  noneFixed(table(schedule({ rows: mark(ROWS, null), lives: LIVES.map((l) => ({ ...l, sum: 100000 })) })), "same sums");
});
test("forWhom some_insured on the fixed rows still gives no one the figure (the reader's own doubt)", () => {
  noneFixed(table(schedule({ rows: mark(ROWS, "some_insured") })), "some_insured");
});
test("no forWhom: a \"Limit per insured person\" column the reader did not mark keeps main's behaviour (no one): only a plain table is read without the mark", () => {
  const rows = mark(ROWS, null).map((r) => FIXED.includes(r.benefit) ? { ...r, column: "Limit per insured person" } : r);
  noneFixed(table(schedule({ header: "Section\tBenefit\tLimit per insured person", rows })), "per-person column, unmarked");
});
test("no forWhom: a two-policy household (Mei Lin and Wei Jie on one schedule, Kai on his own at S$30 a day) gives each schedule's figure to its own lives only", () => {
  const adults = schedule({ id: DOC_A, rows: mark(ROWS, null), lives: LIVES.slice(0, 2) });
  const child = schedule({ id: DOC_B, rows: withRow(mark(ROWS, null), "Hospital cash", { cell: (m) => `${fmt(m, 30)} per day in hospital, payable from the third consecutive day, up to 30 days per accident`, value: 30 }),
    lives: LIVES.slice(2), policyOf: () => "MPA-99001-S" });
  const t = table(adults, child);
  for (const id of ["m", "w"]) assert.ok(!fixedOf(t, id).some((x) => x.includes("S$30")), `${id}: ${fixedOf(t, id).join("; ")}`);
  assert.ok(!fixedOf(t, "k").some((x) => x.includes("S$50")), `k: ${fixedOf(t, "k").join("; ")}`);
  assert.deepEqual(fixedOf(t, "o"), []);
  // Each adult's S$50 comes from their own two-life schedule, exactly as with forWhom given.
  const marked = table(schedule({ id: DOC_A, rows: mark(ROWS, "each_named_insured"), lives: LIVES.slice(0, 2) }), schedule({ id: DOC_B,
    rows: withRow(mark(ROWS, "each_named_insured"), "Hospital cash", { cell: (m) => `${fmt(m, 30)} per day in hospital, payable from the third consecutive day, up to 30 days per accident`, value: 30 }), lives: LIVES.slice(2), policyOf: () => "MPA-99001-S" }));
  assert.deepEqual(everyone(t), everyone(marked));
});

// ---------------------------------------------------------------- #464/#466's adversarial matrix with every row unmarked
/** Each adversarial certificate with every row's forWhom left out, with and (stripped) without its column heading. UNSAFE:
 * someone shown a figure the case does not give them. */
function unsafe(k: Case, strip: boolean): string[] {
  const readings = k.docs.map((d) => {
    const doc = strip ? { ...d, text: d.text.replace(/^Benefit\t.*$/m, "Benefit\tAmount payable"), rows: d.rows.map((x) => ({ ...x, column: null })) } : d;
    const { r, links } = build(doc);
    for (const b of r.benefits) delete b.forWhom;
    return { r, links };
  });
  const t = assembleTable(readings.map((x) => x.r), k.family ?? BASE_FAMILY, readings.flatMap((x) => x.links), [], NOW);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const skipPeople = new Set((k.safeOnly ?? []).filter((s) => s in NAME)), skipRows = new Set((k.safeOnly ?? []).filter((s) => !(s in NAME)).map(norm));
  const printed = new Map(k.docs.flatMap((d) => d.rows.map((r) => [norm(r.benefit), r.value] as const)));
  const firstNumber = (s: string) => { const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  const out: string[] = [];
  for (const p of t.people) {
    if (skipPeople.has(p.id)) continue;
    const exp = k.expect[p.id] ?? [];
    for (const x of p.rows.filter((y) => y.figure.kind !== "none")) {
      if (skipRows.has(norm(x.benefit))) continue;
      const ok = exp.some((e) => { const [name, fig] = e.split("="); const want = fig ? firstNumber(fig) : printed.get(norm(name)) ?? null;
        return norm(name) === norm(x.benefit) && want != null && firstNumber(figureText(x.figure)) === want; });
      if (!ok) out.push(`${p.id} got ${x.benefit}=${figureText(x.figure)}`);
    }
  }
  return out;
}
const COLUMN_ONLY = new Set(["N15", "N27", "N28"]);
for (const k of CASES) {
  test(`adversarial ${k.id} (${k.what}), every row unmarked: no one is shown another's figure`, () => assert.deepEqual(unsafe(k, false), []));
  if (!COLUMN_ONLY.has(k.id)) test(`adversarial ${k.id} (${k.what}) as a plain table, every row unmarked: no one is shown another's figure`, () => assert.deepEqual(unsafe(k, true), []));
}

console.log(`each-person-unmarked-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
