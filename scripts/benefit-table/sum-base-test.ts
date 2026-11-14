/** Scripted tests: a percentage of the policy's own headline sum, by any of its names, is worked out on the person's own
 * printed sum, and the chat shows the amount the table works out (TE-ACC-20261114-R3, failure 3). One general rule,
 * on on made-up single-life schedules in several currencies, with negative controls:
 * A. A share the reading left as "other" (or unset) whose own row prints it "of" the policy's headline sum by a closed
 *    allow-list of names (sum insured / assured / covered, basic or base before them, face amount, coverage amount, jumlah
 *    diinsuranskan / dilindungi) is of the sum insured. Worked out only when the person's policy prints one such sum, in
 *    the cap's currency; another benefit's, rider's, child's or premium's base, "amount covered", "benefit amount" and a
 *    row that takes something off the share stay with no amount.
 * No model, database or network.
 *   npm run benefit-table:sum-base-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, headlineSumShare } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "eeeeeeee-1111-4111-8111-000000000001";
type Cover = { cover: string; sum: number | null; line: string; riderOf?: string | null };
type Spec = { person: string; others?: string[]; linked?: string[]; product: string; insurer: string; policyNumber: string; page1: string; page2?: string;
  covers: Cover[]; benefits: Record<string, unknown>[]; link?: string };
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "percent", value: null, period: null, basis: null, asOf: null, percentOf: "other", baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });

/** One single-life schedule: covers on page 1, benefit provisions on page 2 (or page 1). The provisions' section is linked
 * to `link` (the first cover by default), as the linking step does. */
function build(s: Spec) {
  const members = [s.person, ...(s.others ?? [])];
  const family: FamilyMember[] = members.map((n, i) => ({ id: `m${i}`, display_name: n }));
  const pages = [s.page1, ...(s.page2 != null ? [s.page2] : [])].map((text, i) => ({ page: i + 1, text }));
  const d: Household["documents"][number] = { policyId: DOC, name: `${s.product}.pdf`, insurer: s.insurer, productName: s.product, policyNumber: s.policyNumber, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: s.linked ?? [s.person], supersededAt: null,
    processingStatus: "ready", pages };
  const house: Household = { accountId: ACC, members: members.map((n, i) => ({ name: n, relationship: i ? "spouse" : "self" })), documents: [d] };
  const reading = checkReading({ id: DOC, name: d.name, readable: true, pages }, {
    document: { kind: "personal_proof", product: s.product, insurer: s.insurer, namedPeople: [s.person], plan: null, periodFrom: null, periodTo: null },
    covers: s.covers.map((c) => ({ person: s.person, product: s.product, cover: c.cover, plan: null, riderOf: c.riderOf ?? null, policyNumber: s.policyNumber, premium: null,
      premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, sumInsured: c.sum, quote: c.line })),
    benefits: s.benefits.map(ben) } as never);
  const linkTo = s.covers.find((c) => c.cover === (s.link ?? s.covers[0].cover))!;
  const key = coverKeyOf({ product: s.product, cover: linkTo.cover, plan: null, riderOf: linkTo.riderOf ?? null });
  const sections = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))];
  const table = assembleTable([reading], family, sections.map((section) => ({ section, cover: key, why: "the schedule's benefit provisions" })));
  return { house, table, rows: chatRows(table, house), reading };
}
type Built = ReturnType<typeof build>;
const rowOf = (h: Built, person: string, benefit: RegExp) => h.rows.find((r) => r.person === person && benefit.test(r.benefit));
const amountOf = (h: Built, person: string, benefit: RegExp) => { const r = rowOf(h, person, benefit); return r && r.figure.kind !== "none" ? (r.figure as { amount: number }).amount : null; };
/** The model naming one row, through the row step, the chat's checks and the label check, as the app's turn does. */
function ask(h: Built, person: string, benefit: RegExp, question = `How much is ${person}'s cover?`) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  if (!row) return { row: null, amounts: [] as string[], kept: [] as { text: string; fullText?: string; amount?: { text: string } | null; basis?: string | null }[] };
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-14T04:00:00Z"), question, []);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  return { row, kept, amounts: kept.filter((s) => s.amount && s.personName === person).map((s) => s.amount!.text), report };
}

