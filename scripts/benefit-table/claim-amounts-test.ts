/** Scripted tests: claim answers give the amounts the benefit table worked out (TE-ACC-20261113: 9 of 16 answers dropped a
 * printed cap, a daily amount or a percentage of the person's sum, although the Coverage page showed them). Four general
 * rules, each tested on made-up households in several currencies and layouts, with negative controls:
 * 1. A money figure with its currency code before it is never read as the number before it with that code after it
 *    ("02/11/1982<TAB>GBP 80,000" is GBP 80,000, not 1982 GBP).
 * 2. A percentage row worked out on the person's own sum insured is shown in the chat as the server worked it out, after the
 *    chat's checks find the row, the person's own sum line and any maximum in the stored pages and work it out again.
 *    Two sums for the person, a line with two figures, or a bare "$" give no figure.
 * 3. "Limited to 25% of the Sum Insured" states the share, not a money cap, on a document printed for one life; on a family
 *    schedule, or with money or another life's sum beside it, the row stays capped.
 * 4. Stay totals read a first paid day in words ("from the third consecutive day") and "up to N days" only as a day limit.
 * Family schedules' shared tables and child/adult rows are left as main has them (no amount): four Critic rounds showed
 * no layout rule that proves whose they are (see PR #449).
 * No model, database or network.
 *   npm run benefit-table:claim-amounts-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, NOT_TOLD_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, withoutOwnShareCap, CAP_WORDS, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";
import { anyMoneyFigures } from "@/lib/format/currency";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

// ---------- 1. Money figures ----------
test("a code that opens the next figure is never the number before it's (dates, ages, IC numbers, policy numbers)", () => {
  const cases: [string, number, string][] = [
    ["Daniel Roe\tSpouse\t02/11/1982\tGBP 80,000", 80000, "GBP"],
    ["Ahmad bin Ali\t880101-14-5555\tMYR 150,000", 150000, "MYR"],
    ["Marie Dupont\t42\tEUR 60,000", 60000, "EUR"],
    ["Ngozi Ade\t1982-11-02 GBP 80,000", 80000, "GBP"],
    ["Ngozi Ade\t2 Nov 1982 GBP 80,000", 80000, "GBP"],
    ["Tamati Ruru\tPolicyholder\t12/04/1983\t300,000 NZD", 300000, "NZD"],
    ["Ines Moreau\tID 55120 age 41 EUR 90,000", 90000, "EUR"],
  ];
  for (const [line, value, currency] of cases) {
    const f = moneyFiguresIn(line);
    assert.deepEqual(f.map((x) => [x.value, x.currency]), [[value, currency]], line);
    assert.deepEqual(anyMoneyFigures(line).map((x) => x.value), [value], line);
  }
});
test("control: tables that print the code after the figure keep every figure, whatever its size (Critic #449 round 2)", () => {
  const cases: [string, number[]][] = [["2000 SGD 1 visit", [2000]], ["Room 2000 SGD 30 days", [2000]], ["Accidental death 1999 USD 2 lives", [1999]],
    ["Excess 250 EUR 25,000 EUR", [250, 25000]], ["Daily hospital cash\t100 SGD\t3,000 SGD", [100, 3000]], ["5000 MYR 50,000 MYR", [5000, 50000]],
    ["500 SGD/1,000 SGD", [500, 1000]], ["Hospital cash\t100 SGD\t30 days", [100]], ["Death\t50,000 EUR\t25,000 EUR", [50000, 25000]],
    ["Funeral expenses\t10,000 NZD\t5,000 NZD", [10000, 5000]], ["Ahmad Bin Ali\tx\t120 MYR\t150,000 MYR", [120, 150000]], ["max 2000 MYR\t1 claim", [2000]]];
  for (const [line, want] of cases) {
    assert.deepEqual(moneyFiguresIn(line).map((x) => x.value), want, line);
    assert.deepEqual(anyMoneyFigures(line).map((x) => x.value), want, line);
  }
});
test("control: a figure with its code after it is still read", () => {
  assert.deepEqual(moneyFiguresIn("Benefit 80,000 GBP").map((x) => [x.value, x.currency]), [[80000, "GBP"]]);
  assert.deepEqual(moneyFiguresIn("1,500 EUR per day").map((x) => [x.value, x.currency]), [[1500, "EUR"]]);
  assert.deepEqual(anyMoneyFigures("paid 2,000 MYR.").map((x) => x.value), [2000]);
  assert.deepEqual(moneyFiguresIn("GBP 80,000 and GBP 1,500").map((x) => x.value), [80000, 1500]);
});

// ---------- 3a. Own-share cap words ----------
test("'limited to' the row's own percentage names the share itself, not a money cap", () => {
  for (const [text, pct] of [["For an insured child under 18, limited to 25% of the Sum Insured.", 25], ["limited to 12.5 per cent of the Sum Insured", 12.5], ["Limited to 40% of the Sum Assured", 40]] as const)
    assert.equal(CAP_WORDS.test(withoutOwnShareCap(text, pct)), false, text);
});
test("control: 'up to', 'maximum of' or 'not exceeding' a share says it varies up to it, so the row stays capped (Critic #449 F3)", () => {
  for (const [text, pct] of [["Up to 50% of the Sum Insured according to the Scale of Fractures", 50], ["Up to 100% of the Sum Insured as per the Scale of Benefits", 100], ["subject to a maximum of 10% of the Sum Covered", 10], ["not exceeding 12.5 per cent of the Sum Insured", 12.5]] as const)
    assert.equal(CAP_WORDS.test(withoutOwnShareCap(text, pct)), true, text);
});
test("control: a money cap, or a cap word before another percentage, still marks the row", () => {
  assert.equal(CAP_WORDS.test(withoutOwnShareCap("2% of the Sum Insured per fracture, maximum GBP 1,500 per accident", 2)), true);
  assert.equal(CAP_WORDS.test(withoutOwnShareCap("100% of the Sum Insured, up to 25% for a child", 100)), true);
  assert.equal(CAP_WORDS.test(withoutOwnShareCap("limited to 25% of the Sum Insured", 2)), true);
});

// ---------- Households ----------
type Person = { name: string; relationship: string; line: string; sum: number; dob?: string };
type Spec = { id: string; insurer: string; product: string; policyNumber: string | null; sign: string; currency: string; people: Person[]; page1: string; page2: string;
  benefits: Record<string, unknown>[]; personPage?: number };
const ACC = "44444444-4444-4444-4444-444444444444";
const pid = (n: number) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
function hdoc(policyId: string, name: string, product: string, insurer: string, policyNumber: string | null, people: string[], pages: string[], supersededAt: string | null = null): Household["documents"][number] {
  return { policyId, name, insurer, productName: product, policyNumber, documentType: null, documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01",
    uploadedFor: null, linkedPeople: people, supersededAt, processingStatus: "ready", pages: pages.map((text, i) => ({ page: i + 1, text })) };
}
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });

function build(spec: Spec, extra: Household["documents"] = []) {
  const family: FamilyMember[] = spec.people.map((p, i) => ({ id: `m${i}`, display_name: p.name, relationship: p.relationship, date_of_birth: p.dob ?? null }));
  const d = hdoc(spec.id, `${spec.product}.pdf`, spec.product, spec.insurer, spec.policyNumber, spec.people.map((p) => p.name), [spec.page1, spec.page2]);
  const house: Household = { accountId: ACC, members: spec.people.map((p) => ({ name: p.name, relationship: p.relationship })), documents: [d, ...extra] };
  const reading = checkReading(src(d), { document: { kind: "personal_proof", product: spec.product, insurer: spec.insurer, namedPeople: spec.people.map((p) => p.name), plan: null, periodFrom: null, periodTo: null },
    covers: spec.people.map((p) => ({ person: p.name, product: spec.product, cover: spec.product, plan: null, riderOf: null, policyNumber: spec.policyNumber, premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: spec.personPage ?? 1, sumInsured: p.sum, quote: p.line })), benefits: spec.benefits });
  const key = coverKeyOf({ product: spec.product, cover: spec.product, plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(spec.id, b)))].map((section) => ({ section, cover: key, why: "the schedule's table of benefits" }));
  const table = assembleTable([reading], family, links);
  return { house, table, rows: chatRows(table, house), reading };
}
/** The model's reply naming one row, through the row step, the chat's checks and the label check, as the app's turn does. */
function ask(h: ReturnType<typeof build>, person: string, benefit: RegExp, question = "What can we claim?", extra: Record<string, unknown> = {}) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  if (!row) return { row: null, amounts: [] as string[], kept: [] as { text: string; amount?: { text: string } | null; basis?: string | null }[] };
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" }, ...extra }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), question, []);
  const { answer } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  return { row, kept, amounts: kept.filter((s) => s.amount && s.personName === person).map((s) => s.amount!.text) };
}

