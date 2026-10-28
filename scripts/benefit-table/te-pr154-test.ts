/** Test engineer, PR #154: an intensive-care day's printed daily rate becomes a chat row of its own (N119).
 * Independent of the PR's chat-test. Builds each household from its own pages through checkReading + assembleTable +
 * chatRows (the real pipeline), for made-up SG / MY / UK / HK households. No model, no network, no database.
 *   node --import tsx scripts/benefit-table/te-pr154-test.ts
 * Graded: the ICU row appears with the printed rate where the words say only that; no row (or no figure larger than
 * what is payable) where a plan's own daily rate, an age, a place, another person or another document changes it. */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { type ChatRow, amountsFromRows, chatRows, keepLabelledAmounts, renderTable } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

let passed = 0; const failures: string[] = []; const notes: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

type Page = { page: number; text: string };
type Ben = { section?: string | null; column?: string | null; benefit: string; pays: string; value: number | null; page: number; quote: string; conditions?: string[] };
type Spec = { people: string[]; docs: { id: string; name: string; kind: string; product: string; pages: Page[]; covers: { person: string; cover: string; plan: string | null; sum: number | null; page: number; quote: string }[]; benefits: Ben[] }[];
  links: { doc: string; section: string | null; column: string | null; product: string; cover: string; plan: string | null }[] };

function build(spec: Spec): { rows: ChatRow[]; house: Household } {
  const family: FamilyMember[] = spec.people.map((n, i) => ({ id: `p${i + 1}`, display_name: n }));
  const house: Household = { accountId: "22222222-2222-2222-2222-222222222222", members: spec.people.map((n, i) => ({ name: n, relationship: i ? "spouse" : "self" })),
    documents: spec.docs.map((d) => ({ policyId: d.id, name: d.name, insurer: "Testlife", productName: d.product, policyNumber: null, documentType: null, documentRole: null, effectiveDate: null,
      expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: spec.people, supersededAt: null, processingStatus: "ready", pages: d.pages })) } as Household;
  const readings = spec.docs.map((d) => checkReading({ id: d.id, name: d.name, readable: true, pages: d.pages } as SourceDoc, {
    document: { kind: d.kind, product: d.product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: d.covers.map((c) => ({ person: c.person, product: d.product, cover: c.cover, plan: c.plan, sumInsured: c.sum, asOf: null, page: c.page, quote: c.quote })),
    benefits: d.benefits.map((b) => ({ section: b.section ?? null, column: b.column ?? null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...b })),
  } as never));
  const links = spec.links.map((l) => ({ section: sectionKeyOf(l.doc, { section: l.section, column: l.column }), cover: coverKeyOf({ product: l.product, cover: l.cover, plan: l.plan }), why: "te" }));
  return { rows: chatRows(assembleTable(readings, family, links, []), house), house };
}
const icu = (rs: ChatRow[]) => rs.filter((r) => /intensive care$/.test(r.benefit)).map((r) => ({ person: r.person, benefit: r.benefit, plan: r.plan,
  amount: r.figure.kind === "printed" ? r.figure.amount : null, currency: r.figure.kind === "printed" ? r.figure.currency : null, unit: r.figure.kind === "printed" ? r.figure.unit : null, page: r.source.page }));
const daily = (rs: ChatRow[]) => rs.filter((r) => !/intensive care$/.test(r.benefit) && r.figure.kind === "printed" && r.figure.unit === "per_day").map((r) => `${r.person}|${r.benefit}|${r.figure.kind === "printed" ? r.figure.amount : ""}`);

/** One person, one schedule that prints the daily cash line (and whatever else `extra` adds to the page). */
function single(o: { benefit?: string; person?: string; line: string; quote?: string; value: number; sym: string; conditions?: string[]; extraPages?: Page[]; extra?: string; otherDoc?: Page[] }): Spec {
  const person = o.person ?? "Siti Aminah";
  const pages = [{ page: 1, text: `HOSPITAL INCOME SCHEDULE\nInsured\t${person}\tSum Insured ${o.sym}10,000\n${o.line}${o.extra ? "\n" + o.extra : ""}` }, ...(o.extraPages ?? [])];
  const docs: Spec["docs"] = [{ id: "dddddddd-0000-0000-0000-000000000001", name: "Hospital Income.pdf", kind: "personal_proof", product: "CarePlus", pages,
    covers: [{ person, cover: "Hospital Income", plan: null, sum: 10000, page: 1, quote: `${person} Sum Insured ${o.sym}10,000` }],
    benefits: [{ section: "Hospital", benefit: o.benefit ?? "Hospital Income", pays: "per_day", value: o.value, page: 1, quote: o.quote ?? o.line, conditions: o.conditions ?? [] }] }];
  if (o.otherDoc) docs.push({ id: "dddddddd-0000-0000-0000-000000000002", name: "Brochure.pdf", kind: "brochure", product: "CarePlus", pages: o.otherDoc, covers: [], benefits: [] });
  return { people: [person], docs, links: [{ doc: docs[0].id, section: "Hospital", column: null, product: "CarePlus", cover: "Hospital Income", plan: null }] };
}

// ------------------------------------------------------------ positives
test("P1 MY: the ICU rate printed in brackets in the row's own line is a row of its own (RM300 a day)", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day (RM300 per day if confined in ICU)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows).map((r) => [r.amount, r.currency, r.unit]), [[300, "MYR", "per_day"]], JSON.stringify(icu(rows)));
  assert.deepEqual(daily(rows), ["Siti Aminah|Hospital Income|150"], "the base rate is unchanged");
});
test("P2 UK: an ICU rate in the row's conditions, printed in a footnote on another page of the same document (£100 a day)", () => {
  const { rows } = build(single({ person: "George Patel", line: "Hospital cash\t£50 per day*", value: 50, sym: "£", conditions: ["£100 per day if admitted to intensive care"],
    extraPages: [{ page: 4, text: "Notes\n* £100 per day if admitted to intensive care" }] }));
  const got = icu(rows);
  assert.deepEqual(got.map((r) => [r.amount, r.currency, r.page]), [[100, "GBP", 4]], JSON.stringify(got));
});
test("P3 bare '$': the row keeps no currency of its own (never turned into S$)", () => {
  const { rows } = build(single({ person: "Chan Ka Wai", line: "Hospital cash\t$80 per day ($160 per day in ICU)", value: 80, sym: "$" }));
  const got = icu(rows);
  assert.ok(got.length <= 1, JSON.stringify(got));
  // Same check as the TE's original line (its middle clause compared a figure kind with a currency, always false): no currency.
  if (got.length) assert.equal(got[0].currency, null, "currency " + got[0].currency);
  if (got.length) assert.equal(got[0].amount, 160);
});