// ---------- A. The headline sum's names ----------
test("A: headlineSumShare takes each allow-listed name of the policy's own sum", () => {
  for (const [row, pct] of [
    ["Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 50,000, once per lifetime", 25],
    ["Terminal illness\t50% of the Sum Assured", 50], ["Loss of sight\t100% of the sum insured.", 100], ["Burns\t10% of the Basic Sum Covered", 10],
    ["Accidental death\t100% of the Face Amount", 100], ["TPD\t100% of your sum assured, payable in one lump sum", 100],
    ["Hilang upaya\t50% daripada Jumlah Dilindungi", 50], ["Kematian\t100% daripada Jumlah Diinsuranskan", 100], ["Angioplasty\t10% of Base Sum Assured, once only", 10], ["Accidental death\t200% of the Sum Assured", 200],
    ["Early cancer\t25%\nof the Sum Covered", 25], ["Early cancer\t25 per cent of the Sum Covered", 25],
  ] as const) assert.equal(headlineSumShare(row, pct), true, row);
});
test("A control: another sum, a kind of life, a reduction or a name left off the list is not the headline sum", () => {
  for (const [row, pct] of [
    ["Waiver\t10% of the sum covered under the rider", 10], ["Child cover\t25% of the sum covered for each child", 25], ["Child\t25% of the Sum Covered (insured child)", 25],
    ["Premium refund\t5% of the annual contribution", 5], ["Partial disability\t50% of the monthly benefit", 50], ["Outpatient\t10% of the annual limit", 10],
    ["Late-stage CI\t100% of the Sum Covered, less any early-stage amount already paid", 100], ["Medical\t80% of the amount covered", 80],
    ["Fracture\t50% of the benefit amount", 50], ["TPD\t100% of the death sum assured", 100], ["Rider\t20% of the rider sum assured", 20],
    ["Early CI\t20% of the Basic Plan Sum Assured", 20], ["Death\t100% of the sum at risk", 100], ["Death\t100% of the insured amount", 100],
    ["Burns\t10%", 10], ["Burns\t10% of the Sum Covered of the basic plan", 10], ["Burns\t10% of the Sum Covered per insured child", 10],
    ["Burns\t20% of the Sum Covered", 10], ["Outpatient\t80% of the coverage amount", 80], ["Carcinoma in situ\t25% of Basic Coverage Amount", 25], ["Death\t100% of the basic face amount", 100],
  ] as const) assert.equal(headlineSumShare(row, pct), false, row);
});

