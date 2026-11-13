/** A certificate that names its insured persons and prints one column of per-person limits gives each named insured
 * person those rows (TE-ACC-20261113 defect 6b: a couple's travel certificate showed none of its limits). One general
 * rule (assemble.ts perPersonRows), tested on made-up certificates in several currencies and layouts, with negative
 * controls for every way a row can be one life's: an age group, a child's rate beside it, a row per life, a person's
 * name, a second column, a document that is not the person's own, and a household member the certificate does not name.
 * No model, database or network. The readings are written by hand from each page's own text.
 *   npm run benefit-table:per-person-certificate-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, figureText, NOT_TOLD_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-000000000001";
const page = (text: string): SourceDoc => ({ id: DOC, name: "Certificate.pdf", readable: true, pages: [{ page: 1, text }] });
const cover = (o: Record<string, unknown>) => ({ plan: null, riderOf: null, policyNumber: "C-7", sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, ...o });
const row = (o: Record<string, unknown>) => ({ section: null, column: null, value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

const FAMILY: FamilyMember[] = [
  { id: "a", display_name: "Asha Rao", date_of_birth: "1980-04-02" } as FamilyMember,
  { id: "b", display_name: "Ben Rao", date_of_birth: "1978-09-12" } as FamilyMember,
  { id: "k", display_name: "Kiran Rao", date_of_birth: "2016-01-20" } as FamilyMember,
  { id: "c", display_name: "Chen Rao", date_of_birth: "1950-06-30" } as FamilyMember,
];
const NOW = new Date("2026-11-13T00:00:00Z");
const shownFor = (t: ReturnType<typeof assembleTable>, id: string) =>
  t.people.find((p) => p.id === id)!.rows.filter((x) => x.figure.kind !== "none").map((x) => `${x.benefit} | ${figureText(x.figure)}`);

/** forWhom: what the reader says the row is for (reading.ts FOR_WHOM). The hand readings below say "each_named_insured"
 * even where a careful reader would not, so the layout checks are tested as the last guard. */
type Line = { benefit: string; cell: string; value: number; pays?: string; maxDays?: number; cap?: number; forWhom?: string | null };
/** A certificate naming `lives`, with one table: a header line, then each row as "<benefit>\t<cell>", then `after`. */
function certificate(o: { lives: string[]; column: string; rows: Line[]; section?: string | null; after?: string; extraLines?: string[];
  kind?: "personal_proof" | "scheme_terms"; product?: string }) {
  const product = o.product ?? "Globe Travel Annual";
  const insured = `Certificate C-7\tInsured persons: ${o.lives.join(", ")}`;
  const lines = o.rows.map((r) => `${r.benefit}\t${r.cell}`);
  const text = [`${product.toUpperCase()} - CERTIFICATE OF INSURANCE`, insured, ...(o.section ? [o.section] : []), `Benefit\t${o.column}`,
    ...lines, ...(o.extraLines ?? []), o.after ?? "Terms apply."].join("\n");
  const covers = o.lives.map((person) => cover({ person, product, cover: "Travel", quote: insured }));
  const reading = { document: { kind: o.kind ?? "personal_proof", product, insurer: null, namedPeople: o.lives, plan: null, periodFrom: null, periodTo: null },
    covers: o.kind === "scheme_terms" ? [] : covers,
    benefits: o.rows.map((r, i) => row({ section: o.section ?? null, column: o.column, benefit: r.benefit, pays: r.pays ?? "up_to", value: r.value,
      maxDays: r.maxDays ?? null, cap: r.cap ?? null, quote: lines[i], forWhom: r.forWhom === undefined ? "each_named_insured" : r.forWhom })) };
  const r = checkReading(page(text), reading);
  const key = coverKeyOf({ product, cover: "Travel", plan: null });
  const links = [{ section: sectionKeyOf(DOC, { section: o.section ?? null, column: o.column }), cover: key, why: "the certificate's benefits" }];
  return { r, links };
}
const run = (o: Parameters<typeof certificate>[0], extra: ReturnType<typeof certificate>["r"][] = []) => {
  const { r, links } = certificate(o);
  assert.equal(r.benefits.length, o.rows.length, `rows check against the page: ${JSON.stringify(r.dropped)}`);
  return assembleTable([r, ...extra], FAMILY, links, [], NOW);
};

