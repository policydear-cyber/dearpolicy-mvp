/** A card's condition is said once: a "<benefit> also depends on this: <condition>" point is left out only when every card
 * it is said for already shows those same words among its own conditions (live run 25 Oct: the condition was printed in the
 * card and again under it). A condition the card does not show, or one said for another benefit, stays.
 * Made-up household; no model, database or network.
 *   npm run benefit-table:conditions-twice-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { chatRows, dropConditionsOnCards, type RowReport } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const CERT = "bbbbbbbb-0000-0000-0000-000000000001", PRODUCT = "bbbbbbbb-0000-0000-0000-000000000002", BENEFITS = "bbbbbbbb-0000-0000-0000-000000000003";
const doc = (policyId: string, name: string, pages: { page: number; text: string }[]) => ({ policyId, name, insurer: "Example Insurance", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Lim Ah Kow", "Tan Mei Ling"], supersededAt: null, processingStatus: "ready", pages });
const AMBULANCE_WORDS = "which necessitates the use of an ambulance, we will reimburse the actual ground ambulance costs";
const HOUSE: Household = {
  accountId: "22222222-2222-2222-2222-222222222222",
  members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
  documents: [
    doc(CERT, "Certificate.pdf", [{ page: 1, text: "GROUP PERSONAL ACCIDENT\nLim Ah Kow\tS$600,000\tAs of 01/01/2026\nTan Mei Ling\tS$200,000\tAs of 01/01/2026" }]),
    // The product summary prints the figure in a table, with no words on when it is paid.
    doc(PRODUCT, "Product summary.pdf", [{ page: 3, text: "GROUP PERSONAL ACCIDENT\nAmbulance Cost\tUp to S$500 per incident\nRecovery Benefit\tS$250" }]),
    // The benefit summary prints the same figure with its condition, and the recovery benefit's own condition.
    doc(BENEFITS, "Benefit summary.pdf", [{ page: 8, text: "GROUP PERSONAL ACCIDENT\nG. Ambulance Cost\nIf an Insured Person sustains bodily injury as a result of an Accident, "
      + AMBULANCE_WORDS + " up to maximum of S$500 for transportation to the Hospital.\n"
      + "H. Recovery Benefit\nIf the Insured Person is a hospital resident patient for at least 24 hours, we will pay S$250." }]),
  ],
};
const family: FamilyMember[] = [{ id: "p1", display_name: "Lim Ah Kow" }, { id: "p2", display_name: "Tan Mei Ling" }];
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const reading = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "Group Scheme", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const b = (o: Record<string, unknown>) => ({ section: "Accident", column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...o });
const cover = (person: string, sumInsured: number, quote: string) => ({ person, product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured, asOf: "01/01/2026", page: 1, quote });
const readings = [
  checkReading(src(HOUSE.documents[0]), reading("personal_proof", [cover("Lim Ah Kow", 600000, "Lim Ah Kow S$600,000 As of 01/01/2026"), cover("Tan Mei Ling", 200000, "Tan Mei Ling S$200,000 As of 01/01/2026")], [])),
  checkReading(src(HOUSE.documents[1]), reading("scheme_terms", [], [
    b({ benefit: "Ambulance Cost", pays: "up_to", value: 500, page: 3, quote: "Ambulance Cost Up to S$500 per incident" }),
    b({ benefit: "Recovery Benefit", pays: "amount", value: 250, page: 3, quote: "Recovery Benefit S$250" })])),
  checkReading(src(HOUSE.documents[2]), reading("scheme_terms", [], [
    b({ benefit: "G. Ambulance Cost", pays: "up_to", value: 500, page: 8, quote: "up to maximum of S$500 for transportation to the Hospital." })])),
];
const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null });
const table = assembleTable(readings, family, [
  { section: sectionKeyOf(PRODUCT, { section: "Accident", column: null }), cover: gpa, why: "the product summary" },
  { section: sectionKeyOf(BENEFITS, { section: "Accident", column: null }), cover: gpa, why: "the benefit summary" },
]);
const rows = chatRows(table, HOUSE);
const rowOf = (person: string, benefit: string) => {
  const r = rows.find((x) => x.person === person && x.source.documentId === PRODUCT && x.benefit === benefit);
  assert.ok(r, `no ${benefit} row for ${person}: ${JSON.stringify(rows.map((x) => [x.person, x.benefit, x.source.documentId]))}`);
  return r!;
};

type Shown = { kind: string; text: string; amount: { text: string } | null; personName?: string | null; conditions?: string[] };
/** One chat turn through the app's own runSimpleChat, the model's reply scripted. */
async function turn(statements: Record<string, unknown>[]): Promise<Shown[]> {
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
    return { json: { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: statements.map((s) => ({ kind: "amount", text: "x", document: null, quote: null, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: null, ofBill: null, rowBenefit: null, eventFit: "on_list", waiting: { applies: "no" }, period: null, ...s })) },
    stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
  const context = { request: { accountId: HOUSE.accountId, familyMemberId: null, question: "how much is the ambulance cover", submittedQuestion: "how much is the ambulance cover" },
    family: [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }, { id: "p2", display_name: "Tan Mei Ling", preferred_name: null, relationship: "spouse" }], people: [],
    conversation: { id: "c1", account_id: HOUSE.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
  const saved: { answer: { statements?: Shown[] } }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => HOUSE, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
    table: async () => table, today: () => new Date("2026-10-21T04:00:00Z") });
  return saved[0].answer.statements ?? [];
}
const NEEDS = { text: "The accident must have made an ambulance necessary.", quote: AMBULANCE_WORDS };
const points = (st: Shown[]) => st.filter((x) => !x.amount && /also depends on this/.test(x.text)).map((x) => [x.text, x.personName ?? null]);
const cards = (st: Shown[]) => st.filter((x) => x.amount).map((x) => [x.personName ?? null, x.amount!.text, x.conditions ?? []]);