// ------------------------------------------------------------ negatives (each must give NO intensive-care figure larger than payable)
test("N1 SG plan columns: 'doubled in ICU, capped at S$300 per day' must not give Plan A (S$100 a day) an ICU figure of S$300", () => {
  const note = "(Note: the daily amount is doubled if hospitalised in intensive care, capped at S$300 per day)";
  const page = `HOSPITAL CASH\tPlan A\tPlan B\tPlan C\nDaily hospital cash\tS$100 per day\tS$150 per day\tS$200 per day\n${note}`;
  const person = "Wong Li Hua", D = "dddddddd-0000-0000-0000-000000000011", C = "dddddddd-0000-0000-0000-000000000012";
  const spec: Spec = { people: [person], docs: [
    { id: C, name: "Certificate.pdf", kind: "personal_proof", product: "HealthShield", pages: [{ page: 1, text: `CERTIFICATE\nInsured\t${person}\tPlan A\tS$50,000` }],
      covers: [{ person, cover: "Hospital Cash", plan: "Plan A", sum: 50000, page: 1, quote: `${person} Plan A S$50,000` }], benefits: [] },
    { id: D, name: "Benefit summary.pdf", kind: "benefit_summary", product: "HealthShield", pages: [{ page: 3, text: page }], covers: [],
      benefits: (["Plan A", "Plan B", "Plan C"] as const).map((col, i) => ({ section: "Hospital", column: col, benefit: "Daily hospital cash", pays: "per_day", value: [100, 150, 200][i], page: 3, quote: `Daily hospital cash S$${[100, 150, 200][i]} per day`, conditions: [note] })) },
  ], links: [{ doc: D, section: "Hospital", column: "Plan A", product: "HealthShield", cover: "Hospital Cash", plan: "Plan A" }] };
  const { rows } = build(spec);
  assert.ok(daily(rows).some((d) => d.endsWith("|100")), "fixture: Plan A's own S$100 a day row exists: " + JSON.stringify(daily(rows)));
  const got = icu(rows);
  assert.ok(!got.some((r) => (r.amount ?? 0) > 200), "Plan A pays at most 2 x S$100 = S$200 for an ICU day; got " + JSON.stringify(got));
});
test("N2 'doubled, capped' on a single rate below half the cap: S$120 a day doubled is S$240, never S$400", () => {
  const { rows, house } = build(single({ person: "Lim Boon Huat", line: "Daily hospital income\tS$120 per day", value: 120, sym: "S$",
    conditions: ["daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day"],
    extra: "Note: daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day" }));
  const got = icu(rows);
  const row = rows.find((r) => /intensive care$/.test(r.benefit));
  if (row) { const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Boon Huat", document: null, quote: null, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, eventFit: "any_event" }] };
    const fr = amountsFromRows(raw, rows, house); const { answer: a } = verifyAnswer(house, readModelAnswer(fr.json)!, ["Boon Huat was in ICU for 2 days"], new Set(fr.report.labels));
    notes.push("N2 card shown in chat: " + JSON.stringify(keepLabelledAmounts(a.statements ?? [], fr.report).kept.filter((s) => s.amount).map((s) => s.amount!.text))); }
  assert.ok(!got.some((r) => (r.amount ?? 0) > 240), "S$120 doubled is S$240; got " + JSON.stringify(got));
});
test("N3 a place: 'S$300 per day if hospitalised overseas in ICU' on a local daily cash gives no row without 'overseas'", () => {
  const { rows } = build(single({ person: "Lim Boon Huat", line: "Hospital cash\tS$100 per day (S$300 per day if hospitalised overseas in ICU)", value: 100, sym: "S$" }));
  const got = rows.filter((r) => /intensive care$/.test(r.benefit));
  assert.ok(got.every((r) => /overseas/i.test(`${r.benefit} ${r.qualifier ?? ""} ${r.conditions.join(" ")}`)), "an ICU row that drops 'overseas': " + JSON.stringify(icu(rows)));
});
test("N4 an age limit in the same clause gives no row", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day (RM300 per day in ICU for insured persons aged 65 and below)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows), []);
});
test("N5 another document's ICU rate (a brochure) gives no row for this cover", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day", value: 150, sym: "RM", conditions: ["RM300 per day if confined in ICU"],
    otherDoc: [{ page: 1, text: "CarePlus brochure\nRM300 per day if confined in ICU" }] }));
  assert.deepEqual(icu(rows), []);
});
test("N6 a group limit ('for the employee only') gives no row", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day (RM300 per day in ICU for the employee only)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows), []);
});
test("N7 wrong person: the ICU note on Ah Kow's own schedule never gives Mei Ling an ICU row", () => {
  const A = "dddddddd-0000-0000-0000-000000000021", B = "dddddddd-0000-0000-0000-000000000022";
  const spec: Spec = { people: ["Lim Ah Kow", "Tan Mei Ling"], docs: [
    { id: A, name: "Ah Kow schedule.pdf", kind: "personal_proof", product: "CareA", pages: [{ page: 1, text: "SCHEDULE\nInsured\tLim Ah Kow\tS$10,000\nHospital cash\tS$100 per day (S$200 per day in ICU)" }],
      covers: [{ person: "Lim Ah Kow", cover: "Hospital Cash", plan: null, sum: 10000, page: 1, quote: "Lim Ah Kow S$10,000" }],
      benefits: [{ section: "Hospital", benefit: "Hospital cash", pays: "per_day", value: 100, page: 1, quote: "Hospital cash S$100 per day (S$200 per day in ICU)" }] },
    { id: B, name: "Mei Ling schedule.pdf", kind: "personal_proof", product: "CareB", pages: [{ page: 1, text: "SCHEDULE\nInsured\tTan Mei Ling\tS$10,000\nHospital cash\tS$80 per day" }],
      covers: [{ person: "Tan Mei Ling", cover: "Hospital Cash", plan: null, sum: 10000, page: 1, quote: "Tan Mei Ling S$10,000" }],
      benefits: [{ section: "Hospital", benefit: "Hospital cash", pays: "per_day", value: 80, page: 1, quote: "Hospital cash S$80 per day" }] },
  ], links: [{ doc: A, section: "Hospital", column: null, product: "CareA", cover: "Hospital Cash", plan: null }, { doc: B, section: "Hospital", column: null, product: "CareB", cover: "Hospital Cash", plan: null }] };
  const { rows } = build(spec);
  const got = icu(rows);
  assert.deepEqual(got.map((r) => [r.person, r.amount]), [["Lim Ah Kow", 200]], JSON.stringify(got));
});
test("N8 'not': 'ICU stays are not covered, S$200 per day otherwise' gives no row", () => {
  const { rows } = build(single({ line: "Hospital cash\tS$100 per day (ICU not covered; S$200 per day in a private ward)", value: 100, sym: "S$" }));
  assert.deepEqual(icu(rows), []);
});

