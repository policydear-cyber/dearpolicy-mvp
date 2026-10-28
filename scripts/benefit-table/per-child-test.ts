/** Scripted tests: a figure printed per child, worked out for the number of children the household gives (overnight run
 * 23 Oct, N023: "how much in total if we have two kids" was refused although "S$5,000 per child (up to 2 children)" is
 * printed). Made-up households only. No model, database or network.
 *   npm run benefit-table:per-child-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { childrenSaid, readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function atest(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const CERT = "cccccccc-0000-0000-0000-000000000001", TERMS = "cccccccc-0000-0000-0000-000000000002";
const doc = (policyId: string, name: string, pages: { page: number; text: string }[]) => ({ policyId, name, insurer: "Example Insurance", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Lim Ah Kow", "Tan Mei Ling"], supersededAt: null, processingStatus: "ready", pages });
const family: FamilyMember[] = [{ id: "p1", display_name: "Lim Ah Kow" }, { id: "p2", display_name: "Tan Mei Ling" }];
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const b = (o: Record<string, unknown>) => ({ section: "Accident", column: null, pays: "amount", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...o });

/** A household whose accident terms print `line` on page 3 (with `value` the figure the reading took from it), and a
 * certificate listing the cover for Lim Ah Kow. `sign` is the certificate's currency sign. */
function household(line: string, value: number, quote = line, sign = "S$") {
  const house: Household = {
    accountId: "33333333-3333-3333-3333-333333333333",
    members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }, { name: "Lim Xiao Ming", relationship: "child" }],
    documents: [
      doc(CERT, "Certificate.pdf", [{ page: 1, text: `GROUP PERSONAL ACCIDENT\nLim Ah Kow\t${sign}600,000\tAs of 01/01/2026` }]),
      doc(TERMS, "Accident terms.pdf", [{ page: 3, text: `GROUP PERSONAL ACCIDENT\nAccidental Death\t100% of Sum Insured\n${line}\nAmbulance Cost\tUp to ${sign}500 per incident` }]),
    ],
  };
  const cert = checkReading(src(house.documents[0]), reading("personal_proof", "Group Scheme", [{ person: "Lim Ah Kow", product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured: 600000, asOf: "01/01/2026", page: 1, quote: `Lim Ah Kow ${sign}600,000 As of 01/01/2026` }], []));
  const terms = checkReading(src(house.documents[1]), reading("scheme_terms", "Group Scheme", [], [b({ benefit: "Child Education Fund Benefit", value, page: 3, quote })]));
  const table = assembleTable([cert, terms], family, [{ section: sectionKeyOf(TERMS, { section: "Accident", column: null }), cover: coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null }), why: "accident terms" }]);
  return { house, table, rows: chatRows(table, house) };
}

/** The model's reply naming the per-child row, through the row step, verifyAnswer and the label check, as the app's turn does. */
function answer(h: ReturnType<typeof household>, asked: string[], o: Record<string, unknown> = {}) {
  const row = h.rows.find((r) => /Child Education/.test(r.benefit));
  assert.ok(row, `no child education row: ${JSON.stringify(h.rows.map((r) => r.benefit))}`);
  const raw = { bottomLine: "The fund pays per child.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Child education fund.", person: "Lim Ah Kow", document: null, quote: null,
    amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row!.id, rowBenefit: row!.benefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" }, ...o }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-10-21T04:00:00Z"), asked[0], asked.slice(1));
  const { answer: a } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, asked, new Set(fromRows.report.labels));
  const { kept } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  return { kept, amounts: kept.filter((s) => s.amount).map((s) => s.amount!.text), count: kept.find((s) => s.id?.endsWith("-count")), dropped: fromRows.report.dropped };
}

const TABLE_LINE = "Child Education Fund Benefit*\tS$5,000 per child (up to 2 children)";
const PROSE_LINE = "pay child education fund of $5,000 per child, subject to a maximum of two\nchildren, provided the Dependant child is unmarried and is aged 25 and below.";
const PROSE_QUOTE = "pay child education fund of $5,000 per child, subject to a maximum of two\nchildren";

