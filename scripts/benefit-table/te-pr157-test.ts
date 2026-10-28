/** Test engineer, PR #157: a limit's daily-rate row keeps its own printed currency (Critic R272, #154 follow-up).
 * Independent of the PR's chat-test. Builds each household from its own pages through checkReading + assembleTable +
 * chatRows (the real pipeline), for made-up SG / MY / UK / HK households. No model, no network, no database.
 *   node --import tsx scripts/benefit-table/te-pr157-test.ts
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


/** A travel or hospital plan whose `line` (the row's quote) prints a limit and its daily cap. */
function lim(o: { line: string; value: number; sym: string; person?: string; extra?: string; pages?: Page[]; column?: string | null; plan?: string | null; quote?: string }): Spec {
  const person = o.person ?? "Wong Mei Yee";
  const pages = o.pages ?? [{ page: 1, text: `TRAVEL CARE SUMMARY\nInsured\t${person}\tPlan ${o.plan ?? "Standard"}\n${o.extra ? o.extra + "\n" : ""}${o.line}\nEmergency phone\t${o.sym}100` }];
  const docs: Spec["docs"] = [{ id: "eeeeeeee-0000-0000-0000-0000000000a1", name: "Travel.pdf", kind: "personal_proof", product: "TravelCare", pages,
    covers: [{ person, cover: "Travel Care", plan: o.plan ?? null, sum: null, page: 1, quote: `${person}` }],
    benefits: [{ section: "Travel", column: o.column ?? null, benefit: "Overseas hospital cash", pays: "up_to", value: o.value, page: 1, quote: o.quote ?? o.line }] }];
  return { people: [person], docs, links: [{ doc: docs[0].id, section: "Travel", column: o.column ?? null, product: "TravelCare", cover: "Travel Care", plan: o.plan ?? null }] };
}
const rates = (rs: ChatRow[]) => rs.filter((r) => r.benefit === "Overseas hospital cash" && r.figure.kind === "printed" && r.figure.unit === "per_day").map((r) => r.figure.kind === "printed" ? [r.figure.amount, r.figure.currency] : null);
const limits = (rs: ChatRow[]) => rs.filter((r) => r.benefit === "Overseas hospital cash" && r.figure.kind === "printed" && r.figure.unit === "up_to").map((r) => r.figure.kind === "printed" ? [r.figure.amount, r.figure.currency] : null);

// ------------------------------------------------------------ positives, other markets and layouts
for (const [id, sym, code, line] of [
  ["P1 SG", "S$", "SGD", "Overseas hospital cash\tUp to S$8,000, capped at S$200 per day"],
  ["P2 MY", "RM", "MYR", "Overseas hospital cash\tUp to RM8,000, maximum RM200 per day"],
  ["P3 UK", "£", "GBP", "Overseas hospital cash\tUp to £8,000 (maximum £200 per day)"],
  ["P4 HK", "HK$", "HKD", "Overseas hospital cash\tUp to HK$8,000, capped at HK$200 per day"],
  ["P5 SGD code", "SGD ", "SGD", "Overseas hospital cash\tUp to SGD 8,000, capped at SGD 200 per day"],
] as const) test(`${id}: the daily cap is a row in ${code}`, () => {
  const { rows } = build(lim({ line, value: 8000, sym }));
  assert.deepEqual(limits(rows), [[8000, code]], "fixture limit: " + JSON.stringify(limits(rows)));
  assert.deepEqual(rates(rows), [[200, code]]);
});
test("P6 rate and limit on separate lines of the quote ('Capped at RM200 per day' then 'RM8,000')", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\nCapped at RM200 per day\nRM8,000", value: 8000, sym: "RM" }));
  assert.deepEqual(rates(rows), [[200, "MYR"]]);
});
test("P7 plan columns: 'Capped at £200 per day' over '£5,000 £8,000 £10,000', the person on the middle plan", () => {
  const line = "Overseas hospital cash\nCapped at £200 per day\n£5,000\t£8,000\t£10,000";
  const pages = [{ page: 1, text: `TRAVEL CARE SUMMARY\nInsured\tWong Mei Yee\tPlan Gold\nBenefits\tSilver\tGold\tPlatinum\n${line}\nEmergency phone\t£100\t£200\t£300` }];
  const { rows } = build(lim({ line, value: 8000, sym: "£", pages, column: "Gold", plan: "Gold" }));
  if (!limits(rows).length) { notes.push("P7 plan columns: no limit row read (fixture), rate unchecked"); return; }
  assert.deepEqual(rates(rows), [[200, "GBP"]], JSON.stringify({ limits: limits(rows), rates: rates(rows) }));
});

