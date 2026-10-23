/** Scripted tests for Ask DearPolicy on the benefit table (lib/benefit-table/chat.ts): a synthetic household is read
 * into a table, the model's reply names rows, and the simple chat's own checks (lib/simple-chat/verify.ts, unchanged)
 * decide what the household sees. No model, database or network.
 *   npm run benefit-table:chat-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type Confirmation, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, declaredCurrency, type SourceDoc } from "@/lib/benefit-table/check";
import { type ChatRow, amountsFromRows, chatRows, printedDay, coverLabels, citedPages, dropAgreeingDayRules, dropAmountPointers, dropPeopleShutOut, rowLabel, NARROWED_PAGES_NOTE, pagesToSend, keepLabelledAmounts, nameStatesMoney, noteLeftOutAmounts, NO_ROWS_YET, renderTable } from "@/lib/benefit-table/chat";
import { escapeText, PAGES_LEFT_OUT, PAGES_NOTE, spouseMeant, type Household } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT, NOTHING_SHOWN, readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";
import { TABLE_ANSWER_SCHEMA } from "@/lib/simple-chat/prompt";
import { datesSaidNote, periodsNote, runSimpleChat } from "@/lib/simple-chat/hook";
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
      { page: 9, text: "CLAIMS\nWritten notice of a claim must be given within 30 days." },
      { page: 11, text: "LIVING CARE\nWaiting Period: no Living Care benefit is payable for a heart attack or major cancer diagnosed within 90 days of cover starting." },
      { page: 12, text: "CRITICAL ILLNESS\nThe insured must survive the diagnosis by 7 days (the survival period)." },
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
  // Day counts are on the row, so two documents' rows for the same daily benefit can be seen to agree (live run B3).
  const days = renderTable([{ ...rows[0], figure: { kind: "printed", amount: 30, currency: "SGD", unit: "per_day", period: null }, fromDay: 11, maxDays: 30 } as ChatRow]);
  assert.match(days, /S\$30 a day \| from day 11 \| for at most 30 days/);
  assert.equal(renderTable([]), "");
});
test("the answer schema asks for each statement's row", () => {
  assert.ok((TABLE_ANSWER_SCHEMA.properties.statements.items.required as readonly string[]).includes("row"));
  // The API refuses a schema with more than 16 nullable or union parameters (round 9: "period" made 20, every call failed).
  const unions = (x: unknown): number => !x || typeof x !== "object" ? 0
    : (Array.isArray(x) ? x.reduce((n: number, y) => n + unions(y), 0)
      : (Array.isArray((x as { type?: unknown }).type) || "anyOf" in (x as object) ? 1 : 0) + Object.values(x as object).reduce((n: number, y) => n + unions(y), 0));
  assert.ok(unions(TABLE_ANSWER_SCHEMA) <= 16, `${unions(TABLE_ANSWER_SCHEMA)} union parameters`);
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
test("an amount binds to a card only by the row id it names, never by its quote or figure (coordinator, TE #108 Q8)", () => {
  for (const quote of ["Ambulance Cost Up to S$500 per incident", "Ambulance claims\tS$500"]) {
    const r = answer([{ person: "Lim Ah Kow", amount: "S$500", quote, document: "D2", text: "x" }]);
    assert.equal(r.amounts.length, 0, quote);
    assert.ok(r.statements.some((s) => s.text === LEFT_OUT_AMOUNT));
  }
  assert.match(renderTable(rows), /always with its id, also when you read the figure in another document/);
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
  assert.match(r.amounts[0]?.text ?? "", /^Ambulance Cost \(Group Personal Accident\): up to this limit, per incident\.$/);
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
test("a percentage of the sum insured says so (R91-1), on the card's own line and not again in its label (DC, 22 Oct)", () => {
  const r = answer([{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "Hip." }]);
  const hip = r.statements.find((s) => s.amount);
  assert.match(hip?.basis ?? "", /^75% of Lim Ah Kow's .*sum insured of S\$600,000/, JSON.stringify(r.statements));
  assert.match(hip!.text, /^Hip \([^)]*\)\.$/);
  const a = answer([{ row: idOf("Lim Ah Kow", "Ankle"), person: "Lim Ah Kow", text: "Ankle." }]);
  const ankle = a.statements.find((s) => s.amount);
  assert.match(ankle?.basis ?? "", /^50% of S\$\d/, JSON.stringify(a.statements));
  assert.doesNotMatch(ankle!.text, /amount printed|%/);
});
test("a plan named with a number of 100 or more keeps its amount and its name (R91-2)", () => {
  const named = rows.map((r) => ({ ...r, plan: r.product === "Group Scheme" ? "300" : r.plan }));
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "Ambulance." }, { row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "Hip." }], named);
  assert.equal(r.amounts.length, 2, JSON.stringify(r.statements));
  assert.match(r.amounts[0].text, /^Ambulance Cost \(Group Personal Accident, plan 300\): up to this limit, per incident\.$/);
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
test("an answer card names the cover shortly; the product is added only when two covers read the same, and the full names when that is still not enough", () => {
  const labels = coverLabels([
    { product: "MINDEF & MHA GROUP INSURANCE SCHEME (GROUP POLICY NO. G007500)", cover: "GROUP TERM LIFE(POLICY NO.3037850)", plan: null },
    { product: "Singlife Shield", cover: "Death Benefit", plan: null }, { product: "FWD Term", cover: "Death Benefit", plan: null },
    { product: "Travel Care", cover: "Travel Care", plan: "Business" }, { product: "Travel insurance summary", cover: "Single Trip", plan: "Business" },
    { product: "Same Name", cover: "Ward", plan: null }, { product: "Same Name (Policy No. 2)", cover: "Ward", plan: null },
  ]);
  assert.deepEqual([...labels.values()], ["GROUP TERM LIFE", "Death Benefit, Singlife Shield", "Death Benefit, FWD Term", "Travel Care, plan Business",
    "Single Trip, plan Business, Travel insurance summary", "Same Name, Ward", "Same Name (Policy No. 2), Ward"]);
});
test("labels picked by different rules never land on the same words (TE #99)", () => {
  const labels = coverLabels([{ product: "Alpha", cover: "Life, Beta", plan: null }, { product: "Beta", cover: "Life", plan: null }, { product: "Gamma", cover: "Life", plan: null }]);
  const values = [...labels.values()];
  assert.equal(new Set(values).size, values.length, JSON.stringify(values));
});
test("real names carry policy and scheme numbers: their rows keep their amounts", () => {
  const named = rows.map((r) => r.product === "Group Scheme" ? { ...r, product: "MINDEF & MHA GROUP INSURANCE SCHEME (GROUP POLICY NO. G007500)", cover: "GROUP PERSONAL ACCIDENT(POLICY NO. 3037850)" } : r);
  const r = answer([{ row: idOf("Lim Ah Kow", "Ambulance Cost"), person: "Lim Ah Kow", text: "a" }, { row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", text: "b" }], named);
  assert.equal(r.amounts.length, 2, JSON.stringify(r.dropped));
  assert.match(r.amounts[0].text, /^Ambulance Cost \(GROUP PERSONAL ACCIDENT\): up to this limit, per incident\.$/);
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
  assert.match(a.bottomLine ?? "", /Ankle \([^)]*\)\./);
  assert.doesNotMatch(a.bottomLine ?? "", /amount printed/);
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
  const saved: { answer: { statements?: { amount: { text: string } | null; text: string; basis?: string | null }[] }; state: { simpleChat: { turns: { report: { dropped: { why: string }[] } }[] } } }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => HOUSE, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
    table: async () => (table === true ? tableWith() : table || null), today: () => new Date("2026-10-21T04:00:00Z") });
  return { call: calls[0], saved: saved[0] };
}
async function integration() {
  const hip = (call: SimpleModelCall) => ({ bottomLine: "A hip fracture is covered; see the amount below.", nextSteps: [], question: null, statements: [
    { kind: "amount", text: "A hip fracture pays a share of the sum insured.", person: "Lim Ah Kow", document: null, quote: null, amount: "S$999,999", percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
      row: /R(\d+) \| Lim Ah Kow \| [^\n]*\| Hip \|/.exec(call.library)?.[0].split(" ")[0] ?? null }] });
  await atest("a bottom line that answers on its own is never followed by the 'none shown' line; one that introduces points is (live run 23 Oct, E2; stress S070)", async () => {
    const unquoted = (bottomLine: string) => () => ({ bottomLine, nextSteps: [], question: null, statements: [
      { kind: "fact", text: "The scheme has a hotline.", person: null, document: "D1", quote: "a sentence printed nowhere", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: null, waiting: null, period: null }] });
    const texts = async (b: string) => ((await turn(unquoted(b), true)).saved.answer.statements ?? []).map((x) => x.text);
    assert.ok(!(await texts("All eight of your files were read, so none could not be read.")).includes(NOTHING_SHOWN));
    for (const b of ["Here is each adult's list.", "The documents are listed below.", "Each person's documents:", "Here's what each of you has.", "Your documents are as follows.", "These are the benefits."]) assert.deepEqual(await texts(b), [NOTHING_SHOWN], b);
    // "Following" and "below" in their plain sense introduce nothing (TE N4).
    for (const b of ["Nothing is paid following a stroke in the first year.", "An injury below the knee is covered.", "These are not covered by his plan.", "Your claim is below the limit."]) assert.ok(!(await texts(b)).includes(NOTHING_SHOWN), b);
  });
  await atest("in the app's chat turn, the table rides with the documents and the row's amount is what is saved", async () => {
    const t = await turn(hip, true);
    assert.equal(t.call.withRows, true);
    assert.match(t.call.library, /<benefit_table>/);
    const amounts = (t.saved.answer.statements ?? []).filter((s) => s.amount).map((s) => s.amount!.text);
    assert.equal(amounts.length, 1);
    assert.match(amounts[0], /450,000/);
    assert.ok(!JSON.stringify(t.saved.answer).includes("999,999"));
  });
  await atest("with the table, the pages its rows come from and those documents' rule pages are sent, with every document's details; switched off, every page", async () => {
    const t = await turn(hip, true), off = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [] }), false);
    const cited = pagesToSend(chatRows(tableWith(), HOUSE), HOUSE);
    let left = 0;
    for (const d of HOUSE.documents) {
      assert.ok(t.call.library.includes(`name="${d.name}"`), d.name);
      for (const p of d.pages) {
        const page = `<page n="${p.page}">\n${escapeText(p.text)}\n</page>`;
        assert.ok(off.call.library.includes(page), `off sends ${d.name} p${p.page}`);
        assert.equal(t.call.library.includes(page), cited.has(`${d.policyId}#${p.page}`), `${d.name} p${p.page}`);
        if (!cited.has(`${d.policyId}#${p.page}`)) left++;
      }
    }
    assert.ok(left > 0 && cited.size > 0, "the household has pages no row cites");
    // The note says the left-out pages were read, so a file is never called unreadable (release-set E1, E2).
    assert.match(t.call.library, new RegExp(`<pages_not_sent count="\\d+" of="\\d+" note="${PAGES_LEFT_OUT}"/>`));
    assert.ok(t.call.library.includes(PAGES_NOTE) && !off.call.library.includes(PAGES_NOTE));
    // Critic R113-1: an uncited page with a waiting period is sent; an uncited claims page is not.
    assert.match(t.call.library, /Waiting Period: no Living Care benefit is payable/);
    assert.match(t.call.library, /must survive the diagnosis by 7 days/, "Critic R114-1: a survival-period page is sent");
    assert.doesNotMatch(t.call.library, /Written notice of a claim/);
    assert.ok(citedPages(chatRows(tableWith(), HOUSE)).size < cited.size, "rule pages are added to the cited ones");
  });
  await atest("Critic R113-1: an amount given from narrowed pages always carries the server's note on waiting periods and exclusions", async () => {
    const t = await turn(hip, true);
    const st = t.saved.answer.statements ?? [];
    assert.ok(st.some((s) => s.amount), "the amount is shown");
    assert.equal(st.filter((s) => s.text === NARROWED_PAGES_NOTE).length, 1);
    assert.doesNotMatch(NARROWED_PAGES_NOTE, /\d/);
    const none = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [{ kind: "fact", text: "Ambulance is covered per incident.", person: "Lim Ah Kow", document: "D2",
      quote: "Ambulance Cost Up to S$500 per incident", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null }] }), true);
    assert.ok(!(none.saved.answer.statements ?? []).some((s) => s.text === NARROWED_PAGES_NOTE), "no amount, no note");
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
    assert.match(shown[0].text, /plan 300\)\.$/);
    assert.match(shown[0].basis ?? "", /^75% of .*sum insured/);
  });
  await atest("in the app's chat turn, a made-up row is dropped and the household is told an amount was left out", async () => {
    const t = await turn(() => ({ bottomLine: "x", nextSteps: [], question: null, statements: [{ kind: "amount", text: "made up", person: "Lim Ah Kow", document: null, quote: null, amount: "S$777", percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: "R99" }] }), true);
    assert.equal((t.saved.answer.statements ?? []).filter((s) => s.amount).length, 0);
    assert.ok((t.saved.answer.statements ?? []).some((s) => s.text === LEFT_OUT_AMOUNT));
    assert.ok(!JSON.stringify(t.saved.answer).includes("777"));
  });
}
// ------------------------------------------------------------------ chat test 01 follow-ups: stays, cover lines, premiums
const SCHED = "aaaaaaaa-0000-0000-0000-000000000004", CASH = "aaaaaaaa-0000-0000-0000-000000000005";
const HOUSE2: Household = { ...HOUSE, documents: [
  doc(SCHED, "Policy schedule.pdf", [{ page: 3, text: "Policy Effective Date\t: 19/10/2026\nAssured\t: Lim Ah Kow\nInstalment Premium\t: 470.85\tCurrency\n: Singapore Dollar\nPayment Frequency\t: Monthly\nBasic Benefits\tSum\tInstalment\nComprehensive Critical\t300,000.00\t269.05\t19/10/2036\nIllness Benefit\nDeath Benefit\t5,000.00\t---\nPolicy Number\t: 1234567" }]),
  doc(CASH, "Life terms.pdf", [{ page: 5, text: "BENEFIT 1: GROUP TERM LIFE\nDaily Hospital Cash Benefit\tS$30 per day from the 11th day onwards.\nMax: 30 days of continuous hospitalisation" }]),
] };
const schedCover = (o: Record<string, unknown>) => ({ person: "Lim Ah Kow", product: "CI Plan", cover: "Comprehensive Critical Illness Benefit", plan: null, sumInsured: 300000, asOf: "19/10/2026", page: 3,
  quote: "Comprehensive Critical\tIllness Benefit\t300,000.00\t269.05\t19/10/2036", ...o });
const schedR = (o: Record<string, unknown> = {}) => checkReading(src(HOUSE2.documents[0]), reading("personal_proof", "CI Plan", [schedCover(o)], []));
const cashR = (o: Record<string, unknown>) => checkReading(src(HOUSE2.documents[1]), reading("scheme_terms", "Group Scheme", [], [
  b({ section: "Life", benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 30, page: 5, quote: "Daily Hospital Cash Benefit\tS$30 per day from the 11", ...o })]));
const lifeCert = checkReading(src(HOUSE2.documents[0]), reading("personal_proof", "Group Scheme", [], []));
function answer2(cash: Record<string, unknown>, statements: Record<string, unknown>[], asked: string[], confirmations: Confirmation[] = [], sched = schedR()) {
  const ci = coverKeyOf({ product: "CI Plan", cover: "Comprehensive Critical Illness Benefit", plan: null });
  const t = assembleTable([sched, cashR(cash), lifeCert], family, [{ section: sectionKeyOf(CASH, { section: "Life", column: null }), cover: ci, why: "hospital cash" }], confirmations);
  const rs = chatRows(t, HOUSE2);
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: statements.map((s) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, ...s, ...(typeof s.row === "function" ? { row: (s.row as (r: typeof rs) => string)(rs) } : {}) })) };
  const fromRows = amountsFromRows(raw, rs, HOUSE2);
  const { answer: a } = verifyAnswer(HOUSE2, readModelAnswer(fromRows.json)!, asked, new Set(fromRows.report.labels));
  const { kept } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  return { rows: rs, amounts: kept.filter((s) => s.amount).map((s) => s.amount!.text), kept };
}
const rowNamed = (benefit: RegExp) => (rs: ReturnType<typeof chatRows>) => rs.find((r) => benefit.test(r.benefit))!.id;
const CASH_ROW = { fromDay: 11, maxDays: 30, quote: "Daily Hospital Cash Benefit\tS$30 per day from the 11th day onwards.\nMax: 30 days of continuous hospitalisation" };
test("a stay the household described is worked out from a labelled daily row, within its most days (chat test B3, H4)", () => {
  const twelve = answer2(CASH_ROW, [{ row: rowNamed(/Hospital Cash/), perDay: { stayDays: 12 }, text: "Hospital cash." }], ["he was in hospital 12 days"]);
  assert.deepEqual(twelve.amounts, ["S$30", "S$60"]);
  assert.ok(twelve.kept.some((s) => s.kind === "calculation" && s.amount?.illustration && /12-day stay/.test(s.text)));
  const long = answer2(CASH_ROW, [{ row: rowNamed(/Hospital Cash/), perDay: { stayDays: 45 }, text: "Hospital cash." }], ["in hospital 45 days after a fall"]);
  assert.deepEqual(long.amounts, ["S$30", "S$900"]);
});
test("the stay is refused when the table read other most days, or none, for that row", () => {
  for (const o of [{ ...CASH_ROW, maxDays: 40 }, { ...CASH_ROW, maxDays: null }]) {
    const r = answer2(o, [{ row: rowNamed(/Hospital Cash/), perDay: { stayDays: 45 }, text: "Hospital cash." }], ["in hospital 45 days"]);
    assert.deepEqual(r.amounts, ["S$30"], JSON.stringify(o));
  }
  // A first paid day the quote states is the row's, whatever the reading said ("from the 11th day", read as 30): the
  // stay is worked out from day 11 (TE #108 B2).
  const misread = answer2({ ...CASH_ROW, fromDay: 30 }, [{ row: rowNamed(/Hospital Cash/), perDay: { stayDays: 45 }, text: "Hospital cash." }], ["in hospital 45 days"]);
  assert.equal(misread.rows.find((x) => /Hospital Cash/.test(x.benefit))!.fromDay, 11);
  assert.deepEqual(misread.amounts, ["S$30", "S$900"]);
});
test("a stay statement is never kept without its labelled daily row", () => {
  const report = { dropped: [], labels: [], days: { "Cash (X).": [{ fromDay: 11, maxDays: 30, alone: true }] } };
  const st = [{ id: "s1", text: "Cash (Y).", amount: { text: "S$30" } }, { id: "s1-stay", text: "For a 12-day stay, this works out to 2 days of the daily benefit.", amount: { text: "S$60" }, basis: "S$30 a day, paid from day 11, for at most 30 days (2 × S$30)" }];
  assert.deepEqual(keepLabelledAmounts(st, report).kept, []);
});
test("a label that wraps onto the next line is still found, and only then (CI II schedule, chat test A3)", () => {
  const r = schedR();
  assert.equal(r.covers.length, 1, JSON.stringify(r.dropped));
  assert.equal(r.covers[0].currency, "SGD");
  assert.match(r.covers[0].source.excerpt, /Comprehensive Critical 300,000\.00/);
  const other = schedR({ quote: "Comprehensive Critical\tDeath Benefit\t300,000.00\t269.05\t19/10/2036" });
  assert.equal(other.covers.length, 0);
});
test("each cover's printed sum insured is a row after the benefit rows, shown from the person's own line", () => {
  const r = answer2(CASH_ROW, [{ row: rowNamed(/^Sum insured/), text: "Sum." }], ["how much CI cover"]);
  // The schedule's one plain premium line is the cover's premium row, after its sum insured (release-set A6).
  assert.deepEqual(r.rows.slice(-2).map((x) => x.benefit), ["Sum insured, dated 19/10/2026", "Instalment Premium, Monthly"]);
  assert.ok(r.rows.findIndex((x) => /Hospital Cash/.test(x.benefit)) < r.rows.findIndex((x) => /^Sum insured/.test(x.benefit)));
  assert.deepEqual(r.amounts, ["S$300,000"]);
  const corrected = answer2(CASH_ROW, [{ row: rowNamed(/^Sum insured/), text: "Sum." }], ["x"], [{ personId: "p1", coverKey: coverKeyOf({ product: "CI Plan", cover: "Comprehensive Critical Illness Benefit", plan: null }), status: "corrected", sumInsured: 250000 }]);
  assert.deepEqual(corrected.amounts, []);
});
test("a premium printed on its own line is read and shown from that line (chat test A6)", () => {
  const sched = schedR({ premium: 470.85, premiumFrequency: "Monthly", premiumQuote: "Instalment Premium\t: 470.85" });
  assert.equal(sched.covers[0].premium, 470.85);
  assert.match(sched.covers[0].premiumSource?.excerpt ?? "", /Instalment Premium/);
  const r = answer2(CASH_ROW, [{ row: rowNamed(/Premium/), text: "Premium." }], ["how much do we pay"], [], sched);
  assert.equal(r.rows.find((x) => /Premium/.test(x.benefit))!.benefit, "Instalment Premium, Monthly");
  assert.deepEqual(r.amounts, ["S$470.85"]);
});
test("a premium is refused on a line that does not say premium, or that is not printed", () => {
  // The reading's own premium is refused; the page's one plain premium line is then used, from that line (release-set A6).
  for (const premiumQuote of ["Death Benefit\t5,000.00", "Instalment Premium\t: 470.85 extra", undefined]) {
    const sched = schedR({ premium: premiumQuote?.startsWith("Death") ? 5000 : 470.85, premiumQuote });
    assert.equal(sched.covers[0].premium, 470.85, String(premiumQuote));
    assert.equal(sched.covers[0].premiumSource?.excerpt, "Instalment Premium : 470.85 Currency", String(premiumQuote));
  }
  // With no premium line on the page, none is shown.
  const none = checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text: HOUSE2.documents[0].pages[0].text.replace("Instalment Premium\t: 470.85\tCurrency\n", "") }] }),
    reading("personal_proof", "CI Plan", [schedCover({ premium: 5000, premiumQuote: "Death Benefit\t5,000.00" })], []));
  assert.equal(none.covers[0].premium, null);
});

test("a stay is not worked out past a limit printed with the daily rate (Critic R108-1)", () => {
  const H: Household = { ...HOUSE2, documents: [HOUSE2.documents[0], { ...HOUSE2.documents[1], pages: [{ page: 5,
    text: "BENEFIT 1: GROUP TERM LIFE\nDaily Hospital Cash Benefit\tS$100 per day from the 11th day onwards.\nMax: 30 days, overall limit S$2,000" }] }] };
  const quote = "Daily Hospital Cash Benefit\tS$100 per day from the 11th day onwards.\nMax: 30 days, overall limit S$2,000";
  const cash = checkReading(src(H.documents[1]), reading("scheme_terms", "Group Scheme", [], [b({ section: "Life", benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 100, page: 5, quote, fromDay: 11, maxDays: 30 })]));
  const t = assembleTable([schedR(), cash, lifeCert], family, [{ section: sectionKeyOf(CASH, { section: "Life", column: null }), cover: coverKeyOf({ product: "CI Plan", cover: "Comprehensive Critical Illness Benefit", plan: null }), why: "cash" }]);
  const rs = chatRows(t, H);
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [],
    alternativeGroup: null, perDay: { stayDays: 35 }, ofBill: null, row: rs.find((r) => /Cash/.test(r.benefit))!.id }] };
  const fromRows = amountsFromRows(raw, rs, H);
  const { answer: a } = verifyAnswer(H, readModelAnswer(fromRows.json)!, ["he was in hospital 35 days"], new Set(fromRows.report.labels));
  const shown = keepLabelledAmounts(a.statements ?? [], fromRows.report).kept.filter((s) => s.amount).map((s) => s.amount!.text);
  assert.ok(!shown.some((x) => /2,500/.test(x)), JSON.stringify(shown));
  assert.deepEqual(shown, ["S$100"]);
});
test("a qualified premium line, another life's or a rider's, is never the cover's premium (Critic R108-2, TE #97)", () => {
  const page = (extra: string) => checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text: HOUSE2.documents[0].pages[0].text + "\n" + extra }] }),
    reading("personal_proof", "CI Plan", [schedCover({ premium: 376.68, premiumQuote: extra })], []));
  // The qualified figure is never used. The page's one plain line ("Instalment Premium : 470.85") still is, unless the
  // page names another life; a first-year line on the page is said with it (release-set A6).
  for (const [line, plain] of [["First Year Instalment Premium * : 376.68", 470.85], ["Rider Premium\t: 376.68", 470.85], ["Instalment Premium (Life Assured 2) : 376.68", null]] as const) {
    assert.equal(page(line).covers[0].premium, plain, line);
    assert.equal(page(line).covers[0].premiumNote ?? null, /^First Year/.test(line) ? "the page prints a different premium for the first policy year" : null, line);
  }
  // Two plain premium lines on one page (one per life): neither is used.
  const two = checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text: HOUSE2.documents[0].pages[0].text + "\nLife Assured 2\t: Tan Mei Ling\nInstalment Premium\t: 88.40" }] }),
    reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
  assert.equal(two.covers[0].premium, null);
});
test("a first-year premium printed once on the premium's page is its own row, given with the premium (release-set A6)", () => {
  const withFirst = (extra: string) => checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text: HOUSE2.documents[0].pages[0].text.replace("Instalment Premium\t: 470.85", `${extra}\nInstalment Premium\t: 470.85`) }] }),
    reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
  const c = withFirst("First Year Instalment Premium * : 376.68").covers[0];
  assert.equal(c.firstYearPremium, 376.68);
  assert.equal(c.firstYearLabel, "First Year Instalment Premium");
  // Two first-year lines, or one with no figure of its own, give none (the note is still said).
  assert.equal(withFirst("First Year Instalment Premium * : 376.68\nFirst Year Premium (Rider) : 12.00").covers[0].firstYearPremium ?? null, null);
  assert.equal(withFirst("First Year Instalment Premium * : see page 4").covers[0].firstYearPremium ?? null, null);
  assert.equal(withFirst("First Year Instalment Premium * : see page 4").covers[0].premiumNote, "the page prints a different premium for the first policy year");
  // Named, the premium row brings the first-year row with it; both shown, never as alternatives.
  const H: Household = { ...HOUSE2, documents: [{ ...HOUSE2.documents[0], pages: [{ page: 3, text: HOUSE2.documents[0].pages[0].text.replace("Instalment Premium\t: 470.85", "First Year Instalment Premium * : 376.68\nInstalment Premium\t: 470.85") }] }, ...HOUSE2.documents.slice(1)] };
  const rs = chatRows(assembleTable([withFirst("First Year Instalment Premium * : 376.68")], family, []), H);
  assert.deepEqual(rs.filter((r) => /Premium/.test(r.benefit)).map((r) => r.benefit), ["Instalment Premium (the page prints a different premium for the first policy year)", "First Year Instalment Premium (first policy year only)"]);
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: rs.find((r) => /^Instalment Premium/.test(r.benefit))!.id }] };
  const fromRows = amountsFromRows(raw, rs, H);
  const a = verifyAnswer(H, readModelAnswer(fromRows.json)!, ["how much do we pay"], new Set(fromRows.report.labels)).answer;
  const shown = keepLabelledAmounts(a.statements ?? [], fromRows.report).kept.filter((x) => x.amount);
  assert.deepEqual(shown.map((x) => x.amount!.text), ["S$470.85", "S$376.68"]);
  assert.ok(shown.every((x) => !x.group));
  // Each named by the model in one alternative group: still one after the other, and no "insurer decides which applies"
  // note (live run 23 Oct, A6).
  const both = { ...raw, statements: rs.filter((r) => /Premium/.test(r.benefit)).map((r) => ({ ...raw.statements[0], row: r.id, alternativeGroup: "premiums" })) };
  const fromBoth = amountsFromRows(both, rs, H);
  const b2 = verifyAnswer(H, readModelAnswer(fromBoth.json)!, ["how much do we pay"], new Set(fromBoth.report.labels)).answer;
  assert.deepEqual((b2.statements ?? []).filter((x) => x.amount).map((x) => [x.amount!.text, x.group]), [["S$470.85", null], ["S$376.68", null]]);
  assert.deepEqual((b2.statements ?? []).filter((x) => /insurer decides/.test(x.text)), []);
});
test("a figure printed per child (or per incident) says so on its card, never as a family total (release-set H10)", () => {
  const amb = rows.find((r) => r.benefit === "Ambulance Cost")!;
  const fund = { ...amb, benefit: "Child Education Fund Benefit", figure: { kind: "printed", amount: 5000, currency: "SGD", unit: "lump_sum" } as typeof amb.figure, source: { ...amb.source, excerpt: "Child Education Fund Benefit* S$5,000 per child (up to 2 children)" } };
  assert.match(rowLabel(fund), /: per child \(up to 2 children\)\.$/);
  // A "per" that follows another figure is not this one's.
  assert.doesNotMatch(rowLabel({ ...fund, source: { ...fund.source, excerpt: "Child Education Fund Benefit S$5,000; Ambulance S$500 per incident" } }), /per/);
});
test("a premium sentence never says the insurer decides which premium applies (release-set A6)", () => {
  const run = (bottomLine: string, text: string) => {
    const a = verifyAnswer(HOUSE, readModelAnswer({ bottomLine, nextSteps: [], question: null, statements: [{ kind: "uncertainty", text, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] })!, ["q"]).answer;
    return { bottom: a.bottomLine, texts: (a.statements ?? []).map((x) => x.text) };
  };
  const r = run("Here are the premiums. The pages print two premiums, so the insurer decides which applies.", "The proposal prints a different premium from the schedule, so the insurer decides which applies. The schedule is later.");
  assert.equal(r.bottom, "Here are the premiums.");
  assert.deepEqual(r.texts, []);
  assert.deepEqual(run("b", "The documents print different premium figures, so Singlife decides if they differ.").texts, []);
  assert.deepEqual(run("b", "The documents print different premium figures. The schedule is the one to rely on, and Singlife decides if they differ.").texts, []);
  // A premium rule the documents print is not about which premium applies (Critic R131-3).
  assert.deepEqual(run("b", "Premiums are waived if the insurer determines you are totally disabled.").texts, ["Premiums are waived if the insurer determines you are totally disabled."]);
  // Not about a premium: kept.
  assert.deepEqual(run("b", "Two documents print different amounts for the fracture, so the insurer decides which applies.").texts, ["Two documents print different amounts for the fracture, so the insurer decides which applies."]);
});
test("a premium on a page that names another life is not used (TE #97)", () => {
  const base = HOUSE2.documents[0].pages[0].text;
  for (const extra of ["Life Assured 2\t: Goh Siew Lan", "Insured\t: Tan Mei Ling", "Second life insured: Tan Mei Ling", "Name of Life Assured\t: Goh Siew Lan",
    "Spouse\t: Goh Siew Lan", "Covered Members\nLim Ah Kow\tSelf\nGoh Siew Lan\tSpouse"]) {
    const text = base.replace("Instalment Premium\t: 470.85", `${extra}\nInstalment Premium\t: 470.85`);
    const r = checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text }] }), reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
    assert.equal(r.covers[0].premium, null, extra);
  }
  // The person's own "Assured : <name>" line (the page's only life) still allows it.
  const own = checkReading(src(HOUSE2.documents[0]), reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
  assert.equal(own.covers[0].premium, 470.85);
  // A real schedule repeats the own life and has a column header "Assured/ Premium …": neither is another life.
  const header = base.replace("Basic Benefits", "Life Assured\t: Lim Ah Kow\nAssured/\tPremium\tCessation\tCommencement\tCessation\nBasic Benefits");
  const real = checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text: header }] }), reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
  assert.equal(real.covers[0].premium, 470.85);
  // Another household member's name anywhere on the page, under any label or none, refuses it (fail-safe).
  const withPeople = (text: string) => checkReading({ ...src({ ...HOUSE2.documents[0], pages: [{ page: 3, text }] }), people: ["Lim Ah Kow", "Tan Mei Ling"] },
    reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], [])).covers[0].premium;
  assert.equal(withPeople(base.replace("Basic Benefits", "Nominee Tan Mei Ling\nBasic Benefits")), null);
  assert.equal(withPeople(base), 470.85);
});
test("one premium per policy: a schedule read as two covers gives one premium row", () => {
  const sched = checkReading(src(HOUSE2.documents[0]), reading("personal_proof", "CI Plan", [schedCover({ premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" }),
    schedCover({ cover: "Death Benefit", sumInsured: 5000, quote: "Death Benefit\t5,000.00\t---", premium: 470.85, premiumQuote: "Instalment Premium\t: 470.85" })], []));
  assert.equal(sched.covers.length, 2);
  const rs = chatRows(assembleTable([sched], family, []), HOUSE2);
  assert.equal(rs.filter((r) => /Premium/.test(r.benefit)).length, 1);
});
test("\"all amounts in Singapore dollars unless stated otherwise\" does not set a currency (TE #97)", () => {
  assert.equal(declaredCurrency("All amounts are in Singapore Dollars unless stated otherwise.\nDeath\t5,000"), null);
  assert.equal(declaredCurrency("Benefits (S$)\nDeath\t5,000"), "SGD");
});

// ------------------------------------------------------------------ live run 22 Oct (de65355) round 3
const WORDING = "aaaaaaaa-0000-0000-0000-000000000006", OTHER_POLICY = "aaaaaaaa-0000-0000-0000-00000000000b";
// One policy document holding its schedule (p3) and wording (p7, p8), as the CI II PDF does; and a group certificate.
const HOUSE3: Household = { ...HOUSE, documents: [
  doc(WORDING, "CI policy.pdf", [
    { page: 3, text: "Assured\t: Lim Ah Kow\nCurrency\t: SGD\nBenefit\tSum Assured\nCritical Illness Benefit\t300,000.00" },
    { page: 7, text: "CRITICAL ILLNESS BENEFIT\n100% of the Sum Assured will be payable in one lump sum. We will pay the Critical Illness Benefit subject to the following:" },
    { page: 8, text: "ADVANCE BENEFIT\n100% of the Sum Assured, up to S$400,000, will be payable." },
    { page: 9, text: "Accidental Medical Expenses (Sum Insured S$5,000)\nMedical expenses\t100%" },
  ]),
  doc(OTHER_POLICY, "Certificate.pdf", [{ page: 1, text: "GROUP TERM LIFE\nLim Ah Kow\tS$500,000\nTan Mei Ling\tS$1,000,000\nGROUP PERSONAL ACCIDENT\nLim Ah Kow\tS$600,000" }]),
] };
const whole = (quote: string, person = "Lim Ah Kow", baseQuote = "Critical Illness Benefit\t300,000.00", baseAmount = "300,000.00", baseDocument = "D1", H = HOUSE3) => {
  const { answer: a, report } = verifyAnswer(H, readModelAnswer({ bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Critical illness.", person, document: "D1", quote,
    amount: null, percentOf: { percent: 100, baseAmount, baseDocument, baseQuote }, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] })!, ["q"]);
  return { amounts: (a.statements ?? []).filter((x) => x.amount).map((x) => [x.amount!.text, x.basis]), report };
};
const LUMP = "100% of the Sum Assured will be payable in one lump sum.";
test("100% of the sum insured in a policy wording is the person's printed sum insured (release-set A3)", () => {
  assert.deepEqual(whole(LUMP).amounts, [["S$300,000", "100% of Lim Ah Kow's sum insured of S$300,000 (CI policy, page 3)"]]);
  // Wording that limits it (a cap, any figure) is never read as the whole sum insured.
  assert.deepEqual(whole("100% of the Sum Assured, up to S$400,000, will be payable.").amounts, []);
  // A sum insured on a page that does not name the person is not theirs.
  assert.deepEqual(whole(LUMP, "Tan Mei Ling").amounts, []);
});
// The CI II schedule as printed: "Sum" over "Assured/", the plan's name wrapped onto the next line, a second row (the death
// benefit) and a proposal page whose table has no clean Sum Assured column (round 4, A3).
const PLAN_SCHED = "Policy Schedule\nPlan\t: Comprehensive Critical Illness II\nAssured\t: Lim Ah Kow\nFirst Year Instalment Premium * : 376.68\n: Singapore Dollar\nInstalment Premium\t: 470.85\tCurrency\n"
  + "Basic Benefits\tSum\tInstalment\tPremium\tBenefit\tBenefit\nAssured/\tPremium\tCessation\tCommencement\tCessation\nBenefit\tDate\tDate\tDate\n"
  + "Comprehensive Critical\t300,000.00\t269.05\t19/10/2036\t19/10/2026\t19/10/2036\nIllness Benefit\n- Health Extra\t---\t201.80\t19/10/2036\t---\t---\nDeath Benefit\t5,000.00\t---\t---\t19/10/2026\t19/10/2036";
const PROPOSAL = "Life Assured\t: LIM AH KOW\nCurrency\t: SGD\nSum Assured /\tDiscount\nComprehensive Critical\n10\t10\t300,000.00\t298.95\t10%\t269.05\nIllness II";
const planHouse = (sched: string, extra: { page: number; text: string }[] = [], product = "Comprehensive Critical Illness II"): Household => ({ ...HOUSE, documents: [
  { ...doc(WORDING, "CI policy.pdf", [{ page: 2, text: PROPOSAL }, { page: 3, text: sched }, ...extra, { page: 9, text: "2.2. Critical Illness Benefit\n100% of the Sum Assured will be payable in one lump sum." }]), productName: product },
  doc(OTHER_POLICY, "Certificate.pdf", [{ page: 1, text: "GROUP TERM LIFE\nLim Ah Kow\tS$500,000\nTan Mei Ling\tS$1,000,000" }]),
] });
const PROPOSAL_ROW = "Comprehensive Critical\n10 10 300,000.00 298.95 10% 269.05\nIllness II";
test("100% of the Sum Assured is the plan table's own Sum Assured cell, read only where it is plainly the plan's (round 4, A3)", () => {
  const ok = [["S$300,000", "100% of Lim Ah Kow's sum insured of S$300,000 (Comprehensive Critical Illness II, page 3)"]];
  // The table row step's base is the proposal page; its schedule prints the plan's Sum Assured column.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED)).amounts, ok);
  // A row above the plan's (a rider printed first) makes it no first row: refused.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("Comprehensive Critical\t300,000.00", "Early Critical Illness Rider\t50,000.00\t12.00\t-\t-\t-\nComprehensive Critical\t300,000.00"))).amounts, []);
  // A rider printed as the only first row, its name on the line above its cells or with the product's rider words, is
  // never the plan's Sum Assured, even when the base worked out is the rider's figure (TE #104 P1, P2).
  const rider = (row: string) => PLAN_SCHED.replace("Comprehensive Critical\t300,000.00", `${row}\t50,000.00\t12.00\t-\t-\t-\nComprehensive Critical\t300,000.00`);
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness\t50,000.00\t12.00", "50,000.00", "D1", planHouse(rider("Early\nCritical Illness"))).amounts, []);
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Early Critical Illness Rider\t50,000.00\t12.00", "50,000.00", "D1", planHouse(rider("Early Critical Illness Rider"), [], "Comprehensive Critical Illness II with Early Critical Illness Rider")).amounts, []);
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Early Critical Illness\t50,000.00\t12.00", "50,000.00", "D1", planHouse(rider("Early Critical Illness"), [], "Comprehensive Critical Illness II with Early Critical Illness Rider")).amounts, []);
  // A first row naming another benefit ("Critical Illness Hospital Income") or words beyond the product's name is refused.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("Comprehensive Critical\t", "Critical Illness Hospital Income\t").replace("\nIllness Benefit\n", "\n"))).amounts, []);
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED, [], "Shield Plan")).amounts, []);
  // A row that does not name the wording's benefit is refused.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("Comprehensive Critical\t", "Comprehensive Life\t").replace("\nIllness Benefit\n", "\n"))).amounts, []);
  // Another page of the document printing a different sum for the plan: neither is taken.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED, [{ page: 4, text: PLAN_SCHED.replace("300,000.00", "250,000.00") }])).amounts, []);
  // A schedule that also names another member is never read.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED + "\nSpouse\t: Tan Mei Ling")).amounts, []);
  // A limit column is not a Sum Assured column, and a cell that is not the worked-out sum is not taken.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("Basic Benefits\tSum\t", "Basic Benefits\tLimit\t"))).amounts, []);
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("\t300,000.00\t", "\t200,000.00\t"))).amounts, []);
  // Spouse's own plan table does not answer for him.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", PROPOSAL_ROW, "300,000.00", "D1", planHouse(PLAN_SCHED.replace("Assured\t: Lim Ah Kow", "Assured\t: Tan Mei Ling"))).amounts, []);
});
test("the 100% fallback never takes another policy's or person's sum, or overrides a table's own base (Critic R126-1)", () => {
  // Another policy's sum (the group certificate's term life line), even on a line naming the person.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Lim Ah Kow\tS$500,000", "S$500,000", "D2").amounts, []);
  // The spouse's line.
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Tan Mei Ling\tS$1,000,000", "S$1,000,000", "D2").amounts, []);
  // The same policy number does not make a page that names another member the person's own.
  const sameNumber: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d) => ({ ...d, policyNumber: "P-1" })) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Lim Ah Kow\tS$500,000", "S$500,000", "D2", sameNumber).amounts, []);
  // A table that prints its own base ("Sum Insured S$5,000") settles it: never the person's S$600,000.
  assert.deepEqual(whole("Medical expenses\t100%", "Lim Ah Kow", "Lim Ah Kow\tS$600,000", "S$600,000", "D2").amounts, []);
  assert.deepEqual(whole("Medical expenses\t100%", "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1").amounts, []);
  // A page printing two sums insured, not as a plan table's Sum Assured column, cannot say which one the wording's 100% is
  // of (TE #103 A3).
  const two: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text.replace("Benefit\tSum Assured\n", "Sum Assured\n") + "\nDeath Benefit\t5,000.00\nTerm Rider\t150,000.00" }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", two).amounts, []);
  // Under a plan table's Sum Assured column, the CI row's own cell is the CI wording's sum, whatever rows follow it; a death
  // wording never takes it (Critic R127-1, the CI II schedule's shape; round 4 A3).
  const withDeath: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nInstalment Premium\t: 470.85\nDeath Benefit\t5,000.00" }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", withDeath).amounts, [["S$300,000", "100% of Lim Ah Kow's sum insured of S$300,000 (CI policy, page 3)"]]);
  const deathToo: Household = { ...withDeath, documents: withDeath.documents.map((d, i) => i ? d : { ...d, pages: [...d.pages, { page: 11, text: "DEATH BENEFIT\n100% of the Sum Assured will be payable on death." }] }) };
  assert.deepEqual(whole("100% of the Sum Assured will be payable on death.", "Lim Ah Kow", "Death Benefit\t5,000.00", "5,000.00", "D1", deathToo).amounts, []);
  // With one amount line, wording headed by another benefit ("DEATH BENEFIT") never takes the CI line.
  const deathWording: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: [...d.pages, { page: 11, text: "DEATH BENEFIT\n100% of the Sum Assured will be payable on death." }] }) };
  assert.deepEqual(whole("100% of the Sum Assured will be payable on death.", "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", deathWording).amounts, []);
  // The one amount on a one-life schedule that is a limit, not a sum insured, is never the sum insured (TE #103 A10b).
  const limitOnly: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: "Assured\t: Lim Ah Kow\nCurrency\t: SGD\nCritical Illness Benefit Medical Expenses limit\t15,000.00" }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Benefit Medical Expenses limit\t15,000.00", "15,000.00", "D1", limitOnly).amounts, []);
  // A line that never says sum insured or sum assured (nor its table heading) is not taken as one.
  const unnamed: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text.replace("Benefit\tSum Assured\n", "") }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", unnamed).amounts, []);
  // Any word on the base line beyond the heading's benefit, "sum insured" and the amount refuses it (TE #103 A10c).
  const income: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text.replace("Critical Illness Benefit\t300,000.00", "Critical Illness Hospital Income\t300,000.00") }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Hospital Income\t300,000.00", "300,000.00", "D1", income).amounts, []);
  // A premium line on the page is not a second benefit amount.
  const withPremium: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: d.pages.map((p) => p.page !== 3 ? p : { ...p, text: p.text + "\nInstalment Premium\t: 470.85" }) }) };
  assert.deepEqual(whole(LUMP, "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", withPremium).amounts, [["S$300,000", "100% of Lim Ah Kow's sum insured of S$300,000 (CI policy, page 3)"]]);
  // Wording that deducts, pro-rates, excludes or aggregates is not the whole sum (TE #103 A5).
  for (const words of ["after deducting any amount already paid", "pro-rated by age", "in proportion to the loss", "excluding any Advance Payment", "net of any claim paid", "in the aggregate"]) {
    const H: Household = { ...HOUSE3, documents: HOUSE3.documents.map((d, i) => i ? d : { ...d, pages: [...d.pages, { page: 10, text: `TOTAL DISABLEMENT\n100% of the Sum Assured, ${words}.` }] }) };
    assert.deepEqual(whole(`100% of the Sum Assured, ${words}.`, "Lim Ah Kow", "Critical Illness Benefit\t300,000.00", "300,000.00", "D1", H).amounts, [], words);
  }
});
test("a premium taken from its page has only the currency its line or page settles, never the cover's (Critic R126-4)", () => {
  const text = "Assured\t: Lim Ah Kow\nInstalment Premium\t: 470.85\nComprehensive Critical Illness Benefit\tS$300,000.00";
  const r = checkReading(src({ ...HOUSE2.documents[0], pages: [{ page: 3, text }] }), reading("personal_proof", "CI Plan", [schedCover({ quote: "Comprehensive Critical Illness Benefit\tS$300,000.00" })], []));
  assert.equal(r.covers[0].currency, "SGD", JSON.stringify(r.dropped));
  assert.equal(r.covers[0].premium, 470.85);
  assert.equal(r.covers[0].premiumCurrency, null);
  const premiumRow = chatRows(assembleTable([r], family, []), HOUSE2).find((x) => /Premium/.test(x.benefit))!;
  assert.deepEqual(premiumRow.figure, { kind: "printed", amount: 470.85, currency: null, unit: "lump_sum" });
});
test("the same benefit of the same cover in another document is given with it, not added up (release-set B7, H7, H10)", () => {
  const fracture = checkReading(src(HOUSE.documents[1]), reading("scheme_terms", "Group Scheme", [], [
    b({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", page: 2, quote: "Hip 75%" }),
    b({ benefit: "Ankle", pays: "percent", value: 50, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Compensation (% of S$5,000)", page: 3, quote: "Ankle 50%" })]));
  const OTHER = "aaaaaaaa-0000-0000-0000-000000000007";
  const H: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(OTHER, "Benefit summary.pdf", [{ page: 8, text: "Simple Fracture due to Accident: (% of S$5,000)\nB. Hip\t30%\nPayable only if surgery is performed.\nAnkle\t50%" }])] };
  const other = checkReading(src(H.documents[3]), reading("scheme_terms", "Group Scheme", [], [
    b({ section: "Fracture", benefit: "Simple Fracture due to Accident: B. Hip", pays: "percent", value: 30, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Simple Fracture due to Accident: (% of S$5,000)", page: 8, quote: "B. Hip 30%",
      conditions: ["Payable only if surgery is performed."] }),
    b({ section: "Fracture", benefit: "Ankle", pays: "percent", value: 50, percentOf: "fixed_amount", baseAmount: 5000, baseQuote: "Simple Fracture due to Accident: (% of S$5,000)", page: 8, quote: "Ankle 50%" })]));
  const t = assembleTable([certR, fracture, other], family, [...links, { section: sectionKeyOf(OTHER, { section: "Fracture", column: null }), cover: gpa, why: "fractures" }]);
  const rs = chatRows(t, H);
  const ask = (benefit: RegExp) => {
    const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [],
      alternativeGroup: null, perDay: null, ofBill: null, row: rs.find((r) => r.person === "Lim Ah Kow" && r.source.documentId === TERMS && benefit.test(r.benefit))!.id }] };
    const fromRows = amountsFromRows(raw, rs, H);
    const { answer: a } = verifyAnswer(H, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels));
    return a.statements ?? [];
  };
  const hip = ask(/^Hip$/);
  assert.deepEqual(hip.filter((x) => x.amount).map((x) => x.amount!.text), ["S$450,000", "S$1,500"]);
  assert.ok(hip.some((x) => /not a total/.test(x.text)), JSON.stringify(hip));
  // The companion carries its own row's condition, not the named row's (Critic R126-2).
  assert.deepEqual(hip.find((x) => x.amount?.text === "S$1,500")!.conditions.map((c) => (typeof c === "string" ? c : (c as { text: string }).text)), ["Payable only if surgery is performed."]);
  // Two different sections of one benefit name are different benefits (TE #103 C4).
  const C4: Household = { ...H, documents: [...H.documents, doc("aaaaaaaa-0000-0000-0000-00000000000c", "Compound.pdf", [{ page: 1, text: "Compound Fracture: Hip\tS$3,000" }])] };
  const compound = checkReading(src(C4.documents[4]), reading("scheme_terms", "Group Scheme", [], [b({ section: "Compound", benefit: "Compound Fracture: Hip", pays: "amount", value: 3000, page: 1, quote: "Compound Fracture: Hip S$3,000" })]));
  const t4 = assembleTable([certR, fracture, other, compound], family, [...links, { section: sectionKeyOf(OTHER, { section: "Fracture", column: null }), cover: gpa, why: "fractures" },
    { section: sectionKeyOf("aaaaaaaa-0000-0000-0000-00000000000c", { section: "Compound", column: null }), cover: gpa, why: "compound" }]);
  const rs4 = chatRows(t4, C4);
  const simpleHip = rs4.find((r) => r.source.documentId === OTHER && /Hip/.test(r.benefit))!;
  const fromRows4 = amountsFromRows({ bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [],
    alternativeGroup: null, perDay: null, ofBill: null, row: simpleHip.id }] }, rs4, C4);
  const shown4 = (readModelAnswer(fromRows4.json)!.statements ?? []).map((x) => x.quote);
  assert.ok(!shown4.some((q) => /Compound/.test(q ?? "")), JSON.stringify(shown4));
  assert.ok(shown4.some((q) => /^Hip/.test(q ?? "")), JSON.stringify(shown4));
  // The same figure printed again is not given twice.
  assert.deepEqual(ask(/^Ankle$/).filter((x) => x.amount).map((x) => x.amount!.text), ["S$2,500"]);
});
test("a condition printed only for the same benefit in another document goes with it as its own point; a limit paid as the lesser of the cost says so (release-set H7)", () => {
  const OTHER = "aaaaaaaa-0000-0000-0000-00000000000d";
  const H: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(OTHER, "Benefit summary.pdf", [{ page: 8, text:
    "J. Ambulance Cost\nWe will, upon proof of the emergency call, pay up to $500 of the ambulance cost, whichever is lesser.\nOnly for an emergency ambulance called within 24 hours.\n"
    + "K. Hospital Cash Benefit\nPayable only after 3 days in hospital.\nWe will pay S$50 a day." }])] };
  const other = checkReading(src(H.documents[3]), reading("scheme_terms", "Group Scheme", [], [
    b({ benefit: "J. Ambulance Cost", pays: "up_to", value: 500, page: 8, quote: "We will, upon proof of the emergency call, pay up to $500 of the ambulance cost, whichever is lesser." })]));
  const rs = chatRows(assembleTable([certR, termsR, other], family, [...links, { section: sectionKeyOf(OTHER, { section: "Accident", column: null }), cover: gpa, why: "ambulance" }]), H);
  const amb = (p: string) => rs.find((r) => r.person === p && r.source.documentId === TERMS && r.benefit === "Ambulance Cost")!;
  assert.ok(amb("Lim Ah Kow").lesserOf, "the other document's line for the same figure says whichever is lesser");
  const run = (statements: Record<string, unknown>[]) => {
    const fromRows = amountsFromRows({ bottomLine: "b", nextSteps: [], question: null, statements: statements.map((x) => ({ kind: "amount", text: "x", document: null, quote: null, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: null, ofBill: null, ...x })) }, rs, H);
    const { answer: a } = verifyAnswer(H, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels));
    return a.statements ?? [];
  };
  const proof = { text: "The emergency call must be proved.", quote: "upon proof of the emergency call" };
  const within = { text: "It must be an emergency ambulance called within 24 hours.", quote: "Only for an emergency ambulance called within 24 hours" };
  let st = run([{ row: amb("Lim Ah Kow").id, person: "Lim Ah Kow", conditions: [proof, within] }]);
  const card = st.find((x) => x.amount)!;
  assert.equal(card.amount!.text, "Up to S$500");
  assert.match(card.text, /the cost, up to this limit, whichever is less/);
  const points = st.filter((x) => !x.amount).map((x) => [x.text, x.personName ?? null, x.source?.page ?? null]);
  assert.deepEqual(points, [["Ambulance Cost also depends on this: The emergency call must be proved.", "Lim Ah Kow", 8], ["Ambulance Cost also depends on this: It must be an emergency ambulance called within 24 hours.", "Lim Ah Kow", 8]]);
  // For both people: one point each, said for nobody in particular.
  st = run([{ row: amb("Lim Ah Kow").id, person: "Lim Ah Kow", conditions: [within] }, { row: amb("Tan Mei Ling").id, person: "Tan Mei Ling", conditions: [within] }]);
  assert.deepEqual(st.filter((x) => !x.amount).map((x) => [x.text, x.personName ?? null]), [["Ambulance Cost also depends on this: It must be an emergency ambulance called within 24 hours.", null]]);
  assert.equal(st.filter((x) => x.amount).length, 2);
  // Never another sub-benefit's condition, one printed nowhere, or one that states money.
  for (const c of [{ text: "Only after 3 days in hospital.", quote: "Payable only after 3 days in hospital" }, { text: "Must be in Singapore.", quote: "only in Singapore" }, { text: "Up to $500 a trip.", quote: "Only for an emergency ambulance called within 24 hours" }])
    assert.deepEqual(run([{ row: amb("Lim Ah Kow").id, person: "Lim Ah Kow", conditions: [c] }]).filter((x) => !x.amount), [], c.text);
  // A limit no line calls the lesser of the cost is "up to this limit".
  assert.ok(!rows.find((r) => r.benefit === "Ambulance Cost")!.lesserOf);
});

test("a point that says it shows an amount is given that row's amount; with no amount at all, nothing points at one (live run 23 Oct, B7)", () => {
  const run = (bottomLine: string, statements: Record<string, unknown>[]) => {
    const fromRows = amountsFromRows({ bottomLine, nextSteps: [], question: null, statements: statements.map((x) => ({ kind: "fact", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, ...x })) }, rows, HOUSE);
    const { answer: a } = verifyAnswer(HOUSE, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels));
    const left = dropAmountPointers(a, fromRows.report.labels);
    return { bottom: a.bottomLine, texts: (a.statements ?? []).filter((x) => !x.amount).map((x) => x.text), amounts: (a.statements ?? []).filter((x) => x.amount).map((x) => [x.personName, x.amount!.text]), left };
  };
  const said = "If it was an emergency, the ambulance benefit applies. The scheme terms show this amount.";
  // Its quote is the row's own line, in the document it names, for the person it is about: that row's amount is given.
  let r = run("Here.", [{ text: said, document: "D2", quote: "Ambulance Cost Up to S$500 per incident" }]);
  assert.deepEqual(r.amounts, [["Lim Ah Kow", "Up to S$500"]]);
  assert.deepEqual(r.texts, [said]);
  r = run("Here.", [{ text: said, person: "Tan Mei Ling", document: "D2", quote: "Ambulance Cost Up to S$500 per incident" }]);
  assert.deepEqual(r.amounts, [["Tan Mei Ling", "Up to S$500"]]);
  // A point that says the amount is not paid, does not apply or is someone else's is never given it; what it says of "this
  // amount" is kept, said of the benefit (Critic R134-1, TE #105 Y13).
  for (const [x, kept] of [["No ambulance was used, so this amount is not payable.", ["No ambulance was used, so this benefit is not payable."]],
    ["This amount does not apply, because the policy ended before the accident.", ["This benefit does not apply, because the policy ended before the accident."]],
    ["That limit is for Tan Mei Ling's policy only.", ["That benefit is for Tan Mei Ling's policy only."]], ["The policy has ended. The scheme terms show this amount.", ["The policy has ended."]]] as const) {
    r = run("Not covered.", [{ text: x, document: "D2", quote: "Ambulance Cost Up to S$500 per incident" }]);
    assert.deepEqual(r.amounts, [], x);
    assert.deepEqual(r.texts, kept, x);
  }
  // A quote that is no row's line, or names another document: no amount, and with none in the answer the pointing words go.
  for (const x of [{ document: "D2", quote: "Compensation (% of S$5,000)" }, { document: "D1", quote: "Ambulance Cost Up to S$500 per incident" }]) {
    r = run("It is not shown as covered, and the amounts below only apply if the terms are met.", [{ text: said, ...x }]);
    assert.deepEqual(r.amounts, [], JSON.stringify(x));
    assert.equal(r.bottom, "It is not shown as covered.");
    assert.deepEqual(r.texts, ["If it was an emergency, the ambulance benefit applies."]);
    assert.equal(r.left.length, 1);
  }
  // With an amount in the answer, nothing is cut; "these sums insured" points at nothing.
  r = run("The amounts below are separate.", [{ kind: "amount", row: idOf("Lim Ah Kow", "Hip"), text: "Hip." }, { text: "The certificate showing these sums insured is dated 01/01/2026.", document: "D1", quote: "As of 01/01/2026" }]);
  assert.equal(r.bottom, "The amounts below are separate.");
  assert.equal(r.texts.length, 1);
  r = run("Here.", [{ text: "The certificate showing these sums insured is dated 01/01/2026.", document: "D1", quote: "As of 01/01/2026" }]);
  assert.deepEqual(r.texts, ["The certificate showing these sums insured is dated 01/01/2026."]);
});

test("a card whose event is not on its cover's list is never shown, decided per card and never from the prose (live run 23 Oct, H2; unseen U4)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  // Covers that started long ago: no waiting period can still run (that is tested on its own below).
  const listCover = (id: string, cover: string, benefit: string): ChatRow => ({ ...amb, id, cover, benefit, coverKey: coverKeyOf({ product: amb.product, cover, plan: null }), coverSince: "01/01/2020" });
  const lc = listCover("R901", "GROUP LIVING CARE(POLICY NO. 1)", "Coverage against 37 critical illnesses"), lcp = listCover("R902", "GROUP LIVING CARE PLUS(POLICY NO. 1)", "Coverage against 10 early critical illnesses");
  const all = [...rows, lc, lcp];
  const run = (cards: [string, unknown][], facts: string[] = [], bottomLine = "q") => {
    const st = (x: Record<string, unknown>) => ({ kind: "fact", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: null, ...x });
    const fromRows = amountsFromRows({ bottomLine, nextSteps: [], question: null, statements: [...facts.map((text) => st({ kind: "uncertainty", text })), ...cards.map(([row, eventFit]) => st({ kind: "amount", row, text: "Cover.", eventFit }))] }, all, HOUSE);
    const { answer: a } = verifyAnswer(HOUSE, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels));
    const kept = keepLabelledAmounts(a.statements ?? [], fromRows.report).kept;
    return { cards: kept.filter((x) => x.amount).map((x) => x.text.replace(/:.*$/, "")), notes: noteLeftOutAmounts(kept as never[], fromRows.report, (id, text) => ({ id, kind: "uncertainty", text }) as never).filter((x: { text: string }) => x.text === LEFT_OUT_AMOUNT).length };
  };
  const LC = "Coverage against 37 critical illnesses (GROUP LIVING CARE)", LCP = "Coverage against 10 early critical illnesses (GROUP LIVING CARE PLUS)";
  // The model says, card by card, whether the event is on the row's list: "not_on_list" is never shown, with no
  // "left out an amount" note (the answer's own fact says why).
  let r = run([[lc.id, "on_list"], [lcp.id, "not_on_list"]], ["A heart attack is not on the Living Care Plus list."]);
  assert.deepEqual(r.cards, [LC]);
  assert.equal(r.notes, 0);
  assert.deepEqual(run([[lc.id, "not_on_list"], [lcp.id, "not_on_list"]]).cards, []);
  // Every other value, or none (an older answer), is shown as before.
  for (const fit of ["on_list", "any_event", "no_event", null, undefined, "maybe"]) assert.deepEqual(run([[lc.id, fit], [lcp.id, fit]]).cards, [LC, LCP], String(fit));
  // A card that pays only on something the household has not described (an ambulance) is never shown either (S088).
  assert.deepEqual(run([[lc.id, "on_list"], [lcp.id, "not_described"]], ["Living Care Plus needs an ambulance."]).cards, [LC]);
  assert.deepEqual(run([[lc.id, "not_described"], [lcp.id, "on_list"]]).cards, [LCP]);
  // The prose never decides: wording that rules a cover out, or keeps it in, changes no card (TE #107 N1, N8, K1, K6).
  for (const text of ["A heart attack is not on the Living Care Plus list.", "A fracture doesn't appear on the Living Care list.", "A heart attack is on the Living Care list. It is not on the Living Care Plus list."])
    assert.deepEqual(run([[lc.id, "on_list"], [lcp.id, "on_list"]], [text]).cards, [LC, LCP], text);
  // Not named anywhere in the answer's own words, the household hears an amount was left out (Critic R143-2).
  assert.equal(run([[lc.id, "on_list"], [lcp.id, "not_on_list"]]).notes, 1);
  // A card made from a pointing point keeps its flag: not_on_list gives none (Critic R143-1).
  const pointed = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "fact", text: "The scheme terms show this amount.", person: "Lim Ah Kow", document: "D2", quote: "Ambulance Cost Up to S$500 per incident",
    amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: "not_on_list" }] }, all, HOUSE);
  assert.deepEqual(pointed.report.labels, []);
  // Ruled out once, a row stays out: named again with another flag, or its twin named as any_event (TE #107 E7, E8c).
  assert.deepEqual(run([[lcp.id, "not_on_list"], [lcp.id, "on_list"]]).cards, []);
  assert.deepEqual(run([[lc.id, "on_list"], [lcp.id, "not_on_list"]], ["Not on the Living Care Plus list."]).cards, [LC]);
  // Living Care ruled out with only "Living Care Plus" named: the household hears an amount was left out (TE #107 L4).
  assert.equal(run([[lc.id, "not_on_list"], [lcp.id, "on_list"]], ["A heart attack is on the Living Care Plus list."]).notes, 1);
  // A pointer at a ruled-out row gives no card (TE #107 E8b).
  const pointedOut = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [
    { kind: "amount", text: "Cover.", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: amb.id, eventFit: "not_on_list" },
    { kind: "fact", text: "The scheme terms show this amount.", person: "Lim Ah Kow", document: "D2", quote: "Ambulance Cost Up to S$500 per incident", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: null }] }, all, HOUSE);
  assert.deepEqual(pointedOut.report.labels, []);
  // A ruled-out pointer keeps the row out even when another statement names it (TE #107 E8d).
  const pointerOut = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [
    { kind: "fact", text: "The scheme terms show this amount.", person: "Lim Ah Kow", document: "D2", quote: "Ambulance Cost Up to S$500 per incident", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: "not_on_list" },
    { kind: "amount", text: "Cover.", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: amb.id, eventFit: "any_event" }] }, rows, HOUSE);
  assert.deepEqual(pointerOut.report.labels, []);
  // A "not_on_list" card takes the same benefit's companion from another document with it.
  const hip = idOf("Lim Ah Kow", "Hip");
  assert.deepEqual(run([[hip, "not_on_list"]]).cards, []);
  // The schema asks for the decision on every statement.
  const items = (TABLE_ANSWER_SCHEMA.properties.statements as { items: { required: string[] } }).items;
  assert.ok(items.required.includes("eventFit"));
});
test("a sentence that leans on one left out goes with it; with no amount shown, no sentence says the figures differ (unseen U3, U16)", () => {
  const run = (text: string) => verifyAnswer(HOUSE, readModelAnswer({ bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "uncertainty", text, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] })!, ["q"]);
  let r = run("The ambulance limit is S$500 per incident. That limit applies per trip. Call the insurer first.");
  assert.deepEqual((r.answer.statements ?? []).map((x) => x.text), ["Call the insurer first."]);
  assert.ok(r.report.sentencesLeftOut.includes("That limit applies per trip."));
  // A sentence that states a condition stays, even leaning on one left out (Critic R140-2).
  r = run("The ambulance limit is S$500 per incident. It is paid only if the ambulance takes him to a hospital within 24 hours of the accident.");
  assert.deepEqual((r.answer.statements ?? []).map((x) => x.text), ["It is paid only if the ambulance takes him to a hospital within 24 hours of the accident."]);
  r = run("The ambulance limit is S$500 per incident. Ambulance cover applies per trip.");
  assert.deepEqual((r.answer.statements ?? []).map((x) => x.text), ["Ambulance cover applies per trip."]);
  const a = { summary: "The two documents print different figures, so the insurer decides which applies.", bottomLine: "The two documents print different figures, so the insurer decides which applies.",
    statements: [{ text: "The two documents print different figures for the same shoulder fracture benefit, so the insurer decides which applies.", amount: null }, { text: "Ask the doctor about an X-ray.", amount: null }] };
  dropAmountPointers(a, []);
  assert.deepEqual(a.statements.map((x) => x.text), ["Ask the doctor about an X-ray."]);
  assert.equal(a.bottomLine, "Here is what your documents say.");
});
test("with amounts shown, words that say the amounts shown do not apply go; other pointers stay (unseen U8)", () => {
  const b = "Living Care Plus pays only for its 10 early critical illnesses, and a heart attack is not one of them, so the amounts below for it don't apply.";
  const a = { summary: b, bottomLine: b, statements: [{ text: "Up to S$350,000", amount: { text: "S$350,000" } },
    { text: "The amount below is not payable for an illness diagnosed in the first 90 days.", amount: null }, { text: "The amounts below only apply after the waiting period.", amount: null }] };
  const left = dropAmountPointers(a, ["Up to S$350,000"]);
  assert.equal(a.bottomLine, "Living Care Plus pays only for its 10 early critical illnesses, and a heart attack is not one of them.");
  assert.equal(a.summary, a.bottomLine);
  assert.deepEqual(a.statements.map((x) => x.text), ["Up to S$350,000", "The amount below is not payable for an illness diagnosed in the first 90 days.", "The amounts below only apply after the waiting period."]);
  assert.ok(left.includes(b));
  // A point beside a card that states a condition of it stays, said of the benefit (TE #108 D8).
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [
    { kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: idOf("Lim Ah Kow", "Hip"), eventFit: "any_event" },
    { kind: "fact", text: "The amounts below do not apply if the injury was self-inflicted.", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null },
    { kind: "fact", text: "The amount below doesn't apply to pre-existing conditions.", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null }] };
  const texts = ((amountsFromRows(raw, rows, HOUSE).json as { statements: { text: string }[] }).statements).map((x) => x.text);
  assert.ok(texts.includes("These benefits do not apply if the injury was self-inflicted."), JSON.stringify(texts));
  assert.ok(texts.includes("This benefit doesn't apply to pre-existing conditions."), JSON.stringify(texts));
  const cannot = ((amountsFromRows({ ...raw, statements: [raw.statements[0], { ...raw.statements[1], text: "The amount below cannot be paid unless a doctor certifies the fracture." }] }, rows, HOUSE).json as { statements: { text: string }[] }).statements).map((x) => x.text);
  assert.ok(cannot.includes("This benefit cannot be paid unless a doctor certifies the fracture."), JSON.stringify(cannot));
  const shown = answer([{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow", eventFit: "any_event" },
    { kind: "fact", person: "Lim Ah Kow", document: "D2", quote: "Written notice of a claim must be given within 30 days.", text: "The amounts below are not paid unless written notice is given within 30 days." }]).statements.map((x) => x.text);
  assert.ok(shown.includes("These benefits are not paid unless written notice is given within 30 days."), JSON.stringify(shown));
  // With no card shown, a pointer inside a name becomes the benefit's name (Critic R149-2).
  const none = { summary: "s", bottomLine: "s", statements: [{ text: "The Advance Payment amount below is not paid in addition to the death benefit.", amount: null }] };
  dropAmountPointers(none, []);
  assert.deepEqual(none.statements.map((x) => x.text), ["The Advance Payment benefit is not paid in addition to the death benefit."]);
  // A coordination rule about the amount shown stays (Critic R147-2).
  for (const t of ["The Advance Payment amount below is not paid in addition to the death benefit.", "The amount below is not payable on top of the Advance Payment already paid."]) {
    const c = { summary: "s", bottomLine: "s", statements: [{ text: "Up to S$350,000", amount: { text: "S$350,000" } }, { text: t, amount: null }] };
    dropAmountPointers(c, ["Up to S$350,000"]);
    assert.deepEqual(c.statements.map((x) => x.text), ["Up to S$350,000", t]);
  }
});

test("a short document no row comes from is sent whole, unless it could not be read; payee rules are sent (release-set E1, E2, H10)", () => {
  const RECEIPT = "aaaaaaaa-0000-0000-0000-000000000008", LONG = "aaaaaaaa-0000-0000-0000-000000000009", FAILED = "aaaaaaaa-0000-0000-0000-00000000000a";
  const H: Household = { ...HOUSE, documents: [...HOUSE.documents,
    doc(RECEIPT, "Receipt.pdf", [{ page: 1, text: "Tax invoice\nTotal premium\tS$73.17" }]),
    doc(LONG, "Brochure.pdf", [1, 2, 3, 4].map((page) => ({ page, text: `Page ${page}` }))),
    { ...doc(FAILED, "Scan.pdf", [{ page: 1, text: "partial" }]), processingStatus: "failed" }] };
  const sent = pagesToSend(rows, H);
  assert.ok(sent.has(`${RECEIPT}#1`));
  assert.ok(![1, 2, 3, 4].some((n) => sent.has(`${LONG}#${n}`)));
  assert.ok(!sent.has(`${FAILED}#1`));
  // At most 15 pages of such documents in all (Critic R126-3).
  const many: Household = { ...HOUSE, documents: [...HOUSE.documents, ...Array.from({ length: 8 }, (_, i) => doc(`aaaaaaaa-0000-0000-0001-${String(i).padStart(12, "0")}`, `Receipt ${i}.pdf`, [1, 2].map((page) => ({ page, text: `Receipt ${i}` }))))] };
  const extra = [...pagesToSend(rows, many)].filter((k) => k.startsWith("aaaaaaaa-0000-0000-0001-")).length;
  assert.equal(extra, 14);
  const payee = { ...HOUSE, documents: HOUSE.documents.map((d) => d.policyId !== TERMS ? d : { ...d, pages: [...d.pages, { page: 37, text: "All claims will be paid directly to the Insured Person, proper claimant or legal representative, as applicable." }] }) };
  assert.ok(pagesToSend(rows, payee).has(`${TERMS}#37`));
});

// ------------------------------------------------------------------ live run 22 Oct (ab4026a) round 4
/** The answer for these model statements, as the chat turn has it before the shut-out check, and that check's result. */
function shutOut(bottomLine: string, statements: Record<string, unknown>[]) {
  const raw = { bottomLine, nextSteps: [], question: null, statements: statements.map((s) => ({
    kind: "amount", text: "x", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, ...s })) };
  const fromRows = amountsFromRows(raw, rows, HOUSE);
  const { answer: a } = verifyAnswer(HOUSE, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels));
  const left = dropPeopleShutOut(a, rows, HOUSE, fromRows.report.labels);
  return { left, bottom: a.bottomLine, texts: (a.statements ?? []).filter((s) => !s.amount).map((s) => s.text), amounts: (a.statements ?? []).filter((s) => s.amount).length };
}
const fact = (text: string, person: string | null = null) => ({ kind: "uncertainty", text, person, quote: null, document: null });
test("a sentence that shuts a person out of a cover their own cards or rows show is left out (live run 22 Oct, C5)", () => {
  const hips = [{ row: idOf("Lim Ah Kow", "Hip"), person: "Lim Ah Kow" }, { row: idOf("Tan Mei Ling", "Hip"), person: "Tan Mei Ling" }];
  // "not Tan" while Tan's own card is shown: left out, and the bottom line is the server's.
  let r = shutOut("Both are real, and they belong to Lim, not Tan Mei Ling.", hips);
  assert.equal(r.left.length, 1);
  assert.doesNotMatch(String(r.bottom), /not Tan/);
  assert.equal(r.amounts, 2);
  // Only Lim's card shown, but Tan has her own row for the same benefit: still left out.
  r = shutOut("This is Lim's alone. The hip benefit pays a share of the sum insured.", [hips[0]]);
  assert.deepEqual(r.left, ["This is Lim's alone."]);
  assert.match(String(r.bottom), /hip benefit/);
  for (const s of ["Only Lim Ah Kow has this accident cover.", "This accident cover belongs only to Lim.", "That benefit is for Lim's policy only.", "The accident cover is Lim's, not Mei Ling's.", "It is held by Lim, not Tan Mei Ling."]) {
    r = shutOut("Here it is.", [hips[0], fact(s)]);
    assert.deepEqual(r.left, [s], s);
  }
  // A sentence that gives a reason or a condition, or does not speak of ownership, is never left out (Critic R131-1).
  for (const s of ["Tan does not get the ambulance benefit, because no ambulance was used.", "Tan is not covered for this event, because a hairline crack is not a listed fracture.",
    "Tan cannot claim the recuperation benefit unless she stays in hospital for 24 hours.", "It is paid to Tan Mei Ling's estate only.", "Lim's hip benefit only pays for a full break.", "Mei Ling has no accident cover.", "Only Lim's hip card is shown here, if Mei Ling was not hurt."]) {
    r = shutOut("Here it is.", [...hips, fact(s)]);
    assert.deepEqual(r.left, [], s);
  }
  // A kind of cover she has no row for is not shut out of anything she has.
  for (const s of ["The travel policy belongs to Lim, not Tan Mei Ling.", "Only Lim has motor cover."]) {
    r = shutOut("Here it is.", [hips[0], fact(s)]);
    assert.deepEqual(r.left, [], s);
  }
  // A card of hers for another cover or policy says nothing about this one (TE #104 S4).
  for (const s of ["Only Lim has the SaveMore policy.", "The SaveMore policy belongs to Lim, not Tan Mei Ling."]) {
    r = shutOut("Here it is.", [hips[1], fact(s)]);
    assert.deepEqual(r.left, [], s);
  }
  // Naming both, or saying what is the person's own, shuts no one out.
  for (const s of ["Lim and Tan Mei Ling each have their own accident cover.", "The amount below is Lim's own accident cover."]) {
    r = shutOut(s, hips);
    assert.deepEqual(r.left, [], s);
  }
});

