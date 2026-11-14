/** A family schedule's one plain table of benefits ("Section | Benefit | Amount payable", below an insured persons table)
 * gives each named insured person its fixed-amount rows when nothing on the document says the amount differs by person
 * (TE-ACC-20261113: a family PA schedule's "5 Hospital cash GBP 50 per day ..." and "6 Medical expenses Up to GBP 2,500 ..."
 * were shown for no one). One general rule (assemble.ts perPersonRows, plainTable), tested on made-up schedules with
 * negative controls: a document-wide child note, a table with a column per plan, a row naming a child or a person, a row
 * printing an age, a premium, a figure equal to one person's sum insured, a reader that does not mark the row, a different
 * cover for one life, and the per-person adversarial matrix of #464/#466 with every row marked for every named person by a
 * careless reader (with and without its column heading), and every repro of the TE gate on 4a8af1a5 (plain-table-gate.md:
 * shared limits, footnotes, premium-like rows, benign lines on a per-person certificate). And the chat: an amount the model gives for a row withheld that
 * way is said to be printed, with its document and page, never "I left out an amount I couldn't find printed".
 * No model, database or network: the readings are written by hand
 * from each page's own text.
 *   npm run benefit-table:plain-table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qualifierText } from "@/lib/benefit-table/headline";
import { assembleTable, coverKeyOf, figureText, NOT_TOLD_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { checkStored } from "@/lib/benefit-table/service";
import { amountsFromRows, chatRows, noteLeftOutAmounts, renderTable, withheldNote, withheldRows } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT } from "@/lib/simple-chat/verify";
import { BASE_FAMILY, CASES, NAME, NOW, build, type Case } from "./per-person-adversarial-cases";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-0000000000f1";
const PRODUCT = "FAMILY PERSONAL ACCIDENT POLICY";
const FAMILY: FamilyMember[] = [
  { id: "n", display_name: "Ngozi Okafor", date_of_birth: "1984-06-14" } as FamilyMember,
  { id: "d", display_name: "Daniel Okafor", date_of_birth: "1982-11-02" } as FamilyMember,
  { id: "g", display_name: "Grace Okafor", date_of_birth: "2017-04-09" } as FamilyMember,
  { id: "o", display_name: "Olu Okafor", date_of_birth: "1950-01-01" } as FamilyMember,
];
const PAGE1 = (lives: [string, string, string, string][]) => ["Harbourline Assurance plc", `${PRODUCT} - SCHEDULE`,
  "Policy number: HPA-55120-K\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency", "of this policy: Pounds sterling (GBP)",
  "Insured person\tRelationship\tDate of birth\tSum Insured", ...lives.map((l) => l.join("\t")),
  "Annual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00."].join("\n");
const LIVES: [string, string, string, string][] = [["Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000"], ["Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000"], ["Grace Okafor", "Child", "09/04/2017", "GBP 20,000"]];
const SUMS: Record<string, number> = { "Ngozi Okafor": 100000, "Daniel Okafor": 80000, "Grace Okafor": 20000 };

type Row = { n: string; benefit: string; cell: string; pays: string; value: number; percentOf?: string; cap?: number; capQuote?: string; fromDay?: number; maxDays?: number;
  conditions?: string[]; forWhom?: string | null; column?: string | null; section?: string };
/** The printed rows of the TE schedule's table, with the marks the reading prompt asks for. */
const ROWS: Row[] = [
  { n: "1", benefit: "Accidental death", cell: "100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured.", pays: "percent", value: 100, percentOf: "sum_insured",
    conditions: ["For an insured child under 18, limited to 25% of the Sum Insured."], forWhom: "some_insured" },
  { n: "2", benefit: "Permanent total disablement", cell: "100% of the Sum Insured", pays: "percent", value: 100, percentOf: "sum_insured" },
  { n: "3", benefit: "Fracture of arm, wrist or leg", cell: "2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)", pays: "percent", value: 2, percentOf: "sum_insured",
    cap: 1500, capQuote: "maximum GBP 1,500 per accident", conditions: ["Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident."] },
  { n: "4", benefit: "Fracture of skull, spine or pelvis", cell: "5% of the Sum Insured per accident", pays: "percent", value: 5, percentOf: "sum_insured" },
  { n: "5", benefit: "Hospital cash", cell: "GBP 50 per day in hospital, payable from the third consecutive day, up to 30 days per accident", pays: "per_day", value: 50, fromDay: 3, maxDays: 30,
    conditions: ["payable from the third consecutive day, up to 30 days per accident"], forWhom: "each_named_insured" },
  { n: "6", benefit: "Medical expenses", cell: "Up to GBP 2,500 per accident, after an excess of GBP 100 per claim", pays: "up_to", value: 2500, conditions: ["after an excess of GBP 100 per claim"], forWhom: "each_named_insured" },
];
const NOTE_A = ["Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500", "maximum per accident."];
const TAIL = ["Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.", "How to claim: notify Harbourline Assurance within 30 days of the accident on 0800 000 0000",
  "(claims line) and send the completed claim form with the original hospital discharge summary."];

/** The schedule, read by hand: page 1 the insured persons, page 2 the table. `rows` replace the table's rows; `header` its
 * header line; `notes` lines printed after the table (before note (a)); `covers` the cover each life holds. */
function schedule(o: { rows?: Row[]; header?: string; notes?: string[]; pre?: string[]; post?: string[]; extraBenefits?: Record<string, unknown>[]; lives?: [string, string, string, string][]; coverOf?: (person: string) => string } = {}) {
  const rows = o.rows ?? ROWS, lives = o.lives ?? LIVES;
  const lines = rows.map((r) => `${r.n}\t${r.benefit}\t${r.cell}`);
  const page2 = ["TABLE OF BENEFITS (all amounts in GBP)", ...(o.pre ?? []), o.header ?? "Section\tBenefit\tAmount payable", ...lines, ...(o.notes ?? []), ...NOTE_A, ...TAIL, ...(o.post ?? [])].join("\n");
  const doc: SourceDoc = { id: DOC, name: "Harbourline-Family-PA-Schedule-2026.pdf", readable: true, pages: [{ page: 1, text: PAGE1(lives) }, { page: 2, text: page2 }] };
  const coverOf = o.coverOf ?? (() => "Personal accident");
  const reading = {
    document: { kind: "personal_proof", product: PRODUCT, insurer: "Harbourline Assurance plc", namedPeople: lives.map((l) => l[0]), plan: null, periodFrom: "1 March 2026", periodTo: "28 February 2027" },
    covers: lives.map((l) => ({ person: l[0], product: PRODUCT, cover: coverOf(l[0]), plan: null, riderOf: null, policyNumber: "HPA-55120-K", sumInsured: SUMS[l[0]] ?? Number(l[3].replace(/\D/g, "")),
      premium: null, premiumFrequency: null, asOf: null, startDate: "1 March 2026", endDate: "28 February 2027", page: 1, quote: l.join("\t") })),
    benefits: rows.map((r, i) => ({ section: r.section ?? r.n, column: r.column ?? null, benefit: r.benefit, pays: r.pays, value: r.value, period: null, basis: null, asOf: null,
      percentOf: r.percentOf ?? null, baseAmount: null, baseQuote: null, cap: r.cap ?? null, capQuote: r.capQuote ?? null, fromDay: r.fromDay ?? null, maxDays: r.maxDays ?? null,
      conditions: r.conditions ?? [], page: 2, quote: lines[i], ...(r.forWhom ? { forWhom: r.forWhom } : {}) })).concat((o.extraBenefits ?? []) as never[]),
  };
  const r = checkReading(doc, reading);
  assert.equal(r.benefits.length, rows.length + (o.extraBenefits ?? []).length, `rows check against the page: ${JSON.stringify(r.dropped)}`);
  const keys = [...new Set(lives.map((l) => coverKeyOf({ product: PRODUCT, cover: coverOf(l[0]), plan: null })))];
  const links = [...new Set(r.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: keys[0], why: "the schedule's table of benefits" }));
  return { r, table: assembleTable([r], FAMILY, links, [], NOW) };
}
const shown = (t: ReturnType<typeof assembleTable>, id: string, benefit?: string) =>
  t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none" && (!benefit || x.benefit === benefit)).map((x) => `${x.benefit} | ${figureText(x.figure)}`);
const FIXED = ["Hospital cash", "Medical expenses"];
const fixedShown = (t: ReturnType<typeof assembleTable>, id: string) => FIXED.flatMap((b) => shown(t, id, b));
const NAMED = ["n", "d", "g"];
const noneFixed = (t: ReturnType<typeof assembleTable>, what: string) => { for (const id of [...NAMED, "o"]) assert.deepEqual(fixedShown(t, id), [], `${what}: ${id}`); };
const withRow = (n: string, change: Partial<Row>) => ROWS.map((r) => r.n === n ? { ...r, ...change } : r);