const TAKAFUL = (o: { lines: string[]; benefits: Record<string, unknown>[]; covers?: Cover[]; page1?: string; capSign?: string }) => build({
  person: "Nur Aina Binti Hassan", others: ["Faris Bin Hassan"], product: "CRITICAL CARE TAKAFUL", insurer: "Example Takaful Berhad", policyNumber: "CCT-77120",
  page1: o.page1 ?? "Example Takaful Berhad\nCRITICAL CARE TAKAFUL - CERTIFICATE SCHEDULE\nCertificate number: CCT-77120\tPerson covered: Nur Aina Binti Hassan\tCurrency: Ringgit Malaysia (RM)\nBenefit\tAmount\nSum Covered (critical illness)\tRM 300,000\nDeath benefit\tRM 300,000\nMonthly contribution\tRM 210.00",
  page2: `BENEFIT PROVISIONS\nBenefit\tWhat is paid\n${o.lines.join("\n")}`,
  covers: o.covers ?? [{ cover: "Sum Covered (critical illness)", sum: 300000, line: "Sum Covered (critical illness)\tRM 300,000" }, { cover: "Death benefit", sum: 300000, line: "Death benefit\tRM 300,000" }],
  benefits: o.benefits.map((b) => ({ section: "BENEFIT PROVISIONS", ...b })),
});
const AINA = "Nur Aina Binti Hassan";
test("A (MYR takaful): 25% of the Sum Covered read as 'other' is worked out on the certificate's Sum Covered, within its cap", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 60,000, once per lifetime";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 60000, capQuote: "up to a maximum of\nRM 60,000", quote: line }] });
  assert.equal(amountOf(h, AINA, /Early-stage/), 60000);
  const h2 = TAKAFUL({ lines: [line.replace("RM 60,000", "RM 90,000")], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 90000, capQuote: "up to a maximum of\nRM 90,000", quote: line.replace("RM 60,000", "RM 90,000") }] });
  assert.equal(amountOf(h2, AINA, /Early-stage/), 75000);
});
test("A: a stored reading with no base at all (percentOf unset) is settled the same way", () => {
  const line = "Angioplasty\t10% of the Sum Covered, up to a maximum of RM 25,000";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Angioplasty", value: 10, percentOf: null, cap: 25000, capQuote: "up to a maximum of RM 25,000", quote: line }] });
  assert.equal(amountOf(h, AINA, /Angioplasty/), 25000);
});
for (const [cur, sumText, sum, line, expect] of [
  ["SGD", "S$200,000", 200000, "Terminal illness\t50% of the Sum Assured", 100000],
  ["GBP", "£80,000", 80000, "Loss of sight\t100% of the Basic Sum Insured", 80000],
  ["USD", "US$500,000", 500000, "Accidental death\t100% of the Face Amount", 500000],
  ["MYR", "RM 100,000", 100000, "Hilang upaya\t50% daripada Jumlah Dilindungi", 50000],
] as const) test(`A (${cur}): "${line.split("\t")[1]}" read as 'other' is worked out on the schedule's one sum`, () => {
  const h = build({ person: "Jane Roe", product: "Life Plan", insurer: "Example Life", policyNumber: "LP-1", page1: `Example Life\nLIFE PLAN - SCHEDULE\nLife assured: Jane Roe\nBenefit\tSum assured\nLife Plan\t${sumText}`,
    page2: `BENEFITS\n${line}`, covers: [{ cover: "Life Plan", sum, line: `Life Plan\t${sumText}` }], benefits: [{ section: "BENEFITS", benefit: line.split("\t")[0], value: Number(/(\d+)%/.exec(line)![1]), quote: line }] });
  assert.equal(amountOf(h, "Jane Roe", new RegExp(line.split("\t")[0])), expect);
});
for (const [what, line, value] of [
  ["the sum covered under the rider", "Waiver benefit\t10% of the sum covered under the rider", 10],
  ["the sum covered for each child", "Child cover\t25% of the sum covered for each child", 25],
  ["the annual contribution (premium)", "Contribution refund\t5% of the annual contribution", 5],
  ["the monthly benefit", "Partial disability\t50% of the monthly benefit", 50],
  ["the annual limit", "Outpatient\t10% of the annual limit", 10],
  ["the amount covered", "Medical bills\t80% of the amount covered", 80],
  ["the benefit amount", "Second fracture\t50% of the benefit amount", 50],
  ["the Sum Covered less earlier payments", "Late-stage critical illness\t100% of the Sum Covered, less any early-stage amount already paid", 100],
] as const) test(`A control: a share of ${what} read as 'other' stays with no amount`, () => {
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: line.split("\t")[0], value, quote: line }] });
  const r = rowOf(h, AINA, new RegExp(line.split("\t")[0]))!;
  assert.ok(r, line);
  assert.equal(r.figure.kind, "none", JSON.stringify(r.figure));
  assert.doesNotMatch(JSON.stringify(r.figure), /30,000|75,000|300,000|15,000|150,000|240,000/);
});
test("A control: a cap printed in another currency than the Sum Covered gives no amount", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of S$50,000";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 50000, capQuote: "up to a maximum of S$50,000", quote: line }] });
  assert.equal(rowOf(h, AINA, /Early-stage/)!.figure.kind, "none");
});
test("A control: two different Sum Covered figures for the person's policy (basic plan and rider) give no amount", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered";
  const page1 = "Example Takaful Berhad\nCRITICAL CARE TAKAFUL - CERTIFICATE SCHEDULE\nCertificate number: CCT-77120\tPerson covered: Nur Aina Binti Hassan\nBenefit\tSum Covered\nBasic plan\tRM 300,000\nEarly CI rider\tRM 100,000";
  const h = TAKAFUL({ lines: [line], page1, covers: [{ cover: "Basic plan Sum Covered", sum: 300000, line: "Basic plan\tRM 300,000" }, { cover: "Early CI rider Sum Covered", sum: 100000, line: "Early CI rider\tRM 100,000", riderOf: "Basic plan" }],
    benefits: [{ benefit: "Early-stage critical illness", value: 25, quote: line }] });
  const r = rowOf(h, AINA, /Early-stage/)!;
  assert.equal(r.figure.kind, "none", JSON.stringify(r.figure));
  assert.doesNotMatch(JSON.stringify(r.figure), /75,000|25,000/);
});
test("A control: a rider's share of the basic sum covered is not worked out on the rider's own sum", () => {
  const line = "Early CI\t20% of basic sum covered";
  const page1 = "Example Takaful Berhad\nCRITICAL CARE TAKAFUL - CERTIFICATE SCHEDULE\nCertificate number: CCT-77120\tPerson covered: Nur Aina Binti Hassan\nEarly CI rider\tRM 100,000";
  const h = TAKAFUL({ lines: [line], page1, covers: [{ cover: "Early CI rider", sum: 100000, line: "Early CI rider\tRM 100,000", riderOf: "Basic plan" }], benefits: [{ benefit: "Early CI", value: 20, quote: line }] });
  const r = rowOf(h, AINA, /Early CI$/)!;
  assert.equal(r.figure.kind, "none", JSON.stringify(r.figure));
});
test("A control: a share already read as of the sum insured is worked out as before", () => {
  const line = "Burns\t10% of the Sum Covered";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Burns", value: 10, percentOf: "sum_insured", quote: line }] });
  assert.equal(amountOf(h, AINA, /Burns/), 30000);
});