test("what prose says about the library is held to the library's own record (live run 22 Oct, E4, A8)", () => {
  // Three documents: two linked to both, one (the illustration) to Lim only, uploaded for him.
  const H: Household = { ...HOUSE, documents: HOUSE.documents.map((d) => d.policyId === ILP ? { ...d, linkedPeople: ["Lim Ah Kow"], uploadedFor: "Lim Ah Kow" } : { ...d, uploadedFor: "Tan Mei Ling" }) };
  const run = (bottomLine: string, statements: Record<string, unknown>[] = [], q = "show me mei ling's documents") => {
    const { answer: a, report } = verifyAnswer(H, readModelAnswer({ bottomLine, nextSteps: [], question: null, statements: statements.map((x) => ({ kind: "fact", text: "x", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, ...x })) })!, [q]);
    return { bottom: a.bottomLine, texts: (a.statements ?? []).map((x) => x.text), left: report.sentencesLeftOut };
  };
  // A wrong count is replaced by the record's count; a right one is kept.
  assert.equal(run("Mei Ling has four documents linked to her.").bottom, "Tan Mei Ling has 2 documents linked in DearPolicy.");
  assert.equal(run("Mei Ling has two documents linked to her.").bottom, "Mei Ling has two documents linked to her.");
  assert.equal(run("You have 5 documents uploaded.").bottom, "Your library has 3 documents.");
  // A count of the documents linked to the people it names is held to the record (live run 23 Oct, E1).
  assert.equal(run("Two are linked to both Lim and Mei Ling, and the rest to Lim only.").bottom, "Two are linked to both Lim and Mei Ling, and the rest to Lim only.");
  assert.equal(run("One is linked to both Lim and Mei Ling, and the rest to Lim only.").bottom, "Of your 3 documents, 2 are linked to Lim Ah Kow and Tan Mei Ling, and 1 to Lim Ah Kow only.");
  assert.equal(run("3 of them are linked to Lim only.").bottom, "Of your 3 documents, 2 are linked to Lim Ah Kow and Tan Mei Ling, and 1 to Lim Ah Kow only.");
  assert.equal(run("1 is linked only to Lim.").bottom, "1 is linked only to Lim.");
  assert.equal(run("Three documents are linked to Lim.").bottom, "Three documents are linked to Lim.");
  // A count of some kind of document is not the library count (Critic R131-4).
  assert.equal(run("Mei Ling has two travel documents.").bottom, "Mei Ling has two travel documents.");
  // A count of documents that print or show something is not a library count.
  assert.equal(run("Two documents print different amounts for this.").bottom, "Two documents print different amounts for this.");
  // Uploaded for, or linked to, someone the record does not say: left out.
  let r = run("Here they are.", [{ kind: "uncertainty", text: "The Certificate and the Policy illustration were uploaded under Mei Ling's name. Both are read." }]);
  assert.deepEqual(r.texts, ["Both are read."]);
  r = run("Here they are.", [{ kind: "uncertainty", text: "The Policy illustration is linked to Lim Ah Kow and Tan Mei Ling." }]);
  assert.deepEqual(r.texts, []);
  r = run("Here they are.", [{ kind: "uncertainty", text: "The Certificate is linked only to Lim." }]);
  assert.deepEqual(r.texts, []);
  r = run("Here they are.", [{ kind: "uncertainty", text: "The Policy illustration is linked only to Lim Ah Kow. The Certificate was uploaded for Mei Ling." }]);
  assert.deepEqual(r.texts, ["The Policy illustration is linked only to Lim Ah Kow. The Certificate was uploaded for Mei Ling."]);
  // What no file is ("no document is linked to Mei Ling") is not a claim about the file the sentence names.
  r = run("Here they are.", [{ kind: "uncertainty", text: "The Certificate lists only Lim, and no document is linked to Mei Ling alone." }]);
  assert.equal(r.texts.length, 1);
  // Asked about documents, an unquoted point about one file is said from its record, never dropped.
  r = run("Mei Ling has two documents.", [{ text: "The group certificate for the scheme.", document: "D1" }, { text: "The scheme's terms.", document: "D2" }]);
  assert.equal(r.texts.length, 2);
  assert.match(r.texts[0], /^Certificate \(Certificate\.pdf\) was read\. It is linked to Lim Ah Kow and Tan Mei Ling in DearPolicy\. It was uploaded for Tan Mei Ling\.$/);
  // Asked how to file a claim, or which documents a claim needs, the question is not about the library (TE #104 L9).
  for (const q of ["how do I file a claim for Lim's hip", "what documents do I need to claim"])
    assert.deepEqual(run("Here.", [{ text: "Notice must be given within 30 days.", document: "D2" }], q).texts.filter((t) => /was read\./.test(t)), [], q);
  // Not asked about documents, it is not.
  assert.equal(run("Here.", [{ text: "The group certificate for the scheme.", document: "D1" }], "how much is the accident cover").texts.length, 0);
});

