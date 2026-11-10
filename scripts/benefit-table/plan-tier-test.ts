/** A wording prints rows for every kind of plan and insured person side by side: a family plan's overall limits, a child
 * covered under a family plan, adults below or above an age. A person sees only the rows for their own plan and tier, as
 * their own documents print it (or the date of birth the household entered for the age groups); a cover their schedule
 * prints as not covered shows no amount (10 Nov: a single traveller's plan showed a family plan's S$12,500 baggage limit,
 * and a wording's figures for optional covers the schedule said were not bought). Made-up insurers and people in three
 * currencies; no household data, no model.
 *   npm run -s benefit-table:plan-tier-test */
import assert from "node:assert/strict";
import { checkReading } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, tierProblem, ageOn, type FamilyMember } from "@/lib/benefit-table/assemble";
import { singaporeDay } from "@/lib/benefit-table/dates";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const b = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[], plan: string | null = null) =>
  ({ document: { kind, product, insurer: null, namedPeople: [], plan, periodFrom: null, periodTo: null }, covers, benefits });
const NOW = new Date("2026-11-10T12:00:00+08:00");

const MARKETS = [
  { m: "SG", person: "Jane Doe", sign: "S$" },
  { m: "MY", person: "Aminah binti Yusof", sign: "RM " },
  { m: "UK", person: "Oliver Grant", sign: "£" },
] as const;