// ---------- A in the chat ----------
// Part A alone does not lift main's chat rule that the sum's own line names the person (serverFigureChecked). So the chat
// shows the worked-out share only where the Sum Covered line names them; on a certificate whose Sum Covered line does not
// repeat the name (the TE-ACC-20261114-R3 failure 3 layout), the table shows the amount and the chat gives none.
test("A (MYR takaful): the chat shows the worked-out share of the Sum Covered, with its cap, when the Sum Covered line names the person", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 60,000, once per lifetime";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 60000, capQuote: "up to a maximum of\nRM 60,000", quote: line }],
    covers: [{ cover: "Sum Covered (critical illness)", sum: 300000, line: `Sum Covered (critical illness) - ${AINA}\tRM 300,000` }],
    page1: `Ex Takaful Berhad\nCI SHIELD - CERTIFICATE SCHEDULE\nCertificate number: CS-1\tPerson covered: ${AINA}\nSum Covered (critical illness) - ${AINA}\tRM 300,000` });
  assert.equal(amountOf(h, AINA, /Early-stage/), 60000);
  const a = ask(h, AINA, /Early-stage/);
  assert.deepEqual(a.amounts, ["Up to RM60,000"]);
  assert.match(a.kept.find((s) => s.amount)!.basis ?? "", /25% of Nur Aina Binti Hassan's sum insured of RM300,000 .* so up to RM60,000/);
});
test("A (MYR takaful): when the Sum Covered line does not name the person, the table shows the share and the chat shows only the row's own printed maximum, never a share worked out on the sum", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 60,000, once per lifetime";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 60000, capQuote: "up to a maximum of\nRM 60,000", quote: line }] });
  assert.equal(amountOf(h, AINA, /Early-stage/), 60000);
  const a = ask(h, AINA, /Early-stage/);
  assert.deepEqual(a.amounts, ["Up to RM60,000"]);
  assert.doesNotMatch(a.kept.find((s) => s.amount)!.basis ?? "", /RM300,000/);
});
// ---------- Gate round 1 (sum-base-gate.md): every repro, all with no amount on main ----------
test("gate H1/H2/M2: a cell that goes on past the name, takes something off, pays by the day or in instalments, or names a life is not the headline sum", () => {
  for (const [row, pct] of [
    ["Waiver\t10% of the sum covered\nunder the rider", 10], ["Burns\t10% of the Sum Covered\nof the basic plan", 10], ["Early CI\t20% of the Sum Assured\nof the Critical Illness Rider", 20],
    ["Early CI\t20% of the Sum Assured, Critical Illness Rider", 20], ["Early CI\t20% of the Sum Assured, under the CI rider", 20], ["Early CI\t20% of the Sum Assured, for the second life", 20],
    ["Child\t25% of the Sum Insured, for each insured child", 25], ["Death\t100% of the face amount\nof Policy 2", 100],
    ["Late CI\t100% daripada Jumlah Dilindungi, ditolak bayaran peringkat awal", 100], ["Late CI\t100% of the Sum Covered. Early-stage payments already made will be subtracted", 100],
    ["Late CI\t100% of the Sum Covered, excluding any amount previously paid", 100], ["Late CI\t100% of the Sum Covered (early-stage payments are offset)", 100],
    ["Late CI\t100% of the Sum Covered; the balance after any early payment", 100], ["Plan A\t50% of the Sum Insured\tPlan B\t50% of the Sum Insured", 50],
    ["Hospital\t10% of the Sum Insured per day", 10], ["Hospital\t1% of the Sum Insured, per day", 1], ["Hospital\t1% of the Sum Insured payable for each day of hospitalisation", 1],
    ["Hospital\t1% of the Sum Insured. Payable per day, up to 30 days", 1], ["Wife\t50% of the Sum Insured", 50], ["Husband's death\t50% of the Sum Insured", 50],
    ["Spouse rider\t50% of Sum Insured", 50], ["Juvenile\t25% of the Sum Insured", 25], ["Death (Insured 2)\t50% of the Sum Insured", 50], ["Death (Life 2)\t50% of the Sum Assured", 50],
    ["TPD\t100% of the Sum Assured, payable in 5 annual instalments of 20%", 100], ["TPD\t100% of the Sum Assured, paid monthly over 10 years", 100],
    ["Kematian\t100% dari Jumlah Diinsuranskan, dibayar secara ansuran", 100], ["Death\t100% of Sum Assured, multiplied by 3 before age 65", 100],
    ["Death\t100% of the Sum Assured, or the cash value if higher", 100], ["Death\t100% of the Sum Assured; 50% for deaths in the first year", 100],
    ["Death\t100% of the Sum Assured, plus bonuses", 100], ["Accident\t100% of the Sum Insured, up to 50% for the left hand", 100],
  ] as const) assert.equal(headlineSumShare(row, pct), false, row);
  // A continuation line after the quoted cell, not quoted, is not read past: the share is left as read.
  assert.equal(headlineSumShare("Late CI\t100% of the Sum Covered,", 100, "\tless any early-stage amount already paid"), false);
  assert.equal(headlineSumShare("Early CI\t25% of the Sum Covered", 25, "Angioplasty\t10% of the Sum Covered"), true);
});
const riderDoc = (line: string, value: number, riderOf: string | null) => build({ person: AINA, others: ["Faris Bin Hassan"], product: "EARLY CI RIDER", insurer: "Ex Takaful", policyNumber: "ECI-1",
  page1: "Ex Takaful\nEARLY CI RIDER - CERTIFICATE SCHEDULE\nCertificate number: ECI-1\tPerson covered: Nur Aina Binti Hassan\nEarly CI rider\tRM 100,000",
  page2: `BENEFIT PROVISIONS\nBenefit\tWhat is paid\n${line}`, covers: [{ cover: "Early CI rider", sum: 100000, line: "Early CI rider\tRM 100,000", riderOf }],
  benefits: [{ section: "BENEFIT PROVISIONS", benefit: line.split("\t")[0], value, quote: line }] });