// ---------------------------------------------------------------- the TE schedule: each named person gets the fixed rows
test("the TE family PA schedule: each of the three named insured gets hospital cash GBP 50 a day and medical expenses up to GBP 2,500", () => {
  const { r, table } = schedule();
  assert.deepEqual(r.lifeNotes, [], "no note off a row's own line names a kind of life (row 1's child limit is on its own line)");
  for (const id of NAMED) {
    assert.deepEqual(fixedShown(table, id), ["Hospital cash | GBP 50 a day", "Medical expenses | up to GBP 2,500"], id);
    const cash = table.people.find((p) => p.id === id)!.rows.find((x) => x.benefit === "Hospital cash")!;
    assert.equal(cash.fromDay, 3, `${id}: first paid day kept`);
    assert.equal(cash.maxDays, 30, `${id}: most days kept`);
    assert.deepEqual(cash.conditions, ["payable from the third consecutive day, up to 30 days per accident"], `${id}: conditions kept`);
    assert.deepEqual(table.people.find((p) => p.id === id)!.rows.find((x) => x.benefit === "Medical expenses")!.conditions, ["after an excess of GBP 100 per claim"]);
  }
  assert.deepEqual(table.people.find((p) => p.id === "o")!.rows, [], "a household member the schedule does not name gets nothing");
  assert.ok(!table.unlinkedSections.some((u) => u.why === NOT_TOLD_WHY), JSON.stringify(table.unlinkedSections.map((u) => u.section.section)));
  // The shares of each person's own sum are still each person's own (unchanged).
  assert.ok(shown(table, "d", "Permanent total disablement")[0]?.startsWith("Permanent total disablement | GBP 80,000, worked out: 100% of GBP 80,000"), shown(table, "d").join("; "));
  assert.ok(shown(table, "g", "Fracture of skull, spine or pelvis")[0]?.startsWith("Fracture of skull, spine or pelvis | GBP 1,000, worked out: 5% of GBP 20,000"), shown(table, "g").join("; "));
});
test("the same schedule with its rows read under a \"Section 5\" heading and the number printed as the row's first cell: still shown", () => {
  const { table } = schedule({ rows: ROWS.map((r) => ({ ...r, section: `Section ${r.n}` })) });
  for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, `${id}: ${fixedShown(table, id).join("; ")}`);
});
test("each figure only once: a row whose own section number is printed again elsewhere in it is withheld (\"5 ... 5 days\")", () => {
  const { table } = schedule({ rows: withRow("5", { cell: "GBP 50 per day in hospital, after 5 days, up to 30 days per accident", fromDay: undefined, conditions: [] }) });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], id);
});

// ---------------------------------------------------------------- negative controls
for (const note of ["All benefits for a child are halved.", "Benefits for children under 18 are 50% of the amounts shown.", "Note: for an insured person aged 70 or over, the amounts are halved.",
  "Benefits for insured persons under 18 are half the amounts shown.", "Insured persons over seventy receive half the amounts shown."]) {
  test(`a document-wide note ("${note}") withholds every fixed-amount row from everyone, with the reason`, () => {
    const { r, table } = schedule({ notes: [note] });
    assert.deepEqual(r.lifeNotes, [note]);
    noneFixed(table, note);
    assert.ok(table.unlinkedSections.some((u) => u.why === NOT_TOLD_WHY && u.section.section === "5"));
  });
}
test("a child note on the line right below the last fixed row (\"Children: half of the above amount\") withholds the rows", () => {
  noneFixed(schedule({ notes: ["Children: half of the above amount"] }).table, "next line");
});
test("a note in a note mark's words (\"(b) Dependent children are covered at half the benefits.\") withholds the rows", () => {
  noneFixed(schedule({ notes: ["(b) Dependent children are covered at half the benefits."] }).table, "marked note");
});
test("a note naming a person and changing an amount (\"Benefits for Grace Okafor (child) are halved\") withholds the rows", () => {
  noneFixed(schedule({ notes: ["Benefits for Grace Okafor (child) are halved."] }).table, "a person's note");
});
test("a note naming a person with no kind of life (\"Benefits for Grace Okafor are halved\") withholds the rows", () => {
  noneFixed(schedule({ pre: ["Benefits for Grace Okafor are halved."] }).table, "a person's note");
});
test("a line that only says who an insured person is (\"Spouse: Daniel Okafor\") is no note: the rows are still shown", () => {
  const { r, table } = schedule({ pre: ["Policyholder: Ngozi Okafor", "Spouse: Daniel Okafor"] });
  assert.deepEqual(r.lifeNotes, []);
  for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, id);
});
test("a table with a column per plan withholds the fixed rows", () => {
  const cells: [string, string, string, number, number][] = [["5", "Hospital cash", "GBP 50 per day\tGBP 100 per day", 50, 100], ["6", "Medical expenses", "Up to GBP 2,500\tUp to GBP 5,000", 2500, 5000]];
  const rows: Row[] = cells.flatMap(([n, benefit, cell, a, b]) => [{ n, benefit, cell, pays: n === "5" ? "per_day" : "up_to", value: a, column: "Plan A", forWhom: "each_named_insured" },
    { n, benefit, cell, pays: n === "5" ? "per_day" : "up_to", value: b, column: "Plan B", forWhom: "each_named_insured" }]);
  const { table } = schedule({ header: "Section\tBenefit\tPlan A\tPlan B", rows });
  noneFixed(table, "plan columns");
});
test("a table with one figure column headed by a person's name withholds the rows from everyone but that person", () => {
  const { table } = schedule({ rows: ROWS.map((r) => ({ ...r, column: "Ngozi Okafor" })), header: "Section\tBenefit\tNgozi Okafor" });
  for (const id of ["d", "g", "o"]) assert.deepEqual(fixedShown(table, id), [], id);
});
for (const [what, change] of [
  ["a row naming a child", { benefit: "Hospital cash (child)" }],
  ["a row whose cell names children", { cell: "GBP 50 per day in hospital (children GBP 25), payable from the third consecutive day, up to 30 days per accident" }],
  ["a row naming a person", { benefit: "Hospital cash - Grace" }],
  ["a row naming a role", { benefit: "Hospital cash (policyholder)" }],
  ["a row printing an age", { cell: "GBP 50 per day in hospital for insured persons under 18 years of age, payable from the third consecutive day, up to 30 days per accident" }],
  ["a row naming a plan", { cell: "GBP 50 per day in hospital (Plan A), payable from the third consecutive day, up to 30 days per accident" }],
  ["a row naming a spouse", { cell: "GBP 50 per day in hospital (spouse: from the first day), payable from the third consecutive day, up to 30 days per accident" }],
  ["a row the reader marks for some", { forWhom: "some_insured" }],
  ["a row the reader leaves unmarked (the TE's own reading, before the prompt change)", { forWhom: null }],
  ["a row whose figure is a share of the sum insured", { cell: "GBP 50 per day in hospital, or 0.1% of the Sum Insured if less, up to 30 days per accident", fromDay: undefined, conditions: [] }],
] as [string, Partial<Row>][]) {
  test(`${what}: hospital cash withheld from every named person`, () => {
    const { table } = schedule({ rows: withRow("5", change) });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, "Hospital cash"), [], id);
  });
}
test("a premium row marked for every named person is never shown as a benefit for each", () => {
  const rows = [...ROWS, { n: "7", benefit: "Annual premium", cell: "GBP 312.00 per year", pays: "amount", value: 312, forWhom: "each_named_insured" } as Row];
  const { table } = schedule({ rows });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Annual premium"), [], id);
});
test("a fixed row right below a row the reader marks for some is withheld (its neighbour may change it)", () => {
  const rows = [...ROWS.slice(0, 4), { n: "5", benefit: "Hospital cash", cell: "GBP 50 per day in hospital", pays: "per_day", value: 50, forWhom: "each_named_insured" } as Row,
    { n: "6", benefit: "Hospital cash top-up", cell: "GBP 25 per day in hospital", pays: "per_day", value: 25, forWhom: "some_insured" } as Row];
  const { table } = schedule({ rows });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], id);
});
test("a figure equal to one person's sum insured goes to that person alone (existing behaviour)", () => {
  const { table } = schedule({ rows: withRow("6", { cell: "Up to GBP 20,000 per accident, after an excess of GBP 100 per claim", value: 20000 }) });
  assert.deepEqual(shown(table, "g", "Medical expenses"), ["Medical expenses | up to GBP 20,000"]);
  for (const id of ["n", "d", "o"]) assert.deepEqual(shown(table, id, "Medical expenses"), [], id);
});
test("a different cover printed for one life (a child's cover) withholds the rows from everyone", () => {
  const { table } = schedule({ coverOf: (p) => p === "Grace Okafor" ? "Child personal accident" : "Personal accident" });
  for (const id of [...NAMED, "o"]) assert.deepEqual(fixedShown(table, id), [], id);
});
test("a schedule naming one life is not a family table (its own rows as before)", () => {
  const { table } = schedule({ lives: LIVES.slice(0, 1) });
  assert.deepEqual(fixedShown(table, "n"), ["Hospital cash | GBP 50 a day", "Medical expenses | up to GBP 2,500"]);
  for (const id of ["d", "g"]) assert.deepEqual(fixedShown(table, id), [], id);
});
test("a scheme's terms (not a personal schedule) never gives the rows by this rule", () => {
  const { r } = schedule();
  const terms = { ...r, kind: "scheme_terms" as const };
  const t = assembleTable([terms], FAMILY, [...new Set(r.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: coverKeyOf({ product: PRODUCT, cover: "Personal accident", plan: null }), why: "x" })), [], NOW);
  for (const id of [...NAMED, "o"]) assert.deepEqual(fixedShown(t, id), [], id);
});

