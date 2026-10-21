/** Scripted tests for Ask DearPolicy on the benefit table (lib/benefit-table/chat.ts): a synthetic household is read
 * into a table, the model's reply names rows, and the simple chat's own checks (lib/simple-chat/verify.ts, unchanged)
 * decide what the household sees. No model, database or network.
 *   npm run benefit-table:chat-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type Confirmation, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts, nameStatesMoney, noteLeftOutAmounts, NO_ROWS_YET, renderTable } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT, readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";
import { TABLE_ANSWER_SCHEMA } from "@/lib/simple-chat/prompt";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel, SimpleModelCall } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const CERT = "aaaaaaaa-0000-0000-0000-000000000001", TERMS = "aaaaaaaa-0000-0000-0000-000000000002", ILP = "aaaaaaaa-0000-0000-0000-000000000003";
const doc = (policyId: string, name: string, pages: { page: number; text: string }[]) => ({ policyId, name, insurer: "Testlife", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Lim Ah Kow", "Tan Mei Ling"], supersededAt: null, processingStatus: "ready", pages });
const HOUSE: Household = {
  accountId: "11111111-1111-1111-1111-111111111111",
  members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
  documents: [
    doc(CERT, "Certificate.pdf", [{ page: 1, text: "GROUP PERSONAL ACCIDENT\nLim Ah Kow\tS$600,000\tAs of 01/01/2026\nTan Mei Ling\tS$200,000\tAs of 01/01/2026" }]),
    doc(TERMS, "Scheme terms.pdf", [
      { page: 2, text: "BENEFIT 2: GROUP PERSONAL ACCIDENT\nCompensation Schedule (% of Sum Insured)\nHip\t75%\nWrist\t20%" },
      { page: 4, text: "BENEFIT 5: GROUP TERM LIFE\nCompensation Schedule (% of Sum Insured)\nKnee\t40%" },
      { page: 3, text: "Simple Fracture Benefit Limit: S$5,000\nCompensation (% of S$5,000)\nAnkle\t50%\nAmbulance Cost\tUp to S$500 per incident\nChild\nHospital cash\tS$50 per day" },
      { page: 5, text: "BENEFIT 2: GROUP PERSONAL ACCIDENT\nAdvance Payment Benefit 100% Sum Insured (up to S$400,000)" },
    ]),
    doc(ILP, "Policy illustration.pdf", [{ page: 1, text: "Lim Ah Kow\tSum assured S$100,000\nNon-Guaranteed Surrender Value S$12,400" }]),
  ],
};
const family: FamilyMember[] = [{ id: "p1", display_name: "Lim Ah Kow" }, { id: "p2", display_name: "Tan Mei Ling" }];
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const b = (o: Record<string, unknown>) => ({ section: "Accident", column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...o });
const cover = (person: string, sumInsured: number, quote: string) => ({ person, product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured, asOf: "01/01/2026", page: 1, quote });

const certR = checkReading(src(HOUSE.documents[0]), reading("personal_proof", "Group Scheme", [cover("Lim Ah Kow", 600000, "Lim Ah Kow S$600,000 As of 01/01/2026"), cover("Tan Mei Ling", 200000, "Tan Mei Ling S$200,000 As of 01/01/2026")], []));
const termsR = checkReading(src(HOUSE.documents[1]), reading("scheme_terms", "Group Scheme", [], [
  b({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", page: 2, quote: "Hip 75%" }),
  b({ benefit: "Ankle", pays: "percent", value: 50, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Compensation (% of S$5,000)", page: 3, quote: "Ankle 50%" }),
  b({ section: "Life", benefit: "Knee", pays: "percent", value: 40, percentOf: "sum_insured", page: 4, quote: "Knee 40%" }),
  b({ benefit: "Advance Payment Benefit", pays: "percent", value: 100, percentOf: "sum_insured", cap: 400000, capQuote: "(up to S$400,000)", page: 5, quote: "Advance Payment Benefit 100% Sum Insured (up to S$400,000)" }),
  b({ benefit: "Ambulance Cost", pays: "up_to", value: 500, page: 3, quote: "Ambulance Cost Up to S$500 per incident" }),
  b({ section: "Hospital", column: "Child", benefit: "Hospital cash", pays: "per_day", value: 50, page: 3, quote: "Hospital cash S$50 per day" }),
]));
const ilpR = checkReading(src(HOUSE.documents[2]), reading("personal_proof", "SaveMore", [{ person: "Lim Ah Kow", product: "SaveMore", cover: "SaveMore", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: "Lim Ah Kow Sum assured S$100,000" }],
  [b({ section: null, benefit: "Surrender value", pays: "value", value: 12400, page: 1, quote: "Non-Guaranteed Surrender Value S$12,400" })]));
const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null });
const links = [
  { section: sectionKeyOf(TERMS, { section: "Accident", column: null }), cover: gpa, why: "the accident scale" },
  { section: sectionKeyOf(TERMS, { section: "Hospital", column: "Child" }), cover: gpa, why: "hospital cash" },
  // A wrong link (a life-cover table linked to the accident cover): the chat's own page check still refuses its amount.
  { section: sectionKeyOf(TERMS, { section: "Life", column: null }), cover: gpa, why: "a wrong link" },
  { section: sectionKeyOf(ILP, { section: null, column: null }), cover: coverKeyOf({ product: "SaveMore", cover: "SaveMore", plan: null }), why: "the plan" },
];
const tableWith = (confirmations: Confirmation[] = []) => assembleTable([certR, termsR, ilpR], family, links, confirmations);
const rows = chatRows(tableWith(), HOUSE);
const idOf = (person: string, benefit: string) => rows.find((r) => r.person === person && r.benefit === benefit)!.id;

/** The model's reply with these statements, through the row step, readModelAnswer and verifyAnswer. */
function answer(statements: Record<string, unknown>[], rs = rows) {
  const raw = { bottomLine: "The amounts below.", nextSteps: [], question: null, statements: statements.map((s) => ({
    kind: "amount", text: "x", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, ...s })) };
  const fromRows = amountsFromRows(raw, rs, HOUSE);
  const parsed = readModelAnswer(fromRows.json)!;
  const { answer: a, report } = verifyAnswer(HOUSE, parsed, ["How much?"], new Set(fromRows.report.labels));
  if (process.env.DEBUG_CHAT) console.log(JSON.stringify({ st: parsed.statements, report }, null, 1));
  // As the app's chat turn does (lib/simple-chat/hook.ts): unlabelled amounts refused, left-out amounts noted.
  const { kept, refused } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  fromRows.report.dropped.push(...refused.map((st) => ({ why: "the amount lost its label to the checks", text: st.text })));
  a.statements = noteLeftOutAmounts(kept, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
  const amounts = (a.statements ?? []).filter((s) => s.amount).map((s) => ({ person: s.personName, text: s.text, amount: s.amount!.text }));
  return { amounts, dropped: fromRows.report.dropped, statements: a.statements ?? [] };
}

test("the table block numbers every row and states the figure the Coverage page shows", () => {
  const block = renderTable(rows);
  assert.match(block, /<benefit_table>/);
  assert.match(block, /R\d+ \| Lim Ah Kow \| .*Hip \| S\$450,000, worked out: 75% of S\$600,000/);
  assert.match(block, /Tan Mei Ling .*Hip \| S\$150,000/);
  assert.match(block, /Hospital cash \| for child \| S\$50 a day/);
  assert.equal(renderTable([]), "");
});
test("the answer schema asks for each statement's row", () => {
  assert.ok((TABLE_ANSWER_SCHEMA.properties.statements.items.required as readonly string[]).includes("row"));
});
test("a printed row's amount reaches the household, checked against the page", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "Ambulance cost is paid up to a limit." }]);
  assert.equal(r.amounts.length, 1);
  assert.match(r.amounts[0].amount, /500/);
});
test("a percentage of the person's own sum insured is worked out on that person's figure", () => {
  const lim = answer([{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "A hip fracture pays a share of the sum insured." }]);
  const tan = answer([{ row: idOf("Tan Mei Ling", "Hip"), person: "Tan Mei Ling", text: "A hip fracture pays a share of the sum insured." }]);
  assert.match(lim.amounts[0]?.amount ?? "", /450,000/);
  assert.match(tan.amounts[0]?.amount ?? "", /150,000/);
});
test("a percentage of a fixed amount printed on the page is worked out", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Ankle"), person: "Lim Ah Kow", text: "An ankle fracture pays a share of the fracture limit." }]);
  assert.match(r.amounts[0]?.amount ?? "", /2,500/);
});
test("the model's own amount is ignored: the row's figure is used", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", amount: "S$1,000,000", percentOf: { percent: 100, baseAmount: "S$1,000,000", baseDocument: null, baseQuote: null }, text: "Hip." }]);
  assert.match(r.amounts[0]?.amount ?? "", /450,000/);
  assert.ok(!r.amounts.some((a) => /1,000,000/.test(a.amount)));
});
test("the model's own quote and document are ignored: the row's page is used", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", document: "D1", quote: "Tan Mei Ling S$200,000 As of 01/01/2026", text: "Ambulance." }]);
  assert.match(r.amounts[0]?.amount ?? "", /500/);
  assert.ok(!r.amounts.some((a) => /200,000/.test(a.amount)));
});
test("an amount with no row, a made-up row, or another person's row is dropped", () => {
  const r = answer([
    { person: "Lim Ah Kow", amount: "S$500", quote: "Ambulance Cost Up to S$500 per incident", document: "D2", text: "no row" },
    { row: "R999", person: "Lim Ah Kow", text: "made-up row" },
    { row: idOf("Tan Mei Ling", "Hip"), person: "Lim Ah Kow", text: "another person's row" },
  ]);
  assert.equal(r.amounts.length, 0);
  assert.deepEqual(r.dropped.map((d) => d.text), ["no row", "made-up row", "another person's row"]);
  assert.ok(r.statements.some((s) => s.text === LEFT_OUT_AMOUNT), "the household is told an amount was left out");
});
test("money in the model's own sentence never removes what the amount is for (R90-1)", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Hospital cash"), person: "Lim Ah Kow", text: "Hospital cash pays S$999 a day, so S$9,990 for ten days." }]);
  assert.equal(r.amounts.length, 1);
  assert.match(r.amounts[0].amount, /50/);
  assert.match(r.amounts[0].text, /^Hospital cash \(/);
  assert.doesNotMatch(JSON.stringify(r.statements), /999|9,990/);
});
test("the model's sentence naming another benefit is not used: the row's own benefit is said (R90-2)", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "Death benefit pays this." }]);
  assert.match(r.amounts[0]?.text ?? "", /^Ambulance Cost \(Group Scheme, Group Personal Accident\): up to this limit\.$/);
  assert.doesNotMatch(JSON.stringify(r.statements), /Death benefit/);
});
test("with no table rows yet, an amount asked for is said plainly not to be ready (R90-3)", () => {
  const r = answer([{ row: "R1", person: "Lim Ah Kow", text: "Hip." }], []);
  assert.equal(r.amounts.length, 0);
  assert.ok(r.statements.some((s) => s.text === NO_ROWS_YET), JSON.stringify(r.statements));
  assert.ok(r.statements.some((s) => s.text === LEFT_OUT_AMOUNT));
});
test("an amount whose sentence is not the server's label is refused after the checks", () => {
  const report = { dropped: [], labels: ["Hip (Group Scheme)."] };
  const { kept, refused } = keepLabelledAmounts([{ text: "Hip (Group Scheme).", amount: { text: "S$1" } }, { text: "Hip (Group Scheme)", amount: { text: "S$2" } }, { text: "A fact.", amount: null }], report);
  assert.deepEqual(kept.map((s) => s.text), ["Hip (Group Scheme).", "A fact."]);
  assert.deepEqual(refused.map((s) => s.text), ["Hip (Group Scheme)"]);
  const noted = noteLeftOutAmounts([{ id: "left-out-fact", kind: "uncertainty", text: "I left out a point I couldn’t find in your documents." }], { dropped: [{ why: "x", text: "y" }], labels: [] }, (id, text) => ({ id, kind: "uncertainty", text }));
  assert.deepEqual(noted.map((s) => s.id), ["left-out-amount"]);
  assert.deepEqual(noteLeftOutAmounts([], { dropped: [], labels: [] }, (id, text) => ({ id, kind: "uncertainty", text })), []);
});
test("a row for a child says so with its amount (R89-1)", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Hospital cash"), person: "Lim Ah Kow", text: "Hospital cash is paid per day." }]);
  assert.match(r.amounts[0]?.text ?? "", /^Hospital cash \(.*\), for child only: paid per day\.$/);
});
test("a percentage of the sum insured says so (R91-1)", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "Hip." }]);
  assert.match(r.amounts[0]?.text ?? "", /: 75% of the sum insured, worked out\.$/);
  const a = answer([{ row: idOf("Lim Ah Kow", "Ankle"), person: "Lim Ah Kow", text: "Ankle." }]);
  assert.match(a.amounts[0]?.text ?? "", /: 50% of the amount printed, worked out\.$/);
});
test("a plan named with a number of 100 or more keeps its amount and its name (R91-2)", () => {
  const named = rows.map((r) => ({ ...r, plan: r.product === "Group Scheme" ? "300" : r.plan }));
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "Ambulance." }, { row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "Hip." }], named);
  assert.equal(r.amounts.length, 2, JSON.stringify(r.statements));
  assert.match(r.amounts[0].text, /^Ambulance Cost \(Group Scheme, Group Personal Accident, plan 300\): up to this limit\.$/);
  assert.match(r.amounts[0].amount, /500/);
  assert.match(r.amounts[1].amount, /450,000/);
});
test("a row whose benefit, cover or plan name states money is never labelled (R92-2)", () => {
  const named = rows.map((r) => r.benefit === "Ambulance Cost" ? { ...r, benefit: "Accidental Death S$1,000,000" } : r.benefit === "Hip" ? { ...r, cover: "Accident cover 1,000,000" }
    : r.benefit === "Ankle" ? { ...r, plan: "S$300" } : r);
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "a" }, { row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "b" },
    { row: idOf("Lim Ah Kow", "Ankle"), person: "Lim Ah Kow", text: "c" }], named);
  assert.equal(r.amounts.length, 0);
  assert.deepEqual(r.dropped.map((d) => /name states money/.test(d.why)), [true, true, true]);
  assert.doesNotMatch(JSON.stringify(r.statements), /1,000,000|S\$300/);
  assert.ok(r.statements.some((s) => s.text === LEFT_OUT_AMOUNT));
});
test("real names carry policy and scheme numbers: their rows keep their amounts", () => {
  const named = rows.map((r) => r.product === "Group Scheme" ? { ...r, product: "MINDEF & MHA GROUP INSURANCE SCHEME (GROUP POLICY NO. G007500)", cover: "GROUP PERSONAL ACCIDENT(POLICY NO. 3037850)" } : r);
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "a" }, { row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "b" }], named);
  assert.equal(r.amounts.length, 2, JSON.stringify(r.dropped));
  assert.match(r.amounts[0].text, /POLICY NO\. 3037850\)\): up to this limit\.$/);
  for (const name of ["GROUP POLICY NO. G007500", "POLICY NO.3037850", "Plan 300", "Plan 1000", "Plan 5000 Plus", "Option 2A", "Group Term Life (Policy 0012345678)", "Scheme 2026",
    "Policy No: 23-456789-01", "Certificate 000123", "SG-2026-001234", "12 Critical Illnesses", "Section 4.2.1", "Hospital & Surgical (Ward B1)", "Coverage against 37 critical illnesses", "Benefit 365 days", "Outpatient 120 visits"])
    assert.ok(!nameStatesMoney(name), name);
  for (const money of ["Death S$1,000,000", "Cover 1,000,000", "Death 1 million", "Benefit of 500 dollars", "Death $500", "Death S＄１,０００",
    // Critic R94
    "Accidental Death 1000000", "Death benefit of 600000", "Hospital cash 200 per day", "Hospital cash 200/day", "Benefit up to 5000", "Room & Board 300", "Death 1 000 000",
    // Test engineer, #96
    "one million dollars", "Sum insured: 300000", "Accidental death 200000", "1 000 000", "SGD 200000", "200000 dollars", "1.5m", "Lump sum 5k", "200,000.00", "Plan 300 (S$300 a day)", "1.000.000", "500000"])
    assert.ok(nameStatesMoney(money), money);
  assert.ok(!nameStatesMoney("300", "plan") && !nameStatesMoney("Plan 5000 Plus", "plan"), "a plan may be a bare number");
  assert.ok(nameStatesMoney("S$300", "plan") && nameStatesMoney("300 per day", "plan"));
  // Products and covers named with a number (Test engineer, #96) keep their rows; with a money cue they do not.
  for (const product of ["Smart Life 100", "Elite 500 Benefit", "Shield 360", "Critical Illness 150", "Saver 150", "MER 1500"]) assert.ok(!nameStatesMoney(product, "product"), product);
  for (const product of ["Accidental Death 1000000", "Death benefit of 600000", "Sum insured: 300000", "Shield S$360", "Benefit up to 5000", "Saver 150 per day"]) assert.ok(nameStatesMoney(product, "product"), product);
});
test("money in full-width digits is money: left out of the bottom line, next steps and facts (R92-1)", () => {
  const parsed = readModelAnswer({ bottomLine: "Your death cover pays S$１,０００,０００.", nextSteps: ["Claim S＄５００ now.", "Call the insurer."], question: null, statements: [
    { kind: "fact", text: "Your death cover pays S$１,０００,０００. Ambulance is covered.", person: "Lim Ah Kow", document: "D2", quote: "Ambulance Cost Up to S$500 per incident", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] })!;
  const { answer: a } = verifyAnswer(HOUSE, parsed, ["How much?"]);
  const all = JSON.stringify({ b: a.bottomLine, n: a.nextSteps, s: (a.statements ?? []).map((s) => s.text) });
  assert.doesNotMatch(all, /[\uff10-\uff19]/, all);
  assert.match(all, /Ambulance is covered/);
  assert.match(all, /Call the insurer/);
});
test("a bottom line built from the first card shows the label as written (TE, 233669e)", () => {
  const raw = { bottomLine: "S$999.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: idOf("Lim Ah Kow", "Ankle") }] };
  const fromRows = amountsFromRows(raw, rows, HOUSE);
  const { answer: a } = verifyAnswer(HOUSE, readModelAnswer(fromRows.json)!, ["How much?"], new Set(fromRows.report.labels));
  assert.match(a.bottomLine ?? "", /Ankle \(.*\): 50% of the amount printed, worked out\./);
  assert.doesNotMatch(JSON.stringify(a), /[\uff10-\uff19]|999/);
});
test("the same row named twice is given once (R91-3)", () => {
  const id = idOf("Lim Ah Kow", "Hip");
  const r = answer([{ row: id, person: "Lim Ah Kow", text: "Hip." }, { row: id, person: "Lim Ah Kow", text: "Hip again." }]);
  assert.equal(r.amounts.length, 1);
  assert.equal(r.dropped.length, 0);
});
test("a capped percentage gives the printed cap, checked against the words that print it", () => {
  const lim = answer([{ row: idOf("Lim Ah Kow", "Advance Payment Benefit"), person: "Lim Ah Kow", text: "Advance payment." }]);
  assert.match(lim.amounts[0]?.amount ?? "", /400,000/, JSON.stringify(lim.dropped));
  assert.match(lim.amounts[0].text, /: 100% of the sum insured, up to this limit\.$/);
  assert.doesNotMatch(JSON.stringify(lim.statements), /600,000/);
  const tan = answer([{ row: idOf("Tan Mei Ling", "Advance Payment Benefit"), person: "Tan Mei Ling", text: "Advance payment." }]);
  // Under its cap, the worked-out amount is the Coverage page's; the chat's own checks never work out a capped
  // percentage (verify.ts R52), so the chat names the row without an amount and says one was left out.
  assert.equal(tan.amounts.length, 0);
  assert.ok(tan.statements.some((s) => s.text === LEFT_OUT_AMOUNT));
  assert.doesNotMatch(JSON.stringify(tan.statements), /600,000|400,000/);
});
test("a non-guaranteed value is said to be projected", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Surrender value"), person: "Lim Ah Kow", text: "The surrender value." }]);
  assert.match(r.statements.find((s) => /surrender/i.test(s.text))?.text ?? "", /^Surrender value \(SaveMore\): projected, not guaranteed\.$/);
});
test("a corrected sum insured is never shown as a printed amount: the chat points to Coverage", () => {
  const corrected = chatRows(tableWith([{ personId: "p1", coverKey: gpa, status: "corrected", sumInsured: 700000 }]), HOUSE);
  const id = corrected.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Hip")!.id;
  const r = answer([{ row: id, person: "Lim Ah Kow", text: "Hip." }], corrected);
  assert.equal(r.amounts.length, 0);
  assert.ok(!r.amounts.some((a) => /450,000|525,000/.test(a.amount)));
  assert.match(r.statements.map((s) => s.text).join(" "), /you corrected on the Coverage page/);
});
test("the chat's own page check is a second guard: a row linked to the wrong cover shows no amount", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Knee"), person: "Lim Ah Kow", text: "Knee." }]);
  assert.equal(r.amounts.length, 0);
});
test("statements that are not amounts pass through unchanged", () => {
  const r = answer([{ kind: "fact", text: "Ambulance is covered per incident.", quote: "Ambulance Cost Up to S$500 per incident", document: "D2", person: "Lim Ah Kow" }]);
  assert.ok(r.statements.some((s) => s.kind === "fact" && /Ambulance/.test(s.text)));
});