for (const { m, person, sign } of MARKETS) {
  const SCHED = `sched-${m}`, WORD = `word-${m}`;
  const scheduleFor = (planLine: string) => checkReading({ id: SCHED, name: "Travel schedule.pdf", readable: true, pages: [{ page: 1, text:
    `TRAVEL INSURANCE SCHEDULE\n${planLine}\nInsured person\t${person}\nOptional covers\nCancel for any reason\tNot covered\nHome cover\tNot covered\nPet care (${sign}50 per six-hour period of delay)\tNot covered\nSports equipment protector\tCovered` }] },
    reading("personal_proof", "Travel insurance", [{ person, product: "Travel insurance", cover: "Elite", plan: "Elite", sumInsured: null, asOf: null, page: 1, quote: `Insured person\t${person}` }],
      [b({ section: "Optional covers", benefit: "Cancel for any reason", pays: "not_covered", quote: "Cancel for any reason\tNot covered" }),
        b({ section: "Optional covers", benefit: "Home cover", pays: "not_covered", quote: "Home cover\tNot covered" }),
        b({ section: "Optional covers", benefit: `Pet care (${sign}50 per six-hour period of delay)`, pays: "not_covered", quote: `Pet care (${sign}50 per six-hour period of delay)\tNot covered` })], planLine.replace(/^Plan:\s*/, "").split("\t")[0]));
  const lines: [string, string, number][] = [
    ["Personal liability while on your trip", "Personal liability while on your trip", 750000],
    ["Theft of or damage to baggage: Overall limit for family plan*", "Overall limit for family plan*", 12500],
    ["Theft of or damage to baggage: per article", "Theft of or damage to baggage per article", 500],
    ["Personal accident: Adult below 70 years of age", "Adult below 70 years of age", 300000],
    ["Personal accident: Adult 70 years old or older", "Adult 70 years old or older", 60000],
    ["Personal accident: Child covered under a family plan", "Child covered under a family plan", 90000],
    ["Child companion", "Child companion", 7500],
    ["Hospital stay over 3 days", "Hospital stay over 3 days", 1000],
    ["Cancel for any reason: Trip cancellation for any reason", "Trip cancellation for any reason", 3000],
    ["Pet care", "Pet care", 150],
    ["Home contents", "Home contents", 6000],
    ["Sports equipment protector", "Sports equipment protector", 2000],
  ];
  const fig = (n: number) => `${sign}${n.toLocaleString("en-US")}`;
  const wording = checkReading({ id: WORD, name: "Travel wording.pdf", readable: true, pages: [{ page: 1, text:
    `TABLE OF BENEFITS\tElite\n${lines.map(([, q, v]) => `${q}\tup to ${fig(v)}`).join("\n")}` }] },
    reading("policy_wording", "Travel insurance", [], lines.map(([benefit, q, v]) => b({ section: "Table of benefits", column: "Elite", benefit, pays: "up_to", value: v, quote: `${q}\tup to ${fig(v)}` }))));
  const cover = coverKeyOf({ product: "Travel insurance", cover: "Elite", plan: "Elite" });
  const links = [{ section: sectionKeyOf(WORD, { section: "Table of benefits", column: "Elite" }), cover, why: "the plan" }];
  const table = (planLine: string, family: FamilyMember[]) => assembleTable([scheduleFor(planLine), wording], family, links, [], NOW);
  const shown = (planLine: string, family: FamilyMember[]) => Object.fromEntries(table(planLine, family).people[0].rows.filter((r) => r.source.documentId === WORD)
    .map((r) => [r.benefit, r.figure.kind === "printed" ? r.figure.amount : null]));

  test(`${m} T1 a single traveller with no date of birth: no family, child or age-group row; the plan's own rows stay`, () => {
    const rows = shown("Plan: Elite\tSingle trip", [{ id: "p", display_name: person }]);
    assert.equal(rows["Personal liability while on your trip"], 750000);
    assert.equal(rows["Theft of or damage to baggage: per article"], 500);
    assert.equal(rows["Child companion"], 7500, "a benefit about a child is not a tier");
    assert.equal(rows["Hospital stay over 3 days"], 1000, "a number of days is not an age group");
    for (const k of ["Theft of or damage to baggage: Overall limit for family plan*", "Personal accident: Child covered under a family plan",
      "Personal accident: Adult below 70 years of age", "Personal accident: Adult 70 years old or older"]) assert.ok(!(k in rows), k);
    const hidden = table("Plan: Elite\tSingle trip", [{ id: "p", display_name: person }]).notForPerson ?? [];
    assert.equal(hidden.length, 4);
    assert.ok(hidden.every((h) => h.personId === "p" && h.why));
  });

  test(`${m} T2 the date of birth on the Family page picks the person's age group, and only that one`, () => {
    const young = shown("Plan: Elite", [{ id: "p", display_name: person, date_of_birth: "1985-06-15" }]);
    assert.equal(young["Personal accident: Adult below 70 years of age"], 300000);
    assert.ok(!("Personal accident: Adult 70 years old or older" in young));
    const older = shown("Plan: Elite", [{ id: "p", display_name: person, date_of_birth: "1950-01-01" }]);
    assert.equal(older["Personal accident: Adult 70 years old or older"], 60000);
    assert.ok(!("Personal accident: Adult below 70 years of age" in older));
    // The day before the 70th birthday is still below 70.
    assert.equal(ageOn("1956-11-11", singaporeDay(NOW)), 69);
    assert.equal(ageOn("1956-11-10", singaporeDay(NOW)), 70);
  });

  test(`${m} T3 a family plan, as the schedule prints it, shows the family plan's overall limits`, () => {
    const rows = shown("Plan: Elite (Family plan)", [{ id: "p", display_name: person, date_of_birth: "1985-06-15" }]);
    assert.equal(rows["Theft of or damage to baggage: Overall limit for family plan*"], 12500);
    assert.ok(!("Personal accident: Child covered under a family plan" in rows), "an adult on a family plan is not the child");
  });

  test(`${m} T4 covers the schedule prints as not covered show no amount from the wording; a covered option keeps its figure`, () => {
    const rows = table("Plan: Elite", [{ id: "p", display_name: person }]).people[0].rows.filter((r) => r.source.documentId === WORD);
    for (const k of ["Cancel for any reason: Trip cancellation for any reason", "Pet care", "Home contents"]) {
      const r = rows.find((x) => x.benefit === k)!;
      assert.equal(r.figure.kind, "none", k);
      assert.match((r.figure as { why: string }).why, /not covered/);
    }
    assert.equal(rows.find((x) => x.benefit === "Sports equipment protector")!.figure.kind, "printed");
  });
}

test("U tier words: what counts as a family, child or age-group row", () => {
  const p = (benefit: string, own = "Plan: Elite", age: number | null = null) => tierProblem({ benefit, column: null }, own, age);
  assert.ok(p("Medical expenses: per family"));
  assert.ok(p("Medical expenses: each child"));
  assert.ok(p("Accidental death: insured aged 18 to 69 years"));
  assert.equal(p("Accidental death: insured aged 18 to 69 years", "Plan: Elite", 40), null);
  assert.ok(p("Accidental death: insured aged 18 to 69 years", "Plan: Elite", 70));
  assert.equal(p("Medical expenses: per family", "Family plan"), null);
  assert.equal(p("Claims of S$500 and above"), null);
  assert.equal(p("Return home earlier than planned"), null);
  assert.equal(p("Daily hospital cash up to 30 days"), null);
});

console.log(`benefit-table plan tier: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