// ---------------------------------------------------------------- the TE gate on 4a8af1a5 (plain-table-gate.md), each repro
// H1: a limit shared by all the lives is never each person's.
for (const words of ["Up to GBP 2,500 per accident for all insured persons together", "Up to GBP 2,500 in aggregate per period of insurance", "Up to GBP 2,500 per policy",
  "Up to GBP 2,500 per accident, all insured persons combined", "Up to GBP 2,500 in total under this policy"]) {
  test(`H1: a shared limit in the row ("${words}") is withheld from every named person`, () => {
    const { table } = schedule({ rows: withRow("6", { cell: `${words}, after an excess of GBP 100 per claim` }) });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, "Medical expenses"), [], id);
  });
}
for (const [benefit, cell] of [["Aggregate limit for all insured persons", "GBP 10,000 per period"], ["Maximum payable under this policy", "GBP 10,000"]]) {
  test(`H1: a row of its own for a shared limit ("${benefit}") is no one's benefit, and blocks the plain rows`, () => {
    const { table } = schedule({ rows: [...ROWS, { n: "7", benefit, cell, pays: "up_to", value: 10000, forWhom: "each_named_insured" }] });
    for (const id of [...NAMED, "o"]) assert.deepEqual([...shown(table, id, benefit), ...fixedShown(table, id)], [], id);
  });
}
for (const line of ["The limits shown apply to all insured persons combined.", "Limits are per family unless stated otherwise.", "Limits are shared between all insured persons.",
  "Amounts shown are per policy, not per person.", "The most we pay for all insured persons together under Section 6 is GBP 5,000 per period."]) {
  for (const where of ["notes", "post"] as const) test(`H1: a document line "${line}" (${where === "notes" ? "under the table" : "at the end"}) blocks every fixed row`, () => {
    noneFixed(schedule({ [where]: [line] }).table, line);
  });
}
// H2: a row's footnote, or a condition giving another figure, is read with the row.
test("H2 F7: 'GBP 50* per day' with '* GBP 25 per day for those in full-time education' (as its condition and printed) is withheld", () => {
  const note = "* GBP 25 per day for those in full-time education";
  for (const where of ["notes", "post"] as const) {
    const { table } = schedule({ rows: withRow("5", { cell: "GBP 50* per day in hospital, payable from the third consecutive day, up to 30 days per accident", conditions: [note] }), [where]: [note] });
    for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], `${where} ${id}`);
  }
});
test("H2 F6: '(note b)' with 'Note (b): halved for the second and subsequent insured persons' is withheld, wherever the note is printed", () => {
  const note = "Note (b): halved for the second and subsequent insured persons.";
  for (const where of ["notes", "pre", "post"] as const) {
    const { table } = schedule({ rows: withRow("5", { cell: "GBP 50 per day in hospital (note b), payable from the third consecutive day, up to 30 days per accident", conditions: [note] }), [where]: [note] });
    for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], `${where} ${id}`);
  }
});
test("H2: a footnote mark with no note found on the document withholds the row", () => {
  const { table } = schedule({ rows: withRow("5", { cell: "GBP 50* per day in hospital, payable from the third consecutive day, up to 30 days per accident" }) });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], id);
});
test("H2: a condition copied from elsewhere that prints another figure withholds the row", () => {
  const { table } = schedule({ rows: withRow("6", { conditions: ["after an excess of GBP 100 per claim", "GBP 1,000 for dental treatment"] }), post: ["GBP 1,000 for dental treatment"] });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Medical expenses"), [], id);
});
// Changed in round 2 (intentional): a footnote must print nothing beyond the shapes a row's cell may print, so even a
// harmless-looking definition withholds the row; a note that only repeats a known shape keeps it.
test("H2: a footnote with words beyond a row's own shapes ('* A day means a night spent in hospital.') withholds the row (round 2 allow-list)", () => {
  const { table } = schedule({ rows: withRow("5", { cell: "GBP 50* per day in hospital, payable from the third consecutive day, up to 30 days per accident" }), post: ["* A day means a night spent in hospital."] });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), [], id);
});
test("H2: a footnote that only repeats a row's shapes ('* per day in hospital, up to 30 days') keeps the row for each person", () => {
  const { table } = schedule({ rows: withRow("5", { cell: "GBP 50* per day in hospital, payable from the third consecutive day, up to 30 days per accident" }), post: ["* per day in hospital, up to 30 days"] });
  for (const id of NAMED) assert.deepEqual(shown(table, id, "Hospital cash"), ["Hospital cash | GBP 50 a day"], id);
});
// H3: premium-like rows.
for (const [benefit, cell, value, pays] of [["Monthly contribution", "GBP 26.00", 26, "amount"], ["Cost of cover", "GBP 312.00 a year", 312, "amount"],
  ["Waiver of contributions", "up to GBP 26 per month", 26, "up_to"], ["Instalment", "GBP 26.00 by direct debit", 26, "amount"]] as const) {
  test(`H3: "${benefit} ${cell}" marked for every named person is never shown as each person's benefit`, () => {
    const { table } = schedule({ rows: [...ROWS, { n: "7", benefit, cell, pays, value, forWhom: "each_named_insured" }] });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, benefit), [], id);
  });
}
// H4: a line that says nothing about an amount does not hide a per-person column's figures (base shows them).
const TRAVEL = "eeeeeeee-0000-4000-8000-0000000000f2";
function travel(extra: string[]) {
  const lives = ["Asha Rao", "Ben Rao", "Kiran Rao"];
  const rows = [["Overseas medical expenses", "S$500,000", 500000], ["Trip cancellation", "S$10,000", 10000]] as const;
  const text = ["GLOBE TRAVEL ANNUAL - CERTIFICATE OF INSURANCE", `Certificate C-7\tInsured persons: ${lives.join(", ")}`, "Insured person\tCover", ...lives.map((n) => `${n}\tGlobe Travel Annual`),
    "Benefit\tLimit per insured person", ...rows.map(([b, c]) => `${b}\t${c}`), "Terms and conditions apply.", ...extra].join("\n");
  const { r, links } = build({ id: TRAVEL, lives, text, rows: rows.map(([benefit, cell, value]) => ({ benefit, value, quote: `${benefit}\t${cell}`, column: "Limit per insured person" })) });
  for (const b of r.benefits) b.forWhom = "each_named_insured";
  const t = assembleTable([r], BASE_FAMILY, links, [], NOW);
  return ["a", "b", "k"].map((id) => t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none").length);
}
for (const line of ["The policyholder must tell us about any change in health.", "Signed on behalf of the policyholder", "Partner means your spouse or the person you live with.",
  "Cover is available to persons aged 75 or under at the start of the trip.", "Assistance line for students abroad: +65 6000 0000", "Children under 18 travel free when travelling with a parent."]) {
  test(`H4: "${line}" on a per-person certificate does not hide its limits`, () => assert.deepEqual(travel([line]), [2, 2, 2]));
}
test("H4: the base bug stays fixed: 'Benefits for children under 18 are 50% of the amounts shown' withholds the per-person limits", () => {
  assert.deepEqual(travel(["Benefits for children under 18 are 50% of the amounts shown."]), [0, 0, 0]);
});
// R5-H2 (plain-table gate round 5): a per-person column ("Limit per insured person") is held to the plain path's checks:
// shared and family words, the heading's own footnote and note, payment and premium rows.
type PerPersonDoc = { heading?: string; column?: string; rows?: [string, string, number][]; extra?: string[]; under?: string[]; page2?: string[] };
function perPersonColumn(o: PerPersonDoc) {
  const t = perPersonTable(o);
  return Object.fromEntries(["a", "b", "k"].map((id) => [id, t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none").map((x) => x.benefit)]));
}
function perPersonTable(o: PerPersonDoc) {
  const lives = ["Asha Rao", "Ben Rao", "Kiran Rao"];
  const rows = o.rows ?? [["Overseas medical expenses", "S$500,000", 500000], ["Trip cancellation", "S$10,000", 10000]];
  const column = o.column ?? "Limit per insured person";
  const text = ["GLOBE TRAVEL ANNUAL - CERTIFICATE OF INSURANCE", `Certificate C-7\tInsured persons: ${lives.join(", ")}`, "Insured person\tCover", ...lives.map((n) => `${n}\tGlobe Travel Annual`),
    o.heading ?? `Benefit\t${column}`, ...rows.map(([b, c]) => `${b}\t${c}`), ...(o.under ?? []), "Terms and conditions apply.", ...(o.extra ?? [])].join("\n");
  const { r, links } = build({ id: TRAVEL, lives, text, rows: rows.map(([benefit, cell, value]) => ({ benefit, value, quote: `${benefit}\t${cell}`, column })), ...(o.page2 ? { page2: o.page2.join("\n") } : {}) });
  for (const b of r.benefits) b.forWhom = "each_named_insured";
  return assembleTable([r], BASE_FAMILY, links, [], NOW);
}
const noOne = { a: [], b: [], k: [] };
test("R5-H2 positive: a per-person column with no shared, family or premium words still gives each person both limits", () => {
  const all = ["Overseas medical expenses", "Trip cancellation"];
  assert.deepEqual(perPersonColumn({}), { a: all, b: all, k: all });
});
test("R5-H2 (H5i): 'Overseas medical expenses S$500,000 per family' under a per-person column is no one's own", () => {
  const got = perPersonColumn({ rows: [["Overseas medical expenses", "S$500,000 per family", 500000], ["Trip cancellation", "S$10,000", 10000]] });
  for (const id of ["a", "b", "k"]) assert.ok(!got[id].includes("Overseas medical expenses"), `${id}: ${got[id]}`);
});
for (const column of ["Limit per insured person*", "Limit per insured person"]) {
  test(`R5-H2 (H5e): heading 'Limit per insured person*' with '* One limit shared by the family.' below (reader's column '${column}') withholds the rows`, () => {
    assert.deepEqual(perPersonColumn({ heading: "Benefit\tLimit per insured person*", column, extra: ["* One limit shared by the family."] }), noOne);
  });
  test(`R5-H2: heading 'Limit per insured person*' with a note that is not a row shape ('* Limits apply to the household.'; column '${column}') withholds the rows`, () => {
    assert.deepEqual(perPersonColumn({ heading: "Benefit\tLimit per insured person*", column, extra: ["* Limits apply to the household."] }), noOne);
  });
  test(`R5-H2: heading 'Limit per insured person*' whose note is not printed (column '${column}') withholds the rows`, () => {
    assert.deepEqual(perPersonColumn({ heading: "Benefit\tLimit per insured person*", column }), noOne);
  });
}
test("R5-H2: heading 'Limit per insured person*' with '* per period of insurance' (a row shape only) still gives each person both limits", () => {
  const all = ["Overseas medical expenses", "Trip cancellation"];
  assert.deepEqual(perPersonColumn({ heading: "Benefit\tLimit per insured person*", column: "Limit per insured person*", extra: ["* per period of insurance"] }), { a: all, b: all, k: all });
});
for (const benefit of ["Family personal liability", "Personal liability (shared)", "Household personal liability"]) {
  test(`R5-H2 (H3): '${benefit} S$1,000,000' under a per-person column is no one's own`, () => {
    const got = perPersonColumn({ rows: [["Overseas medical expenses", "S$500,000", 500000], [benefit, "S$1,000,000", 1000000]] });
    for (const id of ["a", "b", "k"]) assert.ok(!got[id].includes(benefit), `${id}: ${got[id]}`);
  });
}
test("R5-H2 (H12): 'Annual premium S$120' in a 'Premium | Per insured person' table is no one's benefit", () => {
  assert.deepEqual(perPersonColumn({ heading: "Premium\tPer insured person", column: "Per insured person", rows: [["Annual premium", "S$120", 120]] }), noOne);
});
test("R5-H2: 'Trip cancellation S$120' under a per-person column, the premium line printing S$120, is no one's own", () => {
  const got = perPersonColumn({ extra: ["Premium paid: S$120"], rows: [["Overseas medical expenses", "S$500,000", 500000], ["Trip cancellation", "S$120", 120]] });
  for (const id of ["a", "b", "k"]) assert.ok(!got[id].includes("Trip cancellation"), `${id}: ${got[id]}`);
});
// Per-person-shared gate round 1: words are read by whose they are. Ordinary certificate wording that makes no limit shared
// keeps every figure (lost figures were a regression against main); wording that ties a limit to the lives together
// withholds it: a row's own words that row alone, a note off the rows every row.
const SIX: [string, string, number][] = [["Overseas medical expenses", "S$500,000", 500000], ["Emergency medical evacuation", "S$1,000,000", 1000000],
  ["Trip cancellation", "S$10,000", 10000], ["Travel delay", "S$1,000", 1000], ["Baggage delay", "S$500", 500], ["Personal liability", "S$1,000,000", 1000000]];
const sixWith = (o: PerPersonDoc) => perPersonColumn({ rows: SIX, ...o });
const each = (names: string[]) => ({ a: names, b: names, k: names });
const SIX_NAMES = SIX.map(([b]) => b);
test("gate PPS-1 baseline: the six-row certificate gives each person all six limits", () => assert.deepEqual(sixWith({}), each(SIX_NAMES)));
for (const [id, line] of [["R1", "Aggregate limit for any one conveyance: S$2,000,000"], ["R2", "Aggregate limit per event for all insured persons on this certificate: S$2,000,000"],
  ["R3", "This certificate covers all persons named above."], ["R16", "Our total liability under this policy shall not exceed the limits shown."],
  ["R17", "Emergency assistance: 24-hour helpline available to all insured persons."], ["R22 note", "Baggage: S$500 per article, S$3,000 in total per insured person."]] as const) {
  test(`gate PPS-1 ${id}: '${line}' on the certificate keeps every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), each(SIX_NAMES)));
}
for (const [id, note] of [["R9", "* per insured person, per trip"], ["R10", "* Per trip."], ["R11", "* Limits apply per trip and are in Singapore dollars."]] as const) {
  for (const column of ["Limit per insured person*", "Limit per insured person"]) {
    test(`gate PPS-1 ${id}: heading 'Limit per insured person*' with '${note}' (reader's column '${column}') keeps every per-person limit`, () =>
      assert.deepEqual(sixWith({ heading: "Benefit\tLimit per insured person*", column, extra: [note] }), each(SIX_NAMES)));
  }
}
const withSix = (benefit: string, row: [string, string, number]) => SIX.map((x) => x[0] === benefit ? row : x);
for (const [id, from, row] of [["R4", "Travel delay", ["Travel delay", "up to S$1,000 in total", 1000]], ["R5", "Travel delay", ["Hijack", "combined maximum S$2,000 with travel delay", 2000]],
  ["R22 row", "Baggage delay", ["Baggage", "S$3,000 in total per insured person", 3000]], ["R6", "Baggage delay", ["Compassionate visit by a family member", "S$5,000", 5000]]] as const) {
  test(`gate PPS-1 ${id}: a row '${row[0]}  ${row[1]}' keeps itself and every other per-person limit`, () => {
    const rows = withSix(from, [...row] as [string, string, number]);
    assert.deepEqual(sixWith({ rows }), each(rows.map(([b]) => b)));
  });
}
for (const cell of ["S$500,000 for all of you", "S$500,000 however many are insured", "S$500,000 per trip for the group", "S$500,000 per party", "S$500,000 jointly",
  "S$500,000 per booking", "S$500,000 per certificate", "S$500,000 per family", "S$500,000 shared between the insured persons"]) {
  test(`gate PPS-1: a medical row printing '${cell}' is no one's own; the other rows stay each person's`, () => {
    const got = sixWith({ rows: withSix("Overseas medical expenses", ["Overseas medical expenses", cell, 500000]) });
    assert.deepEqual(got, each(SIX_NAMES.slice(1)));
  });
}
test("gate PPS-1: a row labelled 'Overseas medical expenses (per policy)' is no one's own", () => {
  const got = sixWith({ rows: withSix("Overseas medical expenses", ["Overseas medical expenses (per policy)", "S$500,000", 500000]) });
  assert.deepEqual(got, each(SIX_NAMES.slice(1)));
});
for (const line of ["Medical expenses: one limit for everyone on this certificate.", "Limits apply to the certificate as a whole.",
  "For couple plans the limits apply to both insured persons jointly.", "Couples: limits are shared.", "Limits are per family unless stated otherwise."]) {
  test(`gate PPS-1: the note '${line}' withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const line of ["Plan: Family", "Family plan: up to 2 adults and their children", "Pre-existing conditions are not covered.", "Policyholder: Asha Rao"]) {
  test(`gate PPS-1 safe: '${line}' on the certificate keeps every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), each(SIX_NAMES)));
}
test("gate PPS-1 safe: the heading 'Limit per insured person (couple plan: combined)' gives no one a limit", () =>
  assert.deepEqual(sixWith({ heading: "Benefit\tLimit per insured person (couple plan: combined)", column: "Limit per insured person (couple plan: combined)" }), noOne));
for (const note of ["(a) Shared between the insured persons.", "(a) Payable once per event regardless of the number of insured.", "(a) For both of you."]) {
  test(`gate PPS-1: heading 'Limit per insured person (a)' with '${note}' withholds every per-person limit`, () =>
    assert.deepEqual(sixWith({ heading: "Benefit\tLimit per insured person (a)", extra: [note] }), noOne));
}
// Per-person-shared gate round 2: a note line ties a limit to the lives together only when, in one clause, the tie sits a
// few words from a limit word (check.ts tiesLimitToLives). Ordinary wording keeps every figure; shared wording withholds.
for (const line of ["Limits apply per insured person per policy period.", "Cover is per policy year.", "Excess: S$100 per policy", "An excess of S$100 applies per policy per claim.",
  "Premium is payable per policy.", "Your cover renews per certificate year.", "One certificate is issued per booking.", "Any dispute between you and us may be referred to FIDReC.",
  "Any dispute between the insured and us may be referred to FIDReC.", "Benefits are payable per insured person regardless of the number of claims.",
  "Medical: one limit applies for each insured person.", "Hotel rooms shared with a travel companion are covered.", "If you cancel, the refund of premium is shared pro-rata.",
  "Search and rescue costs are shared with other rescued parties.", "The policyholder and insured persons are jointly responsible for paying the premium."]) {
  test(`gate PPS-2: '${line}' on the certificate keeps every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), each(SIX_NAMES)));
}
for (const line of ["The limits are the most we pay for all insured persons together.", "Each limit is the most we will pay in total for all insured persons.",
  "Limits apply to all insured persons combined.", "Limits are in aggregate for all insured.", "All insured persons share these limits.",
  "Limits apply collectively to the insured persons.", "The insured persons together may claim up to the limits shown.", "Limits are not per person.",
  "Limits shown are per trip for all travellers on this certificate.", "Limits apply to the two of you.", "Limits are the total for the insured persons named.",
  "The amounts shown are the maximum for this certificate."]) {
  test(`gate PPS-2: the note '${line}' withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const cell of ["S$500,000 combined for all insured", "S$500,000 in total for the travellers"]) {
  test(`gate PPS-2: a medical row printing '${cell}' is no one's own; the other rows stay each person's`, () =>
    assert.deepEqual(sixWith({ rows: withSix("Overseas medical expenses", ["Overseas medical expenses", cell, 500000]) }), each(SIX_NAMES.slice(1))));
}
// Per-person-shared gate round 3: a note line printed right under the table is read by the note-line rule, never as the last
// row's own words; a family plan's cap set as a multiple of each person's limit keeps each person's rows, with the note.
for (const line of ["Limits apply per insured person per policy period.", "If you cancel, the refund of premium is shared pro-rata.", "Any dispute between the insured and us may be referred to FIDReC.",
  "Any dispute between you and us may be referred to FIDReC.", "Benefits are payable per insured person regardless of the number of claims.", "Search and rescue costs are shared with other rescued parties.",
  "Medical: one limit applies for each insured person.", "Shared rooms are covered.", "In the event of a claim, all insured persons must cooperate together with us."]) {
  test(`gate PPS-3: '${line}' printed right under the table keeps every per-person limit, the last row too`, () => assert.deepEqual(sixWith({ under: [line] }), each(SIX_NAMES)));
}
test("gate PPS-3: a cell carried on to the next line ('per family') is still the row's own words", () => {
  const got = sixWith({ under: ["per family"] });
  for (const id of ["a", "b", "k"]) assert.ok(!got[id].includes("Personal liability"), `${id}: ${got[id]}`);
});
for (const line of ["For Family Plan, the most we pay for all insured persons combined is twice the limit shown.", "Family plan maximum: 2 times the per insured person limit, in aggregate."]) {
  test(`gate PPS-3: the family-plan multiple '${line}' keeps each person's rows, with the note as each row's condition`, () => {
    const t = perPersonTable({ rows: SIX, extra: [line] });
    for (const id of ["a", "b", "k"]) {
      const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
      assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
      for (const x of rows) assert.ok(x.conditions.includes(line), `${id} ${x.benefit}: ${x.conditions}`);
    }
  });
}
for (const line of ["For Family Plan, the most we pay for all insured persons combined is S$1,000,000.", "For Family Plan, limits are shared by the family, twice the amounts in brackets."]) {
  test(`gate PPS-3: a family cap that is no multiple of each person's limit ('${line}') withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const line of ["These sums are pooled across the travellers.", "The amounts are what we pay for the trip, not for each traveller.", "The benefit limit applies once to the certificate, whatever the number of travellers.",
  "Benefit limits are for the travellers as a unit.", "Travellers on this certificate draw on the same limits.", "The insured persons are covered up to the limits shown in total.",
  "Each benefit limit covers every traveller named on this certificate.", "Limits are for both."]) {
  test(`gate PPS-3: the note '${line}' withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const cell of ["S$500,000 for the certificate", "S$500,000 (all travellers)", "S$500,000 for both"]) {
  test(`gate PPS-3: a medical row printing '${cell}' is no one's own; the other rows stay each person's`, () =>
    assert.deepEqual(sixWith({ rows: withSix("Overseas medical expenses", ["Overseas medical expenses", cell, 500000]) }), each(SIX_NAMES.slice(1))));
}
// Per-person-shared gate round 4: the multiple is read as a number; only one above 1, not turned round, keeps each person's rows.
for (const line of ["For Family Plan, the most we pay for the whole family is 100% of the individual limit.", "For Family Plan, the most we pay for the whole family is 1 times the individual limit.",
  "For Family Plan, the most we pay for the whole family is 0.5 times the individual limit.", "For Family Plan, the most we pay for the whole family is 50% of the individual limit.",
  "Family plan maximum: 1 times the per insured person limit, in aggregate.", "For the family, the most we pay is the limit shown, not twice the limit shown.",
  "For the family, the most we pay is the limit shown instead of twice the limit shown.", "For Family Plan, the most we pay for the whole family is half the individual limit."]) {
  test(`gate PPS-4: '${line}' (a multiple of 1 or less, or turned round) withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const line of ["For Family Plan, the most we pay for the whole family is 150% of the individual limit.", "For Family Plan, the most we pay for the whole family is 1.5 times the individual limit.",
  "For Family Plan, the most we pay for all insured persons combined is 2 x the limit shown.", "For Family Plan, the most we pay for the whole family is 1.5x the individual limit.",
  "Family plan maximum: 2 times the per insured person limit, in aggregate.", "For Family Plan, the most we pay for the whole family is x2 the individual limit.",
  "For Family Plan, the most we pay for the whole family is six times the individual limit.", "For Family Plan, the most we pay for the whole family is treble the individual limit.",
  "For Family Plan, the most we pay for all insured persons combined is twice the limit shown, whether or not you travel together.", "For Family Plan, the most we pay for the whole family is 200 per cent of the individual limit."]) {
  test(`gate PPS-4: '${line}' (a multiple above 1) keeps each person's rows with the note`, () => {
    const t = perPersonTable({ rows: SIX, extra: [line] });
    for (const id of ["a", "b", "k"]) {
      const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
      assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
      for (const x of rows) assert.ok(x.conditions.includes(line), `${id} ${x.benefit}`);
    }
  });
}
// Per-person-shared gate round 5: a multiple joined to another number, unreadable, or printed with a money ceiling withholds.
for (const line of ["For Family Plan, the most we pay for the whole family is 1/2 times the individual limit.", "For Family Plan, the most we pay for the whole family is 3/4 times the individual limit.",
  "For Family Plan, the most we pay for the whole family is 0,5 times the individual limit.", "For Family Plan, the most we pay for the whole family is 1:2 times the individual limit.",
  "For Family Plan, the most we pay for the whole family is 1–2 times the individual limit.", "For Family Plan, the most we pay for the whole family is 1 - 2 times the individual limit.",
  "For Family Plan, the most we pay for the whole family is 2-times the individual limit.", "For Family Plan, the most we pay for the whole family is 1½ times the individual limit.",
  "For Family Plan, the most we pay for the whole family is one and a half times the individual limit.", "For Family Plan, the most we pay for the whole family is two hundred per cent of the individual limit.",
  "For Family Plan, the most we pay for the whole family is twice the individual limit or S$5,000, whichever is less.",
  "For Family Plan, the most we pay for the whole family is 3 times the individual limit, subject to a maximum of S$100,000.",
  "For Family Plan, the family limit is S$200,000 or twice the individual limit.", "For Family Plan, the most we pay for all insured persons combined is 2 x the limit shown, up to S$600,000."]) {
  test(`gate PPS-5: '${line}' withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
test("gate PPS-5: the chat's sentence for a per-person row says 'per insured person only', never 'for per insured only'", () => {
  const src = readFileSync(new URL("../../lib/benefit-table/chat.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("`, for ${row.qualifier} only`"));
  assert.equal(qualifierText("per insured"), "per insured person");
  assert.equal(qualifierText("child"), "for child");
});
// Per-person-shared gate round 6: a family cap keeps each person's rows only when the whole line is one of the closed shapes
// (check.ts KEEP_SHAPES); any other line naming each person's own limit about the lives together withholds. The two round-3
// notes that name benefits or say more than the cap now withhold too (stricter than round 3, by design).
const FP = "For Family Plan, the most we pay for the whole family is";
for (const line of ["For Family Plan, baggage and travel delay limits are 200% of the individual limit for the whole family.",
  "Couple plans: the limits shown apply to each insured person, up to three times the limit shown for all insured persons together.",
  `${FP} the lesser of twice the individual limit and the limit shown.`, `${FP} the individual limit, or twice the individual limit for medical expenses.`,
  `${FP} twice the individual limit for baggage and the individual limit for all other benefits.`, `${FP} up to twice the individual limit for single-trip plans and the limit shown for annual plans.`,
  "Unlike the old plan, which paid twice the individual limit, the whole family now shares the limit shown.",
  "The family limit, formerly twice the individual limit, is now the limit shown for the whole family.",
  "For Family Plan, all insured persons combined are covered up to the limit shown, which is twice the individual limit.",
  `${FP} the limit shown and not, as before, twice the limit shown.`, `${FP} up to twice the individual limit but not for personal liability, which is shared.`,
  `${FP} twice the individual limit, subject to a maximum of 100,000 dollars.`, `${FP} twice the individual limit, subject to the overall maximum in the Schedule.`,
  "For Family Plan, the premium is S$300 and the limit shown applies to the whole family.", "For Family Plan, the premium is payable monthly and the limit shown applies to the whole family.",
  "For Family Plan, the whole family shares the individual limit, which is twice the limit shown.", `${FP} twice the individual limit for medical expenses only.`,
  `${FP} twice the limit shown - not the individual limit.`, "We will not pay more than twice the individual limit for the whole family."]) {
  test(`gate PPS-6: '${line}' is no closed family-cap shape and withholds every per-person limit`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
for (const line of ["For Family Plan, the most we will pay for all the insured persons in aggregate is three times the individual limit.", "For Family Plan, 2 times the individual limit for all insured persons combined.",
  "Twice the limit shown for the whole family.", "Couple plan maximum: 150% of the individual limit."]) {
  test(`gate PPS-6: the closed family-cap shape '${line}' keeps each person's rows with the note`, () => {
    const t = perPersonTable({ rows: SIX, extra: [line] });
    for (const id of ["a", "b", "k"]) {
      const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
      assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
      for (const x of rows) assert.ok(x.conditions.includes(line), `${id} ${x.benefit}`);
    }
  });
}
for (const line of ["For Family Plan, the most we pay for the whole family is 1 times the individual limit.", "Couple plan maximum: 100% of the individual limit."]) {
  test(`gate PPS-6: the closed shape with a multiple of 1 ('${line}') withholds`, () => assert.deepEqual(sixWith({ extra: [line] }), noOne));
}
// Per-person-shared gate round 7: the shape is judged on the whole sentence the condition shows (continuation lines joined),
// common rewordings of the shape keep, and a sentence sharing one benefit withholds that row.
for (const [id, first, cont] of [["WR4", "For Family Plan, the most we pay for all insured persons combined is twice the limit shown", "or S$5,000, whichever is less."],
  ["WR1", "For Family Plan, the most we pay for all insured persons combined is twice the limit shown", "except personal liability, which is shared by the family."],
  ["WR7", "For Family Plan, the most we pay for all insured persons combined is twice the limit shown", "unless you are injured in the same event, in which case the limit shown is for all of you."]] as const) {
  for (const where of ["extra", "under"] as const) {
    test(`gate PPS-7 ${id} (${where}): a shape line carried on by '${cont}' withholds every per-person limit`, () => {
      const got = sixWith({ [where]: [first, cont] });
      for (const k of ["a", "b", "k"]) assert.ok(!got[k].includes("Personal liability") && !got[k].includes("Overseas medical expenses"), `${k}: ${got[k]}`);
    });
  }
}
test("gate PPS-7: a shape sentence with no full stop, followed by another note line, is left open and withholds", () =>
  assert.deepEqual(sixWith({ extra: ["For Family Plan, the most we pay for all insured persons combined is twice the limit shown", "Or S$5,000, whichever is less."] }), noOne));
for (const line of ["For Family Plan, the maximum amount payable for all insured persons is 200% of the individual limit.",
  "For Family Plan, the total payable for all insured persons shall not exceed twice the limit per insured person.",
  "Couple plan: the most we pay for both of you is 150% of the individual limit.", "For Family Plan, the maximum we will pay for the family is 2 times the individual limit.",
  "Family limit: 2 x individual limit", "Under the Family Plan, the most we pay for the whole family is twice the limit shown.",
  "For Family Plan the most we pay for the whole family is twice the limit shown.", "For Family Plan, the most we pay for your whole family is twice the limit shown.",
  "For Family Plan, the most we pay for all insured persons combined is twice the limit shown for each benefit.",
  "* For Family Plan, the most we pay for all insured persons combined is twice the limit shown.", "Note: For Family Plan, the most we pay for all insured persons combined is twice the limit shown.",
  "Twice the limit per insured person for both of you."]) {
  test(`gate PPS-7: the reworded shape '${line}' keeps each person's rows with the note`, () => {
    const t = perPersonTable({ rows: SIX, extra: [line] });
    for (const id of ["a", "b", "k"]) {
      const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
      assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
      for (const x of rows) assert.ok(x.conditions.includes(line), `${id} ${x.benefit}`);
    }
  });
}
test("gate PPS-7: a shape whose continuation line is plain words of the shape ('...is twice' / 'the limit shown.') keeps, with the whole sentence attached", () => {
  const t = perPersonTable({ rows: SIX, extra: ["For Family Plan, the most we pay for all insured persons combined is twice", "the limit shown."] });
  for (const id of ["a", "b", "k"]) {
    const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
    assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
    for (const x of rows) assert.ok(x.conditions.includes("For Family Plan, the most we pay for all insured persons combined is twice the limit shown."), `${id} ${x.benefit}: ${x.conditions}`);
  }
});
for (const line of ["Personal liability is shared by the family.", "Personal liability is shared by all insured persons."]) {
  test(`gate PPS-7: '${line}' withholds the personal liability row only`, () => assert.deepEqual(sixWith({ extra: [line] }), each(SIX_NAMES.filter((b) => b !== "Personal liability"))));
}
// Per-person-shared gate round 8: a note sentence runs on over a page break; a full stop followed by a lower-case line leaves
// it open; a sentence sharing a benefit names its row by the label's head words.
const SHAPE_OPEN = "For Family Plan, the most we pay for the whole family is twice the limit shown";
for (const [id, cont] of [["P1", "or S$5,000, whichever is less."], ["P2", "except personal liability, which is shared by the family."]] as const) {
  test(`gate PPS-8 ${id}: a shape ending page 1 with no full stop, carried on by page 2's '${cont}', withholds every per-person limit`, () => {
    const rows: [string, string, number][] = [...SIX.slice(0, 5), ["Personal liability (third party)", "S$1,000,000", 1000000]];
    assert.deepEqual(perPersonColumn({ rows, extra: [SHAPE_OPEN], page2: [cont, "Claims procedure"] }), noOne);
  });
}
test("gate PPS-8: a shape ending page 1 with no full stop, page 2 starting with a heading, is left open and withholds", () =>
  assert.deepEqual(sixWith({ extra: [SHAPE_OPEN], page2: ["CLAIMS PROCEDURE", "Call us within 30 days."] }), noOne));
test("gate PPS-8: a complete shape ending page 1, page 2 starting with a heading, still keeps each person's rows with the note", () => {
  const t = perPersonTable({ rows: SIX, extra: [`${SHAPE_OPEN}.`], page2: ["CLAIMS PROCEDURE", "Call us within 30 days."] });
  for (const id of ["a", "b", "k"]) {
    const rows = t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none");
    assert.deepEqual(rows.map((x) => x.benefit), SIX_NAMES, id);
    for (const x of rows) assert.ok(x.conditions.includes(`${SHAPE_OPEN}.`), `${id} ${x.benefit}`);
  }
});
test("gate PPS-8 C5: a shape ending in a full stop, followed by 'or S$5,000, whichever is less.', withholds every per-person limit", () =>
  assert.deepEqual(sixWith({ extra: [`${SHAPE_OPEN}.`, "or S$5,000, whichever is less."] }), noOne));
test("gate PPS-8: 'Personal liability is shared by the family.' withholds a 'Personal liability (third party)' row", () => {
  const rows: [string, string, number][] = [...SIX.slice(0, 5), ["Personal liability (third party)", "S$1,000,000", 1000000]];
  assert.deepEqual(sixWith({ rows, extra: ["Personal liability is shared by the family."] }), each(SIX_NAMES.slice(0, 5)));
});
test("gate PPS-8: 'Medical expenses are shared by the family.' withholds 'Overseas medical expenses' and no other row", () =>
  assert.deepEqual(sixWith({ extra: ["Medical expenses are shared by the family."] }), each(SIX_NAMES.slice(1))));
test("gate PPS-8: 'Hotel rooms shared with a travel companion are covered.' withholds no row (no row's head words)", () =>
  assert.deepEqual(sixWith({ extra: ["Hotel rooms shared with a travel companion are covered."] }), each(SIX_NAMES)));
test("gate PPS-4: a per-person column's qualifier reads 'per insured person' in the chat's table, never 'for per insured'", () => {
  const t = perPersonTable({ rows: SIX });
  const household = { accountId: "11111111-1111-1111-1111-111111111111", members: BASE_FAMILY.map((m) => ({ name: m.display_name, relationship: "self" })),
    documents: [{ policyId: TRAVEL, name: "Globe-Travel-Certificate.pdf", insurer: null, productName: "Globe Travel Annual", policyNumber: null, documentType: null, documentRole: null,
      effectiveDate: null, expiryDate: null, uploadedAt: "2026-03-01", uploadedFor: null, linkedPeople: BASE_FAMILY.map((m) => m.display_name), supersededAt: null, processingStatus: "ready", pages: [] }] } as unknown as Household;
  const text = renderTable(chatRows(t, household));
  assert.ok(!/for per insured/.test(text), text.slice(0, 400));
  assert.match(text, /\| per insured person \|/);
});
test("H4: 'Signed on behalf of the policyholder: N. Okafor' does not block the plain table", () => {
  const { table } = schedule({ post: ["Signed on behalf of the policyholder: N. Okafor"] });
  for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, id);
});
// Builder risks the gate confirmed.
for (const n of ["1", "4"]) {
  test(`a children's note on row ${n}'s own line about every benefit ("All benefits for children are half the amounts shown in this table") withholds the fixed rows`, () => {
    const cell = n === "1" ? "100% of the Sum Insured. All benefits for children are half the amounts shown in this table." : "5% of the Sum Insured per accident. All benefits for children are half the amounts shown in this table.";
    noneFixed(schedule({ rows: withRow(n, { cell, conditions: [], forWhom: "some_insured" }) }).table, `row ${n}`);
  });
}
for (const line of ["Those still in full-time education receive half the amounts shown.", "Second insured person", "Third insured person: reduced cover"]) {
  test(`a line with no kind-of-life word ("${line}") withholds the fixed rows`, () => noneFixed(schedule({ pre: [line] }).table, line));
}

// ---------------------------------------------------------------- round 2 of the TE gate (head 015beafa), each repro
// R2-H1: a note giving children, an age group or a named person another figure.
for (const line of ["Hospital cash rates: adults GBP 50 a day, children GBP 25 a day", "Children: GBP 25 a day hospital cash", "Medical expenses for children are covered to GBP 1,000",
  "Grace Okafor: hospital cash GBP 25 a day", "Insured persons aged 70 and over: GBP 25 a day", "For minors the daily rate is GBP 25", "Children GBP 25"]) {
  for (const where of ["pre", "post"] as const) test(`R2-H1: "${line}" (${where === "pre" ? "above the table" : "at the end"}) withholds every fixed row`, () => {
    const { r, table } = schedule({ [where]: [line] });
    noneFixed(table, line);
    assert.ok(r.lifeNotes!.includes(line), `a note on the per-person path too: ${JSON.stringify(r.lifeNotes)}`);
  });
}
// R2-H2: shared-limit wordings outside any word list.
for (const line of ["The amounts shown are the most we will pay for you and your family for any one event.", "One limit applies to everyone named on this schedule.",
  "Limits apply to the policy as a whole, not to each insured person.", "Medical expenses are payable once per accident regardless of the number of insured persons involved."]) {
  test(`R2-H2: a document line "${line}" withholds every fixed row`, () => noneFixed(schedule({ post: [line] }).table, line));
}
for (const note of ["(b) This is the most we pay for everyone insured.", "(b) One limit for the schedule, not for each person.", "(b) Applies to you and your family.", "(b) Per household per period."]) {
  test(`R2-H2: row 6's mark "(b)" with its note far from the row ("${note}") withholds medical expenses`, () => {
    const { table } = schedule({ rows: withRow("6", { cell: "Up to GBP 2,500 per accident (b), after an excess of GBP 100 per claim" }), post: [note] });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, "Medical expenses"), [], id);
  });
}
for (const words of ["Up to GBP 2,500 any one event, however many insured persons are hurt", "Up to GBP 2,500 per accident for everyone insured", "Up to GBP 2,500 per accident for all of you"]) {
  test(`R2-H2: row 6's own words ("${words}") withhold medical expenses`, () => {
    const { table } = schedule({ rows: withRow("6", { cell: words, conditions: [] }) });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, "Medical expenses"), [], id);
  });
}
// R2-H3: payment rows under other labels.
for (const [benefit, cell, value] of [["Total payable", "GBP 349.44", 349.44], ["Policy fee", "GBP 10.00", 10], ["Annual price", "GBP 312.00", 312], ["Amount due each month", "GBP 26.00", 26],
  ["Renewal quote", "GBP 330.00", 330], ["Monthly amount", "GBP 26.00", 26]] as const) {
  test(`R2-H3: "${benefit} ${cell}" is never each person's benefit`, () => {
    const { table } = schedule({ rows: [...ROWS, { n: "7", benefit, cell, pays: "amount", value, forWhom: "each_named_insured" }] });
    for (const id of [...NAMED, "o"]) assert.deepEqual(shown(table, id, benefit), [], id);
  });
}
// R2-M1: ordinary lines on a per-person certificate keep its limits (as main does).
for (const line of ["Benefits are paid to the policyholder.", "Only the policyholder may make changes to this policy.", "Children are covered free of charge up to age 18.",
  "Cover for persons over 70 is limited to trips of 31 days."]) {
  test(`R2-M1: "${line}" on a per-person certificate does not hide its limits`, () => assert.deepEqual(travel([line]), [2, 2, 2]));
}
test("R2-M1: 'Benefits are paid to the policyholder.' is an admin line: the plain schedule still gives its fixed rows", () => {
  const { table } = schedule({ post: ["Benefits are paid to the policyholder."] });
  for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, id);
});
// R2-M2: never more than a person's own printed sum.
test("R2-M2: a fixed GBP 40,000 row goes to those insured for at least that, never to a child insured for GBP 25,000", () => {
  const lives: [string, string, string, string][] = [["Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 50,000"], ["Daniel Okafor", "Spouse", "02/11/1982", "GBP 50,000"], ["Grace Okafor", "Child", "09/04/2017", "GBP 25,000"]];
  const sums = { ...SUMS };
  Object.assign(SUMS, { "Ngozi Okafor": 50000, "Daniel Okafor": 50000, "Grace Okafor": 25000 });
  try {
    const { table } = schedule({ lives, rows: [...ROWS, { n: "7", benefit: "Loss of sight", cell: "GBP 40,000", pays: "amount", value: 40000, forWhom: "each_named_insured" }] });
    assert.deepEqual(shown(table, "n", "Loss of sight"), ["Loss of sight | GBP 40,000"]);
    assert.deepEqual(shown(table, "d", "Loss of sight"), ["Loss of sight | GBP 40,000"]);
    assert.deepEqual(shown(table, "g", "Loss of sight"), []);
  } finally { Object.assign(SUMS, sums); }
});
// Low: a bare-letter mark whose note gives another figure.
test("a bare-letter note line ('a GBP 1,000 for the youngest.') is no structural line: the fixed rows are withheld", () => {
  noneFixed(schedule({ rows: withRow("6", { cell: "Up to GBP 2,500 per accident a, after an excess of GBP 100 per claim", conditions: [] }), post: ["a GBP 1,000 for the youngest."] }).table, "bare letter");
});
// The allow-list itself: any line outside the closed set (a money figure, a person, an unknown sentence) withholds.
for (const line of ["Dental treatment\tGBP 300", "Daniel Okafor is also insured under another policy", "Please read the policy wording for the full terms that apply to you."]) {
  test(`allow-list: an unread line ("${line}") is no structural line, so the fixed rows are withheld`, () => noneFixed(schedule({ post: [line] }).table, line));
}