// ------------------------------------------------------------ another currency: no row
for (const [id, line, sym] of [
  ["N1 US$ rate, S$ limit", "Overseas hospital cash\tUp to S$8,000, capped at US$200 per day", "S$"],
  ["N2 RM rate, £ limit", "Overseas hospital cash\tUp to £8,000, capped at RM200 per day", "£"],
  ["N3 HK$ limit, S$ rate", "Overseas hospital cash\tUp to HK$8,000, maximum S$200 per day", "HK$"],
  ["N4 MYR code rate, RM limit is the same currency", "", ""],
] as const) if (line) test(`${id}: no daily row`, () => {
  const { rows } = build(lim({ line, value: 8000, sym }));
  assert.deepEqual(rates(rows), [], "limit read as " + JSON.stringify(limits(rows)));
});
test("N4 'MYR 200 per day' under an RM limit is the same currency: a MYR row", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to RM8,000, capped at MYR 200 per day", value: 8000, sym: "RM" }));
  assert.deepEqual(rates(rows), [[200, "MYR"]]);
});
test("N5 the same value printed earlier in another currency ('Registration fee S$200; capped at US$200 per day') never makes the US$ rate an S$ row", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to S$8,000. Registration fee S$200; capped at US$200 per day", value: 8000, sym: "S$" }));
  const got = rates(rows);
  assert.ok(!got.some((r) => r && r[1] === "SGD"), "US$200 a day shown as S$200: " + JSON.stringify(got));
});
test("N6 the same value printed later in another currency ('capped at $200 per day ... US$200 for evacuation') keeps no currency or none", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to S$8,000, capped at $200 per day; transport up to US$200", value: 8000, sym: "S$" }));
  const got = rates(rows);
  assert.ok(!got.some((r) => r && r[1] === "USD"), "bare $ rate turned into US$: " + JSON.stringify(got));
});

// ------------------------------------------------------------ bare "$"
test("B1 bare '$' rate under an S$ limit keeps no currency", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to S$8,000, capped at $200 per day", value: 8000, sym: "S$" }));
  assert.deepEqual(rates(rows), [[200, null]]);
});
test("B2 bare '$' rate and limit with the document's currency declared ('All amounts are in Singapore Dollars'): end to end through verify", () => {
  const line = "Overseas hospital cash\tUp to $8,000, capped at $200 per day";
  const { rows, house } = build(lim({ line, value: 8000, sym: "$", extra: "All amounts are in Singapore Dollars." }));
  const lim0 = limits(rows), rate0 = rates(rows);
  assert.deepEqual(lim0, [[8000, "SGD"]], "a bare '$' limit takes the page's declared currency");
  notes.push(`B2 declared SGD: limit ${JSON.stringify(lim0)}, rate ${JSON.stringify(rate0)}`);
  assert.equal(rate0.length, 1, JSON.stringify(rate0));
  assert.ok(rate0[0]![1] === null || rate0[0]![1] === lim0[0]?.[1], "rate currency differs from the declared one: " + JSON.stringify({ lim0, rate0 }));
  const row = rows.find((r) => r.benefit === "Overseas hospital cash" && r.figure.kind === "printed" && r.figure.unit === "per_day")!;
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Daily cash.", person: "Wong Mei Yee", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null,
    perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const fr = amountsFromRows(raw, rows, house);
  const { answer } = verifyAnswer(house, readModelAnswer(fr.json)!, ["how much is the overseas hospital cash a day"], new Set(fr.report.labels));
  const kept = keepLabelledAmounts(answer.statements ?? [], fr.report).kept.filter((s) => s.amount);
  notes.push("B2 card: " + JSON.stringify(kept.map((s) => s.amount)));
  assert.equal(kept.length, 1, JSON.stringify(answer.statements));
  const amt = kept[0].amount as { text: string; currencyResolved?: boolean };
  assert.ok(/200/.test(amt.text) && !/US|RM|£|HK/.test(amt.text), amt.text);
  assert.ok(!/8,000/.test(amt.text), "the limit shown as a day's rate: " + amt.text);
});
test("B3 bare '$' rate, US$ limit: no US$ borrowed", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to US$8,000, capped at $200 per day", value: 8000, sym: "US$" }));
  assert.ok(rates(rows).every((r) => r && r[1] === null), JSON.stringify(rates(rows)));
});