// ------------------------------------------------------------------ the household's number of children
test("the number of children is read from the household's own words, and only when it is the one number given", () => {
  for (const [q, n] of [["how much in total if we have two kids", 2], ["we have 3 children", 3], ["my 2 sons", 2], ["what about our two young kids?", 2], ["one child", 1], ["Child education fund for 2 kids?", 2], ["for our 2 children: the child education fund", 2]] as const)
    assert.equal(childrenSaid(q), n, q);
  for (const q of ["how much is the child education fund", "2 sons and a daughter", "my two kids and another child", "we have twins", "my 2 sons and 1 daughter", "she is 2 and has a brother", "we have kids", "a 25 year old child", "two-year-old child", "we have 11 children", "expecting a baby, we have two kids"])
    assert.equal(childrenSaid(q), null, q);
});

// ------------------------------------------------------------------ worked out from the printed line
test("S$5,000 per child (up to 2 children) is S$10,000 for two children, as a conditional illustration", () => {
  const r = answer(household(TABLE_LINE, 5000), ["how much in total if we have two kids"]);
  assert.deepEqual(r.amounts, ["S$5,000", "S$10,000"]);
  assert.equal(r.count?.kind, "calculation");
  assert.equal((r.count?.amount as { illustration?: boolean }).illustration, true);
  assert.match(r.count!.text, /^For 2 children, this works out to 2 times the amount per child, if this benefit's conditions are met for each child\.$/);
  assert.equal(r.count!.basis, "S$5,000 per child, for at most 2 children (2 × S$5,000), for the children you described");
  assert.ok(r.count!.source, "the illustration cites its row's page");
});
test("more children than the printed most are paid for the most only", () => {
  const r = answer(household(TABLE_LINE, 5000), ["we have 3 children, how much would the fund pay?"]);
  assert.deepEqual(r.amounts, ["S$5,000", "S$10,000"]);
  assert.match(r.count!.text, /^For 3 children, this pays for at most 2 children/);
});
test("the most printed in words in a paragraph is used, and a bare $ stays unresolved", () => {
  const r = answer(household(PROSE_LINE, 5000, PROSE_QUOTE, "$"), ["if we have 4 kids"]);
  assert.deepEqual(r.amounts, ["$5,000", "$10,000"]);
  assert.equal((r.count!.amount as { currencyResolved?: boolean }).currencyResolved, false);
  assert.match(r.count!.basis ?? "", /^\$5,000 per child, for at most 2 children \(2 × \$5,000\)/);
});
test("a per-child figure with no most printed is multiplied by the number given", () => {
  const r = answer(household("Child Education Fund Benefit\tS$3,000 per child", 3000), ["we have three kids"]);
  assert.deepEqual(r.amounts, ["S$3,000", "S$9,000"]);
});
test("another market's currency is worked out the same way (RM, £)", () => {
  const rm = answer(household("Child Education Fund Benefit\tRM5,000 per child (maximum of 3 children)", 5000, undefined, "RM"), ["we have 4 kids"]);
  assert.deepEqual(rm.amounts, ["RM5,000", "RM15,000"]);
  const gbp = answer(household("Child Education Fund Benefit\t£2,000 for each child (up to 2 children)", 2000, undefined, "£"), ["2 children"]);
  assert.equal(gbp.amounts[0], "£2,000");
  // "for each child" is not the label's "per child" words: the illustration is not shown, never a wrong one.
  assert.ok(gbp.amounts.length === 1 || gbp.amounts[1] === "£4,000", JSON.stringify(gbp.amounts));
});

// ------------------------------------------------------------------ never worked out
test("no illustration without a number of children, for one child, or when the number is unclear", () => {
  for (const q of ["how much is the child education fund", "one child", "2 sons and a daughter", "we have twins"])
    assert.deepEqual(answer(household(TABLE_LINE, 5000), [q]).amounts, ["S$5,000"], q);
  // A number given only in an earlier message is not taken for this one.
  assert.deepEqual(answer(household(TABLE_LINE, 5000), ["and the compassionate allowance?", "we have two kids"]).amounts, ["S$5,000"]);
});
test("a line with another limit is never multiplied (default safe)", () => {
  for (const line of [
    "Child Education Fund Benefit\tS$5,000 per child (up to 2 children), overall limit S$8,000",
    "Child Education Fund Benefit\tUp to S$5,000 per child (up to 2 children)",
    "Child Education Fund Benefit\tS$5,000 per child, maximum S$8,000 per family",
    "Child Education Fund Benefit\tS$5,000 per child (up to 2 children) or the costs incurred, whichever is less",
    "Child Education Fund Benefit\tS$5,000 per family",
    "Child Education Fund Benefit\tS$5,000 per child (up to 2 children, or 3 children for a single parent)",
    "Child Education Fund Benefit\tS$5,000 per child in aggregate",
    "Child Education Fund Benefit\tS$5,000 per child (max 2 children), 3 children if adopted",
  ]) {
    const value = 5000;
    const r = answer(household(line, value), ["we have two kids"]);
    assert.ok(!r.count, `${line}: ${JSON.stringify(r.amounts)}`);
  }
});
test("a daily or percentage figure is never treated as per child", () => {
  const h = household("Child Education Fund Benefit\tS$50 per day per child", 50);
  assert.ok(!answer(h, ["we have two kids"]).count);
});

// ------------------------------------------------------------------ the simple chat without a table
test("without a benefit table, the model's own amount statement quoting the per-child line is worked out the same way", () => {
  const h = household(TABLE_LINE, 5000);
  const parsed = readModelAnswer({ bottomLine: "The fund pays per child.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "The child education fund pays per child, up to two children.", person: "Lim Ah Kow",
    document: "D2", quote: "Child Education Fund Benefit*\tS$5,000 per child (up to 2 children)", amount: "S$5,000", percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] })!;
  const two = verifyAnswer(h.house, parsed, ["how much if we have 2 kids"]).answer.statements ?? [];
  assert.deepEqual(two.filter((s) => s.amount).map((s) => s.amount!.text), ["S$5,000", "S$10,000"], JSON.stringify(two));
  const none = verifyAnswer(h.house, parsed, ["how much is it"]).answer.statements ?? [];
  assert.deepEqual(none.filter((s) => s.amount).map((s) => s.amount!.text), ["S$5,000"]);
  // A daily figure the household gives a stay for is the stay's card, never a children's one.
  const daily = readModelAnswer({ ...parsed, statements: [{ ...parsed.statements[0], perDay: { stayDays: 12 } }] })!;
  assert.ok(!(verifyAnswer(h.house, daily, ["two kids, in hospital 12 days"]).answer.statements ?? []).some((s) => s.id?.endsWith("-count")));
});