void (async () => {
  await test("a condition the card itself shows is not said again under it (live run 25 Oct)", async () => {
    const st = await turn([{ row: rowOf("Lim Ah Kow", "Ambulance Cost").id, person: "Lim Ah Kow", conditions: [NEEDS] }]);
    // Nobody is named, so the same card is given for the other holder too (walkthrough gap 2). It shows only its own row's
    // printed conditions: the model's condition was said for Lim's card and is never copied to another person's (TE #345).
    assert.deepEqual(cards(st), [["Lim Ah Kow", "Up to S$500", [NEEDS.text]], ["Tan Mei Ling", "Up to S$500", []]], JSON.stringify(st));
    assert.deepEqual(points(st), [], JSON.stringify(st));
  });
  await test("the same for two people's cards: the shared point goes when both cards show it", async () => {
    const st = await turn([{ row: rowOf("Lim Ah Kow", "Ambulance Cost").id, person: "Lim Ah Kow", conditions: [NEEDS] },
      { row: rowOf("Tan Mei Ling", "Ambulance Cost").id, person: "Tan Mei Ling", conditions: [NEEDS] }]);
    assert.deepEqual(cards(st), [["Lim Ah Kow", "Up to S$500", [NEEDS.text]], ["Tan Mei Ling", "Up to S$500", [NEEDS.text]]], JSON.stringify(st));
    assert.deepEqual(points(st), [], JSON.stringify(st));
  });

  // The rest work on the step itself, with the cards and points as the checks leave them.
  const report = (over: Partial<RowReport>): RowReport => ({ dropped: [], labels: [], cards: {}, conditionPoints: [], ...over });
  const card = (personName: string, text: string, conditions: string[]) => ({ kind: "benefit_terms", text, amount: { text: "Up to S$500" }, personName, conditions });
  const point = (text: string, personName: string | null) => ({ kind: "fact", text, amount: null, personName, conditions: [] as string[] });
  const AMB = "Ambulance Cost (GROUP PERSONAL ACCIDENT): up to this limit.", REC = "Recovery Benefit (GROUP PERSONAL ACCIDENT).";
  const cardsOf = { A1: { text: AMB, person: "Lim Ah Kow" }, A2: { text: AMB, person: "Tan Mei Ling" }, R1: { text: REC, person: "Lim Ah Kow" } };

  await test("the same words, case and closing full stop aside, are the same condition", () => {
    const p = point("Ambulance Cost also depends on this: The accident must have made an ambulance necessary.", "Lim Ah Kow");
    const out = dropConditionsOnCards([card("Lim Ah Kow", AMB, ["the accident must have made an ambulance necessary"]), p],
      report({ cards: cardsOf, conditionPoints: [{ text: p.text, condition: NEEDS.text, rows: ["A1"] }] }));
    assert.deepEqual(out.map((x) => x.text), [AMB]);
  });
  await test("a condition the card does not show stays as its own point, even one in similar words", () => {
    const p = point("Ambulance Cost also depends on this: The emergency call must be proved within 24 hours.", "Lim Ah Kow");
    const out = dropConditionsOnCards([card("Lim Ah Kow", AMB, ["The emergency call must be proved."]), p],
      report({ cards: cardsOf, conditionPoints: [{ text: p.text, condition: "The emergency call must be proved within 24 hours.", rows: ["A1"] }] }));
    assert.deepEqual(out.map((x) => x.text), [AMB, p.text]);
  });
  await test("a condition said for another benefit stays, though another card shows the same words", () => {
    const p = point("Recovery Benefit also depends on this: The accident must have made an ambulance necessary.", "Lim Ah Kow");
    const out = dropConditionsOnCards([card("Lim Ah Kow", AMB, [NEEDS.text]), card("Lim Ah Kow", REC, []), p],
      report({ cards: cardsOf, conditionPoints: [{ text: p.text, condition: NEEDS.text, rows: ["R1"] }] }));
    assert.deepEqual(out.map((x) => x.text), [AMB, REC, p.text]);
  });
  await test("a point said for two people stays while one of their cards does not show it", () => {
    const p = point("Ambulance Cost also depends on this: The accident must have made an ambulance necessary.", null);
    const out = dropConditionsOnCards([card("Lim Ah Kow", AMB, [NEEDS.text]), card("Tan Mei Ling", AMB, []), p],
      report({ cards: cardsOf, conditionPoints: [{ text: p.text, condition: NEEDS.text, rows: ["A1", "A2"] }] }));
    assert.equal(out.length, 3);
  });
  await test("a point whose card is not shown stays", () => {
    const p = point("Ambulance Cost also depends on this: The accident must have made an ambulance necessary.", "Lim Ah Kow");
    const out = dropConditionsOnCards([p], report({ cards: cardsOf, conditionPoints: [{ text: p.text, condition: NEEDS.text, rows: ["A1"] }] }));
    assert.equal(out.length, 1);
  });
  await test("a fact the row step did not make is never touched", () => {
    const p = point("Ambulance Cost also depends on this: The accident must have made an ambulance necessary.", "Lim Ah Kow");
    assert.equal(dropConditionsOnCards([card("Lim Ah Kow", AMB, [NEEDS.text]), p], report({ cards: cardsOf })).length, 2);
  });

  console.log(`conditions twice: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
})();