// ---------------------------------------------------------------- each named insured person gets the per-person limits
for (const column of ["Limit per insured person", "Maximum amount payable each insured person", "Benefit limit per person", "Sum insured per insured person"]) {
  test(`couple certificate, bare "$", "${column}": both named insured see each limit, currency not stated; no one else does`, () => {
    const t = run({ lives: ["Asha Rao", "Ben Rao"], column, rows: [{ benefit: "Overseas medical expenses", cell: "$500,000", value: 500000 }, { benefit: "Trip cancellation", cell: "$5,000", value: 5000 }] });
    for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id), ["Overseas medical expenses | up to $500,000 (currency not stated)", "Trip cancellation | up to $5,000 (currency not stated)"], id);
    for (const id of ["k", "c"]) assert.deepEqual(t.people.find((p) => p.id === id)!.rows, [], `${id} is not named on the certificate`);
  });
}
for (const [sign, code] of [["GBP ", "GBP"], ["S$", "SGD"], ["RM ", "MYR"], ["€", "EUR"]] as const) {
  test(`${code}: a family certificate naming three gives each named one the limits (and a daily rate with its day limit)`, () => {
    const t = run({ lives: ["Asha Rao", "Ben Rao", "Kiran Rao"], column: "Limit per insured person", rows: [
      { benefit: "Emergency medical expenses", cell: `${sign}2,000,000`, value: 2000000 },
      { benefit: "Hospital cash", cell: `${sign}100 per day, up to 30 days`, value: 100, pays: "per_day", maxDays: 30 },
      { benefit: "Baggage", cell: `${sign}3,000`, value: 3000 }] });
    for (const id of ["a", "b", "k"]) assert.equal(shownFor(t, id).length, 3, `${id}: ${shownFor(t, id).join("; ")}`);
    for (const id of ["a", "b", "k"]) assert.ok(t.people.find((p) => p.id === id)!.rows.every((x) => x.figure.kind === "none" || (x.figure as { currency?: string }).currency === code), id);
    assert.deepEqual(t.people.find((p) => p.id === "c")!.rows, [], "Chen is not named");
  });
}
test("a row's next line that starts another row does not withhold it (each row keeps its own figures)", () => {
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Personal accident", cell: "USD 50,000", value: 50000 }, { benefit: "Medical expenses", cell: "USD 250,000", value: 250000 }] });
  for (const id of ["a", "b"]) assert.equal(shownFor(t, id).length, 2, id);
});