test("N9 a day rule on the row ('from the 3rd day') gives no ICU row (it may hold for an ICU day too)", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day from the 3rd day of the stay (RM300 per day if confined in ICU)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows), []);
});
test("N10 an ICU rate the reading already took as its own row is not added twice", () => {
  const spec = single({ line: "Hospital Income\tRM150 per day (RM300 per day if confined in ICU)", value: 150, sym: "RM" });
  spec.docs[0].benefits.push({ section: "Hospital", benefit: "ICU daily income", pays: "per_day", value: 300, page: 1, quote: "RM300 per day if confined in ICU" });
  const { rows } = build(spec);
  assert.equal(rows.filter((r) => r.figure.kind === "printed" && r.figure.amount === 300).length, 1, JSON.stringify(rows.map((r) => [r.benefit, r.figure.kind === "printed" ? r.figure.amount : null])));
});
test("N11 a row that is itself for intensive care gives no second ICU row from its own note", () => {
  const { rows } = build(single({ benefit: "ICU Hospital Income", line: "ICU Hospital Income\tRM300 per day (RM450 per day if confined in ICU)", value: 300, sym: "RM" }));
  assert.ok(!rows.some((r) => r.figure.kind === "printed" && r.figure.amount === 450), JSON.stringify(rows.map((r) => r.benefit)));
});