test("a row the checks refuse is given as the same benefit's same figure from another document, never another figure (H1)", () => {
  const PROSE = "aaaaaaaa-0000-0000-0000-00000000000c";
  const H: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(PROSE, "Benefit summary.pdf", [{ page: 5, text: "BENEFIT 2: GROUP PERSONAL ACCIDENT\nB. Hip\nIn the event of a fracture the Company will pay seventy five\npercent (75%) of the Sum Insured in the following manner" }])] };
  const hip = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Hip")!;
  const twin = { ...hip, id: `R${rows.length + 1}`, docIndex: H.documents.length - 1, source: { ...hip.source, documentId: PROSE, page: 5, excerpt: "the Company will pay seventy five\npercent (75%) of the Sum Insured in the following manner" } };
  const rs = [...rows, twin];
  const give = (id: string, r2 = rs) => {
    const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: id }] };
    const fromRows = amountsFromRows(raw, r2, H);
    const a = verifyAnswer(H, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels)).answer;
    return (a.statements ?? []).filter((x) => x.amount).map((x) => [x.amount!.text, x.source?.page]);
  };
  // The prose row alone is refused (its percentage is wrapped onto the next line); named, the table row is given instead.
  assert.deepEqual(give(twin.id, [twin]), []);
  assert.deepEqual(give(twin.id), [["S$450,000", 2]]);
  // Named itself, the table row is given, once.
  assert.deepEqual(give(hip.id), [["S$450,000", 2]]);
  // The named row's own condition, printed only on its page, goes with the stand-in as a point quoting that page; one that
  // states money cannot, so there is then no stand-in (Critic R131-2).
  const all = (r2: ChatRow[], H2 = H) => {
    const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: twin.id }] };
    const fromRows = amountsFromRows(raw, r2, H2);
    return (verifyAnswer(H2, readModelAnswer(fromRows.json)!, ["q"], new Set(fromRows.report.labels)).answer.statements ?? []).map((x) => [x.amount?.text ?? null, x.text, x.source?.page]);
  };
  const conditioned = { ...twin, conditions: ["In the event of a fracture"] };
  assert.deepEqual(all([...rows, conditioned]).filter(([, t]) => /also depends on/.test(String(t))), [[null, "Hip also depends on this: In the event of a fracture", 5]]);
  const H3: Household = { ...H, documents: H.documents.map((d) => d.policyId !== PROSE ? d : { ...d, pages: [{ ...d.pages[0], text: d.pages[0].text + "\nNo more than S$1,000 is paid for any one fracture." }] }) };
  const moneyed = { ...twin, conditions: ["No more than S$1,000 is paid for any one fracture."] };
  assert.deepEqual(all([...rows, moneyed], H3).filter(([a]) => a), []);
  // A twin with another figure is no stand-in.
  const other = { ...hip, figure: { ...hip.figure, amount: 300000 } as typeof hip.figure, id: twin.id, docIndex: twin.docIndex, source: twin.source };
  assert.deepEqual(give(twin.id, [...rows.filter((r) => r !== hip), other]).filter(([t]) => t === "S$450,000"), []);
});

