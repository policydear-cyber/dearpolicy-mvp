/** Scripted tests for Ask DearPolicy on the benefit table (lib/benefit-table/chat.ts): a synthetic household is read
 * into a table, the model's reply names rows, and the simple chat's own checks (lib/simple-chat/verify.ts, unchanged)
 * decide what the household sees. No model, database or network.
 *   npm run benefit-table:chat-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type Confirmation, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, declaredCurrency, type SourceDoc } from "@/lib/benefit-table/check";
import { type ChatRow, amountsFromRows, intensiveCareRateOf, chatRows, planTableRows, printedDay, coverLabels, citedPages, dropAgreeingDayRules, dropAmountPointers, dropPeopleShutOut, rowLabel, NARROWED_PAGES_NOTE, pagesToSend, keepLabelledAmounts, nameStatesMoney, noteLeftOutAmounts, NO_ROWS_YET, renderTable } from "@/lib/benefit-table/chat";
import { escapeText, PAGES_LEFT_OUT, PAGES_NOTE, spouseMeant, type Household } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT, NOTHING_SHOWN, libraryGroups, readModelAnswer, stayDaysSaid, verifyAnswer } from "@/lib/simple-chat/verify";
import { TABLE_ANSWER_SCHEMA } from "@/lib/simple-chat/prompt";
import { claimWindows, datesSaidNote, dropLateClaims, maskIdentityNumbers, periodsNote, runSimpleChat } from "@/lib/simple-chat/hook";
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
test("a plan or product printed with the cover's own name is not repeated on the card (Josephine's new documents, AIA)", () => {
  const labels = coverLabels([{ product: "AIA PRO LIFETIME PROTECTOR - MAX", cover: "PRO LIFETIME PROTECTOR - MAX", plan: "AIA PRO LIFETIME PROTECTOR - MAX" }]);
  assert.deepEqual([...labels.values()], ["PRO LIFETIME PROTECTOR - MAX"]);
  // A plan with words of its own still names it (Critic R173-1).
  assert.deepEqual([...coverLabels([{ product: "Travel Insurance", cover: "Travel Insurance", plan: "Travel Insurance Premier" }]).values()], ["Travel Insurance, plan Travel Insurance Premier"]);
  assert.match([...coverLabels([{ product: "Hospital & Surgical", cover: "Hospital & Surgical", plan: "Hospital & Surgical (Plan 2)" }]).values()][0], /plan Hospital & Surgical \(Plan 2\)/);
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
  // Files read in full are listed together under the people they are linked to, in one line, whichever way the model split
  // its points: one point per file used to come back as a line per file repeating "was read. It is linked to ... It was
  // uploaded for ..." (live 7e6d50e, E1, E4, H12).
  r = run("Mei Ling has two documents.", [{ text: "The group certificate for the scheme.", document: "D1" }, { text: "The scheme's terms.", document: "D2" }]);
  assert.equal(r.texts.length, 1);
  assert.match(r.texts[0], /^Linked to Lim Ah Kow and Tan Mei Ling, 2 documents, all read: Certificate \(Certificate\.pdf\); .+\.$/);
  assert.equal(r.texts.some((t) => /was read\. It is linked to/.test(t)), false);
  // Every file, one point each (the live E1 shape): one line per set of people, then only what is news about a file.
  r = run("You have 3 documents.", [1, 2, 3].map((i) => ({ text: `File ${i}.`, document: `D${i}` })), "what documents have we uploaded");
  assert.equal(r.texts.filter((t) => /^Linked to /.test(t)).length, 2, r.texts.join(" | "));
  assert.equal(r.texts.some((t) => /was read\. It is linked to/.test(t)), false, r.texts.join(" | "));
  // A file uploaded for someone it is not linked to still says so, once (live H12).
  const apart: Household = { ...H, documents: H.documents.map((d, i) => i === 0 ? { ...d, uploadedFor: "Alex Example" } : d) };
  const { answer: a2 } = verifyAnswer(apart, readModelAnswer({ bottomLine: "One file.", nextSteps: [], question: null, statements: [{ kind: "fact", text: "x", person: null, document: "D1", quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: false }] })!, ["which of our documents are about alex"]);
  const t2 = (a2.statements ?? []).map((x) => x.text);
  assert.deepEqual(t2, ["Certificate (Certificate.pdf) was read. It is linked to Lim Ah Kow and Tan Mei Ling, but it was uploaded for Alex Example."]);
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

// Changed 31 Oct (DC: "ignore all expiry dates ... assume all policies are still in force"): this used to check that a card
// for an event after a trip's printed period was dropped, and that a card shown with no event said the period ended.
// Every policy on file is now in force, so the same cards are always shown and never say a period ended.
test("a printed cover period never drops a card or adds an ended note: every policy is in force (was: live run 23 Oct, S048, S008)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const trip: ChatRow = { ...amb, id: "R961", cover: "Single Trip", benefit: "Daily hospital cash while overseas", coverKey: coverKeyOf({ product: amb.product, cover: "Single Trip", plan: null }) };
  const run = (eventFit: string, period: unknown) => {
    const r = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
      percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: trip.id, eventFit, waiting: null, period }] }, [...rows, trip], HOUSE, new Date("2026-10-23T02:00:00Z"));
    return { labels: r.report.labels, why: r.report.dropped.map((d) => d.why) };
  };
  const p = (eventOn: string | null) => ({ from: "29/09/2026", to: "04/10/2026", eventOn });
  for (const [eventFit, period] of [["any_event", p("")], ["any_event", p("23/10/2026")], ["any_event", p("29/09/2026")], ["any_event", p("20/09/2026")],
    ["any_event", null], ["any_event", { from: null, to: null, eventOn: null }], ["no_event", p("")], ["no_event", { from: "01/10/2026", to: "01/12/2026", eventOn: null }]] as const) {
    const out = run(eventFit, period);
    assert.equal(out.labels.length, 1, JSON.stringify(period));
    assert.doesNotMatch(out.labels[0], /ended|expired|starts on|not started/i, JSON.stringify(period));
    assert.ok(!out.why.some((w) => /period/.test(w)), JSON.stringify(out.why));
  }
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

// Changed 31 Oct (DC: every policy is in force): the dates note used to say whether each range had ended, was running or
// had not started. It now gives the printed ranges only.
test("each printed date range is given as printed, never as ended, running or not started (was: live run 23 Oct, S048)", () => {
  const withPages = (text: string): Household => ({ ...HOUSE, documents: [...HOUSE.documents, doc("aaaaaaaa-0000-0000-0000-0000000000e2", "Trip.pdf", [{ page: 1, text }])] });
  const now = new Date("2026-10-23T03:00:00Z");
  for (const [text, range] of [["Period of Insurance: 29/09/2026 to 04/10/2026", "29/09/2026 to 04/10/2026"], ["Cover 01/10/2026 - 01/12/2026", "01/10/2026 to 01/12/2026"], ["Trip 01/12/2026 to 05/12/2026", "01/12/2026 to 05/12/2026"]]) {
    const note = periodsNote(withPages(text), now);
    assert.ok(note.includes(range), note);
    assert.doesNotMatch(note, /ended|running|not started/i);
  }
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
  // A copy naming another of the person's covers is that cover, never this row (TE #112 B4).
  const ci = { ...at("R967", "Coverage against 37 critical illnesses", 5000, "doc-a"), cover: "CRITICAL ILLNESS(POLICY NO. 7)" };
  const eci = { ...at("R968", "Early Critical Illness", 5000, "doc-a"), cover: "EARLY CRITICAL ILLNESS(POLICY NO. 8)" };
  for (const n of ["Critical Illness", "Critical Illness Policy", "Critical Illness (Policy No. 7)", "Critical Illness Insurance"]) assert.ok(!shown([ci, eci], eci, n), n);
  assert.ok(shown([ci, eci], eci, "Early Critical Illness"));
  // The row's own longer line still binds (A6).
  const prem = at("R966", "Instalment Premium, Monthly", 470.85, "doc-a", "Instalment Premium : 470.85 Currency");
  assert.ok(shown([prem], prem, "Comprehensive Critical Illness Benefit", "Instalment Premium : 470.85"));
});

test("a plan table's lines the reading left out are rows for the person's plan column only, named by their own label (overnight run 23 Oct, N112, N113, N263)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const TRAVEL = "aaaaaaaa-0000-0000-0000-0000000000t1";
  const page = (n: number, text: string) => ({ page: n, text });
  const house: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(TRAVEL, "Travel wording.pdf", [
    page(6, ["Table of benefits", "Protecting your stuff", "Premium\tBusiness\tFirst", "Theft of or damage to baggage or personal belongings", "S$3,000\tS$5,000\tS$7,500",
      "Sub-limit for laptop / tablet (in total)", "S$1,000\tS$1,000\tS$1,000", "Sub-limit for jewellery (in total)", "S$300\tS$500\tS$500", "Overall limit for family plan*", "S$7,500\tS$12,500\tS$18,750",
      "S$300\tS$600\tS$1,000", "Loss of passport, travel documents & theft of money", "Sub-limit for theft of your money", "S$300\tS$300\tS$300",
      "Travel delay", "S$100 for every\tS$50 for every\tS$50 for every", "Delay while in Singapore", "Overall limit^\tS$300\tS$800\tS$1,500",
      "Trip cancellation", "S$500\tS$1,000\tS$1,500\tS$2,000"].join("\n")),
    page(9, ["Table of benefits", "Optional covers", "Premium\tBusiness\tFirst", "Home contents", "S$6,000\tS$6,000\tS$6,000"].join("\n")),
    // Another table under the same plan headings (Critic R169-2), and a line with one figure more than the plans (R169-3).
    page(7, ["For insured persons aged 70 years and above", "Premium\tBusiness\tFirst", "Overseas medical expenses", "S$50,000\tS$100,000\tS$150,000"].join("\n")),
  ])] };
  const docIndex = house.documents.length - 1;
  const template: ChatRow = { ...amb, id: "R900", benefit: "Theft of or damage to baggage or personal belongings", column: "Business", plan: "Business", docIndex,
    figure: { kind: "printed", amount: 5000, currency: "SGD", unit: "up_to", period: null }, source: { ...amb.source, documentId: TRAVEL, page: 6, excerpt: "Theft of or damage to baggage or personal belongings\nS$3,000 S$5,000 S$7,500" } };
  const made = planTableRows([...rows, template], house).map((r) => [r.benefit, r.figure.kind === "printed" ? r.figure.amount : null]);
  assert.deepEqual(made, [
    ["Theft of or damage to baggage or personal belongings: Sub-limit for laptop / tablet (in total)", 1000],
    ["Theft of or damage to baggage or personal belongings: Sub-limit for jewellery (in total)", 500],
    ["Loss of passport, travel documents & theft of money", 600],
    ["Loss of passport, travel documents & theft of money: Sub-limit for theft of your money", 300],
  ], JSON.stringify(made));
  // Never the family-plan limit, a sub-limit with no benefit just above it ("Overall limit^" under the merged delay cells),
  // a row the reading has, or an optional cover's table.
  // Another plan's column is its own: the Premium plan reads S$300 for jewellery.
  const premium = planTableRows([...rows, { ...template, column: "Premium", plan: "Premium" }], house).find((r) => /jewellery/.test(r.benefit))!;
  assert.equal(premium.figure.kind === "printed" && premium.figure.amount, 300);
});

test("a plan table's rows: the cell's own currency; never another table's heading, an optional-covers line, a label whose own cells carry a footnote, or an adult-only line (TE pr113 P3, P4, P6, P7, P8)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const TRAVEL = "aaaaaaaa-0000-0000-0000-0000000000t2";
  const plan = (lines: string[], currency = "SGD") => {
    const house: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(TRAVEL, "Travel wording.pdf", [{ page: 4, text: lines.join("\n") }])] };
    const template: ChatRow = { ...amb, id: "R901", benefit: "Overseas medical expenses", column: "Premier", plan: "Premier", docIndex: house.documents.length - 1,
      figure: { kind: "printed", amount: 300000, currency, unit: "up_to", period: null }, source: { ...amb.source, documentId: TRAVEL, page: 4, excerpt: lines[1] } };
    return planTableRows([template], house).map((r) => [r.benefit, r.figure.kind === "printed" ? r.figure.amount : null, r.figure.kind === "printed" ? r.figure.currency : null]);
  };
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tUS$150,000\tUS$300,000", "Trip cancellation\tS$5,000\tS$10,000"], "USD"), [["Trip cancellation", 10000, "SGD"]]);
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tS$150,000\tS$300,000", "Single Trip\tAnnual Trip", "Trip cancellation\tS$5,000\tS$15,000"]), []);
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tS$150,000\tS$300,000", "Optional covers (pay extra)", "Golf cover\tS$500\tS$1,000"]), []);
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses", "S$150,000\tS$300,000", "S$50,000\tS$80,000", "Emergency evacuation", "S$1,000*\tS$2,000*", "* Pre-existing conditions are excluded."]), [["Emergency evacuation", 2000, "SGD"]]);
  // A footnoted cell gives none with no footnote printed, or one that names a group, limit or share (Critic R171-1).
  for (const note of [null, "^ Limited to S$25,000 for children.", "^ Reduced to 50% for insured persons aged 70 years and above."])
    assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tS$150,000\tS$300,000", "Personal accident\tS$50,000^\tS$100,000^", ...(note ? [note] : [])]), [], String(note));
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tS$150,000\tS$300,000", "Personal accident (adult)", "S$50,000\tS$100,000"]), []);
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses\tS$150,000\tS$300,000", "Golf cover\tS$500^\tS$1,000^", "^ For Classic plan holders only."]), []);
  assert.deepEqual(plan(["Classic\tPremier", "Overseas medical expenses", "S$150,000\tS$300,000", "Personal accident", "Adult\tS$50,000\tS$100,000", "Child\tS$12,500\tS$25,000"]), []);
});

test("a plan table's per-block cells wrapped over two lines are a row for the person's column, printed as they are (overnight run 23 Oct, N106, N107)", () => {
  const amb = rows.find((r) => r.person === "Lim Ah Kow" && r.benefit === "Ambulance Cost")!;
  const TRAVEL = "aaaaaaaa-0000-0000-0000-0000000000t3";
  const made = (lines: string[], column = "Business") => {
    const house: Household = { ...HOUSE, documents: [...HOUSE.documents, doc(TRAVEL, "Travel wording.pdf", [{ page: 5, text: lines.join("\n") }])] };
    const template: ChatRow = { ...amb, id: "R902", benefit: "Trip diversion", column, plan: column, docIndex: house.documents.length - 1,
      figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "up_to", period: null }, source: { ...amb.source, documentId: TRAVEL, page: 5, excerpt: "Trip diversion\nS$500\tS$1,000\tS$1,500" } };
    return planTableRows([template], house) as ChatRow[];
  };
  const TABLE = ["Premium\tBusiness\tFirst", "Trip diversion", "S$500\tS$1,000\tS$1,500", "Travel delay", "S$100 for every\tS$50 for every\tS$50 for every",
    "Delay while overseas\tsix-hour delay\tthree-hour delay\tthree-hour delay", "S$100 for the first\tS$50 for every", "Delay while in Singapore", "six-hour delay\tthree-hour delay,",
    "only\tup to S$100", "Overall limit^\tS$300\tS$800\tS$1,500"];
  const business = made(TABLE);
  assert.deepEqual(business.map((r) => [r.benefit, r.figure]), [["Travel delay: Delay while overseas", { kind: "printed", amount: 50, currency: "SGD", unit: "per_period", period: "three-hour delay" }]]);
  assert.equal(business[0].source.excerpt, TABLE.slice(3, 6).join("\n"));
  assert.match(rowLabel(business[0]), /Travel delay: Delay while overseas.*: paid for every three-hour delay\.$/);
  assert.match(renderTable(business.map((r, i) => ({ ...r, id: `R${i}` })) as never), /S\$50 for every three-hour delay/);
  // Each plan's own cell: the first column is S$100 for every six-hour delay.
  assert.deepEqual(made(TABLE, "Premium").map((r) => r.figure), [{ kind: "printed", amount: 100, currency: "SGD", unit: "per_period", period: "six-hour delay" }]);
  // Merged cells (the Singapore delay), a cell that is not "for every", a missing length, or a name above that is not the
  // benefit's give none; nor the baggage delay's cells wrapped over five lines.
  assert.deepEqual(made(TABLE.slice(0, 4).concat(TABLE.slice(6))), []);
  assert.deepEqual(made([...TABLE.slice(0, 4), "S$100 for the first\tS$50 for every\tS$50 for every", TABLE[5]]), []);
  assert.deepEqual(made([...TABLE.slice(0, 4), TABLE[4], "Delay while overseas\tsix-hour delay\tthree-hour delay"]), []);
  assert.deepEqual(made([...TABLE.slice(0, 3), "S$100\tS$200\tS$300", TABLE[4], TABLE[5]]), []);
  assert.deepEqual(made(["Premium\tBusiness\tFirst", "Trip diversion", "S$500\tS$1,000\tS$1,500", "Baggage delay", "S$150", "S$150\tS$150", "for the first", "Delay while overseas\tfor every\tfor every", "six-hour delay", "six-hour delay\tsix-hour delay", "only"]), []);
  // A limit on the line after the two wrapped lines belongs to the cells: no row without it (Critic R186-2). A bare "$"
  // names no currency (R186-1).
  for (const next of ["up to S$1,000\tup to S$500\tup to S$800", "max S$500 per trip", "S$500\tS$800\tS$1,000", "per trip"])
    assert.deepEqual(made([...TABLE.slice(0, 6), next]), [], next);
  // Blank lines before it do not end the block, and a total or one figure per plan in one cell is part of it (TE P120-1/2).
  assert.deepEqual(made([...TABLE.slice(0, 6), "", "up to S$1,000\tup to S$500\tup to S$800"]), []);
  assert.deepEqual(made([...TABLE.slice(0, 6), "Total payable S$300 / S$600 / S$900"]), []);
  assert.equal(made([...TABLE.slice(0, 4), "$100 for every\t$50 for every\t$50 for every", TABLE[5]])[0].figure.kind === "printed" && (made([...TABLE.slice(0, 4), "$100 for every\t$50 for every\t$50 for every", TABLE[5]])[0].figure as { currency: string | null }).currency, null);
  // A period the reading names keeps its wording.
  assert.match(rowLabel({ ...business[0], figure: { kind: "printed", amount: 500, currency: "SGD", unit: "per_period", period: "month" } }), /: paid per month\.$/);
});

test("claim windows are never a waiting period or a free look; a passed deadline for one claim stays when only another claim's date is open (TE pr113 W2, W3, D4)", () => {
  const house = (text: string) => ({ ...HOUSE, documents: [doc(CERT, "x.pdf", [{ page: 1, text }])] });
  assert.deepEqual(claimWindows(house("No claim is payable for any illness that starts within 30 days of the cover start date.")), []);
  assert.deepEqual(claimWindows(house("If no claim has been made, you may cancel this policy within 14 days of receiving it.")), []);
  assert.deepEqual(claimWindows(house("upon receipt of your written notification of cancellation to us within 14 days from the date you receive your policy.")), []);
  // Real windows stay: "payable only if notice is given within", a sentence before that starts cover, forms returned (TE pr113 R9, R10).
  assert.deepEqual(claimWindows(house("Benefits are payable only if written notice of a claim is given within 30 days of the event.")), [30]);
  assert.deepEqual(claimWindows(house("Cover starts on the day of admission. Notice of a claim must be given within 30 days of discharge.")), [30]);
  assert.deepEqual(claimWindows(house("Claim forms must be completed and returned within 30 days of receiving them.")), [30]);
  const a = { summary: "", bottomLine: "The baggage claim deadline has already passed; the medical claim is still open.", statements: [], nextSteps: ["Submit the medical claim by 30/10/2026."] };
  dropLateClaims(a, new Date("2026-10-24T02:00:00Z"));
  assert.equal(a.bottomLine, "The baggage claim deadline has already passed; the medical claim is still open.");
  assert.match(datesSaidNote("he fell the day before yesterday and was admitted yesterday", new Date("2026-10-24T02:00:00Z")), /"yesterday" is 23\/10\/2026/);
});

test("claim deadlines: days said as 'yesterday' or 'N days ago' get their dates and each printed claim window's last day; a 'passed' clause goes when the answer's own deadline is open (overnight run 23 Oct, K1, N111, N118, N264)", () => {
  const now = new Date("2026-10-23T02:00:00Z");
  assert.match(datesSaidNote("josephine had a heart attack yesterday", now, [30, 120]), /"yesterday" is 22\/10\/2026, 1 day before today \(30 days after it is 21\/11\/2026, 29 days after today; 120 days after it is 19\/02\/2027, 119 days after today\)/);
  assert.match(datesSaidNote("he fell 3 days ago", now, []), /"3 days ago" is 20\/10\/2026, 3 days before today/);
  assert.match(datesSaidNote("the day before yesterday", now, []), /21\/10\/2026, 2 days before today/);
  assert.doesNotMatch(datesSaidNote("the day before yesterday", now, []), /"yesterday"/);
  assert.deepEqual(claimWindows({ ...HOUSE, documents: [doc(CERT, "x.pdf", [{ page: 1, text: "Written notice of a claim must be given within one hundred and twenty (120) days of the event.\nWaiting period of 90 days from the start." }])] }), [120]);
  const at = new Date("2026-10-24T02:00:00Z");
  const a = { summary: "", bottomLine: "The theft falls inside the trip, but the laptop is not clearly covered, and the 30-day claim window has already passed.", statements: [] as { text: string; fullText?: string }[], nextSteps: ["Claim by 31/10/2026, 7 days from today."] };
  dropLateClaims(a, at);
  assert.equal(a.bottomLine, "The theft falls inside the trip, but the laptop is not clearly covered.");
  const b = { summary: "", bottomLine: "It is covered, but the claim deadline has passed, so a claim may be refused unless FWD accepts it late.", statements: [], nextSteps: ["Claim by 30/10/2026."] };
  dropLateClaims(b, at);
  assert.equal(b.bottomLine, "It is covered.");
  const c = { summary: "", bottomLine: "Not shown.", statements: [], nextSteps: ["Claim within 30 days of the incident; a cancellation around 29/09/2026 may already be past that."] };
  dropLateClaims(c, at);
  assert.deepEqual(c.nextSteps, ["Claim within 30 days of the incident."]);
  // A date that is not a claim's last day opens no window (Critic R169-5).
  const e = { summary: "", bottomLine: "The 30-day claim window has passed: it ended on 01/09/2026.", statements: [{ text: "Your cover runs until 31/12/2026." }], nextSteps: [] };
  dropLateClaims(e, at);
  assert.equal(e.bottomLine, "The 30-day claim window has passed: it ended on 01/09/2026.");
  // A deadline that has passed, with no open date, and other periods, stay.
  for (const t of ["The 30-day claim window has passed: it ended on 01/09/2026.", "The waiting period has passed, so it can be claimed by 30/10/2026."]) {
    const d = { summary: "", bottomLine: t, statements: [], nextSteps: [] };
    dropLateClaims(d, at);
    assert.equal(d.bottomLine, t);
  }
});

test("an NRIC or FIN is masked as the certificate prints it, everywhere in the answer (overnight run 23 Oct, N291, N292)", () => {
  const a = { summary: "His NRIC is S1234567D.", statements: [{ text: "The schedule prints S1234567D", quote: "Identity Number : S1234567D" }], nextSteps: ["Quote T1234567J when you call."] };
  maskIdentityNumbers(a);
  assert.equal(a.summary, "His NRIC is S****567D.");
  assert.equal(a.statements[0].quote, "Identity Number : S****567D");
  assert.equal(a.nextSteps[0], "Quote T****567J when you call.");
  // Policy numbers and amounts are not identity numbers.
  const b = { summary: "Policy 3037850, S$1,000,000, G007500, A12345678B." };
  maskIdentityNumbers(b);
  assert.equal(b.summary, "Policy 3037850, S$1,000,000, G007500, A12345678B.");
});

test("a stay's length the latest message gives works out a daily card the model gave none for (overnight run 23 Oct, N145, N258)", () => {
  assert.equal(stayDaysSaid(["how much hospital cash would josephine get for 25 days"]), 25);
  assert.equal(stayDaysSaid(["he broke his leg skiing on 1 oct, stayed in hospital there 4 days"]), 4);
  assert.equal(stayDaysSaid(["hospitalised for 15 days"]), 15);
  // No stay, two lengths, or a claim window: none.
  assert.equal(stayDaysSaid(["claim within 30 days"]), null);
  assert.equal(stayDaysSaid(["in hospital 3 days, then admitted again for 5 days"]), null);
  // When, not how long (Critic R169-4).
  for (const q of ["admitted 10 days after the accident", "he was admitted 3 days ago", "hospitalised 2 days before the trip ended"]) assert.equal(stayDaysSaid([q]), null, q);
  // "Within N days of", and a second "for N days" elsewhere, say no one length; "for N days after" is one (TE pr113 S3, S5, S10).
  for (const q of ["he was admitted within 30 days of the trip ending", "warded in ICU for 3 days and then in the general ward for 7 days", "stayed 2 days in ICU and 5 days in the ward"]) assert.equal(stayDaysSaid([q]), null, q);
  assert.equal(stayDaysSaid(["he was hospitalised for 12 days after the fall"]), 12);
  for (const q of ["he was in hospital for 5 days, and he has 30 days to claim", "admitted for 5 days; is there a 90 days waiting period?"]) assert.equal(stayDaysSaid([q]), 5, q);
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
  const b = "Raymond pays two CI II premiums and a one-off travel premium, shown below.";
  const a = { summary: b, bottomLine: b, statements: [{ text: "Up to S$73.17", amount: { text: "S$73.17" } }, { text: "The amounts below are monthly.", amount: null }] };
  dropAmountPointers(a, ["Up to S$73.17"], true);
  assert.equal(a.bottomLine, "Raymond pays two CI II premiums and a one-off travel premium.");
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

// ------------------------------------------------------------------ an intensive-care day's own daily rate (overnight run 23 Oct, N119)
const TRIP = "aaaaaaaa-0000-0000-0000-000000000031", STAY = "aaaaaaaa-0000-0000-0000-000000000032";
const ICU_NOTE = "(Note: daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day)";
const HOUSE_ICU: Household = { ...HOUSE, documents: [...HOUSE.documents,
  doc(TRIP, "Wayfarer travel summary.pdf", [{ page: 7, text: `Protecting you and your health\tSilver\tGold\tPlatinum\nDaily hospital cash while overseas\nCapped at S$200 per day\nS$5,000\tS$8,000\tS$10,000\n${ICU_NOTE}\nEmergency phone charges\tS$100\tS$200\tS$300` }]),
  doc(STAY, "Rawat income terms.pdf", [{ page: 2, text: "Hospital Income\tRM100 per day (RM200 per day if confined in ICU)\nThe Life Assured must be confined for at least 24 hours." }]),
] };
function icuRows(o: { benefit?: string; excerpt?: string; conditions?: string[]; figure?: TableRowFigure; fromDay?: number | null; extra?: Partial<ChatRow>[]; documentId?: string; page?: number; printed?: string } = {}) {
  const t = tableWith();
  const person = t.people.find((p) => p.name === "Lim Ah Kow")!;
  const base = person.rows.find((r) => r.benefit === "Ambulance Cost")!;
  const row = { ...base, benefit: o.benefit ?? "Daily hospital cash while overseas", coverKey: "wayfarer|single trip|gold", product: "Wayfarer travel summary", cover: "Single Trip", plan: "Gold",
    conditions: o.conditions ?? ["Capped at S$200 per day", ICU_NOTE], fromDay: o.fromDay ?? null, maxDays: null,
    figure: o.figure ?? { kind: "printed" as const, amount: 8000, currency: "SGD", unit: "up_to" as const, period: null },
    source: { documentId: o.documentId ?? TRIP, document: "Wayfarer travel summary.pdf", page: o.page ?? 7, excerpt: o.excerpt ?? "Capped at S$200 per day\nS$5,000\tS$8,000\tS$10,000" } };
  const extra = (o.extra ?? []).map((x) => ({ ...row, ...x }));
  // Words printed on the travel page too, so a clause is refused for its words and not only for not being found.
  const house = o.printed ? { ...HOUSE_ICU, documents: HOUSE_ICU.documents.map((d) => d.policyId === TRIP ? { ...d, pages: d.pages.map((p) => ({ ...p, text: `${p.text}\n${o.printed}` })) } : d) } : HOUSE_ICU;
  return chatRows({ ...t, people: t.people.map((p) => p === person ? { ...p, rows: [...p.rows, row, ...extra] as typeof p.rows } : p) }, house);
}
type TableRowFigure = ChatRow["figure"];
const icuOf = (rs: ChatRow[]) => rs.filter((r) => /intensive care$/.test(r.benefit)).map((r) => [r.person, r.benefit, r.figure.kind === "printed" ? [r.figure.amount, r.figure.currency, r.figure.unit] : null, r.source.page]);
test("a daily cash whose own note prints an intensive-care rate gives that rate as a row of its own, named for intensive care, last (N119)", () => {
  const plain = icuRows({ conditions: [] });
  const rs = icuRows();
  assert.deepEqual(icuOf(rs), [["Lim Ah Kow", "Daily hospital cash while overseas in intensive care", [400, "SGD", "per_day"], 7]]);
  // One row only, though the limit and its own daily rate both carry the note; every other row keeps its number.
  assert.equal(rs.length, plain.length + 1);
  assert.deepEqual(rs.slice(0, plain.length).map((r) => [r.id, r.benefit]), plain.map((r) => [r.id, r.benefit]));
  assert.equal(rs.at(-1)!.benefit, "Daily hospital cash while overseas in intensive care");
  // The clause is the row's own condition, so "doubled ..., capped at" goes with the figure (R265 M1).
  assert.deepEqual(rs.at(-1)!.conditions, ["daily income amount will be doubled if hospitalised in intensive care, capped at S$400 per day"]);
  // The limit and its daily rate are unchanged.
  assert.deepEqual(rs.filter((r) => r.benefit === "Daily hospital cash while overseas").map((r) => r.figure.kind === "printed" ? [r.figure.amount, r.figure.unit] : null), [[8000, "up_to"], [200, "per_day"]]);
  assert.match(renderTable(rs), /Daily hospital cash while overseas in intensive care \| S\$400 a day \| conditions: daily income amount will be doubled if hospitalised in\s+intensive care, capped at S\$400 per day \| D\d+ page 7/);
  // Another market: a rate printed in brackets in the row's own line ("RM200 per day if confined in ICU").
  const myr = icuRows({ documentId: STAY, page: 2, benefit: "Hospital Income", conditions: [], excerpt: "Hospital Income\tRM100 per day (RM200 per day if confined in ICU)",
    figure: { kind: "printed", amount: 100, currency: "MYR", unit: "per_day", period: null } });
  assert.deepEqual(icuOf(myr), [["Lim Ah Kow", "Hospital Income in intensive care", [200, "MYR", "per_day"], 2]]);
});
test("an intensive-care rate gives no row unless its words are provably only that rate (N119 negative controls)", () => {
  const none = (o: Parameters<typeof icuRows>[0], why: string) => assert.deepEqual(icuOf(icuRows(o)), [], why);
  // No figure (only "doubled"), two figures, a figure not paid per day, a day count, an age, a group, a "not", an excess.
  for (const note of ["(Note: daily income amount will be doubled if hospitalised in intensive care)",
    "S$200 per day or S$400 per day in intensive care", "S$400 per admission in intensive care", "S$400 in total for intensive care",
    "capped at S$400 per day in intensive care, for at most 10 days", "S$400 per day in intensive care from the 3rd day",
    "S$400 per day in intensive care for insured persons aged 70 and above", "S$400 per day in intensive care for children only",
    "S$400 per day in intensive care is not payable for pre-existing conditions", "S$400 per day in intensive care, less an excess",
    "S$400 per day for a companion while in intensive care", "S$400 per day in a private ward",
    // The base rate is never the ICU day's: a figure before "doubled", or with no cap word between them (Critic R265 H1).
    "Daily hospital cash S$200 per day, doubled in ICU", "Daily hospital cash S$100 per day doubled if hospitalised in intensive care",
    "S$150 per day, double if in ICU", "S$200 per day, twice this amount in ICU", "doubled in ICU to S$400 per day",
    // "or" leaves which applies unsure.
    "S$400 per day in ICU or the daily amount"])
    none({ conditions: [note], printed: note }, note);
  // Each of those clauses is refused for its words: with the words left out that make it unsure, it gives the row.
  assert.equal(icuOf(icuRows({ conditions: ["capped at S$400 per day in intensive care"], printed: "capped at S$400 per day in intensive care" })).length, 1);
  // Each check on its own: a number of days in known words, a figure not paid per day in known words.
  assert.equal(intensiveCareRateOf("S$400 per day in intensive care for 5 day"), null);
  assert.equal(intensiveCareRateOf("S$400 in intensive care"), null);
  assert.equal(intensiveCareRateOf("S$400 per day in the hospital"), null);
  assert.deepEqual(intensiveCareRateOf("S$400 per day in ICU"), { amount: 400, currency: "SGD", doubled: false });
  // A bare "$" names no currency.
  assert.deepEqual(intensiveCareRateOf("$400 per day in ICU"), { amount: 400, currency: null, doubled: false });
  // "Doubled ..., capped at S$400" is an ICU day's figure only when twice the row's own daily rate reaches the cap: at S$120 a
  // day an ICU day is S$240, not S$400; with no daily rate (only the limit) it is unknown (TE pr154 F1). At S$250 it is the cap.
  none({ excerpt: "Capped at S$120 per day\nS$5,000\tS$8,000\tS$10,000" }, "rate S$120, cap S$400");
  none({ excerpt: "S$5,000\tS$8,000\tS$10,000" }, "no daily rate");
  assert.deepEqual(icuOf(icuRows({ excerpt: "Capped at S$250 per day\nS$5,000\tS$8,000\tS$10,000" })).map((r) => r[2]), [[400, "SGD", "per_day"]]);
  // A daily rate in another currency, or a bare "$" cap, says nothing about the cap (Critic R268).
  none({ excerpt: "Capped at US$300 per day\nS$5,000\tS$8,000\tS$10,000" }, "rate in US$");
  // A place word narrows the rate unless the benefit's own name says it (TE pr154 F2).
  const abroad = "S$300 per day if hospitalised overseas in ICU";
  none({ benefit: "Hospital cash", conditions: [abroad], printed: abroad }, "overseas, not in the name");
  assert.equal(icuOf(icuRows({ benefit: "Hospital cash overseas", conditions: [abroad], printed: abroad })).length, 1);
  // A clause that is not printed in the row's own document (only in another one) gives none.
  none({ conditions: ["RM200 per day if confined in ICU"] }, "printed in another document");
  none({ conditions: ["capped at S$450 per day in intensive care"] }, "not printed at all");
  // A row with a day rule of its own (it might hold for an ICU day too), or a row that is itself for intensive care.
  none({ fromDay: 11 }, "first paid day");
  none({ excerpt: "Capped at S$200 per day from the 11th day\nS$5,000\tS$8,000\tS$10,000" }, "day rule in the quote");
  none({ benefit: "ICU daily cash" }, "row for intensive care");
  // A rate the person's rows already give for that cover.
  none({ extra: [{ benefit: "Intensive care daily cash", conditions: [], figure: { kind: "printed", amount: 400, currency: "SGD", unit: "per_day", period: null } }] }, "already a row");
  // A row with no figure.
  none({ figure: { kind: "none", why: "no figure printed" } }, "no figure");
});
test("an intensive-care rate card says intensive care, gives the printed rate as a limit, and is never worked out over a stay (N119)", () => {
  const rs = icuRows();
  const icu = rs.find((r) => /intensive care$/.test(r.benefit))!;
  const ask = (row: string, asked: string[]) => {
    const raw = { bottomLine: "b", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null, percentOf: null,
      conditions: [{ text: "Doubled for intensive care, capped at S$400 per day", quote: ICU_NOTE }], alternativeGroup: null, perDay: { stayDays: 3 }, ofBill: null, row, eventFit: "any_event" }] };
    const fromRows = amountsFromRows(raw, rs, HOUSE_ICU);
    const { answer: a } = verifyAnswer(HOUSE_ICU, readModelAnswer(fromRows.json)!, asked, new Set(fromRows.report.labels));
    return keepLabelledAmounts(a.statements ?? [], fromRows.report).kept.filter((s) => s.amount);
  };
  const cards = ask(icu.id, ["he was in ICU for one of those days", "he was hospitalised overseas for 3 days"]);
  assert.deepEqual(cards.map((s) => [s.personName, s.amount!.text]), [["Lim Ah Kow", "Up to S$400"]]);
  assert.match(cards[0].text, /^Daily hospital cash while overseas in intensive care \(.*\): paid per day\.$/);
  // The base daily rate is still the base rate, with no intensive-care words.
  const daily = rs.find((r) => r.benefit === "Daily hospital cash while overseas" && r.figure.kind === "printed" && r.figure.unit === "per_day")!;
  const base = ask(daily.id, ["he was hospitalised overseas for 3 days"]);
  assert.deepEqual(base.map((s) => s.amount!.text), ["Up to S$200"]);
  assert.ok(!/intensive/i.test(base[0].text));
});

test("a limit's daily rate keeps its own printed currency; a rate in another currency gives no row (Critic R272)", () => {
  const t = tableWith();
  const person = t.people.find((p) => p.name === "Lim Ah Kow")!;
  const amb = person.rows.find((r) => r.benefit === "Ambulance Cost")!;
  const dailyOf = (excerpt: string, currency: string) => chatRows({ ...t, people: t.people.map((p) => p === person ? { ...p, rows: [...p.rows, { ...amb, benefit: "Daily cash",
    source: { ...amb.source, excerpt }, figure: { kind: "printed" as const, amount: 8000, currency, unit: "up_to" as const, period: null } }] } : p) }, HOUSE)
    .filter((r) => r.benefit === "Daily cash" && r.figure.kind === "printed" && r.figure.unit === "per_day").map((r) => r.figure.kind === "printed" ? [r.figure.amount, r.figure.currency] : null);
  // The same layout in four markets: each rate in its own currency.
  assert.deepEqual(dailyOf("Capped at S$200 per day\nS$8,000", "SGD"), [[200, "SGD"]]);
  assert.deepEqual(dailyOf("Capped at RM200 per day\nRM8,000", "MYR"), [[200, "MYR"]]);
  assert.deepEqual(dailyOf("Capped at £200 per day\n£8,000", "GBP"), [[200, "GBP"]]);
  assert.deepEqual(dailyOf("Capped at US$200 per day\nUS$8,000", "USD"), [[200, "USD"]]);
  // A rate printed in another currency than its limit is not that limit's rate.
  assert.deepEqual(dailyOf("Capped at US$300 per day\nS$8,000", "SGD"), []);
  assert.deepEqual(dailyOf("Capped at RM300 per day\n£8,000", "GBP"), []);
  // A bare "$" rate states no currency: it never borrows the limit's.
  assert.deepEqual(dailyOf("Capped at $200 per day\nS$8,000", "SGD"), [[200, null]]);
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
  // The word alone, as people type it, and "hubby"/"wifey" (overnight run 23 Oct, N224, N226); the note quotes what was said.
  assert.deepEqual(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["husband kena fracture leg, claim how much ah"]), { word: "husband", member: "Lim Ah Kow", printed: "Mr Lim Ah Kow" });
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["hubby got cancer what to do"])?.word, "hubby");
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["Husband warded 3 days"])?.member, "Lim Ah Kow");
  assert.equal(spouseMeant(titled("Dear Mrs Tan Mei Ling,"), ["wifey fell down"])?.member, "Tan Mei Ling");
  for (const t of ["my wife kena dengue", "if wife hospitalised can claim", "husband and I both covered?", "Husband warded at SGH, how much?", "my hubby, he fell"])
    assert.ok(spouseMeant(titled("Life Assured : Mr Lim Ah Kow\nDear Mrs Tan Mei Ling,"), [t]), t);
  // Someone else's spouse, a pair, or no one in particular settles nothing.
  for (const t of ["her husband was in hospital", "my sister's husband", "my friend husband kena accident", "my bro wife warded", "her hubby", "my ex-husband", "my ex husband", "can a husband claim", "are husband and wife both covered", "housewife cover", "your husband",
    // Critic R184-1: other people's spouses, however they are written, and a question about someone else.
    "my sis husband got cancer", "my sister-in-law husband", "kakak husband kena accident", "jie jie husband", "my client wife", "my bf wife", "my gf husband",
    "husband of my colleague died", "husband mother warded", "husband-and-wife plan", "my husband's mum got stroke",
    // TE P117-1: a spouse's relative, or someone else's spouse.
    "husband's mum got stroke", "hubby mum warded", "husband brother kena dengue", "wife sister got accident", "wifey's grandma", "husband of my sister kena accident",
    "my friends wife warded", "sister in law husband", "my sis-in-law's husband", "the husband in the policy", "my wife's dad fell", "husband's son warded",
    // Critic R190-2/3: after a possessive, anyone but the spouse; and the word after is not read past.
    "my husband's niece warded", "my husband's uncle", "my husband's maid fell", "my husband's children", "my husband's friend's car", "my husband's goddaughter",
    "my wife's nephew", "my wife's aunt", "my wife's helper", "my wife's kids", "my wife's brother-in-law", "my wife's stepdaughter", "my husband's first wife"])
    assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), [t]), null, t);
  // The spouse's own possessive is about the spouse (TE P117-2).
  for (const t of ["my husband's policy", "my wife's claim got rejected", "my hubby's hospital bill", "husband's cover for cancer", "my wife's hospital plan", "husband's claim how",
    "is this my husband's?", "my husband kena fracture"])
    assert.ok(spouseMeant(titled("Life Assured : Mr Lim Ah Kow\nDear Mrs Tan Mei Ling,"), [t]), t);
  // An insurer or product counts when it is one of this household's own: nothing names any insurer in the code, so any
  // household anywhere is read the same way (DC, 25 Oct: built for every account, not one).
  const insured = (insurer: string, productName: string): Household => {
    const h = titled("Life Assured : Mr Lim Ah Kow\nDear Mrs Tan Mei Ling,");
    return { ...h, documents: h.documents.map((d, i) => i === h.documents.length - 1 ? { ...d, insurer, productName } : d) };
  };
  assert.ok(spouseMeant(insured("Zurich Life", "Zurich Term"), ["hubby's Zurich"]), "the household's own insurer");
  assert.ok(spouseMeant(insured("Example Assurance", "CareFirst Health"), ["my wife's CareFirst Health plan"]), "the household's own product, by its whole name");
  assert.equal(spouseMeant(insured("Example Assurance", "CareFirst Health"), ["my wife's CareFirst plan"]), null, "part of a product name settles nothing: the chat asks who");
  assert.equal(spouseMeant(insured("Example Assurance", "Family Protect Plan"), ["my husband's family claim"]), null, "a product's first word is ordinary English");
  assert.equal(spouseMeant(insured("Zurich Life", "Zurich Term"), ["hubby's Allianz"]), null, "an insurer this household has no document from settles nothing");
  // A product's words that name a person or their family never make a possessive the spouse's own (Critic R207-1, TE P117-4).
  for (const [product, said] of [["Family Care Plan", "my wife's family has cancer history, covered?"], ["Family Protect Plan", "my husband's family got history of stroke"],
    ["Mother & Child Care", "my wife's mother warded, can claim?"], ["Kids First Savings", "my husband's kids from before, covered?"], ["Kids First Savings", "my husband's first wife"]])
    assert.equal(spouseMeant(insured("Example Assurance", product), [said]), null, `${product}: ${said}`);
  assert.ok(spouseMeant(insured("Example Assurance", "Home Care Plan"), ["my wife's Home Care Plan claim"]), "the product's whole name counts");
  // No single word of a product name counts on its own: they are ordinary English (TE P117-5).
  for (const [insurer, product, said] of [["Example Assurance", "Domestic Helper Insurance", "my wife's domestic helper was hospitalised"], ["Example Life", "Elderly Care Plan", "my husband's elderly father has cancer"],
    ["Example General", "Group Employee Benefits", "my husband's employee got injured"], ["Example Life", "Caregiver Rider", "my wife's caregiver hurt her back"],
    ["Example General", "Business Partner Cover", "my husband's business partner died"], ["Great Example", "Term Plan", "my husband's great aunt has cancer"]])
    assert.equal(spouseMeant(insured(insurer, product), [said]), null, said);
  assert.ok(spouseMeant(insured("Great Example", "Term Plan"), ["my husband's Great Example policy"]), "a whole insurer name counts");
  // A whole name counts only when the clause ends or a cover word follows it; a relative's word never does (TE P117-6).
  assert.equal(spouseMeant(insured("Example General", "Business Partner"), ["my husband's business partner died"]), null);
  assert.ok(spouseMeant(insured("Example General", "Business Partner"), ["my husband's Business Partner claim"]));
  for (const said of ["my wife's family health history includes cancer", "my husband's family medical history"])
    assert.equal(spouseMeant(insured("Family Life Insurance Company", "Term Plan"), [said]), null, said);
  // An insurer counts by its own name in full, without the words that only say what it is or where (TE P117-7).
  for (const said of ["my husband's friends medical bills are high", "my husband's friends hospital stay"])
    assert.equal(spouseMeant(insured("Friends Provident International", "Term Plan"), [said]), null, said);
  for (const [insurer, said] of [["Kestrel Provident International", "my husband's Kestrel Provident policy"], ["Great Example Life Insurance", "my husband's Great Example policy"],
    ["AIA Singapore Private Limited", "my husband's AIA plan"], ["Zurich Life Insurance Company Ltd", "hubby's Zurich"]])
    assert.ok(spouseMeant(insured(insurer, "Term Plan"), [said]), `${insurer}: ${said}`);
  // A word for a person right after the possessive is about that person, whatever cover shares it: such a name asks who (TE P117-8).
  for (const [insurer, product, said] of [["Example Assurance", "Family", "my wife's family medical history"], ["Partners Life", "Term Plan", "my husband's partners hospital bill"],
    ["Friends Provident International", "Term Plan", "my husband's Friends Provident policy"], ["Family Life Insurance Company", "Term Plan", "my husband's Family Life policy"]])
    assert.equal(spouseMeant(insured(insurer, product), [said]), null, said);
  assert.ok(spouseMeant(insured("Zurich Life", "Zurich Term"), ["hubby's Zurich, does it pay?"]), "an insurer's first word, then a clause");
  // A later word that is the person's own still counts after someone else's.
  assert.equal(spouseMeant(titled("Life Assured : Mr Lim Ah Kow"), ["her husband has AIA, my husband?"])?.word, "my husband");
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

test("library groups: the same people in any order are one group, and a replaced file is not listed (Critic R224, TE N1 N2)", () => {
  const d = (name: string, people: string[], o: Record<string, unknown> = {}) => ({ ...doc(`id-${name}`, name, [{ page: 1, text: "x" }]), linkedPeople: people, ...o });
  const docs = [d("A.pdf", ["Lim Ah Kow", "Tan Mei Ling"]), d("B.pdf", ["Tan Mei Ling", "Lim Ah Kow"]), d("Old.pdf", ["Lim Ah Kow", "Tan Mei Ling"], { supersededAt: "2026-09-02" })];
  const house = { ...HOUSE, documents: docs } as Household;
  const lines = libraryGroups(house, docs as Household["documents"]);
  assert.equal(lines.length, 1, lines.join(" | "));
  assert.match(lines[0], /^Linked to Lim Ah Kow and Tan Mei Ling, 2 documents, all read/);
  assert.doesNotMatch(lines[0], /Old\.pdf/);
});

// ------------------------------------------------------------------ a premium's parts, and a clause's total limit (overnight run 23 Oct, N087, N088, N092)
const PARTS_DOC = "aaaaaaaa-0000-0000-0000-0000000000p1", LIMIT_DOC = "aaaaaaaa-0000-0000-0000-0000000000p2";
// A made-up schedule in the shape of a CI plan's: the benefit's own premium on its line, an extra charged on it below.
const PARTS_SCHED = (o: { extra?: string; currency?: string; sum?: string } = {}) => "Policy Schedule\nAssured\t: Lim Ah Kow\nFirst Year Instalment Premium * : 300.00\n"
  + `: ${o.currency ?? "Singapore Dollar"}\nInstalment Premium\t: 350.50\tCurrency\nPayment Frequency\t: Monthly\n`
  + "Basic Benefits\tSum\tInstalment\tPremium\tBenefit\tBenefit\nAssured/\tPremium\tCessation\tCommencement\tCessation\nBenefit\tDate\tDate\tDate\n"
  + `Critical Illness Cover\t${o.sum ?? "200,000.00"}\t250.25\t01/10/2036\t01/10/2026\t01/10/2036\nPlus\n${o.extra ?? "- Occupation Extra\t---\t100.25\t01/10/2036\t---\t---"}\nDeath Benefit\t10,000.00\t---\t---\t01/10/2026\t01/10/2036`;
const partsHouse = (sched: string, wording = ""): Household => ({ ...HOUSE, documents: [
  doc(PARTS_DOC, "Schedule.pdf", [{ page: 1, text: sched }]),
  ...(wording ? [doc(LIMIT_DOC, "Wording.pdf", [{ page: 4, text: wording }])] : []),
] });
const partsCover = { person: "Lim Ah Kow", product: "CI Plan", cover: "Critical Illness Cover", plan: null, sumInsured: 200000, asOf: "01/10/2026", page: 1, quote: "Critical Illness Cover\t200,000.00\t250.25\t01/10/2036" };
const ciKey = coverKeyOf({ product: "CI Plan", cover: "Critical Illness Cover", plan: null });
const currencyOf = (r: ChatRow) => (r.figure.kind === "none" ? null : r.figure.currency);
function partsAnswer(house: Household, statements: Record<string, unknown>[], benefits: unknown[] = [], cover: Record<string, unknown> = partsCover, question = "") {
  const sched = checkReading(src(house.documents[0]), reading("personal_proof", "CI Plan", [cover], []));
  const readings = [sched];
  if (house.documents[1]) readings.push(checkReading(src(house.documents[1]), reading("policy_wording", "CI Plan", [], benefits)));
  const t = assembleTable(readings, family, house.documents[1] ? [{ section: sectionKeyOf(LIMIT_DOC, { section: "Benefits", column: null }), cover: ciKey, why: "the plan's wording" }] : []);
  const rs = chatRows(t, house);
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: statements.map((st) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, eventFit: "no_event", ...st, ...(typeof st.row === "function" ? { row: (st.row as (r: typeof rs) => string)(rs) } : {}) })) };
  const fromRows = amountsFromRows(raw, rs, house, new Date(), question);
  const { answer: a } = verifyAnswer(house, readModelAnswer(fromRows.json)!, [question || "how much"], new Set(fromRows.report.labels));
  const { kept } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  return { rows: rs, cover: sched.covers[0], amounts: kept.filter((x) => x.amount).map((x) => x.amount!.text), kept, report: fromRows.report };
}
test("a premium's parts on the schedule line are rows of their own, after every other row (N088, N092)", () => {
  const r = partsAnswer(partsHouse(PARTS_SCHED()), [{ row: rowNamed(/^Occupation Extra/), text: "Extra." }, { row: rowNamed(/^Premium for/), text: "Basic." }]);
  assert.deepEqual(r.cover.premiumParts?.map((x) => [x.label, x.amount]), [[null, 250.25], ["Occupation Extra", 100.25]]);
  assert.deepEqual(r.rows.slice(-2).map((x) => x.benefit), ["Premium for Critical Illness Cover, Monthly (part of the Instalment Premium; the first policy year's premium is different)",
    "Occupation Extra (premium), Monthly (part of the Instalment Premium; the first policy year's premium is different)"]);
  // The rows before them keep their numbers: the premium and the first-year premium come first, as on main.
  assert.ok(r.rows.findIndex((x) => /^First Year/.test(x.benefit)) < r.rows.findIndex((x) => /^Premium for/.test(x.benefit)));
  assert.deepEqual(r.amounts, ["S$100.25", "S$250.25"]);
  // Each part is printed on its own line, in the schedule's currency.
  assert.match(r.rows.at(-1)!.source.excerpt, /Occupation Extra --- 100\.25/);
  assert.equal(currencyOf(r.rows.at(-1)!), "SGD");
});
test("a premium's parts are given in any currency the schedule settles (parity)", () => {
  const r = partsAnswer(partsHouse(PARTS_SCHED({ currency: "Ringgit Malaysia" })), [{ row: rowNamed(/^Occupation Extra/), text: "Extra." }]);
  assert.equal(currencyOf(r.rows.at(-1)!), r.cover.premiumCurrency ?? r.cover.currency);
  assert.notEqual(r.cover.premiumCurrency, "SGD");
});
test("no parts unless they plainly add up to the premium, from the cover's own one line", () => {
  const none = (sched: string, why: string, cover = partsCover) => assert.equal(partsAnswer(partsHouse(sched), [], [], cover).cover.premiumParts ?? null, null, why);
  none(PARTS_SCHED({ extra: "- Occupation Extra\t---\t99.25\t01/10/2036\t---\t---" }), "parts that do not add up");
  none(PARTS_SCHED({ extra: "- Occupation Extra\t50,000.00\t100.25\t01/10/2036\t---\t---" }), "a part that prints a sum");
  none(PARTS_SCHED({ extra: "- Occupation Extra\t---\t60.25\t40.00\t---\t---" }), "a part with two premium-like cells");
  none(PARTS_SCHED({ extra: "Occupation Extra\t---\t100.25\t01/10/2036\t---\t---" }), "a line with no dash is another row");
  none(PARTS_SCHED() + "\nRider\t200,000.00\t12.00\t-\t-\t-", "the sum printed on two lines");
  none(PARTS_SCHED({ extra: "Plus more words" }), "no extra line at all");
  // Another member on the page: never read.
  none(PARTS_SCHED() + "\nSpouse\t: Tan Mei Ling", "another life on the page");
});
const LIMIT_WORDING = (limit: string, next = "2.3. Intensive Care Benefit\nAn additional 20% of the Sum Assured is payable.") => "2. BENEFITS\n2.1. Death Benefit\nWe will pay S$10,000 on death.\n"
  + "2.2. Critical Illness Benefit\n100% of the Sum Assured will be payable in one lump sum.\ni.\tThe Life Assured survives at least 7 days.\n"
  + `${limit}\nRefer to Appendix A for the list.\n${next}`;
const TOTAL = "The most We will pay in total for all Early Stage Critical Illness claims under this Policy and\nall Policies covering the same Life Assured shall not exceed S$800,000 (or equivalent currency).";
const ciRow = { section: "Benefits", benefit: "Critical Illness Benefit", pays: "percent", value: 100, percentOf: "sum_insured", page: 4, quote: "100% of the Sum Assured will be payable in one lump sum." };
const limitRow = (rs: ChatRow[]) => rs.find((x) => /^Limit in total/.test(x.benefit))?.id ?? "R99";
test("a clause's printed total limit is a row of its own, shown when asked with no event (N087)", () => {
  const r = partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(TOTAL)), [{ row: limitRow, text: "The most in total." }], [b(ciRow)]);
  const row = r.rows.find((x) => /^Limit in total/.test(x.benefit))!;
  assert.equal(row.benefit, "Limit in total on Critical Illness Benefit claims");
  assert.equal(row.combinedLimit, true);
  assert.deepEqual(row.conditions, ["The most We will pay in total for all Early Stage Critical Illness claims under this Policy and all Policies covering the same Life Assured"]);
  assert.equal(row.source.excerpt, TOTAL);
  assert.equal(r.rows.at(-1), row, "after every other row");
  assert.deepEqual(r.amounts, ["S$800,000"]);
  // The benefit named in the plural ("Critical Illnesses claims", as printed) is still the row's benefit.
  assert.equal(partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(TOTAL.replace("Critical Illness claims", "Critical Illnesses claims"))), [], [b(ciRow)]).rows.filter((x) => /^Limit in total/.test(x.benefit)).length, 1, "plural");
  // A sentence in capitals with a full stop is no heading: the clause goes on past it.
  assert.equal(partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(`THIS BENEFIT ENDS ON PAYMENT.\n${TOTAL}`)), [], [b(ciRow)]).rows.filter((x) => /^Limit in total/.test(x.benefit)).length, 1, "capitals sentence");
  // The card says what the limit is for, though the model gave no condition.
  const card = r.kept.find((x) => x.amount?.text === "S$800,000")!;
  assert.ok(JSON.stringify(card).includes("for all Early Stage Critical Illness claims"), JSON.stringify(card));
});
test("a total limit is never what an event pays", () => {
  const r = partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(TOTAL)), [{ row: limitRow, text: "Paid.", eventFit: "on_list" }], [b(ciRow)]);
  assert.deepEqual(r.amounts, []);
  assert.match(r.report.dropped.map((d) => d.why).join(" "), /most paid for several benefits together/);
});
test("a total limit in ringgit or pounds is read the same way (parity)", () => {
  for (const [fig, code] of [["RM 800,000", "MYR"], ["£800,000", "GBP"], ["SGD 800,000", "SGD"]]) {
    const r = partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(TOTAL.replace("S$800,000", fig))), [], [b(ciRow)]);
    const row = r.rows.find((x) => /^Limit in total/.test(x.benefit));
    assert.equal(row?.figure.kind === "printed" && row.figure.currency, code, fig);
  }
});
test("no total limit row unless the clause plainly prints one total in a stated currency for the row's own benefit", () => {
  const none = (wording: string, why: string, row: Record<string, unknown> = ciRow) =>
    assert.equal(partsAnswer(partsHouse(PARTS_SCHED(), wording), [], [b(row)]).rows.filter((x) => /^Limit in total/.test(x.benefit)).length, 0, why);
  none(LIMIT_WORDING(TOTAL.replace("S$800,000", "$800,000")), "a bare $ names no currency");
  none(LIMIT_WORDING(TOTAL.replace("claims under", "claims for children under")), "a total for some insured persons");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000", "S$800,000 or S$400,000 after age 65")), "two figures");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000", "50% of the Sum Assured")), "a share, no figure");
  none(LIMIT_WORDING("The amount payable for each claim shall not exceed S$800,000."), "no word says it is a total");
  none(LIMIT_WORDING("We will pay S$800,000 in one lump sum for all Early Stage claims under all Policies covering the same Life Assured."), "no limit wording");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000 per year")), "a total for each period");
  none(LIMIT_WORDING(TOTAL.replace("in total for all", "in total for any one claim among all")), "a limit for each claim");
  none(LIMIT_WORDING(TOTAL.replace("in total for all Early Stage Critical Illness claims", "in total for any one Early Stage Critical Illness claim")), "a limit for any one named claim (TE P155 F3)");
  // A scale word after the figure, or words after it that can change the limit (TE P155 F1, F2).
  none(LIMIT_WORDING(TOTAL.replace("S$800,000", "S$1 million")), "a figure in millions");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000", "the higher of S$800,000 and the Sum Insured")), "the higher of");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000 or the Sum Insured, whichever is lower")), "whichever is lower");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000, less any amount already paid")), "less any amount paid");
  // Another benefit's limit printed in the clause, after an unnumbered heading, or naming no benefit (Critic R270 H1).
  const DEATH_TOTAL = "The most We will pay in total for all Accidental Death claims under all Policies covering the same Life Assured shall not exceed S$300,000.";
  none(LIMIT_WORDING(DEATH_TOTAL), "another benefit's total in the clause");
  none(LIMIT_WORDING("", `GENERAL PROVISIONS\n${TOTAL}`), "a total after an unnumbered heading");
  none(LIMIT_WORDING("", `Appendix B\n${TOTAL}`), "a total in an appendix");
  none(LIMIT_WORDING("The maximum total amount payable under all policies for the same life shall not exceed S$300,000."), "a total naming no benefit");
  // "this Basic Benefit" may be a wider benefit than the row's (a plan's basic benefit holds several): it names no row.
  none(LIMIT_WORDING("The most We will pay in total for all claims under this Basic Benefit and all Policies covering the same Life Assured shall not exceed S$300,000."), "this basic benefit");
  assert.equal(partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING("The most We will pay in total for all claims under this benefit and all Policies covering the same Life Assured shall not exceed S$300,000.")), [], [b(ciRow)]).rows.filter((x) => /^Limit in total/.test(x.benefit)).length, 1, "this benefit, in its own clause");
  none(LIMIT_WORDING("The most We will pay in total for all Critical Illness and Death Benefit claims under all Policies covering the same Life Assured shall not exceed S$300,000."), "a total shared with another heading's benefit");
  // Words after the figure (Critic R270 M1).
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000 less any amount already paid under the Death Benefit")), "less an amount paid");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000, or the Sum Assured if that is lower")), "or the sum assured if lower");
  none(LIMIT_WORDING(TOTAL.replace("S$800,000 (or equivalent currency)", "S$800,000, reduced by any Early Stage payment made before age sixty-five")), "reduced by a payment");
  // The limit printed under the next heading is that benefit's, never the critical illness row's.
  none(LIMIT_WORDING("", `2.3. Intensive Care Benefit\n${TOTAL}`), "another clause's limit");
  // A heading that does not name the row's benefit: its limit is not the row's.
  none(LIMIT_WORDING(TOTAL).replace("2.2. Critical Illness Benefit", "2.2. Special Benefit"), "a heading naming another benefit");
  // The row's own cap said again adds nothing.
  none(LIMIT_WORDING("The most We will pay in total under this benefit and all Policies covering the same Life Assured shall not exceed S$25,000.").replace("will be payable in one lump sum.", "will be payable, subject to a maximum amount of S$25,000."),
    "the row's own cap", { ...ciRow, quote: "100% of the Sum Assured will be payable, subject to a maximum amount of S$25,000." });
});

// A question that asks for the most paid for everything together gets the printed total limit, said as a limit with what
// it is printed for; a question about an event never does, however it is worded (chat-speed run 3 Nov, S4).
test("asked for the most paid in total, the clause's total limit is shown as a limit; an event question never gets it", () => {
  // For an event fit the answer also gives the per-claim benefit: a limit given alone is never kept (Critic #312 M1).
  const ask = (question: string, eventFit: string, limit = TOTAL, perClaim = eventFit !== "no_event") => partsAnswer(partsHouse(PARTS_SCHED(), LIMIT_WORDING(limit)),
    [{ row: limitRow, text: "The most in total.", eventFit }, ...(perClaim ? [{ row: rowNamed(/^Critical Illness Benefit$/), text: "Each claim.", eventFit }] : [])], [b(ciRow)], partsCover, question);
  const shows = (r: ReturnType<typeof ask>, amount = "S$800,000") => r.amounts.some((a) => a.replace(/\s/g, "") === amount.replace(/\s/g, ""));
  for (const question of [
    "if I claim for two different early stage illnesses over the years, what's the most the plan will pay in total?",
    "Is there an overall cap on all my critical illness claims?",
    "What is the maximum payable across all my policies?",
    "what's the most my plan pays for all claims combined?",
    "is there a lifetime limit on this plan?",
    "if I claim for two different early stage illnesses over the years, what's the most it pays?",
    "if I make several claims, what is the maximum the plan pays?",
    "每次多次理赔最多赔多少？",
    "Si je fais plusieurs réclamations, quel est le maximum ?",
    "Si hago varias reclamaciones, ¿cuál es el máximo?",
    "what's the most my total and permanent disability cover pays over the years for all my claims?",
    "berapa jumlah maksimum yang dibayar untuk semua tuntutan?",
    "Apakah had maksimum seumur hidup?",
    "所有重疾理赔总共最多赔多少？",
    "我的保险终身最高赔付总额是多少？",
    "Quel est le plafond global de mes remboursements ?",
    "¿Cuál es el tope acumulado de todas mis reclamaciones?",
  ]) for (const fit of ["on_list", "any_event", "no_event"]) {
    const r = ask(question, fit);
    assert.ok(shows(r), `${fit}: ${question} ${JSON.stringify(r.amounts)} ${JSON.stringify(r.report.dropped)}`);
    const card = r.kept.find((x) => x.amount && /^Limit in total/.test(x.text))!;
    assert.match(card.text, /^Limit in total on Critical Illness Benefit claims/, question);
    assert.ok(JSON.stringify(card).includes("The most We will pay in total for all Early Stage Critical Illness claims"), `the card says what the limit is for: ${question}`);
  }
  // In other currencies the figure is the printed one.
  for (const [from, to, shown] of [["S$800,000", "RM800,000", "RM800,000"], ["S$800,000", "£800,000", "£800,000"]] as const) {
    const r = ask("what's the most it pays over the years?", "on_list", TOTAL.replace(from, to));
    assert.ok(r.amounts.some((a) => a.replace(/\s/g, "").includes(shown.replace("RM", ""))), `${to}: ${JSON.stringify(r.amounts)} ${JSON.stringify(r.report.dropped)}`);
  }
  // Negative controls: an event (also asked with most and total words, in any language), a sum of payouts, a most for
  // one event, or a cover's name holding "total", is never answered with the total (TE #312).
  for (const question of [
    "I was just diagnosed with early stage cancer and spent 5 days in ICU. what can I claim?",
    "what can I claim in total for my cancer and the ICU stay?",
    "what's the most I can claim for this cancer?",
    "how much do I get altogether for this diagnosis?",
    "I was in hospital for 10 days after a car accident, what's the most I can claim in total?",
    "I was in hospital after a car accident, what's the most I can claim over all my claims?",
    "I had surgery last week. How much will I get in total?",
    "what's the most my total and permanent disability cover pays?",
    "I'm totally disabled now, what's the maximum I can claim?",
    "what's my total monthly premium at most?",
    "my wife broke her arm, what's the max in total for the fracture and the hospital stay?",
    "how much in total do I get for this hospital stay?",
    "saya didiagnosis kanser, berapa yang boleh saya tuntut?",
    "Saya dimasukkan ke hospital 5 hari, berapa jumlah maksimum yang boleh saya tuntut untuk semua tuntutan?",
    "berapa jumlah tuntutan yang boleh dibuat untuk pembedahan ini? had saya?",
    "我住院了5天，最多一共可以赔多少？",
    "我住院了5天，所有理赔最多赔多少？",
    "J'ai été hospitalisé 3 jours, combien au maximum au total ?",
    "J'ai été hospitalisé 3 jours, quel est le plafond global ?",
    "Me operaron ayer, ¿cuánto es lo máximo en total que puedo reclamar?",
    "Me operaron ayer, ¿cuál es el tope acumulado?",
    // Critic #312 H1.
    "I had surgery for early stage cancer, what can I claim in total?",
    "I was diagnosed with early stage cancer and spent 5 days in ICU, what's the most I can claim in total?",
    "I broke my knee cap, what can I claim in total?",
    "What's the maximum I can claim altogether for this cancer and the ICU stay?",
    "Most of my bill was ICU, what's my total claim?",
    "Under my Lifetime Shield plan, what's the max for this diagnosis?",
    "Under my Lifetime Shield plan, what's the max?",
    "For this diagnosis, what is the highest amount overall?",
    "saya didiagnosis kanser, berapa jumlah maksimum yang boleh saya tuntut?",
    "我确诊早期癌症，总共最多能赔多少？",
    "J'ai un cancer, quel est le montant maximum au total pour ce diagnostic ?",
    "Tengo cáncer, ¿cuál es el máximo en total que puedo reclamar?",
    "what can I claim in total? I had a heart attack",
    "my wife had a stroke - total payout?",
    // Critic #312 M1 and TE #312 round 2: an event in words no list holds, before the limit question.
    "I've just got cancer, what's the max across all my policies?",
    "My husband has cancer now, what is the most he can get for all his claims?",
    "I'm off sick with cancer - what's the lifetime maximum?",
    "Saya ada kanser, berapa had maksimum semua tuntutan?",
    "我得了癌症，所有理赔最多赔多少？",
    "Mum fell and hurt her hip, what's the max over the years?",
    "J'ai attrapé un cancer, quel est le plafond global ?",
    "My son was bitten by a dog. What's the most we can claim across all his policies?",
    "我昨天中风了，所有理赔最多赔多少？",
    "Mi esposa tuvo un infarto, ¿cuál es el máximo acumulado de todas las reclamaciones?",
    "Mon fils s'est cassé le bras, quel est le plafond global de toutes les réclamations ?",
    "she was knocked down by a car, is there a lifetime cap on her claims?",
    "my dad collapsed at work and is in the ward now. what is the aggregate limit?",
    "Ayah saya dimasukkan ke wad, berapa had seumur hidup?",
    "what's the most over the years for all my claims? my dad collapsed at work",
    "",
  ]) for (const fit of ["on_list", "any_event"]) for (const perClaim of [false, true]) {
    const r = ask(question, fit, TOTAL, perClaim);
    assert.ok(!shows(r), `${fit} ${perClaim}: ${question}`);
    assert.match(r.report.dropped.map((d) => d.why).join(" "), /several benefits together/, `${fit}: ${question}`);
  }
  // A many-claims question about an event, with the limit given alone (no per-claim amount beside it), never shows it:
  // alone it reads as what the event pays (Critic #312 M1). Beside the per-claim amount it is the limit asked for.
  for (const question of ["My husband has cancer now what is the most he can get for all his claims?", "what's the most the plan pays over the years for all my claims?"])
    for (const fit of ["on_list", "any_event"]) {
      assert.ok(!shows(ask(question, fit, TOTAL, false)), `alone ${fit}: ${question}`);
      assert.ok(shows(ask(question, fit, TOTAL, true)), `beside ${fit}: ${question}`);
    }
  // Asked with no event, the limit alone is what was asked.
  assert.ok(shows(ask("what's the most the plan pays over the years for all my claims?", "no_event", TOTAL, false)));
});

async function atest(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

void integration().then(() => {
  console.log(`benefit-table chat: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
});