for (const line of ["Burns\t10% of the Sum Covered\nof the basic plan", "Burns\t10% of the Sum Covered, basic plan", "Burns\t10% of the Basic Sum Covered"])
  for (const riderOf of ["Basic plan", null]) test(`gate H1: a rider (riderOf ${riderOf}) gets no amount for ${JSON.stringify(line)}`, () => {
    const h = riderDoc(line, 10, riderOf);
    assert.equal(amountOf(h, AINA, /Burns/), null);
    assert.deepEqual(ask(h, AINA, /Burns/).amounts, []);
  });
const lifePlan = (line: string, value: number) => build({ person: "Jane Roe", product: "Life Plan", insurer: "Example Life", policyNumber: "LP-1",
  page1: "Example Life\nLIFE PLAN - SCHEDULE\nLife assured: Jane Roe\nBenefit\tSum assured\nSum Assured\tS$500,000",
  page2: `BENEFITS\n${line}`, covers: [{ cover: "Life Plan", sum: 500000, line: "Sum Assured\tS$500,000" }], benefits: [{ section: "BENEFITS", benefit: line.split("\t")[0], value, quote: line }] });
for (const [line, v] of [["Waiver\t10% of the Sum Assured\nunder the CI rider", 10], ["Late CI\t100% of the Sum Assured, ditolak bayaran awal", 100],
  ["Late CI\t100% of the Sum Assured, excluding any amount previously paid", 100], ["TPD\t100% of the Sum Assured, payable in 5 annual instalments", 100],
  ["Death\t100% of the Sum Assured, plus bonuses", 100], ["Hospital\t1% of the Sum Assured, per day", 1], ["Death (Life 2)\t50% of the Sum Assured", 50],
  ["Accident\t100% of the Sum Assured, up to 50% for the left hand", 100]] as const)
  test(`gate H1/H2/M2: one-sum schedule, ${JSON.stringify(line)} gets no amount on the table or in the chat`, () => {
    const name = new RegExp(line.split("\t")[0].replace(/[()]/g, "."));
    const h = lifePlan(line, v);
    assert.equal(amountOf(h, "Jane Roe", name), null);
    assert.deepEqual(ask(h, "Jane Roe", name).amounts, []);
  });