// ---------------------------------------------------------------- negative controls: one life's figure is never another's
for (const forWhom of [null, "some_insured"]) {
  test(`the reader not saying the row is each named insured person's (${forWhom ?? "left out"}) gives no one the limit, with the reason`, () => {
    const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Medical expenses", cell: "$100,000", value: 100000, forWhom }] });
    for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id), [], id);
    assert.equal(t.unlinkedSections[0]?.why, NOT_TOLD_WHY);
  });
}
test("one row the reader says is for some of them does not stop the others", () => {
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Medical expenses", cell: "$100,000", value: 100000 },
    { benefit: "Baggage", cell: "$3,000", value: 3000 }, { benefit: "Child care", cell: "$2,000", value: 2000, forWhom: "some_insured" }] });
  // Baggage, printed right above the reader's "some" row, is withheld with it; Medical expenses is not its neighbour.
  for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id), ["Medical expenses | up to $100,000 (currency not stated)"], id);
});
test("a section that names 'each insured child' is checked against each person when the reader marks the row wrongly (only main's tier phrases are caught: a bare 'Child' or 'Senior' rests on the reader)", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", section: "BENEFITS FOR EACH INSURED CHILD", rows: [{ benefit: "Funeral expenses", cell: "$3,000", value: 3000 }] });
  assert.deepEqual(shownFor(t, "a"), []);
});
for (const [benefit, section] of [["Child hospital cash", null], ["Children's education fund", null], ["Adult accidental death", null], ["Infant care benefit", null], ["Home nursing", "BENEFITS FOR SENIOR CITIZENS"], ["Hospital cash", "CHILD BENEFITS"], ["Medical expenses (spouse)", null]] as const) {
  test(`a kind of life in words ("${benefit}"${section ? `, section "${section}"` : ""}) withholds the row even when the reader marks it for every named person`, () => {
    const t = run({ lives: ["Asha Rao", "Kiran Rao", "Chen Rao"], column: "Limit per insured person", section, rows: [{ benefit, cell: "S$2,000", value: 2000 }] });
    for (const id of ["a", "k", "c"]) assert.deepEqual(shownFor(t, id), [], id);
  });
}
test("a kind of life in words on the next line ('Children: half of the above amount') withholds the row", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Hospital cash", cell: "S$50 per day", value: 50, pays: "per_day" }], extraLines: ["Children: half of the above amount"] });
  for (const id of ["a", "k"]) assert.deepEqual(shownFor(t, id), [], id);
});
test("a number the row owns is matched once: a child's 30 a day beside a 30-day limit is someone else's figure", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Hospital cash", cell: "S$100 per day, up to 30 days (children: S$30 per day)", value: 100, pays: "per_day", maxDays: 30 }] });
  for (const id of ["a", "k"]) assert.deepEqual(shownFor(t, id), [], id);
});
for (const mark of ["some_insured", null]) {
  test(`a neighbouring row the reader marks ${mark ?? "with nothing"} ("Child rate") withholds the row above it`, () => {
    const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Hospital cash", cell: "S$50 per day", value: 50, pays: "per_day" },
      { benefit: "Child rate", cell: "S$25 per day", value: 25, pays: "per_day", forWhom: mark }] });
    for (const id of ["a", "k"]) assert.deepEqual(shownFor(t, id), [], id);
  });
}
test("a neighbouring row the reader marks for some withholds the row below it too", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Junior rate", cell: "S$25 per day", value: 25, pays: "per_day", forWhom: "some_insured" },
    { benefit: "Hospital cash", cell: "S$50 per day", value: 50, pays: "per_day" }] });
  for (const id of ["a", "k"]) assert.deepEqual(shownFor(t, id), [], id);
});
test("a two-letter name in the row's label is a person's name: never the other insured's", () => {
  const family: FamilyMember[] = [{ id: "j", display_name: "Jo Lim" } as FamilyMember, { id: "b", display_name: "Ben Rao" } as FamilyMember];
  const { r, links } = certificate({ lives: ["Jo Lim", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Medical expenses - Jo", cell: "USD 50,000", value: 50000 }] });
  const t = assembleTable([r], family, links, [], NOW);
  assert.deepEqual(shownFor(t, "b"), []);
});
const NO_ONE = (o: Parameters<typeof certificate>[0], what: string) => {
  const t = run(o);
  for (const id of ["a", "b", "k", "c"]) assert.deepEqual(shownFor(t, id), [], `${what}: ${id}`);
};
test("an age group in the row's section is no one's", () => NO_ONE({ lives: ["Asha Rao", "Chen Rao"], column: "Limit per insured person", section: "ADDITIONAL BENEFITS FOR INSURED PERSONS AGED 65 AND OVER",
  rows: [{ benefit: "Home nursing", cell: "GBP 2,000", value: 2000 }] }, "aged 65 section"));
test("an under-18 section is no one's", () => NO_ONE({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", section: "INSURED PERSONS UNDER 18",
  rows: [{ benefit: "Funeral expenses", cell: "GBP 3,000", value: 3000 }] }, "under 18 section"));
for (const cell of ["GBP 50 per day (GBP 25 per day for a child under 18)", "GBP 50 per day; GBP 2,000 if aged 70 or over", "GBP 50 per day, double for a child aged 5"]) {
  test(`another figure on the row's own line is no one's: "${cell}"`, () => NO_ONE({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person",
    rows: [{ benefit: "Hospital cash", cell, value: 50, pays: "per_day" }] }, cell));
}
test("a quote of part of the line: the rest of its printed line (a child's rate) still makes it no one's", () => {
  const product = "Globe Travel Annual", insured = "Certificate C-7\tInsured persons: Asha Rao, Kiran Rao", column = "Limit per insured person";
  const text = `GLOBE TRAVEL ANNUAL - CERTIFICATE\n${insured}\nBenefit\t${column}\nHospital cash\tGBP 50 per day\t(GBP 25 per day for a child)\nEnd.`;
  const r = checkReading(page(text), { document: { kind: "personal_proof", product, insurer: null, namedPeople: ["Asha Rao", "Kiran Rao"], plan: null, periodFrom: null, periodTo: null },
    covers: ["Asha Rao", "Kiran Rao"].map((person) => cover({ person, product, cover: "Travel", quote: insured })),
    benefits: [row({ column, benefit: "Hospital cash", pays: "per_day", value: 50, quote: "Hospital cash\tGBP 50 per day", forWhom: "each_named_insured" })] });
  assert.equal(r.benefits.length, 1);
  const t = assembleTable([r], FAMILY, [{ section: sectionKeyOf(DOC, { section: null, column }), cover: coverKeyOf({ product, cover: "Travel", plan: null }), why: "x" }], [], NOW);
  for (const id of ["a", "k"]) assert.deepEqual(shownFor(t, id), [], id);
});
test("a child's rate on the next line (not a row of its own) is no one's", () => NO_ONE({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person",
  rows: [{ benefit: "Hospital cash", cell: "AUD 50 per day.", value: 50, pays: "per_day" }], extraLines: ["AUD 25 per day for a child."] }, "next line"));
for (const [a, b] of [["Medical expenses Mum", "Medical expenses Dad"], ["Medical expenses - Insured 1", "Medical expenses - Insured 2"], ["Adult medical expenses", "Junior medical expenses"]]) {
  test(`a row per life ("${a}", "${b}") with different figures is no one's`, () => NO_ONE({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person",
    rows: [{ benefit: a, cell: "USD 100,000", value: 100000 }, { benefit: b, cell: "USD 50,000", value: 50000 }] }, a));
}
test("a realistic travel certificate: distinct benefits whose names share a word ('Travel delay', 'Baggage delay') are each every named person's", () => {
  const rows: Line[] = ([["Medical expenses", 500000], ["Emergency medical evacuation", 1000000], ["Trip cancellation", 10000], ["Trip curtailment", 10000],
    ["Travel delay", 1000], ["Baggage delay", 500], ["Personal accident", 200000], ["Personal liability", 1000000]] as [string, number][]).map(([benefit, value]) => ({ benefit, cell: `S$${value.toLocaleString("en-US")}`, value }));
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows });
  for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id).map((x) => x.split(" | ")[0]), rows.map((x) => x.benefit), id);
  for (const id of ["k", "c"]) assert.deepEqual(shownFor(t, id), [], id);
});
// One benefit printed once per life, each row marked (wrongly) for every named person: whole-name checks, not shared words.
for (const [a, b] of [["Mum hospital cash", "Dad hospital cash"], ["Hospital cash Mum", "Hospital cash Dad"], ["Mum's hospital cash", "Dad's hospital cash"], ["Accident Mum", "Accident Dad"],
  ["Medical expenses Insured A", "Medical expenses Insured B"], ["Medical expenses Life Assured 1", "Medical expenses Life Assured 2"], ["Medical expenses AR", "Medical expenses BR"],
  ["Hospital cash Main Insured", "Hospital cash Joint Life"], ["Hospital cash Account Holder", "Hospital cash Co Applicant"], ["Hospital cash First Life", "Hospital cash Second Insured"],
  ["Hospital cash A", "Hospital cash B"], ["Hospital cash 1", "Hospital cash 2"], ["Hospital cash (I)", "Hospital cash (II)"], ["Medical expenses (Plan A)", "Medical expenses (Plan B)"],
  ["Medical expenses: Rao, A.", "Medical expenses: Rao, B."], ["Hospital cash", "Hospital cash Grandma"], ["Hospital cash", "Daily hospital income Dad"], ["Medical expenses", "Junior medical expenses"],
  ["Toddler medical expenses", "Medical expenses"], ["Pensioner hospital cash", "Hospital cash"],
  // Critic 1 on #466: a tier, a title, a sex or a plan size is not a kind of benefit.
  ["Gold medical expenses", "Silver medical expenses"], ["Hospital cash Mr", "Hospital cash Mrs"], ["Accidental death male", "Accidental death female"],
  ["Medical expenses individual", "Medical expenses couple"], ["Standard trip cancellation", "Premier trip cancellation"], ["Hospital cash Rao A", "Hospital cash Rao B"]]) {
  test(`one benefit printed per life ("${a}", "${b}") is no one's, even marked for every named person`, () => {
    const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person",
      rows: [{ benefit: a, cell: "USD 100,000", value: 100000 }, { benefit: b, cell: "USD 50,000", value: 50000 }, { benefit: "Personal liability", cell: "USD 1,000,000", value: 1000000 }] });
    for (const id of ["a", "b", "k", "c"]) assert.deepEqual(shownFor(t, id).filter((x) => !x.startsWith("Personal liability")), [], `${a}: ${id}`);
  });
}
test("a row whose name tells a life apart ('Accident Mum') makes the whole certificate's rows no one's: it prints its rows per life", () => NO_ONE({ lives: ["Asha Rao", "Ben Rao"],
  column: "Limit per insured person", rows: [{ benefit: "Medical expenses", cell: "USD 100,000", value: 100000 }, { benefit: "Personal liability", cell: "USD 1,000,000", value: 1000000 },
    { benefit: "Accident Mum", cell: "USD 50,000", value: 50000 }] }, "Accident Mum"));