/** One chat turn through runSimpleChat with a scripted model, this household and (or without) its table. */
async function turn(reply: (call: SimpleModelCall) => unknown, table: boolean | ReturnType<typeof tableWith>) {
  const calls: SimpleModelCall[] = [];
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call(c) { calls.push(c); return { json: reply(c), stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
  const context = { request: { accountId: HOUSE.accountId, familyMemberId: null, question: "I broke my hip, how much?", submittedQuestion: "I broke my hip, how much?" },
    family: [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }], people: [],
    conversation: { id: "c1", account_id: HOUSE.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
  const saved: { answer: { statements?: { amount: { text: string } | null; text: string }[] }; state: { simpleChat: { turns: { report: { dropped: { why: string }[] } }[] } } }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => HOUSE, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
    table: async () => (table === true ? tableWith() : table || null), today: () => new Date("2026-10-21T04:00:00Z") });
  return { call: calls[0], saved: saved[0] };
}
async function integration() {
  const hip = (call: SimpleModelCall) => ({ bottomLine: "A hip fracture is covered; see the amount below.", nextSteps: [], question: null, statements: [
    { kind: "amount", text: "A hip fracture pays a share of the sum insured.", person: "Lim Ah Kow", document: null, quote: null, amount: "S$999,999", percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
      row: /R(\d+) \| Lim Ah Kow \| [^\n]*\| Hip \|/.exec(call.library)?.[0].split(" ")[0] ?? null }] });
  await atest("in the app's chat turn, the table rides with the documents and the row's amount is what is saved", async () => {
    const t = await turn(hip, true);
    assert.equal(t.call.withRows, true);
    assert.match(t.call.library, /<benefit_table>/);
    const amounts = (t.saved.answer.statements ?? []).filter((s) => s.amount).map((s) => s.amount!.text);
    assert.equal(amounts.length, 1);
    assert.match(amounts[0], /450,000/);
    assert.ok(!JSON.stringify(t.saved.answer).includes("999,999"));
  });
  await atest("switched off, the chat turn is exactly as before: no table, no row field", async () => {
    const t = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [] }), false);
    assert.equal(t.call.withRows, false);
    assert.doesNotMatch(t.call.library, /benefit_table/);
  });
  await atest("in the app's chat turn, an amount without a row is dropped and recorded as dropped", async () => {
    const t = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [{ kind: "amount", text: "made up", person: "Lim Ah Kow", document: "D2", quote: "Hip 75%", amount: null,
      percentOf: { percent: 75, baseAmount: "S$600,000", baseDocument: "D1", baseQuote: "Lim Ah Kow S$600,000 As of 01/01/2026" }, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null }] }), true);
    assert.equal((t.saved.answer.statements ?? []).filter((s) => s.amount).length, 0);
    assert.match(t.saved.state.simpleChat.turns[0].report.dropped.map((d) => d.why).join(";"), /no table row/);
    assert.ok((t.saved.answer.statements ?? []).some((s) => s.text === LEFT_OUT_AMOUNT), "the household is told an amount was left out");
  });
  await atest("in the app's chat turn, a plan named with a number keeps its amount through every check (R91-2)", async () => {
    const t0 = tableWith();
    const named = { ...t0, people: t0.people.map((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, plan: r.product === "Group Scheme" ? "300" : r.plan })) })) };
    const t = await turn(hip, named);
    const shown = (t.saved.answer.statements ?? []).filter((s) => s.amount);
    assert.equal(shown.length, 1, JSON.stringify(t.saved.answer.statements));
    assert.match(shown[0].amount!.text, /450,000/);
    assert.match(shown[0].text, /plan 300\): 75% of the sum insured, worked out\.$/);
  });
  await atest("in the app's chat turn, a made-up row is dropped and the household is told an amount was left out", async () => {
    const t = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [{ kind: "amount", text: "made up", person: "Lim Ah Kow", document: null, quote: null, amount: "S$777", percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: "R99" }] }), true);
    assert.equal((t.saved.answer.statements ?? []).filter((s) => s.amount).length, 0);
    assert.ok((t.saved.answer.statements ?? []).some((s) => s.text === LEFT_OUT_AMOUNT));
    assert.ok(!JSON.stringify(t.saved.answer).includes("777"));
  });
}
async function atest(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

void integration().then(() => {
  console.log(`benefit-table chat: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
});