test("gate L1: 80% of the coverage amount on a health plan whose coverage amount is its annual limit gets no amount", () => {
  const h = build({ person: "Jane Roe", product: "Health Shield", insurer: "Example Health", policyNumber: "HS-1", page1: "Example Health\nHEALTH SHIELD - SCHEDULE\nInsured: Jane Roe\nCoverage amount (annual limit)\tS$1,000,000",
    page2: "BENEFITS\nOutpatient cancer treatment\t80% of the coverage amount", covers: [{ cover: "Health Shield", sum: 1000000, line: "Coverage amount (annual limit)\tS$1,000,000" }],
    benefits: [{ section: "BENEFITS", benefit: "Outpatient cancer treatment", value: 80, quote: "Outpatient cancer treatment\t80% of the coverage amount" }] });
  assert.equal(amountOf(h, "Jane Roe", /Outpatient/), null);
});
test("gate check: the evidence's CI schedule layout (continuations start with a tab): early-stage RM50,000 on the table (none in the chat without part B); late-stage none; no row for the other member", () => {
  const head = "Serimas Takaful Berhad\nCI PROTECT PLUS - POLICY SCHEDULE\nCertificate number: SCI-2026-04417\tPerson covered: Aisyah Rahman\tCurrency: Ringgit Malaysia (RM)\nBenefit\tAmount\nSum covered (critical illness)\tRM 200,000\nDeath benefit\tRM 200,000\nMonthly contribution\tRM 186.40";
  const late = "Late-stage critical illness\t100% of the Sum Covered, less any\n\tearly-stage amount already paid";
  const early = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\n\tRM 50,000, once per lifetime";
  const h = build({ person: "Aisyah Rahman", others: ["Hafiz Rahman"], product: "CI PROTECT PLUS", insurer: "Serimas Takaful Berhad", policyNumber: "SCI-2026-04417",
    page1: `${head}\nBENEFIT PROVISIONS\nBenefit\tWhat is paid\n${late}\n${early}\nHospital income (ICU)\tRM 300 per day of admission to an intensive\n\tcare unit, up to 30 days per year`,
    covers: [{ cover: "Sum covered (critical illness)", sum: 200000, line: "Sum covered (critical illness)\tRM 200,000" }, { cover: "Death benefit", sum: 200000, line: "Death benefit\tRM 200,000" }],
    benefits: [{ section: "BENEFIT PROVISIONS", page: 1, benefit: "Late-stage critical illness", value: 100, quote: late },
      { section: "BENEFIT PROVISIONS", page: 1, benefit: "Early-stage critical illness", value: 25, cap: 50000, capQuote: "up to a maximum of\n\tRM 50,000", quote: early }] });
  assert.equal(amountOf(h, "Aisyah Rahman", /Early/), 50000);
  // The Sum Covered line does not name the person, so main's chat rule gives no figure.
  assert.deepEqual(ask(h, "Aisyah Rahman", /Early/).amounts, []);
  assert.equal(amountOf(h, "Aisyah Rahman", /Late/), null);
  assert.equal(rowOf(h, "Hafiz Rahman", /Early/), undefined);
});
// B: the table put another life's line on Daniel's Death cover; the chat must not show it.
// ---------- Gate round 2 (sum-base-gate.md "Round 2"): the part A repros ----------
test("gate R2-H3/M2: the line after the cell is a new row only with a capital and its own figure; a bare \"$\" is no maximum", () => {
  for (const [cell, next, words] of [
    ["Burns\t10% of the Sum Covered", "for deaths abroad\tunder the rider", ""], ["Burns\t10% of the Sum Covered", "children under 18\tfor each child", ""],
    ["Burns\t10% of the Sum Covered", "Insured child\t5% of the Sum Covered", ""], ["Burns\t10% of the Sum Covered,\n\tup to RM 20,000\n\t5% for a child", "", ""],
    ["Burns\t10% of the Sum Covered per child", "", ""], ["Burns\t10% of the Sum Covered, up to $20,000", "", ""], ["Burns\t10% of the Sum Covered, up to RM 20,000 per year", "", ""],
    ["Burns\t10% of the Sum Covered, up to RM 20,000", "", "per insured child"], ["Burns\t10% of the Sum Covered", "\tper event", ""], ["Burns\t10% of the Sum Covered", "Per event\tsee note 3", ""],
    ["Burns\t10% of the Sum Covered.", "Note: this benefit is reduced for ...", ""], ["Burns\t10% of the Sum Covered", "coronary artery\tRM 25,000", ""],
  ] as const) assert.equal(headlineSumShare(cell, 10, next, words), false, `${cell} / ${next} / ${words}`);
  for (const [cell, next] of [["Burns\t10% of the Sum Covered, up to S$20,000", ""], ["Burns\t10% of the Sum Covered to RM 20,000", ""],
    ["Burns\t10% of the Sum Covered up to a maximum of RM 20,000 whichever is lower", ""], ["Burns\t10% of the Sum Covered", "Angioplasty\t10% of the Sum Covered"], ["Burns\t10% of the Sum Covered", "Hospital income (ICU)\tRM 300 per day"]] as const)
    assert.equal(headlineSumShare(cell, 10, next), true, cell);
});
for (const [what, lines, cap] of [["a bare \"$\" maximum", "Burns\t10% of the Sum Covered, up to $20,000", "up to $20,000"], ["a two-column wrap 'under the rider'", "Burns\t10% of the Sum Covered\nfor deaths abroad\tunder the rider", null],
  ["a two-column wrap 'per child'", "Burns\t10% of the Sum Covered\nchildren under 18\tper child", null]] as const)
  test(`gate R2-H3/M2: ${what} read as 'other' gets no amount on the table or in the chat`, () => {
    const quote = lines.split("\n")[0];
    const h = TAKAFUL({ lines: [lines], benefits: [{ benefit: "Burns", value: 10, quote, ...(cap ? { cap: 20000, capQuote: cap } : {}) }] });
    assert.equal(amountOf(h, AINA, /Burns/), null);
    assert.deepEqual(ask(h, AINA, /Burns/).amounts, []);
  });