test("N12 a day count in otherwise known words ('maximum 30 day') gives no row", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day (RM300 per day in ICU, maximum 30 day)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows), []);
});
test("N13 an ICU figure not paid per day ('RM300 if confined in ICU') gives no row", () => {
  const { rows } = build(single({ line: "Hospital Income\tRM150 per day (RM300 if confined in ICU)", value: 150, sym: "RM" }));
  assert.deepEqual(icu(rows), []);
});

test("N14 'doubled, capped at S$400 per day' with S$250 a day: the ICU row is S$400 (twice the rate reaches the cap), and its card says 'doubled'", () => {
  const { rows } = build(single({ person: "Lim Boon Huat", line: "Daily hospital income\tS$250 per day", value: 250, sym: "S$",
    conditions: ["daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day"],
    extra: "Note: daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day" }));
  assert.deepEqual(icu(rows).map((r) => r.amount), [400]);
  const row = rows.find((r) => /intensive care$/.test(r.benefit))!;
  assert.ok(row.conditions.some((c) => /doubled/.test(c)), "the clause is the row's condition: " + JSON.stringify(row.conditions));
});
test("N15 'S$200 per day, doubled in ICU' (the figure is the base rate) gives no ICU row of S$200", () => {
  const { rows } = build(single({ person: "Lim Boon Huat", line: "Hospital cash\tS$100 per day (S$200 per day, doubled in ICU)", value: 100, sym: "S$" }));
  assert.ok(!icu(rows).some((r) => r.amount === 200), JSON.stringify(icu(rows)));
});
test("N16 a place word in the benefit's own name is allowed ('Overseas hospital cash' ... 'if hospitalised overseas in ICU')", () => {
  const { rows } = build(single({ benefit: "Overseas hospital cash", person: "Lim Boon Huat", line: "Overseas hospital cash\tS$100 per day (S$300 per day if hospitalised overseas in ICU)", value: 100, sym: "S$" }));
  assert.deepEqual(icu(rows).map((r) => r.amount), [300]);
});
test("N17 'twice the daily amount, up to S$400 per day' with S$150 a day gives no S$400 row", () => {
  const { rows } = build(single({ person: "Lim Boon Huat", line: "Hospital cash\tS$150 per day (twice the daily amount in ICU, up to S$400 per day)", value: 150, sym: "S$" }));
  assert.ok(!icu(rows).some((r) => (r.amount ?? 0) > 300), JSON.stringify(icu(rows)));
});
test("N18 plan columns: Plan C (S$200 a day) with 'doubled, capped at S$300' gets S$300; Plan A gets none", () => {
  const note = "(Note: the daily amount is doubled if hospitalised in intensive care, capped at S$300 per day)";
  const page = `HOSPITAL CASH\tPlan A\tPlan B\tPlan C\nDaily hospital cash\tS$100 per day\tS$150 per day\tS$200 per day\n${note}`;
  const mk = (plan: string) => { const person = "Wong Li Hua", D = "dddddddd-0000-0000-0000-000000000011", C = "dddddddd-0000-0000-0000-000000000012";
    return build({ people: [person], docs: [
      { id: C, name: "Certificate.pdf", kind: "personal_proof", product: "HealthShield", pages: [{ page: 1, text: `CERTIFICATE\nInsured\t${person}\t${plan}\tS$50,000` }],
        covers: [{ person, cover: "Hospital Cash", plan, sum: 50000, page: 1, quote: `${person} ${plan} S$50,000` }], benefits: [] },
      { id: D, name: "Benefit summary.pdf", kind: "benefit_summary", product: "HealthShield", pages: [{ page: 3, text: page }], covers: [],
        benefits: (["Plan A", "Plan B", "Plan C"] as const).map((col, i) => ({ section: "Hospital", column: col, benefit: "Daily hospital cash", pays: "per_day", value: [100, 150, 200][i], page: 3, quote: "Daily hospital cash\tS$100 per day\tS$150 per day\tS$200 per day", conditions: [note] })) },
    ], links: [{ doc: D, section: "Hospital", column: plan, product: "HealthShield", cover: "Hospital Cash", plan }] }).rows; };
  const c = mk("Plan C"); assert.deepEqual(icu(c).map((r) => r.amount), [300], JSON.stringify(c.map((r) => [r.benefit, r.plan, r.figure.kind === "printed" ? r.figure.amount : null])));
  assert.deepEqual(icu(mk("Plan A")).map((r) => r.amount), []);
});