test("a number the documents print as a policy number is no money when the sentence calls it a policy number (H8)", () => {
  const H: Household = { ...HOUSE, documents: [...HOUSE.documents, doc("aaaaaaaa-0000-0000-0000-00000000000d", "Group cert.pdf", [{ page: 1, text: "GROUP TERM LIFE(POLICY NO.3037850)\nLim Ah Kow\tS$500,000" }])] };
  const said = (text: string) => (verifyAnswer(H, readModelAnswer({ bottomLine: text, nextSteps: [], question: null, statements: [] })!, ["q"]).answer.bottomLine);
  assert.equal(said("The cover's own policy number, shown against Group Term Life, is 3037850."), "The cover's own policy number, shown against Group Term Life, is 3037850.");
  // Not called a policy number, or a figure the documents never print as one: still money.
  assert.notEqual(said("Group Term Life pays 3037850."), "Group Term Life pays 3037850.");
  assert.notEqual(said("The policy number is fine and the payout is 3037851."), "The policy number is fine and the payout is 3037851.");
});

test("a card inside a waiting period is never shown: the model gives the period as printed, the server compares the dates (stress run 23 Oct, S023)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const ci = (id: string, coverSince: string | null, docIndex = amb.docIndex): ChatRow => ({ ...amb, id, cover: "CRITICAL ILLNESS PLAN", benefit: "Critical Illness Benefit", docIndex,
    coverKey: coverKeyOf({ product: amb.product, cover: "CRITICAL ILLNESS PLAN", plan: null }), coverSince });
  // The backstop only acts where the row's own document prints a waiting period next to the cover's name (Critic R153-1).
  const PRINTS = { ...HOUSE, documents: HOUSE.documents.map((d, i) => i === amb.docIndex ? { ...d, pages: [...d.pages, { ...d.pages[0], text: "Critical Illness Plan\nWaiting Period: 90 days from the issue date" }] } : d) };
  const shown = (row: ChatRow, waiting: unknown, eventFit: unknown = "on_list", now = new Date("2026-10-23T02:00:00Z"), house = PRINTS) => {
    const fromRows = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
      percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, eventFit, waiting }] }, [...rows, row], house, now);
    return { labels: fromRows.report.labels.length, why: fromRows.report.dropped.map((d) => d.why) };
  };
  const old = ci("R950", "01/01/2020"), fresh = ci("R951", "20/10/2026");
  // Inside a period that applies, or may apply: hidden. Past it, or one that does not apply: shown.
  assert.deepEqual(shown(old, { applies: "yes", days: 90, from: "20/10/2026" }), { labels: 0, why: ["the event falls inside its 90-day waiting period"] });
  assert.equal(shown(old, { applies: "unsure", days: 90, from: "20/10/2026" }).labels, 0);
  assert.equal(shown(old, { applies: "yes", days: 90, from: "20/10/2026" }, "on_list", new Date("2027-01-18T02:00:00Z")).labels, 1);
  assert.equal(shown(old, { applies: "yes", days: 90, from: "20/10/2026" }, "on_list", new Date("2027-01-17T02:00:00Z")).labels, 0);
  assert.equal(shown(old, { applies: "no", days: 90, from: "20/10/2026" }).labels, 1);
  // Singapore's date: 18 Jan 2027 begins at 16:00 UTC on 17 Jan.
  assert.equal(shown(old, { applies: "yes", days: 90, from: "20/10/2026" }, "on_list", new Date("2027-01-17T16:30:00Z")).labels, 1);
  // A period that applies but cannot be dated is never taken as over.
  assert.equal(shown(old, { applies: "yes", days: 90, from: null }).labels, 0);
  assert.equal(shown(old, { applies: "unsure", days: null, from: "20/10/2026" }).labels, 0);
  assert.equal(shown(old, { applies: "yes", days: 90, from: "sometime last year" }).labels, 0);
  // No period said: a list cover that started within a year is hidden (not checked); an older one, or any other card, is not.
  assert.equal(shown(fresh, null).labels, 0);
  assert.equal(shown(old, null).labels, 1);
  // A cover whose document prints no waiting period with its name (a group accident plan) is not held back for a year.
  assert.equal(shown(fresh, null, "on_list", undefined, HOUSE).labels, 1);
  assert.equal(shown(fresh, null, "any_event").labels, 1);
  assert.equal(shown(fresh, null, "no_event").labels, 1);
  // With no event asked about, a waiting period hides nothing ("what is he covered for").
  assert.equal(shown(old, { applies: "yes", days: 90, from: "20/10/2026" }, "no_event").labels, 1);
  // The same benefit of the same cover in another document is hidden with it.
  const twin = ci("R952", "01/01/2020", amb.docIndex === 0 ? 1 : 0);
  const both = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [old.id, twin.id].map((row, i) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row, eventFit: "on_list", waiting: i ? null : { applies: "yes", days: 90, from: "20/10/2026" } })) }, [...rows, old, { ...twin, source: { ...twin.source, documentId: "other" } }], HOUSE, new Date("2026-10-23T02:00:00Z"));
  assert.equal(both.report.labels.length, 0);
});