/** A family accident schedule: people and sums on page 1, one shared table of benefits on page 2. */
function family(o: { sign: string; currency: string; people: Person[]; insurer: string; product: string; id?: string; policyNumber?: string | null; capLine?: string; childLine?: string; hospitalRule?: string }) {
  const s = o.sign;
  const page1 = `${o.insurer}\n${o.product.toUpperCase()} - SCHEDULE\nPolicy number: ${o.policyNumber ?? "-"}\nInsured person\tRelationship\tDate of birth\tSum Insured\n${o.people.map((p) => p.line).join("\n")}`;
  const fracture = o.capLine ?? `Broken bones\t4% of the Sum Insured per fracture, maximum ${s}3,000 per accident`;
  const child = o.childLine ?? "For an insured child under 18, limited to 50% of the Sum Insured.";
  const stayRule = o.hospitalRule ?? "payable from the second day, up to 60 days per accident";
  const hospital = `Hospital allowance\t${s}80 per day in hospital, ${stayRule}`;
  const page2 = `TABLE OF BENEFITS\nSection\tBenefit\tAmount payable\n1\tAccidental death\t100% of the Sum Insured. ${child}\n2\t${fracture}\n3\tBurns\t10% of the Sum Insured\n4\t${hospital}`;
  return build({ id: o.id ?? pid(1), insurer: o.insurer, product: o.product, policyNumber: o.policyNumber ?? null, sign: s, currency: o.currency, people: o.people, page1, page2,
    benefits: [
      ben({ section: "1", benefit: "Accidental death", column: "Insured child under 18", pays: "percent", value: 50, percentOf: "sum_insured", quote: child }),
      ben({ section: "2", benefit: "Broken bones", pays: "percent", value: 4, percentOf: "sum_insured", quote: fracture, ...(o.capLine ? {} : { cap: 3000, capQuote: `maximum ${s}3,000 per accident` }) }),
      ben({ section: "4", benefit: "Hospital allowance", pays: "per_day", value: 80, fromDay: null, maxDays: Number(/up to (\d+) days/.exec(stayRule)?.[1] ?? NaN) || null, quote: hospital }),
      ben({ section: "3", benefit: "Burns", pays: "percent", value: 10, percentOf: "sum_insured", quote: "Burns\t10% of the Sum Insured" }),
    ] });
}
const MYR = { sign: "RM ", currency: "MYR", insurer: "Example Takaful Berhad", product: "Keluarga Accident Plan", people: [
  { name: "Ahmad Bin Ali", relationship: "self", line: "Ahmad Bin Ali\tPolicyholder\t01/01/1988\tRM 150,000", sum: 150000 },
  { name: "Siti Binti Omar", relationship: "spouse", line: "Siti Binti Omar\tSpouse\t15/05/1990\tRM 100,000", sum: 100000 },
  { name: "Adam Bin Ahmad", relationship: "child", dob: "2016-09-09", line: "Adam Bin Ahmad\tChild\t09/09/2016\tRM 40,000", sum: 40000 }] };