test("a row named 'Sum insured' does not name a life: the certificate's rows are still every named person's (Critic 1 on #466)", () => {
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Sum insured", cell: "S$100,000", value: 100000 }, { benefit: "Trip cancellation", cell: "S$5,000", value: 5000 }] });
  for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id).map((x) => x.split(" | ")[0]), ["Sum insured", "Trip cancellation"], id);
});
test("'per insured person' in a row's own name does not count as naming a life", () => {
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Medical expenses per insured person", cell: "USD 100,000", value: 100000 }] });
  for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id).map((x) => x.split(" | ")[0]), ["Medical expenses per insured person"], id);
});
test("the same benefit printed twice is no one's", () => NO_ONE({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person",
  rows: [{ benefit: "Medical expenses", cell: "USD 100,000", value: 100000 }, { benefit: "Medical expenses", cell: "USD 50,000", value: 50000 }] }, "twice"));
test("a row naming one insured person is never the other's", () => {
  const t = run({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", rows: [{ benefit: "Medical expenses (Ben Rao)", cell: "USD 80,000", value: 80000 }] });
  assert.deepEqual(shownFor(t, "a"), []);
});
test("a row for each insured child is not an adult's", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Education grant for each insured child", cell: "USD 5,000", value: 5000 }] });
  assert.deepEqual(shownFor(t, "a"), []);
});
test("a column that does not say per person ('Sum insured / amount') gives no one the limits", () => NO_ONE({ lives: ["Asha Rao", "Ben Rao"], column: "Sum insured / amount",
  rows: [{ benefit: "Medical expenses", cell: "$100,000", value: 100000 }] }, "no per person"));
test("scheme terms (not the person's own certificate) give no one the limits", () => NO_ONE({ lives: ["Asha Rao", "Ben Rao"], column: "Limit per insured person", kind: "scheme_terms",
  rows: [{ benefit: "Medical expenses", cell: "$100,000", value: 100000 }] }, "scheme terms"));
test("a figure-only column with a second column beside it (per family) stays refused", () => {
  const product = "Globe Travel Annual";
  const insured = "Certificate C-7\tInsured persons: Asha Rao, Ben Rao";
  const text = `GLOBE TRAVEL ANNUAL - CERTIFICATE\n${insured}\nBenefit\tLimit per insured person\tLimit per family\nMedical expenses\t$100,000\t$300,000\nEnd.`;
  const r = checkReading(page(text), { document: { kind: "personal_proof", product, insurer: null, namedPeople: ["Asha Rao", "Ben Rao"], plan: null, periodFrom: null, periodTo: null },
    covers: ["Asha Rao", "Ben Rao"].map((person) => cover({ person, product, cover: "Travel", quote: insured })),
    benefits: [row({ column: "Limit per insured person", benefit: "Medical expenses", pays: "up_to", value: 100000, quote: "Medical expenses\t$100,000" }),
      row({ column: "Limit per family", benefit: "Medical expenses", pays: "up_to", value: 300000, quote: "$300,000", forWhom: "each_named_insured" })] });
  const key = coverKeyOf({ product, cover: "Travel", plan: null });
  const t = assembleTable([r], FAMILY, ["Limit per insured person", "Limit per family"].map((column) => ({ section: sectionKeyOf(DOC, { section: null, column }), cover: key, why: "x" })), [], NOW);
  for (const id of ["a", "b"]) assert.deepEqual(shownFor(t, id), [], id);
});
test("withheld rows are said, never dropped silently", () => {
  const t = run({ lives: ["Asha Rao", "Kiran Rao"], column: "Limit per insured person", rows: [{ benefit: "Hospital cash", cell: "GBP 50 per day (GBP 25 per day for a child under 18)", value: 50, pays: "per_day" }] });
  assert.equal(t.unlinkedSections[0]?.why, NOT_TOLD_WHY);
});

console.log(`benefit-table per-person certificate: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