test("N19 two daily rates for the benefit (S$100 government, S$250 private) with 'doubled, capped at S$400': no ICU row", () => {
  const note = "Note: the daily amount will be doubled if hospitalised in intensive care, capped at S$400 per day";
  const person = "Lim Boon Huat";
  const spec = single({ person, line: "Hospital cash (government hospital)\tS$100 per day\nHospital cash (private hospital)\tS$250 per day", value: 100, sym: "S$", quote: "Hospital cash (government hospital)\tS$100 per day", conditions: [note], extra: note });
  spec.docs[0].benefits.push({ section: "Hospital", benefit: "Hospital Income", pays: "per_day", value: 250, page: 1, quote: "Hospital cash (private hospital)\tS$250 per day", conditions: [note] });
  const { rows } = build(spec);
  assert.equal(rows.filter((r) => r.benefit === "Hospital Income" && r.figure.kind === "printed" && r.figure.unit === "per_day").length, 2, "fixture: two daily rows");
  assert.deepEqual(icu(rows), []);
});

// ------------------------------------------------------------ follow-up turn: a ward stay, then "one day was in ICU"
test("F1 follow-up: after 'warded 4 days', 'one day was in ICU' keeps the ICU card as a per-day limit, never 4 x RM300", () => {
  const { rows, house } = build(single({ line: "Hospital Income\tRM150 per day (RM300 per day if confined in ICU)", value: 150, sym: "RM" }));
  const icuRow = rows.find((r) => /intensive care$/.test(r.benefit));
  assert.ok(icuRow, "fixture: ICU row exists");
  const ask = (row: string, asked: string[]) => {
    const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Siti Aminah", document: null, quote: null, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: { stayDays: 4 }, ofBill: null, row, eventFit: "any_event" }] };
    const fromRows = amountsFromRows(raw, rows, house);
    const { answer: a } = verifyAnswer(house, readModelAnswer(fromRows.json)!, asked, new Set(fromRows.report.labels));
    return keepLabelledAmounts(a.statements ?? [], fromRows.report).kept.filter((s) => s.amount);
  };
  const cards = ask(icuRow!.id, ["Siti was warded for 4 days", "one day was in ICU"]);
  const texts = cards.map((s) => s.amount!.text);
  assert.ok(!texts.some((t) => /1,200|1200/.test(t)), "never 4 x RM300: " + JSON.stringify(texts));
  assert.ok(texts.some((t) => /RM\s?300/.test(t)) || texts.length === 0, "the ICU card shows RM300 a day or nothing: " + JSON.stringify(texts));
  if (texts.length === 0) notes.push("F1: no amount card kept for the ICU row on the follow-up turn");
  const base = rows.find((r) => r.benefit === "Hospital Income" && r.figure.kind === "printed" && r.figure.unit === "per_day")!;
  const baseCards = ask(base.id, ["Siti was warded for 4 days", "one day was in ICU"]).map((s) => s.amount!.text);
  notes.push("F1 base card on the follow-up: " + JSON.stringify(baseCards));
  assert.ok(!baseCards.some((t) => /RM\s?300/.test(t)), "the base card never shows the ICU rate: " + JSON.stringify(baseCards));
  assert.match(renderTable(rows), /Hospital Income in intensive care \| (?:MYR 300|RM300) a day/);
  notes.push("F1 ICU card on the follow-up: " + JSON.stringify(texts));
});

for (const f of failures) console.log("FAIL " + f);
for (const n of notes) console.log("NOTE " + n);
console.log(`te-pr154: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