test("gate R2 check: the CI schedule with its currency wrapped onto its own line still shows early-stage RM50,000 on the table (none in the chat without part B)", () => {
  const early = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 50,000, once per lifetime";
  const h = build({ person: "Aisyah Rahman", others: ["Hafiz Rahman"], product: "CI PROTECT PLUS", insurer: "Serimas Takaful Berhad", policyNumber: "SCI-2026-04417",
    page1: "Serimas Takaful Berhad\nCI PROTECT PLUS - POLICY SCHEDULE\nCertificate number: SCI-2026-04417\tPerson covered: Aisyah Rahman\tCurrency: Ringgit\nMalaysia (RM)\nBenefit\tAmount\nSum covered (critical illness)\tRM 200,000\nDeath benefit\tRM 200,000\nMonthly contribution\tRM 186.40",
    page2: `BENEFIT PROVISIONS\nBenefit\tWhat is paid\nLate-stage critical illness\t100% of the Sum Covered, less any\nearly-stage amount already paid\n${early}\nAngioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\ncoronary artery\tRM 25,000`,
    covers: [{ cover: "Sum covered (critical illness)", sum: 200000, line: "Sum covered (critical illness)\tRM 200,000" }, { cover: "Death benefit", sum: 200000, line: "Death benefit\tRM 200,000" }],
    benefits: [{ section: "BENEFIT PROVISIONS", benefit: "Early-stage critical illness", value: 25, cap: 50000, capQuote: "up to a maximum of\nRM 50,000", quote: early }] });
  assert.equal(amountOf(h, "Aisyah Rahman", /Early/), 50000);
  // The Sum Covered line does not name the person, so main's chat rule gives no figure.
  assert.deepEqual(ask(h, "Aisyah Rahman", /Early/).amounts, []);
});

// ---------- Gate round 3 (sum-base-gate.md "Round 3"): the part A repro ----------
test("gate R3-L2: a next line opening with a preposition, an article or 'Per' continues the cell", () => {
  for (const next of ["Under The Rider\tRM 5,000", "For Each Child\t5%", "Less Earlier Payments\tRM 0", "Of The Basic Plan\t10", "Per Day\t1", "Payable Monthly\tN/A", "The Basic Plan\tRM 1,000", "With Bonus\tRM 1,000"])
    assert.equal(headlineSumShare("Burns\t10% of the Sum Covered", 10, next), false, next);
  for (const cell of ["Burns\t10% of the Sum Covered, up to SGD 5,000", "Burns\t10% of the Sum Covered, up to US$5,000"]) assert.equal(headlineSumShare(cell, 10), true, cell);
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`benefit-table sum base: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`benefit-table sum base: ${passed} passed, 0 failed`);