const EUR = { sign: "€", currency: "EUR", insurer: "Exemple Assurances SA", product: "Famille Accident Cover", people: [
  { name: "Marie Dupont", relationship: "self", line: "Marie Dupont\tPolicyholder\t42\t€60,000", sum: 60000 },
  { name: "Luc Dupont", relationship: "child", dob: "2019-05-01", line: "Luc Dupont\tChild\t7\t€20,000", sum: 20000 }] };

// ---------- 2. Server-worked percentages reach the answer ----------
test("MYR family schedule: the capped fracture benefit shows the cap the person's own share reaches", () => {
  const h = family(MYR);
  const a = ask(h, "Ahmad Bin Ali", /Broken bones/);
  assert.deepEqual(a.amounts, ["Up to RM3,000"]);
  assert.match(a.kept.find((s) => s.amount)!.basis ?? "", /4% of Ahmad Bin Ali's sum insured of RM150,000 .* is RM6,000, more than the most it pays, so up to RM3,000/);
});
test("MYR family schedule: below the cap, the worked-out share, with the cap said in the basis", () => {
  const h = family(MYR);
  const a = ask(h, "Adam Bin Ahmad", /Broken bones/);
  assert.deepEqual(a.amounts, ["RM1,600"]);
  assert.match(a.kept.find((s) => s.amount)!.basis ?? "", /within its maximum of RM3,000/);
});
test("EUR family schedule with ages before the sums: an uncapped share of each person's own sum", () => {
  const h = family(EUR);
  assert.deepEqual(ask(h, "Marie Dupont", /Burns/).amounts, ["€6,000"]);
  assert.deepEqual(ask(h, "Luc Dupont", /Burns/).amounts, ["€2,000"]);
});
test("each person's figure is worked on their own sum, never another member's", () => {
  const h = family(MYR);
  assert.deepEqual(ask(h, "Siti Binti Omar", /Burns/).amounts, ["RM10,000"]);
  assert.deepEqual(ask(h, "Adam Bin Ahmad", /Burns/).amounts, ["RM4,000"]);
});

// ---------- 2. Negative controls ----------
test("control: a person line that also prints a premium gives no figure (which figure is the sum is doubt)", () => {
  const people = MYR.people.map((p) => ({ ...p, line: `${p.line}\tRM 120.00` }));
  const h = family({ ...MYR, people });
  for (const p of people) assert.deepEqual(ask(h, p.name, /Burns/).amounts, [], p.name);
});
test("control: a bare \"$\" names no currency, so no figure", () => {
  const people = MYR.people.map((p) => ({ ...p, line: p.line.replace("RM ", "$") }));
  const h = family({ ...MYR, sign: "$", currency: "", people });
  assert.deepEqual(ask(h, "Ahmad Bin Ali", /Burns/).amounts, []);
});
/** A wording printing the table of benefits, a schedule printing each person's sum (policy KAP-1001), and maybe an older
 * schedule of the same policy printing another sum for Ahmad. */
function wordingAndSchedule(older: "none" | "live" | "superseded") {
  const people = MYR.people;
  const wording = hdoc(pid(5), "Policy wording.pdf", MYR.product, MYR.insurer, "KAP-1001", people.map((p) => p.name), ["POLICY WORDING", "TABLE OF BENEFITS\nBurns\t10% of the Sum Insured"]);
  wording.documentRole = "policy_wording";
  const schedule = hdoc(pid(6), "Schedule.pdf", MYR.product, MYR.insurer, "KAP-1001", people.map((p) => p.name), [`SCHEDULE\n${people.map((p) => p.line).join("\n")}`]);
  const docs = [wording, schedule];
  if (older !== "none") docs.push(hdoc(pid(7), "Older schedule.pdf", MYR.product, MYR.insurer, "KAP-1001", ["Ahmad Bin Ali"], ["SCHEDULE\nAhmad Bin Ali\tPolicyholder\tRM 120,000"], older === "superseded" ? "2026-03-01" : null));
  const house: Household = { accountId: ACC, members: people.map((p) => ({ name: p.name, relationship: p.relationship })), documents: docs };
  const fam: FamilyMember[] = people.map((p, i) => ({ id: `m${i}`, display_name: p.name, relationship: p.relationship }));
  const doc = (k: string, product: string, named: string[]) => ({ kind: k, product, insurer: MYR.insurer, namedPeople: named, plan: null, periodFrom: null, periodTo: null });
  const rw = checkReading(src(wording), { document: doc("policy_wording", MYR.product, []), covers: [], benefits: [ben({ section: "Benefits", benefit: "Burns", pays: "percent", value: 10, percentOf: "sum_insured", quote: "Burns\t10% of the Sum Insured" })] });
  const rs = checkReading(src(schedule), { document: doc("personal_proof", MYR.product, people.map((p) => p.name)), benefits: [],
    covers: people.map((p) => ({ person: p.name, product: MYR.product, cover: MYR.product, plan: null, riderOf: null, policyNumber: "KAP-1001", premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, sumInsured: p.sum, quote: p.line })) });
  const key = coverKeyOf({ product: MYR.product, cover: MYR.product, plan: null, riderOf: null });
  const table = assembleTable([rw, rs], fam, [{ section: sectionKeyOf(pid(5), { section: "Benefits", column: null }), cover: key, why: "the wording's table" }]);
  return { house, table, rows: chatRows(table, house), reading: rw };
}
test("a wording's percentage on the person's own schedule sum is worked out", () => {
  assert.deepEqual(ask(wordingAndSchedule("none"), "Ahmad Bin Ali", /Burns/).amounts, ["RM15,000"]);
});
test("control: an older live schedule of the same policy printing another sum makes it doubt: no figure", () => {
  assert.deepEqual(ask(wordingAndSchedule("live"), "Ahmad Bin Ali", /Burns/).amounts, []);
  // Siti has one sum only: hers is still shown.
  assert.deepEqual(ask(wordingAndSchedule("live"), "Siti Binti Omar", /Burns/).amounts, ["RM10,000"]);
});
test("control: a superseded schedule never counts as a second sum", () => {
  assert.deepEqual(ask(wordingAndSchedule("superseded"), "Ahmad Bin Ali", /Burns/).amounts, ["RM15,000"]);
});
test("a renewal schedule's own table on its own sums is shown whatever last year's schedule printed", () => {
  const h = family({ ...MYR, policyNumber: "KAP-1001" });
  h.house.documents.push(hdoc(pid(9), "Last year.pdf", MYR.product, MYR.insurer, "KAP-1001", MYR.people.map((p) => p.name), ["SCHEDULE\nAhmad Bin Ali\tPolicyholder\tRM 120,000"]));
  assert.deepEqual(ask(h, "Ahmad Bin Ali", /Burns/).amounts, ["RM15,000"]);
});
test("control: two sums for the person on the row's own schedule give no figure", () => {
  const people = [...MYR.people];
  const h = family({ ...MYR, people });
  h.house.documents[0].pages[0].text += "\nAhmad Bin Ali\tPolicyholder (revised)\t01/01/1988\tRM 175,000";
  assert.deepEqual(ask(h, "Ahmad Bin Ali", /Burns/).amounts, []);
});
test("control: the server figure is never taken from the model's JSON", () => {
  const h = family(MYR);
  const raw = { bottomLine: "-", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Burns.", person: "Ahmad Bin Ali", document: "D1", quote: "Burns\t10% of the Sum Insured", amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, serverFigure: { value: 999999 }, figures: [{ value: 1 }] }] };
  const { answer } = verifyAnswer(h.house, readModelAnswer(raw)!, ["?"]);
  assert.ok(!(answer.statements ?? []).some((s) => s.amount), JSON.stringify(answer.statements));
});

// ---------- 3b. Insured-child rows on a family schedule ----------
test("on a one-life certificate, 'limited to N% of the Sum Insured' is the share, worked out (no 'maximum not captured')", () => {
  for (const [line, pct] of [["Loss of one finger\tLimited to 10% of the Sum Insured.", 10], ["Partial loss of hearing\tlimited to 25% of the sum insured", 25]] as const) {
    const [benefit] = line.split("\t");
    const h = schedule({ people: [MYR.people[0]], page2: `TABLE OF BENEFITS\n${line}`, benefits: [ben({ benefit, pays: "percent", value: pct, percentOf: "sum_insured", quote: line })] });
    const r = h.table.people[0].rows.find((x) => x.benefit === benefit);
    assert.ok(r?.figure.kind === "worked_out" && r.figure.amount === 150000 * pct / 100, `${line}: ${JSON.stringify(r?.figure)}`);
  }
});
test("control: a 'limited to' share that names a kind of life is never worked out, even on one life's certificate (Critic #449 round 5)", () => {
  for (const spec of [MYR, EUR]) for (const p of spec.people) {
    const h = family({ ...spec, people: [p] });
    assert.notEqual(h.table.people[0].rows.find((x) => x.column === "Insured child under 18")?.figure.kind, "worked_out", p.name);
  }
});
test("control: on a family schedule the share's life is not settled by the row, so no one gets an amount for it", () => {
  for (const spec of [MYR, EUR]) {
    const h = family(spec);
    for (const p of spec.people) assert.notEqual(h.table.people.find((x) => x.name === p.name)!.rows.find((x) => x.column === "Insured child under 18")?.figure.kind, "worked_out", p.name);
  }
});
test("control: 'limited to N%' of another life's sum, or with money beside it, stays capped on a one-life certificate", () => {
  const child = MYR.people[2];
  for (const childLine of ["For an insured child under 18, limited to 50% of the Sum Insured, maximum RM 30,000.", "For an insured child under 18, limited to 50% of the Sum Insured of the Principal Insured.",
    "For an insured child under 18, limited to 50% of the Sum Insured applicable to the Insured Parent."]) {
    const h = family({ ...MYR, people: [child], childLine });
    assert.notEqual(h.table.people[0].rows.find((x) => x.column === "Insured child under 18")?.figure.kind, "worked_out", childLine);
  }
});

// ---------- 4. Daily amounts ----------
const SITI = MYR.people[1], MARIE = EUR.people[0];
test("a stay the household describes is worked out from a first paid day printed in words, and 'up to N days'", () => {
  const h = family({ ...MYR, people: [SITI] });
  const a = ask(h, "Siti Binti Omar", /Hospital allowance/, "Siti was in hospital for 6 days. How much hospital allowance?", { perDay: { stayDays: 6 } });
  assert.ok(a.amounts.includes("RM80"), JSON.stringify(a.amounts));
  assert.ok(a.amounts.includes("RM400"), `6 days, paid from day 2: 5 x RM80. Got ${JSON.stringify(a.amounts)}`);
  const g = family({ ...EUR, people: [MARIE], hospitalRule: "payable from the third consecutive day, up to 30 days per accident" });
  const b = ask(g, "Marie Dupont", /Hospital allowance/, "Marie was in hospital for 5 days. How much?", { perDay: { stayDays: 5 } });
  assert.ok(b.amounts.includes("€240"), `5 days, paid from day 3: 3 x €80. Got ${JSON.stringify(b.amounts)}`);
});
test("control: a stay rule with another day rule beside it gives no total", () => {
  const h = family({ ...MYR, people: [SITI], hospitalRule: "payable from the second day, up to 60 days per accident, and 20 days for a stay abroad" });
  const a = ask(h, "Siti Binti Omar", /Hospital allowance/, "Siti was in hospital for 6 days. How much hospital allowance?", { perDay: { stayDays: 6 } });
  assert.ok(!a.amounts.includes("RM400"), JSON.stringify(a.amounts));
});
test("control: on a page that also prints the people's own lines, a fixed figure stays no one's", () => {
  const people = MYR.people;
  const page1 = `SCHEDULE\n${people.map((p) => p.line).join("\n")}\nHospital allowance\tRM 80 per day`;
  const h = build({ id: pid(3), insurer: MYR.insurer, product: MYR.product, policyNumber: null, sign: "RM ", currency: "MYR", people, page1, page2: "Notes",
    benefits: [ben({ section: "Benefits", benefit: "Hospital allowance", pays: "per_day", value: 80, page: 1, quote: "Hospital allowance\tRM 80 per day" })] });
  for (const p of people) assert.ok(!h.table.people.find((x) => x.name === p.name)!.rows.some((r) => r.benefit === "Hospital allowance"), p.name);
  assert.ok(h.table.unlinkedSections.some((u) => u.why === NOT_TOLD_WHY));
});

// ---------- 5. Critic #449 controls: varied layouts that must not hand one life's figure to another ----------
/** A family schedule built from its own table of benefits (page 2), with the people as given. */
function schedule(o: { people: Person[]; page2: string; benefits: Record<string, unknown>[]; product?: string; id?: string }) {
  const product = o.product ?? "Household Accident Plan";
  const page1 = `Example Insurance Bhd\n${product.toUpperCase()} - SCHEDULE\nInsured person\tRelationship\tDate of birth\tSum Insured\n${o.people.map((p) => p.line).join("\n")}`;
  return build({ id: o.id ?? pid(7), insurer: "Example Insurance Bhd", product, policyNumber: null, sign: "RM ", currency: "MYR", people: o.people, page1, page2: o.page2, benefits: o.benefits });
}
const rowOf = (h: ReturnType<typeof build>, person: string, pick: (r: { benefit: string; column: string | null }) => boolean) =>
  h.table.people.find((x) => x.name === person)!.rows.find(pick);
const ADULT_CHILD_PAGE = "TABLE OF BENEFITS\nBenefit\tAdult\tChild\nHospital cash per day\tRM 100\tRM 50";
const adultChildRows = [
  ben({ benefit: "Hospital cash per day", column: "Adult", pays: "per_day", value: 100, quote: "Hospital cash per day\tRM 100\tRM 50" }),
  ben({ benefit: "Hospital cash per day", column: "Child", pays: "per_day", value: 50, quote: "Hospital cash per day\tRM 100\tRM 50" })];
test("control: a family schedule's shared table (no person's line on its page) stays no one's in this change, whatever its layout", () => {
  for (const [page2, benefits] of [[ADULT_CHILD_PAGE, adultChildRows], [`TABLE OF BENEFITS\nBenefit\tAmount payable\nMedical expenses\tUp to RM 2,500 per accident`, [ben({ benefit: "Medical expenses", value: 2500, quote: "Medical expenses\tUp to RM 2,500 per accident" })]]] as const) {
    const h = schedule({ people: MYR.people, page2, benefits: [...benefits] });
    for (const p of MYR.people) assert.deepEqual(h.table.people.find((x) => x.name === p.name)!.rows.filter((r) => r.figure.kind !== "none").map((r) => r.benefit), [], p.name);
  }
});
test("control: a plan column of a shared table is never given to everyone", () => {
  const h = schedule({ people: MYR.people, page2: "TABLE OF BENEFITS\nBenefit\tPlan A\tPlan B\nHospital cash per day\tRM 100\tRM 200",
    benefits: [ben({ benefit: "Hospital cash per day", column: "Plan A", pays: "per_day", value: 100, quote: "Hospital cash per day\tRM 100\tRM 200" })] });
  for (const p of MYR.people) assert.equal(rowOf(h, p.name, (r) => r.column === "Plan A"), undefined, p.name);
});
test("control: a shared-table row printed for an age group is no one's (it cannot be told from the shared page)", () => {
  const benefit = "Hospital cash for insured persons aged 65 and above", quote = `${benefit}\tRM 50 per day`;
  const people: Person[] = [
    { name: "Ahmad Bin Ali", relationship: "self", dob: "1950-01-01", line: "Ahmad Bin Ali\tPolicyholder\t01/01/1950\tRM 150,000", sum: 150000 },
    { name: "Siti Binti Omar", relationship: "spouse", dob: "1970-01-01", line: "Siti Binti Omar\tSpouse\t01/01/1970\tRM 100,000", sum: 100000 }];
  const h = schedule({ people, page2: `TABLE OF BENEFITS\nBenefit\tAmount payable\n${quote}`, benefits: [ben({ benefit, pays: "per_day", value: 50, quote })] });
  for (const p of people) assert.equal(rowOf(h, p.name, (x) => x.benefit === benefit)?.figure.kind ?? "none", "none", p.name);
});
// ---------- 6. Critic #449 round 3 controls ----------
const AU: Person[] = [
  { name: "Liam Kelly", relationship: "self", line: "Liam Kelly\tPolicyholder\t22/07/1984\tAUD 300,000", sum: 300000 },
  { name: "Grace Kelly", relationship: "spouse", line: "Grace Kelly\tSpouse\t03/03/1986\tAUD 200,000", sum: 200000 },
  { name: "Noah Kelly", relationship: "son", line: "Noah Kelly\tSon\t11/10/2004\tAUD 200,000", sum: 200000 }];
function auSchedule(page2: string, benefits: Record<string, unknown>[], people = AU) {
  const page1 = `Example General Ltd\nFAMILY ACCIDENT PLAN - SCHEDULE\nInsured person\tRelationship\tDate of birth\tSum Insured\n${people.map((p) => p.line).join("\n")}`;
  return build({ id: pid(9), insurer: "Example General Ltd", product: "Family Accident Plan", policyNumber: null, sign: "AUD ", currency: "AUD", people, page1, page2, benefits });
}
test("a shared table's rows tied to one life, kind or plan by its page or line are no one's (Critic #449 round 3, F1, F2)", () => {
  const layouts: [string, string, Record<string, unknown>[]][] = [
    ["per-person blocks", "SCHEDULE OF BENEFITS\nLiam Kelly\nMedical expenses\tAUD 5,000\nGrace Kelly\nMedical expenses\tAUD 3,000",
      [ben({ section: "Schedule of benefits", benefit: "Medical expenses", value: 5000, quote: "Medical expenses\tAUD 5,000" })]],
    ["adult and child sections", "ADULT BENEFITS\nHospital cash\tAUD 200 per day\nCHILD BENEFITS\nHospital cash\tAUD 100 per day",
      [ben({ section: "Adult benefits", benefit: "Hospital cash", pays: "per_day", value: 200, quote: "Hospital cash\tAUD 200 per day" })]],
    ["plan sections", "PLAN A\nMedical expenses\tAUD 5,000\nPLAN B\nMedical expenses\tAUD 1,000",
      [ben({ section: "Plan A", benefit: "Medical expenses", value: 5000, quote: "Medical expenses\tAUD 5,000" })]],
    ["child rate on the row's line", "TABLE OF BENEFITS\nHospital cash\tAUD 100 per day, AUD 50 per day for a child",
      [ben({ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tAUD 100 per day" })]],
    ["child rate on the next line", "TABLE OF BENEFITS\nHospital cash\tAUD 100 per day.\nAUD 50 per day for a child",
      [ben({ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tAUD 100 per day" })]],
    ["double for children", "TABLE OF BENEFITS\nHospital cash\tAUD 100 per day; double for children",
      [ben({ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tAUD 100 per day" })]]];
  for (const [what, page2, benefits] of layouts) {
    const h = auSchedule(page2, benefits);
    for (const p of AU) assert.deepEqual(h.table.people.find((x) => x.name === p.name)!.rows.filter((r) => r.figure.kind !== "none").map((r) => r.benefit), [], `${what}: ${p.name}`);
  }
});
test("a printed age group is settled only by a date of birth, never by the relationship alone (Critic #449 round 3, F3)", () => {
  for (const column of ["Insured child under 16", "Child (under 16)"]) {
    const quote = "For an insured child under 16, limited to 25% of the Sum Insured.";
    const h = auSchedule(`TABLE OF BENEFITS\nAccidental death\t${quote}`, [ben({ benefit: "Accidental death", column, pays: "percent", value: 25, percentOf: "sum_insured", quote })]);
    assert.equal(rowOf(h, "Noah Kelly", (x) => x.benefit === "Accidental death")?.figure.kind ?? "none", "none", column);
  }
});
test("'limited to N%' with money beside it stays capped, whatever words join them (Critic #449 round 3, F4)", () => {
  for (const tail of ["or AUD 15,000", "but not more than AUD 15,000", "and in no case more than AUD 15,000", "(AUD 15,000 being the most payable)"]) {
    const quote = `For an insured child under 16, limited to 25% of the Sum Insured ${tail}.`;
    const people = AU.map((p) => p.name === "Noah Kelly" ? { ...p, dob: "2014-01-01", line: "Noah Kelly\tSon\t01/01/2014\tAUD 200,000" } : p);
    const h = auSchedule(`TABLE OF BENEFITS\nAccidental death\t${quote}`, [ben({ benefit: "Accidental death", column: "Insured child under 16", pays: "percent", value: 25, percentOf: "sum_insured", quote })], people);
    assert.notEqual(rowOf(h, "Noah Kelly", (x) => x.benefit === "Accidental death")?.figure.kind, "worked_out", tail);
  }
});
test("a payment 'for each insured child' is not the child's own row (Critic #449 round 3, F7)", () => {
  const quote = "Education grant\tAUD 5,000 for each insured child if the Principal dies as a result of an accident";
  const h = auSchedule(`TABLE OF BENEFITS\n${quote}`, [ben({ benefit: "Education grant", value: 5000, quote })]);
  for (const p of AU) assert.equal(rowOf(h, p.name, (x) => x.benefit === "Education grant")?.figure.kind ?? "none", "none", p.name);
});
test("a code in its own table cell is the figure before it's when another cell follows (Critic #449 round 3, F5, F6)", () => {
  const cases: [string, number[]][] = [["Hospital cash\t100\tSGD\t30 days", [100]], ["80,000\tGBP\t100%", [80000]], ["Medical\t1,000\tEUR\t2 claims", [1000]],
    ["50\tGBP\t3rd day", [50]], ["500\tUSD\t12 months", [500]], ["Liam Kelly\t100,000\tAUD\t22/07/1984", [100000]], ["Liam Kelly\t100,000\tAUD\t500,000\tAUD", [100000, 500000]],
    ["Plan 3 NZD 100,000", [100000]], ["Class 2 CHF 50,000", [50000]], ["Policy year 2025 CHF 10,000", [10000]], ["1-2 NZD 500", [500]], ["Plan 3 SGD 100,000", [100000]],
    ["There is no 50 EUR excess", [50]], ["Policy No. 12 EUR 500", [500]]];
  for (const [line, want] of cases) {
    assert.deepEqual(moneyFiguresIn(line).map((x) => x.value), want, line);
    assert.deepEqual(anyMoneyFigures(line).map((x) => x.value), want, line);
  }
});
test("a code between two figures opens the later one only when it ends the cell (Critic #449 round 6, F1, F2)", () => {
  const cases: [string, number[]][] = [["Hospital 25,000 EUR 80 %", [25000]], ["Deductible 500 EUR 20 % co-pay", [500]], ["1,000 SGD 2 / year", [1000]],
    ["1,000 SGD 2 (visits)", [1000]], ["1,000 SGD 12 mths", [1000]], ["500 EUR 10 Tage", [500]], ["500 EUR 30 jours", [500]], ["5000 EUR 3 séances", [5000]],
    ["150 SGD 365", [150]], ["Total 1,500 USD 2026", [1500]], ["Total 1,500 USD 15 Jan 2026", [1500]], ["Class 1 Marine 5,000 SGD", [5000]],
    ["Plan 3 Junior 2,000 EUR", [2000]], ["Option 2 Separate 300 EUR", [300]], ["Plan 3 NZD 100000", [100000]], ["Plan 3 NZD 100,000.", [100000]],
    ["42\tEUR 60,000", [60000]], ["born 2 Nov 1982 GBP 80,000", [80000]], ["250 EUR 25,000 EUR", [250, 25000]]];
  for (const [line, want] of cases) {
    assert.deepEqual(moneyFiguresIn(line).map((x) => x.value), want, line);
    assert.deepEqual(anyMoneyFigures(line).map((x) => x.value), want, line);
  }
  assert.deepEqual(anyMoneyFigures("1000 € 80 %").map((x) => x.value), [1000]);
});
test("a figure before a code is a label only when the layout says so, never by its size (Critic #449 rounds 7, 8)", () => {
  const cases: [string, number[]][] = [["Hospital cash 50 SGD 365\tdays", [50]], ["Per visit 15 SGD 100\tvisits", [15]], ["Accident 20 MYR 10,000\tper year", [20]],
    ["Renewal 30 EUR 2027.", [30]], ["Excess 50 SGD 100.", [50]], ["Hospital cash 50 SGD 365", [50]], ["Premium 15 USD 2026", [15]], ["Co-pay 20 EUR 100", [20]],
    ["Copay 25 USD 1,000:", [25]], ["Room 300 SGD 1,000", [300]], ["Room\t300 SGD 1,000", [300]], ["Deductible 500 SGD 1,500", [500]], ["Outpatient 2000 SGD 1,500", [2000]],
    ["Limit per year 1000 SGD 12 visits", [1000]], ["PER YEAR 1000 SGD 12 VISITS", [1000]], ["Each year 500 SGD 2 claims", [500]],
    ["Basic plan 1500 SGD 10 visits per year", [1500]], ["Outpatient limit per year 2000 SGD 300 deductible", [2000]], ["Limit per year 1000 SGD 50 per visit", [1000]],
    ["Group 1 USD 50 per visit", [50]], ["Tier 2 SGD 500 per day", [500]], ["Plan 2 SGD 1,000,000", [1000000]],
    ["Plan 3 NZD 100,000\tper year", [100000]], ["Plan 3 NZD 100,000\tPlan 4 NZD 200,000", [100000, 200000]], ["Liam Kelly\t42\tEUR 60,000\t01/02/1983", [60000]]];
  for (const [line, want] of cases) {
    assert.deepEqual(moneyFiguresIn(line).map((x) => x.value), want, line);
    assert.deepEqual(anyMoneyFigures(line).map((x) => x.value), want, line);
  }
});
test("control: 'up to N%' by a scale is never shown as a fixed amount (Critic #449 F3)", () => {
  for (const quote of ["Fractures\tUp to 50% of the Sum Insured according to the Scale of Fractures", "Permanent partial disablement\tUp to 100% of the Sum Insured as per the Scale of Benefits"]) {
    const [benefit, words] = quote.split("\t"), value = Number(/(\d+)%/.exec(words)![1]);
    const h = schedule({ people: MYR.people, page2: `TABLE OF BENEFITS\nBenefit\tAmount payable\n${quote}`, benefits: [ben({ benefit, pays: "percent", value, percentOf: "sum_insured", quote })] });
    for (const p of MYR.people) {
      assert.notEqual(rowOf(h, p.name, (x) => x.benefit === benefit)?.figure.kind, "worked_out", `${p.name} ${benefit}`);
      assert.deepEqual(ask(h, p.name, new RegExp(benefit)).amounts, [], `${p.name} ${benefit}`);
    }
  }
});
test("control: a time window ('a stay that begins up to 30 days after the accident') is not a day limit (Critic #449 F5)", () => {
  for (const rule of ["payable from the second day, for a stay that begins up to 30 days after the accident", "payable from the second day, for a stay that begins up to 30 days post accident", "payable from the second day, for a stay starting up to 30 days later"]) {
    const h = family({ ...MYR, people: [SITI], hospitalRule: rule });
    const a = ask(h, "Siti Binti Omar", /Hospital allowance/, "Siti was in hospital for 45 days. How much hospital allowance?", { perDay: { stayDays: 45 } });
    assert.ok(!a.amounts.includes("RM2,400"), `${rule}: ${JSON.stringify(a.amounts)}`);
  }
  const h = family({ ...MYR, people: [SITI], hospitalRule: "payable from the second day, up to 60 days of hospitalisation" });
  const a = ask(h, "Siti Binti Omar", /Hospital allowance/, "Siti was in hospital for 45 days. How much hospital allowance?", { perDay: { stayDays: 45 } });
  assert.ok(a.amounts.includes("RM3,520"), `44 x RM80: ${JSON.stringify(a.amounts)}`);
});
test("a person whose name is part of another member's name still gets their own figure (Critic #449 F8)", () => {
  const people: Person[] = [
    { name: "Wei Tan", relationship: "self", line: "Wei Tan\tPolicyholder\t01/01/1980\tRM 200,000", sum: 200000 },
    { name: "Wei Ling Tan", relationship: "spouse", line: "Wei Ling Tan\tSpouse\t01/01/1982\tRM 100,000", sum: 100000 }];
  const h = family({ ...MYR, people });
  assert.deepEqual(ask(h, "Wei Tan", /Burns/).amounts, ["RM20,000"]);
  assert.deepEqual(ask(h, "Wei Ling Tan", /Burns/).amounts, ["RM10,000"]);
});

test("control: a row whose line prints another share for a kind of life gives no chat amount (Critic #449 round 4, F6)", () => {
  for (const line of ["Burns\t10% of the Sum Insured. For an insured child, 5% of the Sum Insured.", "Burns\t10% of the Sum Insured. Children: 5%."]) {
    const h = schedule({ people: MYR.people, page2: `TABLE OF BENEFITS\nBenefit\tAmount payable\n${line}`, benefits: [ben({ benefit: "Burns", pays: "percent", value: 10, percentOf: "sum_insured", quote: "Burns\t10% of the Sum Insured" })] });
    for (const p of MYR.people) assert.deepEqual(ask(h, p.name, /Burns/).amounts, [], `${line}: ${p.name}`);
  }
});

test("a note that repeats the row's own cap keeps the figure; one with another amount refuses it", () => {
  const row = "Broken bones\t4% of the Sum Insured per fracture, maximum RM 3,000 per accident (note a)";
  for (const [note, want] of [["Note (a): a compound fracture is paid at double, still subject to the RM 3,000 maximum per accident.", ["Up to RM3,000"]],
    ["Note (a): no more than RM 1,000 is paid for any one fracture.", []]] as const) {
    const h = schedule({ people: [MYR.people[0]], page2: `TABLE OF BENEFITS\n${row}\n${note}`,
      benefits: [ben({ benefit: "Broken bones", pays: "percent", value: 4, percentOf: "sum_insured", quote: row, cap: 3000, capQuote: "maximum RM 3,000 per accident", conditions: [note.replace(/^Note \(a\): /, "")] })] });
    assert.deepEqual(ask(h, "Ahmad Bin Ali", /Broken bones/).amounts, [...want], note);
  }
});

console.log(`claim-amounts-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