test("a benefit the question asks about by name is never hidden as not described (live run 23 Oct, H7)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const aid: ChatRow = { ...amb, id: "R960", benefit: "Mobility aid upon Accidental Total & Permanent Disablement" };
  const shown = (question: string, row = aid) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, eventFit: "not_described", waiting: null, period: null }] }, [...rows, aid], HOUSE, new Date("2026-10-23T02:00:00Z"), question).report.labels.length;
  assert.equal(shown("what is the mobility aid benefit"), 1);
  assert.equal(shown("what does the ambulance cost benefit pay", amb), 1);
  // Not asked about by name: hidden as before (S088: an ambulance nobody mentioned).
  assert.equal(shown("she had an accident at work, 3 days so far"), 0);
  assert.equal(shown("she had an accident at work, 3 days so far", amb), 0);
  // One word of the name is not the name ("aid" alone).
  assert.equal(shown("what aid can i get"), 0);
  // The cover's name is not the benefit's: a not described card under it stays hidden (TE A3).
  assert.equal(shown("I broke my wrist. What does my personal accident cover pay?"), 0);
});

test("a card whose copied benefit name is not its row's is left out: the id slipped (round 9 check, S088)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const rec: ChatRow = { ...amb, id: "R962", benefit: "J, Accidental Hospital Recuperation Benefit" }, cef: ChatRow = { ...amb, id: "R963", benefit: "K. Child Education Fund Benefit" };
  const run = (row: string, rowBenefit: unknown) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row, rowBenefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, [...rows, rec, cef], HOUSE, new Date("2026-10-23T02:00:00Z")).report;
  const slip = run(cef.id, "Accidental Hospital Recuperation Benefit");
  assert.equal(slip.labels.length, 0);
  assert.match(slip.dropped[0].why, /R963 is .*Child Education Fund.*not "Accidental Hospital Recuperation Benefit"/);
  // The row's own name: exactly, without its list letter, in other case, or two or more words of it: shown.
  for (const n of ["K. Child Education Fund Benefit", "Child Education Fund Benefit", "child education fund"]) assert.equal(run(cef.id, n).labels.length, 1, n);
  // One word, an empty name, another row's, or a name with words added: left out (copied exactly, or not at all).
  for (const n of ["Fund", "", "Ambulance Cost", "Child Education Fund (per child)"]) assert.equal(run(cef.id, n).labels.length, 0, n);
  // A name inside another is not that name (Critic R157-1).
  const icu: ChatRow = { ...amb, id: "R964", benefit: "ICU Hospital Cash" }, cash: ChatRow = { ...amb, id: "R965", benefit: "Hospital Cash" };
  const nested = (row: ChatRow, rowBenefit: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, [...rows, icu, cash], HOUSE, new Date("2026-10-23T02:00:00Z")).report.labels.length;
  assert.equal(nested(icu, "Hospital Cash"), 0);
  assert.equal(nested(cash, "ICU Hospital Cash"), 0);
  assert.equal(nested(icu, "ICU Hospital Cash"), 1);
  assert.equal(nested(cash, "Hospital Cash Benefit"), 1);
  // A name without its section is not the row's: two sections can share it (TE K8).
  const simple: ChatRow = { ...amb, id: "R966", benefit: "Simple Fracture: Wrist" }, compound: ChatRow = { ...amb, id: "R967", benefit: "Compound Fracture: Wrist" };
  const fracture = (row: ChatRow, rowBenefit: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, [...rows, simple, compound], HOUSE, new Date("2026-10-23T02:00:00Z")).report.labels.length;
  assert.equal(fracture(compound, "Wrist"), 0);
  assert.equal(fracture(compound, "Simple Fracture: Wrist"), 0);
  assert.equal(fracture(compound, "Compound Fracture: Wrist"), 1);
  // An answer recorded before the field existed is not checked.
  assert.equal(run(cef.id, undefined).labels.length, 1);
});