// ---------------------------------------------------------------- round 3 of the TE gate (head 1acbc02d), each repro
// R3-H1: a footnote marked on one row that changes other rows for some lives is a note on the document.
for (const note of ["(b) Sections 5 and 6 pay half for the second and subsequent insured persons.", "(b) Halved for persons in full-time education; this applies to every section.",
  "(b) Sections 5 and 6 are paid once per accident for everyone insured.", "(b) Also applies to Section 5: payable at 50% for the youngest life.",
  "(b) Sections 5 and 6 are payable only to the first named insured.", "(b) Sections 5 and 6 do not apply to the last named life.", "(b) Sections 5-6 are not available for Grace.",
  "(b) Not available for Grace.", "(b) Section 5 is paid at GBP 25 a day."]) {
  test(`R3-H1: row 6's mark with "${note}" withholds every fixed row, hospital cash too`, () => {
    noneFixed(schedule({ rows: withRow("6", { cell: "Up to GBP 2,500 per accident (b), after an excess of GBP 100 per claim" }), post: [note] }).table, note);
  });
}
for (const note of ["(a) Sections 3 to 6 pay half for the youngest life.", "Note (a): sections 5 and 6 pay 50% for the youngest.",
  "Note (a): this note applies to every section; GBP 25 a day hospital cash for the youngest.", "Note (a): every limit in this table is halved for the last named life."]) {
  test(`R3-H1: a second note on row 3's mark ("${note}") withholds every fixed row`, () => noneFixed(schedule({ post: [note] }).table, note));
}
test("R3-H1: the TE's own Note (a) stays row 3's own: the fixed rows are still shown", () => {
  const { r, table } = schedule();
  assert.deepEqual(r.plainBlockers, []);
  for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, id);
});
// R3 MEDIUM: on the TE reading's own shape, a row read from Note (a) under row 6 is row 3's note, not row 6's neighbour.
const COMPOUND = { section: "3", column: null, benefit: "Compound fracture", pays: "words", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: NOTE_A[0] };
test("R3-MEDIUM: with a 'Compound fracture' row read from Note (a), medical expenses up to GBP 2,500 after a GBP 100 excess reaches all three", () => {
  const { table } = schedule({ extraBenefits: [COMPOUND] });
  for (const id of NAMED) {
    assert.deepEqual(fixedShown(table, id), ["Hospital cash | GBP 50 a day", "Medical expenses | up to GBP 2,500"], id);
    assert.deepEqual(table.people.find((p) => p.id === id)!.rows.find((x) => x.benefit === "Medical expenses")!.conditions, ["after an excess of GBP 100 per claim"], id);
  }
  assert.deepEqual(table.people.find((p) => p.id === "o")!.rows, []);
});
test("R3-MEDIUM: a note read as a row that is not its row's own ('(b) Sections 5 and 6 pay half for the youngest') still blocks", () => {
  const note = "(b) Sections 5 and 6 pay half for the youngest.";
  const { table } = schedule({ rows: withRow("6", { cell: "Up to GBP 2,500 per accident (b), after an excess of GBP 100 per claim" }), post: [note],
    extraBenefits: [{ ...COMPOUND, section: "6", benefit: "Note (b)", quote: note }] });
  noneFixed(table, note);
});
// R3 LOW: admin lines the allow-list now takes; lines it still refuses.
for (const line of ["All limits are per insured person.", "Plan type: Family", "Cover level: Couple", "Exclusions apply."]) {
  test(`R3-LOW: "${line}" is a structural line: the fixed rows are shown`, () => {
    const { table } = schedule({ post: [line] });
    for (const id of NAMED) assert.equal(fixedShown(table, id).length, 2, id);
  });
}
for (const line of ["Cancellation: you may cancel within 14 days for a full refund.", "Data protection: see our privacy notice at www.example.com/privacy"]) {
  test(`R3-LOW (kept): "${line}" still withholds the fixed rows (an allow-list's cost)`, () => noneFixed(schedule({ post: [line] }).table, line));
}