// ------------------------------------------------------------------ the label check
test("a -count card is kept only beside its labelled per-child row, with the same most and the right sum", () => {
  const parent = { id: "s1", text: "Child Education Fund Benefit (Group Personal Accident): per child (up to 2 children).", amount: { text: "S$5,000" } };
  const report = { dropped: [], labels: [parent.text], days: {} };
  const card = (amount: string, basis: string) => ({ id: "s1-count", text: "For 2 children, this works out to 2 times the amount per child.", amount: { text: amount }, basis });
  const ok = card("S$10,000", "S$5,000 per child, for at most 2 children (2 × S$5,000), for the children you described");
  assert.equal(keepLabelledAmounts([parent, ok], report).kept.length, 2);
  for (const bad of [
    card("S$15,000", "S$5,000 per child, for at most 2 children (2 × S$5,000), for the children you described"),
    card("S$15,000", "S$5,000 per child, for at most 3 children (3 × S$5,000), for the children you described"),
    card("S$15,000", "S$5,000 per child (3 × S$5,000), for the children you described"),
    card("S$10,000", "S$5,000 per child, for at most 2 children (2 × S$9,000), for the children you described"),
    card("RM10,000", "S$5,000 per child, for at most 2 children (2 × S$5,000), for the children you described"),
    card("S$10,000", "S$5,000 per family, for at most 2 children (2 × S$5,000), for the children you described"),
  ]) assert.deepEqual(keepLabelledAmounts([parent, bad], report).kept.map((s) => s.id), ["s1"], bad.basis + bad.amount.text);
  // Without its labelled row, never.
  assert.deepEqual(keepLabelledAmounts([ok], report).kept, []);
  assert.deepEqual(keepLabelledAmounts([{ ...parent, text: "Some other words." }, ok], report).kept, []);
});