test("a card for an event outside its cover's printed period is never shown; with no event it says the period ended (live run 23 Oct, S048, S008)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const trip: ChatRow = { ...amb, id: "R961", cover: "Single Trip", benefit: "Daily hospital cash while overseas", coverKey: coverKeyOf({ product: amb.product, cover: "Single Trip", plan: null }) };
  const run = (eventFit: string, period: unknown) => {
    const r = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
      percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: trip.id, eventFit, waiting: null, period }] }, [...rows, trip], HOUSE, new Date("2026-10-23T02:00:00Z"));
    return { labels: r.report.labels, why: r.report.dropped.map((d) => d.why) };
  };
  const p = (eventOn: string | null) => ({ from: "29/09/2026", to: "04/10/2026", eventOn });
  // An event with no date said may have been during the trip: shown, saying when the period ended (Critic R156-1).
  const undated = run("any_event", p(""));
  assert.equal(undated.labels.length, 1);
  assert.match(undated.labels[0], / Its cover period ended on 04\/10\/2026, so it pays only for an event on or before that day\.$/);
  // Happening now (today's date): after the trip ended, no card.
  assert.deepEqual(run("any_event", p("23/10/2026")), { labels: [], why: ["its cover period ended on 04/10/2026"] });
  // On a date inside the trip: shown. Before it: not.
  assert.equal(run("any_event", p("29/09/2026")).labels.length, 1);
  assert.deepEqual(run("any_event", p("20/09/2026")).why, ["its cover period starts on 29/09/2026"]);
  // No period printed, or one that cannot be dated: shown as before.
  assert.equal(run("any_event", null).labels.length, 1);
  assert.equal(run("any_event", { from: null, to: null, eventOn: null }).labels.length, 1);
  // With no event, the card is shown and says the period ended.
  const lookup = run("no_event", p("")).labels;
  assert.equal(lookup.length, 1);
  assert.match(lookup[0], / Its cover period ended on 04\/10\/2026\.$/);
  assert.doesNotMatch(run("no_event", { from: "01/10/2026", to: "01/12/2026", eventOn: null }).labels[0], /ended/);
});