// ---------------------------------------------------------------- the chat: a withheld row's amount is printed, and where
/** The chat's row step on the schedule, as the app's chat turn runs it (lib/simple-chat/hook.ts): an amount statement from
 * the model, its rows, then the left-out note. */
function chatOn(o: Parameters<typeof schedule>[0], statements: Record<string, unknown>[]) {
  const { table } = schedule(o);
  const page2 = ["TABLE OF BENEFITS (all amounts in GBP)", ...(o?.pre ?? []), o?.header ?? "Section\tBenefit\tAmount payable", ...(o?.rows ?? ROWS).map((x) => `${x.n}\t${x.benefit}\t${x.cell}`), ...(o?.notes ?? []), ...NOTE_A, ...TAIL].join("\n");
  const household: Household = { accountId: "11111111-1111-1111-1111-111111111111", members: FAMILY.slice(0, 3).map((m) => ({ name: m.display_name, relationship: "self" })),
    documents: [{ policyId: DOC, name: "Harbourline-Family-PA-Schedule-2026.pdf", insurer: "Harbourline Assurance plc", productName: "Family Personal Accident Policy", policyNumber: "HPA-55120-K",
      documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-03-01", uploadedFor: null, linkedPeople: FAMILY.slice(0, 3).map((m) => m.display_name),
      supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text: PAGE1(o?.lives ?? LIVES) }, { page: 2, text: page2 }] }] } as unknown as Household;
  const rows = chatRows(table, household);
  const raw = { bottomLine: "Here is what the schedule says.", nextSteps: [], question: null, statements: statements.map((x) => ({
    kind: "amount", text: "x", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, ...x })) };
  const fromRows = amountsFromRows(raw, rows, household, NOW, "How much is hospital cash?", [], false, withheldRows(table, household));
  const kept = (fromRows.json as { statements: { id?: string; kind: string; text: string }[] }).statements.map((x, i) => ({ id: x.id ?? `s${i}`, kind: x.kind, text: x.text }));
  return noteLeftOutAmounts(kept, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text }));
}
const CHILD_NOTE = { notes: ["All benefits for a child are halved."] };
test("a withheld row's amount the model gives with no row: the answer says where it is printed, never that it could not be found", () => {
  const out = chatOn(CHILD_NOTE, [{ text: "Hospital cash pays GBP 50 a day.", person: "Grace Okafor", quote: "5 Hospital cash GBP 50 per day in hospital", amount: "GBP 50" }]);
  const texts = out.map((x) => x.text);
  assert.ok(!texts.includes(LEFT_OUT_AMOUNT), texts.join(" | "));
  assert.ok(texts.includes(withheldNote("Hospital cash", "Family Personal Accident Policy, page 2")), texts.join(" | "));
});
test("a withheld row named by its benefit and figure (no quote), and given twice: one note", () => {
  const out = chatOn(CHILD_NOTE, [{ text: "Medical expenses are covered up to GBP 2,500.", person: "Ngozi Okafor", amount: "GBP 2,500" }, { text: "Medical expenses up to GBP 2,500.", person: "Daniel Okafor", amount: "GBP 2,500" }]);
  assert.deepEqual(out.filter((x) => x.kind === "uncertainty").map((x) => x.text), [withheldNote("Medical expenses", "Family Personal Accident Policy, page 2")]);
});
test("an amount with no row that is no withheld row's still says an amount was left out", () => {
  const out = chatOn(CHILD_NOTE, [{ text: "Dental treatment pays GBP 300.", person: "Grace Okafor", amount: "GBP 300" }]);
  assert.deepEqual(out.filter((x) => x.kind === "uncertainty").map((x) => x.text), [LEFT_OUT_AMOUNT]);
});
test("a withheld row and an unfound amount together: both are said", () => {
  const out = chatOn(CHILD_NOTE, [{ text: "Hospital cash pays GBP 50 a day.", person: "Grace Okafor", quote: "5 Hospital cash GBP 50 per day in hospital", amount: "GBP 50" },
    { text: "Dental treatment pays GBP 300.", person: "Grace Okafor", amount: "GBP 300" }]);
  assert.deepEqual(out.filter((x) => x.kind === "uncertainty").map((x) => x.text), [withheldNote("Hospital cash", "Family Personal Accident Policy, page 2"), LEFT_OUT_AMOUNT]);
});
test("on the plain schedule the hospital cash is a row of each named person's table, so nothing is withheld", () => {
  const { table } = schedule();
  assert.deepEqual(table.notToldRows, []);
});