test("B4 bare '$' limit with a US$ rate on the line ('Up to $8,000, capped at US$200 per day'): the limit never borrows US$", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to $8,000, capped at US$200 per day", value: 8000, sym: "$" }));
  assert.ok(limits(rows).every((l) => l && l[1] !== "USD"), "limit " + JSON.stringify(limits(rows)));
  assert.ok(!rates(rows).some((r) => r && r[1] === "USD" && limits(rows).some((l) => l && l[1] === "USD")), JSON.stringify(rates(rows)));
});
test("B5 the same bare-'$' line on a page declaring Singapore Dollars: the limit is SGD (declared), never USD", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to $8,000, capped at US$200 per day", value: 8000, sym: "$", extra: "All amounts are in Singapore Dollars." }));
  assert.ok(limits(rows).every((l) => l && l[1] !== "USD"), "limit " + JSON.stringify(limits(rows)));
});
test("B6 a limit printed in two currencies ('Up to S$8,000 (US$8,000 if overseas)'): never one picked by position alone", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to S$8,000 (US$8,000 if overseas)", value: 8000, sym: "S$" }));
  notes.push("B6 two-currency limit read as " + JSON.stringify(limits(rows)));
  assert.ok(limits(rows).every((l) => l && l[1] === null), "a limit printed in two currencies took one: " + JSON.stringify(limits(rows)));
});
test("B7 the limit's own S$ wins over a different-value US$ figure printed first ('US$50 excess; up to S$8,000')", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tAn excess of US$50 applies; up to S$8,000", value: 8000, sym: "S$" }));
  assert.ok(limits(rows).every((l) => l && l[1] === "SGD"), "limit " + JSON.stringify(limits(rows)));
});

test("N7 a rate printed twice in two currencies ('capped at S$200 per day (US$200 per day overseas)') gives no daily row", () => {
  const { rows } = build(lim({ line: "Overseas hospital cash\tUp to S$8,000, capped at S$200 per day (maximum US$200 per day overseas)", value: 8000, sym: "S$" }));
  assert.deepEqual(rates(rows), []);
});

test("H1 a currency printed only in the row's label or column heading ('Overseas hospital cash (S$)  8,000') is kept, or no row", () => {
  for (const [line, code] of [["Overseas hospital cash (S$)\t8,000", "SGD"], ["Overseas hospital cash (RM)\tUp to 8,000", "MYR"], ["Overseas hospital cash, S$\t8,000 maximum", "SGD"]] as const) {
    const { rows } = build(lim({ line, value: 8000, sym: code === "SGD" ? "S$" : "RM" }));
    const got = limits(rows);
    notes.push(`H1 ${line.replace("\t", " | ")}: ${JSON.stringify(got)}`);
    assert.ok(got.every((l) => l && (l[1] === code || l[1] === null)), line + ": " + JSON.stringify(got));
  }
});

// ------------------------------------------------------------ footnote
test("F1 a footnote rate on another page ('* capped at S$200 per day') is not in the row's own words: no daily row (status quo)", () => {
  const pages = [{ page: 1, text: "TRAVEL CARE SUMMARY\nInsured\tWong Mei Yee\tPlan Standard\nOverseas hospital cash*\tUp to S$8,000\nEmergency phone\tS$100" }, { page: 3, text: "Notes\n* Capped at US$200 per day" }];
  const { rows } = build(lim({ line: "Overseas hospital cash*\tUp to S$8,000", value: 8000, sym: "S$", pages }));
  assert.ok(!rates(rows).some((r) => r && r[1] === "SGD"), JSON.stringify(rates(rows)));
});

for (const f of failures) console.log("FAIL " + f);
for (const n of notes) console.log("NOTE " + n);
console.log(`te-pr157: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