test("a sentence that sets the daily cards' one day rule against itself is left out (live run 23 Oct, H4)", () => {
  const report = { dropped: [], labels: ["Daily cash: paid per day, from day 11 of the stay, for at most 30 days."], days: { "Daily cash: paid per day, from day 11 of the stay, for at most 30 days.": [{ fromDay: 11, maxDays: 30, alone: true }] } };
  const st = (text: string) => ({ text, fullText: text, amount: null as unknown });
  const answer = { summary: "S$900 for 45 days.", bottomLine: "S$900 for 45 days.", statements: [
    st("The pages print two day-counts that differ slightly: one says it pays after the 10th day for up to 30 days, the other says from the 11th to the 40th day. The insurer decides which applies."),
    st("It is paid from the 11th day. It is not paid for self-inflicted injuries."),
    st("The scheme pays after the 7th day, the other from the 11th day."),
    st("The benefit can only be claimed once. One page says after the 10th day for at most thirty (30) days, the other from day 11.") ] };
  const left = dropAgreeingDayRules(answer, report);
  assert.equal(left.length, 2);
  assert.deepEqual(answer.statements.map((x) => x.text), ["It is paid from the 11th day. It is not paid for self-inflicted injuries.", "The scheme pays after the 7th day, the other from the 11th day.", "The benefit can only be claimed once."]);
  // Cards read with different rules: nothing is left out.
  // "After 10 days" is day 11; "on 11th October" is a date, not a first paid day (TE D8, D9).
  const more = { summary: "x", statements: [st("One page says after 10 days, the other from the 11th day, for up to 30 days."), st("He was admitted on 11th October and it pays after the 10th day.")] };
  assert.equal(dropAgreeingDayRules(more, report).length, 1);
  assert.deepEqual(more.statements.map((x) => x.text), ["He was admitted on 11th October and it pays after the 10th day."]);
  // "From day 11 to day 60" is 50 days, not the cards' 30: kept (TE D11).
  const longer = { summary: "x", statements: [st("One says after the 10th day for up to 30 days; the other says from day 11 to day 60.")] };
  assert.deepEqual(dropAgreeingDayRules(longer, report), []);
  const two = { ...report, days: { a: [{ fromDay: 11, maxDays: 30, alone: true }], b: [{ fromDay: 8, maxDays: 30, alone: true }] } };
  const kept = { summary: "x", statements: [st("One says after the 10th day, the other from the 11th day.")] };
  assert.deepEqual(dropAgreeingDayRules(kept, two), []);
});

test("each printed date range is said with whether it has ended, is running or has not started (live run 23 Oct, S048)", () => {
  const withPages = (text: string): Household => ({ ...HOUSE, documents: [...HOUSE.documents, doc("aaaaaaaa-0000-0000-0000-0000000000e2", "Trip.pdf", [{ page: 1, text }])] });
  const now = new Date("2026-10-23T03:00:00Z");
  assert.match(periodsNote(withPages("Period of Insurance: 29/09/2026 to 04/10/2026"), now), /29\/09\/2026 to 04\/10\/2026: ended before today/);
  assert.match(periodsNote(withPages("Cover 01/10/2026 - 01/12/2026"), now), /running today/);
  assert.match(periodsNote(withPages("Trip 01/12/2026 to 05/12/2026"), now), /not started yet/);
  // Singapore's date: 23 Oct begins at 16:00 UTC on 22 Oct, so a trip ending 22 Oct has ended.
  assert.match(periodsNote(withPages("Trip 01/10/2026 to 22/10/2026"), new Date("2026-10-22T16:30:00Z")), /ended before today/);
  // Not a range: nothing said.
  for (const t of ["Issued 01/10/2026", "05/10/2026 to 01/10/2026", "31/02/2026 to 01/03/2026"]) assert.ok(!/\bTrip prints/.test(periodsNote(withPages(t), now)), t);
});

test("a copy without the server's note or a premium's frequency is the row's, when no other row has that short name (live run 23 Oct, A6, A2)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const later: ChatRow = { ...amb, id: "R970", benefit: "Instalment Premium, Monthly (the page prints a different premium for the first policy year)" };
  const first: ChatRow = { ...amb, id: "R971", benefit: "First Year Instalment Premium, Monthly (first policy year only)" };
  const full: ChatRow = { ...amb, id: "R972", benefit: "Neck, Skull or Spine (Full Break)" }, part: ChatRow = { ...amb, id: "R973", benefit: "Neck, Skull or Spine (Partial Break)" };
  const all = [...rows, later, first, full, part];
  const shown = (row: ChatRow, rowBenefit: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, all, HOUSE, new Date("2026-10-23T02:00:00Z")).report.labels.length;
  for (const n of ["Instalment Premium, Monthly", "Instalment Premium", "Instalment Premium, Monthly (the page prints a different premium for the first policy year)"]) assert.ok(shown(later, n) >= 1, n);
  for (const n of ["First Year Instalment Premium, Monthly", "First Year Instalment Premium"]) assert.ok(shown(first, n) >= 1, n);
  // Still never another row's name, and a copy never adds a note.
  assert.equal(shown(later, "First Year Instalment Premium, Monthly"), 0);
  assert.equal(shown(first, "Instalment Premium, Monthly"), 0);
  assert.equal(shown(later, "Instalment Premium (first year)"), 0);
  // A frequency may be left out, never changed (TE #111 C5).
  assert.equal(shown(later, "Instalment Premium, Annual"), 0);
  assert.ok(shown(later, "Instalment Premium, monthly") >= 1);
  // Two rows that differ only in the note: the short name is neither's.
  assert.equal(shown(full, "Neck, Skull or Spine"), 0);
  assert.equal(shown(full, "Neck, Skull or Spine (Full Break)"), 1);
});

test("a copy in the model's own words is the row's when every word is printed with it and no other row fits as well (live run 23 Oct after #111, A6, D1)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const at = (id: string, benefit: string, doc = amb.source.documentId): ChatRow => ({ ...amb, id, benefit, source: { ...amb.source, documentId: doc } });
  const later = at("R990", "Instalment Premium, Monthly (the page prints a different premium for the first policy year)"), first = at("R991", "First Year Instalment Premium, Monthly (first policy year only)");
  const bs = at("R992", "Simple Fracture or Other Fracture due to Accident: Arm, Elbow, Wrist or Ribs (Other Fracture)", "doc-bs"), ps = at("R993", "Arm, Elbow, Wrist or Ribs", "doc-ps");
  const hip = at("R994", "Simple Fracture or Other Fracture due to Accident: Hip", "doc-bs"), cef = at("R995", "K. Child Education Fund Benefit"), rec = at("R996", "J. Accidental Hospital Recuperation Benefit");
  const icu = at("R997", "ICU Hospital Cash"), cash = at("R998", "Hospital Cash");
  const all = [...rows, later, first, bs, ps, hip, cef, rec, icu, cash];
  const shown = (row: ChatRow, rowBenefit: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, all, HOUSE, new Date("2026-10-23T02:00:00Z")).report.labels.some((l) => l.includes(benefitOf(row)));
  const benefitOf = (r: ChatRow) => r.benefit.replace(/^[A-Z]\.\s+/, "").split(" (")[0].split(": ").pop()!;
  for (const [r, n] of [[later, "Monthly Instalment Premium"], [first, "First Year Monthly Instalment Premium"], [bs, "Arm, Elbow, Wrist or Ribs (Other Fracture)"], [bs, "Other Fracture: Arm, Elbow, Wrist or Ribs"]] as const) assert.ok(shown(r, n), n);
  // Never a row another fits as well or better, or one missing a word of the copy.
  for (const [r, n] of [[later, "First Year Instalment Premium"], [first, "Instalment Premium, Monthly"], [hip, "Arm, Elbow, Wrist or Ribs"], [bs, "Wrist"], [cef, "Accidental Hospital Recuperation Benefit"],
    [icu, "Hospital Cash"], [cash, "ICU Hospital Cash"], [first, "First-year instalment premium (discounted)"]] as const) assert.ok(!shown(r, n), `${r.id} ${n}`);
});

test("a card whose quote is its row's own printed line, and no other row's, keeps its row whatever name was copied (round 11 check, A6)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const at = (id: string, benefit: string, excerpt: string): ChatRow => ({ ...amb, id, benefit, cover: "Comprehensive Critical Illness Benefit", source: { ...amb.source, excerpt } });
  const later = at("R980", "Instalment Premium, Monthly (the page prints a different premium for the first policy year)", "Instalment Premium : 470.85 Currency");
  const first = at("R981", "First Year Instalment Premium, Monthly (first policy year only)", "First Year Instalment Premium * : 376.68");
  const cef = at("R982", "K. Child Education Fund Benefit", "Child Education Fund 5,000"), rec = at("R983", "J. Accidental Hospital Recuperation Benefit", "We will pay a one-time amount of $250 per hospitalisation.");
  const all = [...rows, later, first, cef, rec];
  const shown = (row: ChatRow, rowBenefit: string, quote: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, all, HOUSE, new Date("2026-10-23T02:00:00Z")).report.labels.length > 0;
  assert.ok(shown(later, "Comprehensive Critical Illness Benefit", "Instalment Premium : 470.85"));
  assert.ok(shown(first, "Comprehensive Critical Illness Benefit", "First Year Instalment Premium * : 376.68"));
  // Another row's line, a line two rows print, or too short a quote: left out.
  assert.ok(!shown(later, "Comprehensive Critical Illness Benefit", "First Year Instalment Premium * : 376.68"));
  assert.ok(!shown(later, "Comprehensive Critical Illness Benefit", "Instalment Premium"));
  assert.ok(!shown(later, "Comprehensive Critical Illness Benefit", "470.85"));
  // The slipped id quoting the row meant (S088): still left out.
  assert.ok(!shown(cef, "Accidental Hospital Recuperation Benefit", "We will pay a one-time amount of $250 per hospitalisation."));
});

test("a note only one document prints after a benefit's name is the same benefit; two different notes are not (live run 23 Oct after #111, D1; TE #111 C8)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const fig = (amount: number) => ({ kind: "printed", amount, currency: "SGD", unit: "lump_sum", period: null }) as ChatRow["figure"];
  const bs: ChatRow = { ...amb, id: "R985", benefit: "Simple Fracture or Other Fracture due to Accident: Arm, Elbow, Wrist or Ribs (Other Fracture)", figure: fig(120000), source: { ...amb.source, documentId: "doc-bs" } };
  const ps: ChatRow = { ...amb, id: "R986", benefit: "Arm, Elbow, Wrist or Ribs", figure: fig(1250), source: { ...amb.source, documentId: "doc-ps" } };
  const full: ChatRow = { ...amb, id: "R987", benefit: "Neck, Skull or Spine (Full Break)", figure: fig(5000), source: { ...amb.source, documentId: "doc-ps" } };
  const part: ChatRow = { ...amb, id: "R988", benefit: "Neck, Skull or Spine (Partial Break)", figure: fig(2500), source: { ...amb.source, documentId: "doc-bs" } };
  const card = (row: ChatRow, rowBenefit = row.benefit) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
    row: row.id, rowBenefit, eventFit: "on_list", waiting: null, period: { from: "", to: "", eventOn: "" } });
  const go = (rs: ChatRow[], cards: Record<string, unknown>[]) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: cards }, [...rows, ...rs], HOUSE, new Date("2026-10-23T02:00:00Z"));
  // One card brings the other document's figure with it, as an alternative.
  assert.equal(go([bs, ps], [card(ps)]).report.labels.length, 2);
  // A card left out for its copied name whose row is shown anyway is not "left out".
  const r = go([bs, ps], [card(ps), card(bs, "Ribs fracture lump sum")]).report;
  assert.equal(r.labels.length, 2);
  assert.equal(r.dropped.length, 0);
  // Two different notes are two benefits: no companion.
  assert.equal(go([full, part], [card(full)]).report.labels.length, 1);
});

test("a benefit with a note of its own stays a rival to the plain one when matching a copied name; a bare amount line binds no quote (Critic R165)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const fig = (amount: number) => ({ kind: "printed", amount, currency: "SGD", unit: "lump_sum", period: null }) as ChatRow["figure"];
  const at = (id: string, benefit: string, amount: number, doc: string, excerpt = "x"): ChatRow => ({ ...amb, id, benefit, figure: fig(amount), source: { ...amb.source, documentId: doc, excerpt } });
  const shown = (all: ChatRow[], row: ChatRow, rowBenefit: string, quote: string | null = null) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote,
    amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] }, [...rows, ...all], HOUSE,
    new Date("2026-10-23T02:00:00Z")).report.labels.length > 0;
  for (const doc of ["doc-a", "doc-b"]) {
    const ad = at("R960", "Accidental Death", 600000, "doc-a"), pt = at("R961", "Accidental Death (Public Transport)", 1200000, doc);
    // "Accidental Death" is the plain row's; never the public-transport row, in the same document or another.
    assert.ok(!shown([ad, pt], pt, "Accidental Death"), doc);
    assert.ok(shown([ad, pt], pt, "Accidental Death (Public Transport)"), doc);
    const cash = at("R962", "Hospital Cash", 100, "doc-a"), icu = at("R963", "Hospital Cash (ICU)", 200, doc);
    assert.ok(!shown([cash, icu], icu, "Hospital Cash"), doc);
  }
  // A row whose whole line is a bare amount is not quoted by a long line about another benefit.
  const coma = at("R964", "Comatose Benefit", 50000, "doc-a", "Comatose Benefit: 25% of the sum insured, capped at S$50,000 per life");
  const bare = at("R965", "Natural Catastrophe Benefit", 50000, "doc-a", "S$50,000");
  assert.ok(!shown([coma, bare], bare, "Comprehensive Critical Illness Benefit", "Comatose Benefit: 25% of the sum insured, capped at S$50,000 per life"));
  // The row's own longer line still binds (A6).
  const prem = at("R966", "Instalment Premium, Monthly", 470.85, "doc-a", "Instalment Premium : 470.85 Currency");
  assert.ok(shown([prem], prem, "Comprehensive Critical Illness Benefit", "Instalment Premium : 470.85"));
});