// ---------------------------------------------------------------- #464/#466's adversarial matrix, with a careless reader
/** Each adversarial certificate with every row marked "each_named_insured", and (stripped) with its column heading taken
 * off so the rows reach the plain-table rule. UNSAFE: someone shown a figure the case does not give them. */
function unsafe(k: Case, strip: boolean): string[] {
  const readings = k.docs.map((d) => {
    const doc = strip ? { ...d, text: d.text.replace(/^Benefit\t.*$/m, "Benefit\tAmount payable"), rows: d.rows.map((x) => ({ ...x, column: null })) } : d;
    const { r, links } = build(doc);
    for (const b of r.benefits) b.forWhom = "each_named_insured";
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
      const got = `${x.benefit}=${figureText(x.figure)}`;
      if (skipRows.has(norm(x.benefit))) continue;
      const ok = exp.some((e) => { const [name, fig] = e.split("="); const want = fig ? firstNumber(fig) : printed.get(norm(name)) ?? null;
        return norm(name) === norm(x.benefit) && want != null && firstNumber(figureText(x.figure)) === want; });
      if (!ok) out.push(`${p.id} got ${got}`);
    }
  }
  return out;
}
/** Cases whose only sign that a row is not every named person's is the column heading itself, so taking it off makes
 * another case: an age column (N15), a column that does not say per person (N27), a per-child column (N28). */