// ------------------------------------------------------------------ a follow-up giving the number
test("a follow-up giving the number of children right after asking about the benefit by name is not 'not described'", () => {
  const h = household(TABLE_LINE, 5000);
  const r = answer(h, ["how much in total if we have two kids", "what's the child education fund benefit"], { eventFit: "not_described" });
  assert.deepEqual(r.amounts, ["S$5,000", "S$10,000"]);
  // Without the benefit asked about by name, a card the model says pays only on something not described stays out: a
  // fracture of two children is not a death.
  for (const asked of [["my two kids broke their arms", "hi"], ["my two kids broke their arms"], ["how much in total if we have two kids", "what does the accident cover pay"]])
    assert.deepEqual(answer(h, asked, { eventFit: "not_described" }).amounts, [], asked.join(" / "));
  // A list cover the event is not on stays out whatever the number.
  assert.deepEqual(answer(h, ["how much in total if we have two kids", "what's the child education fund benefit"], { eventFit: "not_on_list" }).amounts, []);
});

// ------------------------------------------------------------------ the app's own turn
async function main() {
  await atest("in the app's chat turn, the illustration is saved with its card, and a second turn without a number shows none", async () => {
    const h = household(TABLE_LINE, 5000);
    const saved: { answer: { statements?: { id?: string; amount: { text: string } | null; text: string; basis?: string | null }[] } }[] = [];
    const row = h.rows.find((r) => /Child Education/.test(r.benefit))!;
    const reply = () => ({ bottomLine: "The fund pays per child, up to two children.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Child education fund.", person: "Lim Ah Kow",
      document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "not_described", waiting: null, period: { from: "", to: "", eventOn: "" } }] });
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() { return { json: reply(), stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    const run = async (question: string, history: { role: "user" | "assistant"; text: string }[]) => {
      const context = { request: { accountId: h.house.accountId, familyMemberId: null, question, submittedQuestion: question }, family: [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }], people: [],
        conversation: { id: "c1", account_id: h.house.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
      await runSimpleChat(context, {}, { model, household: async () => h.house, history: async () => history as never, save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
        table: async () => h.table, today: () => new Date("2026-10-21T04:00:00Z") });
      return saved[saved.length - 1].answer.statements ?? [];
    };
    const first = await run("how much in total if we have two kids", [{ role: "user", text: "what's the child education fund benefit" }, { role: "assistant", text: "It pays per child." }]);
    assert.deepEqual(first.filter((s) => s.amount).map((s) => s.amount!.text), ["S$5,000", "S$10,000"], JSON.stringify(first));
    assert.ok(first.some((s) => s.id === "s1-count" && /for the children you described/.test(s.basis ?? "")));
    const second = await run("and what about my wife's cover?", [{ role: "user", text: "how much in total if we have two kids" }]);
    assert.ok(!second.some((s) => s.id?.endsWith("-count")), JSON.stringify(second));
  });
  console.log(`per-child: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
void main();