test("a premium is never hidden by a waiting period or the cover's dates (live run 23 Oct, A6)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const prem: ChatRow = { ...amb, id: "R974", benefit: "Instalment Premium, Monthly" };
  const run = (row: ChatRow) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: { applies: "yes", days: 90, from: "19/10/2026" },
    period: { from: "19/10/2026", to: "19/10/2036", eventOn: "01/10/2026" } }] }, [...rows, prem, { ...amb, id: "R975", benefit: "Death Benefit" }], HOUSE, new Date("2026-10-23T02:00:00Z")).report;
  assert.equal(run(prem).labels.length, 1);
  // A benefit paid on the event still is, also one that names premiums (Critic R162-1).
  assert.equal(run({ ...amb, id: "R975", benefit: "Death Benefit" }).labels.length, 0);
  for (const b of ["Waiver of Premium", "Premium Waiver Benefit", "Return of Premiums", "Refund of Premium", "Refunded Premiums upon Death", "Premiums refunded on death", "Waived Premiums on TPD"]) {
    const w: ChatRow = { ...amb, id: "R976", benefit: b };
    const held = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
      percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: w.id, rowBenefit: b, eventFit: "any_event", waiting: { applies: "yes", days: 90, from: "19/10/2026" },
      period: { from: "", to: "", eventOn: "" } }] }, [...rows, w], HOUSE, new Date("2026-10-23T02:00:00Z")).report;
    assert.equal(held.labels.length, 0, b);
  }
});

test("the same benefit with the same figure from another document is shown once, list numbers aside (live run 23 Oct, B5)", () => {
  const base = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const fig = { kind: "printed", amount: 600000, currency: "SGD", unit: "lump_sum", period: null } as ChatRow["figure"];
  const bs: ChatRow = { ...base, id: "R980", benefit: "2. Permanent Total Loss of (a) Sight in at least one eye", figure: fig, source: { ...base.source, documentId: "doc-bs" } };
  const ps: ChatRow = { ...base, id: "R981", benefit: "Permanent Total Loss of Sight in at least one eye", figure: fig, source: { ...base.source, documentId: "doc-ps" } };
  const other: ChatRow = { ...base, id: "R982", benefit: "Permanent Total Loss of Sight in at least one eye", figure: { ...fig, amount: 300000 } as ChatRow["figure"], source: { ...base.source, documentId: "doc-ps" } };
  const card = (row: ChatRow) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
    row: row.id, rowBenefit: row.benefit, eventFit: "on_list", waiting: null, period: { from: "", to: "", eventOn: "" } });
  const given = (rs: ChatRow[], named: ChatRow[]) => (amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: named.map(card) }, [...rows, ...rs], HOUSE, new Date("2026-10-23T02:00:00Z")).json as { statements: { kind: string; row?: string }[] }).statements.length;
  assert.equal(given([bs, ps], [bs, ps]), 1);
  assert.equal(given([bs, ps], [ps, bs]), 1);
  // A different figure for the same benefit is still given with it.
  assert.equal(given([bs, other], [bs, other]), 2);
  // The skipped card's own condition is kept, as a point quoting its document (TE #111 T5).
  const cond = { text: "Death must occur within 365 days of the accident.", quote: "within 365 days of the accident" };
  const out = (amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [card(bs), { ...card(ps), conditions: [cond] }] }, [...rows, bs, ps], HOUSE, new Date("2026-10-23T02:00:00Z")).json as { statements: { kind: string; text: string; quote?: string }[] }).statements;
  assert.equal(out.filter((x) => x.kind === "amount").length, 1);
  assert.ok(out.some((x) => x.kind === "fact" && /also depends on this: Death must occur within 365 days/.test(x.text) && x.quote === cond.quote), JSON.stringify(out));
});

test("with an amount left out, words pointing at the amounts shown go; the rest stays (live run 23 Oct after #111, A6)", () => {
  const b = "Desmond pays two CI II premiums and a one-off travel premium, shown below.";
  const a = { summary: b, bottomLine: b, statements: [{ text: "Up to S$73.17", amount: { text: "S$73.17" } }, { text: "The amounts below are monthly.", amount: null }] };
  dropAmountPointers(a, ["Up to S$73.17"], true);
  assert.equal(a.bottomLine, "Desmond pays two CI II premiums and a one-off travel premium.");
  assert.deepEqual(a.statements.map((x) => x.text), ["Up to S$73.17"]);
  // Nothing left out: pointers stay.
  const c = { summary: b, bottomLine: b, statements: [{ text: "Up to S$73.17", amount: { text: "S$73.17" } }] };
  dropAmountPointers(c, ["Up to S$73.17"]);
  assert.equal(c.bottomLine, b);
  // No stray comma where the words sat mid-sentence (Critic R165).
  const d = { summary: "", bottomLine: "The premiums, shown below, are paid monthly.", statements: [{ text: "Up to S$73.17", amount: { text: "S$73.17" } }] };
  dropAmountPointers(d, ["Up to S$73.17"], true);
  assert.equal(d.bottomLine, "The premiums are paid monthly.");
});

test("'the amount is below' with no card goes; 'below the limit' is not a pointer (live run 23 Oct, S087)", () => {
  const a = { summary: "s", bottomLine: "Her daily hospital cash only pays past 10 days. The amount is below.", statements: [{ text: "How many days has she been in hospital?", amount: null }] };
  dropAmountPointers(a, []);
  assert.equal(a.bottomLine, "Her daily hospital cash only pays past 10 days.");
  const b = { summary: "s", bottomLine: "The bill amount is below the S$5,000 limit, so it is paid in full.", statements: [] as { text: string; amount: null }[] };
  dropAmountPointers(b, []);
  assert.equal(b.bottomLine, "The bill amount is below the S$5,000 limit, so it is paid in full.");
});

test("the days a message names are given as dates with how far they are from today (live run 23 Oct, S060)", () => {
  const now = new Date("2026-10-23T05:00:00Z");
  assert.match(datesSaidNote("baggage arrived 10 hours late in tokyo on 29 september", now), /"29 september" is 29\/09\/2026, 24 days before today/);
  assert.match(datesSaidNote("admitted on Oct 20th", now), /20\/10\/2026, 3 days before today/);
  assert.match(datesSaidNote("fell on 3/10", now), /03\/10\/2026, 20 days before today/);
  assert.match(datesSaidNote("admitted 03/10/2026", now), /03\/10\/2026, 20 days before today/);
  // Not dates (Critic R162).
  for (const t of ["open 24/7", "about 1/2 of the bill", "3/4 of the sum"]) assert.equal(datesSaidNote(t, now), "", t);
  // A day still to come this year may be last year's: both are said.
  assert.match(datesSaidNote("flying on 5 december", now), /05\/12\/2026, 43 days after today, or 05\/12\/2025, 322 days before today/);
  // Singapore's date.
  assert.match(datesSaidNote("on 23 october", new Date("2026-10-22T16:30:00Z")), /is 23\/10\/2026, today/);
  for (const t of ["it may 3 times", "in march", "no date", "31 february"]) assert.equal(datesSaidNote(t, now), "", t);
});

test("a printed date is read day first, and only as a real date", () => {
  assert.equal(printedDay("20/10/2026")! - printedDay("2026-10-20")!, 0);
  assert.equal(printedDay("20 October 2026"), printedDay("20/10/2026"));
  assert.equal(printedDay("01/02/2026")! - printedDay("31/01/2026")!, 1);
  for (const x of ["31/02/2026", "10/2026", "2026", "", null, "20/10/26"]) assert.equal(printedDay(x), null, String(x));
});

test("a limit whose own line prints one daily rate gives that rate as a row of its own, after every other row (stress run 23 Oct, S016)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const t = tableWith();
  const person = t.people.find((p) => p.name === "Lim Ah Kow")!;
  const capped = { ...person.rows.find((r) => r.benefit === "Ambulance Cost")!, benefit: "Daily hospital cash while overseas", source: { ...amb.source, excerpt: "Capped at S$200 per day\nS$5,000\tS$8,000\tS$10,000" }, figure: { kind: "printed" as const, amount: 8000, currency: "SGD", unit: "up_to" as const } };
  const withRate = chatRows({ ...t, people: t.people.map((p) => p === person ? { ...p, rows: [...p.rows, capped] } : p) }, HOUSE);
  const daily = withRate.filter((r) => r.benefit === "Daily hospital cash while overseas");
  assert.deepEqual(daily.map((r) => [r.figure.kind === "printed" ? [r.figure.amount, r.figure.unit] : null]), [[[8000, "up_to"]], [[200, "per_day"]]]);
  assert.equal(withRate.at(-1)!.benefit, "Daily hospital cash while overseas");
  assert.deepEqual(withRate.slice(0, rows.length).map((r) => r.id), rows.map((r) => r.id));
  // Two rates, or only the limit itself, give none.
  // Only a rate the line prints as a limit counts; ICU, excess, companion and allowance figures never do (Critic R153-2).
  const rateOf = (excerpt: string) => chatRows({ ...t, people: t.people.map((p) => p === person ? { ...p, rows: [...p.rows, { ...capped, source: { ...capped.source, excerpt } }] } : p) }, HOUSE)
    .filter((r) => r.benefit === "Daily hospital cash while overseas" && r.figure.kind === "printed" && r.figure.unit === "per_day").map((r) => r.figure.kind === "printed" ? r.figure.amount : null);
  assert.deepEqual(rateOf("Maximum S$300 per day"), [300]);
  for (const excerpt of ["S$200 per day or S$400 per day in intensive care", "S$8,000 per day", "Up to S$8,000",
    "Hospital Cash: Up to S$8,000; companion bed S$50 per day", "Capped at S$200 per day from the 11th day", "Up to S$200 per day after day 10",
    "ICU: capped at S$300 per day", "An excess of S$100 per day applies", "Companion: up to S$100 per day", "Daily allowance up to S$50 per day", "Pays S$200 per day"]) {
    const other = chatRows({ ...t, people: t.people.map((p) => p === person ? { ...p, rows: [...p.rows, { ...capped, source: { ...capped.source, excerpt } }] } : p) }, HOUSE);
    assert.equal(other.filter((r) => r.benefit === "Daily hospital cash while overseas").length, 1, excerpt);
  }
});

test("a daily card says its first paid day and most days (stress run 23 Oct, S008)", () => {
  const cash = rows.find((r) => r.benefit === "Hospital cash")!;
  assert.match(rowLabel({ ...cash, fromDay: 11, maxDays: 30 }), /: paid per day, from day 11 of the stay, for at most 30 days\.$/);
  assert.match(rowLabel({ ...cash, fromDay: 1, maxDays: null }), /: paid per day\.$/);
  assert.match(rowLabel({ ...cash, fromDay: null, maxDays: 60 }), /: paid per day, for at most 60 days\.$/);
});

test("\"my husband\" is settled only by a title the documents print before that member's own name (stress run 23 Oct, S048)", () => {
  const titled = (text: string): Household => ({ ...HOUSE, documents: [...HOUSE.documents, doc("aaaaaaaa-0000-0000-0000-0000000000e1", "Schedule.pdf", [{ page: 1, text }])] });
  assert.deepEqual(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["my husband was in hospital"]), { word: "my husband", member: "Lim Ah Kow", printed: "Mr Lim Ah Kow" });
  assert.deepEqual(spouseMeant(titled("Dear Mrs Tan Mei Ling,"), ["what does my wife have"])?.member, "Tan Mei Ling");
  // Said earlier in the conversation counts too.
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["how much a day", "my husband was in hospital"])?.member, "Lim Ah Kow");
  // One word of the name is not enough ("Dear Mr Lim"); a title for the other kind of spouse settles nothing; both printed
  // with it settles nothing; no title, no answer.
  assert.equal(spouseMeant(titled("Dear Mr Lim,"), ["my husband"]), null);
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["my wife"]), null);
  assert.equal(spouseMeant(titled("Mr Lim Ah Kow and Mr Tan Mei Ling"), ["my husband"]), null);
  // A relative who shares two of the member's name words is not the member (TE S3).
  assert.equal(spouseMeant(titled("Nominee: Mr Lim Ah Tan (brother)"), ["my husband"]), null);
  // The caller passes the message, then earlier turns newest first: the latest mention decides (TE S4).
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["how much a day?", "and my husband was in hospital", "what does my wife have?"])?.word, "my husband");
  // A member also printed as "Mrs" is never taken as the husband (Critic R153, low).
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow\nDear Mrs Lim Ah Kow,"), ["my husband"]), null);
  assert.equal(spouseMeant(HOUSE, ["my husband"]), null);
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["his cover"]), null);
  // Only for a household set up as one couple (self and spouse).
  assert.equal(spouseMeant({ ...titled("Life Assured : Mr Lim Ah Kow"), members: HOUSE.members.map((m) => ({ ...m, relationship: "child" })) }, ["my husband"]), null);
});

test("for a question about the documents, a point about one person's files is that person's list from the library (stress run 23 Oct, S070)", () => {
  const ask = (statements: Record<string, unknown>[], q = "list my documents") => verifyAnswer(HOUSE, readModelAnswer({ bottomLine: "Here is each adult's list.", nextSteps: [], question: null,
    statements: statements.map((x) => ({ kind: "fact", text: "x", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, ...x })) })!, [q]).answer.statements!.map((x) => x.text);
  assert.deepEqual(ask([{ text: "Lim Ah Kow has 2 documents.", person: "Lim Ah Kow" }, { text: "Tan Mei Ling has the certificate and terms." }, { text: "Ah Kow again.", person: "Lim Ah Kow" }]), [
    "Lim Ah Kow has 3 documents linked in DearPolicy: Certificate (Certificate.pdf); Scheme terms (Scheme terms.pdf); Policy illustration (Policy illustration.pdf).",
    "Tan Mei Ling has 3 documents linked in DearPolicy: Certificate (Certificate.pdf); Scheme terms (Scheme terms.pdf); Policy illustration (Policy illustration.pdf)."]);
  const H: Household = { ...HOUSE, members: [...HOUSE.members, { name: "Lim Xiao Ming", relationship: "child" }] };
  assert.deepEqual(verifyAnswer(H, readModelAnswer({ bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "fact", text: "Xiao Ming has none.", person: "Lim Xiao Ming", document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null }] })!, ["show our files"]).answer.statements!.map((x) => x.text),
    ["No document is linked to Lim Xiao Ming in DearPolicy."]);
  // Not a question about the documents: an unquoted point is left out as before.
  assert.deepEqual(ask([{ text: "Lim Ah Kow has 2 documents.", person: "Lim Ah Kow" }], "how much for a broken wrist"), []);
});

async function atest(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

void integration().then(() => {
  console.log(`benefit-table chat: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
});