const COLUMN_ONLY = new Set(["N15", "N27", "N28"]);
for (const k of CASES) {
  test(`adversarial ${k.id} (${k.what}), every row marked for every named person: no one is shown another's figure`, () => {
    assert.deepEqual(unsafe(k, false), []);
  });
  if (!COLUMN_ONLY.has(k.id)) test(`adversarial ${k.id} (${k.what}) as a plain table with no column heading, every row marked: no one is shown another's figure`, () => {
    assert.deepEqual(unsafe(k, true), []);
  });
}

// #474 perf gate, P474-H1: a long certificate stored in parts, a later part keeping its own kind ("other", none,
// "policy_wording"): the document's notes and blockers are still worked out for every part, so the merged reading keeps
// "for insured children the limits are 50% of those shown" and no one is given the per-person limits.
{
  const id = "eeeeeeee-0000-4000-8000-0000000000f7";
  const lives = ["Asha Rao", "Ben Rao", "Kiran Rao"];
  const rows = [["Overseas medical expenses", "S$500,000", 500000], ["Trip cancellation", "S$10,000", 10000]] as const;
  const text = ["GLOBE TRAVEL ANNUAL - CERTIFICATE OF INSURANCE", `Certificate C-7\tInsured persons: ${lives.join(", ")}`, "Insured person\tCover", ...lives.map((n) => `${n}\tGlobe Travel Annual`),
    "Benefit\tLimit per insured person", ...rows.map(([b, c]) => `${b}\t${c}`), "Note: for insured children the limits are 50% of those shown.", "Terms and conditions apply."].join("\n");
  const insuredLine = text.split("\n")[1];
  const cover = (person: string) => ({ person, product: "Globe Travel Annual", cover: "Travel", plan: null, riderOf: null, policyNumber: "P-f7", sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: insuredLine });
  const benefit = ([b, c, v]: readonly [string, string, number]) => ({ section: null, column: "Limit per insured person", benefit: b, pays: "up_to", value: v, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
    cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: `${b}\t${c}`, forWhom: "each_named_insured" });
  const reading = (kind: string | null, part: 0 | 1) => ({ document: { ...(kind ? { kind } : {}), product: "Globe Travel Annual", insurer: null, namedPeople: lives, plan: null, periodFrom: null, periodTo: null },
    covers: part === 0 ? lives.map(cover) : [], benefits: [benefit(rows[part])] });
  const doc: SourceDoc = { id, name: "certificate.pdf", readable: true, pages: [{ page: 1, text }] };
  const key = coverKeyOf({ product: "Globe Travel Annual", cover: "Travel", plan: null });
  const links = [{ section: sectionKeyOf(id, { section: null, column: "Limit per insured person" }), cover: key, why: "certificate benefits" }];
  for (const kind of ["personal_proof", "other", null, "policy_wording"]) {
    test(`P474-H1: a certificate stored in two parts, the later part's kind ${kind ?? "missing"}, keeps its children's note and withholds the per-person limits`, () => {
      const r = checkStored(doc, { document: reading("personal_proof", 0), pages: [{ page: 1, json: reading(kind, 1) }] } as Parameters<typeof checkStored>[1]);
      assert.equal(r.kind, "personal_proof");
      assert.deepEqual(r.lifeNotes, ["Note: for insured children the limits are 50% of those shown."]);
      assert.ok((r.plainBlockers ?? []).length > 0, "the plain table's blockers are kept too");
      const t = assembleTable([r], BASE_FAMILY, links, [], NOW);
      for (const p of ["a", "b", "k"]) assert.deepEqual(t.people.find((x) => x.id === p)!.rows.filter((x) => x.figure.kind !== "none").map((x) => x.benefit), [], p);
    });
  }
}
console.log(`plain-table-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
