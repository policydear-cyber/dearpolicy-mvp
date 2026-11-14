/** Scripted tests: a percentage of the policy's own headline sum, by any of its names, is worked out on the person's own
 * printed sum, and the chat shows the amount the table works out (TE-ACC-20261114-R3, failures 3 and 4). Two general rules,
 * each on made-up single-life schedules in several currencies, with negative controls:
 * A. A share the reading left as "other" (or unset) whose own row prints it "of" the policy's headline sum by a closed
 *    allow-list of names (sum insured / assured / covered, basic or base before them, face amount, coverage amount, jumlah
 *    diinsuranskan / dilindungi) is of the sum insured. Worked out only when the person's policy prints one such sum, in
 *    the cap's currency; another benefit's, rider's, child's or premium's base, "amount covered", "benefit amount" and a
 *    row that takes something off the share stay with no amount.
 * B. A share of another cover's sum named in the row ("100% of the death sum assured") that the table works out reaches the
 *    chat when the sum's line is on a document printed for that person alone, even when the line does not repeat their
 *    name. A document linked to or naming another life, a second sum under the same label, or a bare "$" give no figure;
 *    why the chat refused is kept in its report, never shown.
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
  if (!row) return { row: null, amounts: [] as string[], kept: [] as { text: string; fullText?: string; amount?: { text: string } | null; basis?: string | null }[], refused: [] as { why: string }[] };
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-14T04:00:00Z"), question, []);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  return { row, kept, amounts: kept.filter((s) => s.amount && s.personName === person).map((s) => s.amount!.text), refused: report.serverFigureRefused ?? [] };
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

// ---------- A + B. The chat shows the amount ----------
test("A+B (MYR takaful): the chat shows the worked-out share of the Sum Covered, with its cap", () => {
  const line = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 60,000, once per lifetime";
  const h = TAKAFUL({ lines: [line], benefits: [{ benefit: "Early-stage critical illness", value: 25, cap: 60000, capQuote: "up to a maximum of\nRM 60,000", quote: line }] });
  const a = ask(h, AINA, /Early-stage/);
  assert.deepEqual(a.amounts, ["Up to RM60,000"]);
  assert.match(a.kept.find((s) => s.amount)!.basis ?? "", /25% of Nur Aina Binti Hassan's sum insured of RM300,000 .* so up to RM60,000/);
});

// ---------- B. A named cover's sum on a single-life schedule ----------
const TERM = (o: { sumLine?: string; extra?: string; linked?: string[]; header?: string; others?: string[] } = {}) => {
  const sumLine = o.sumLine ?? "Death\tS$450,000";
  const tpd = "Total and permanent disability\t100% of the death sum assured";
  return build({ person: "Daniel Tan Wei", others: o.others ?? ["Grace Tan Mei"], linked: o.linked, product: "TERM GUARD", insurer: "Example Life Singapore Ltd", policyNumber: "TG-5521",
    page1: `Example Life Singapore Ltd\nTERM GUARD - POLICY SCHEDULE\n${o.header ?? "Policy number: TG-5521\tLife assured: Daniel Tan Wei\tPolicy currency: Singapore dollars (SGD)"}\nBenefit\tSum assured / amount\n${sumLine}\n${tpd}\nHospital income rider\tS$150 per day in hospital${o.extra ? `\n${o.extra}` : ""}`,
    covers: [{ cover: "Death", sum: Number(/[\d,]{5,}/.exec(sumLine)![0].replace(/,/g, "")), line: sumLine }, { cover: "Total and permanent disability", sum: null, line: tpd }],
    benefits: [{ section: "TERM GUARD - POLICY SCHEDULE", benefit: "Total and permanent disability", value: 100, percentOf: "sum_insured", page: 1, quote: tpd }], link: "Total and permanent disability" });
};
const DANIEL = "Daniel Tan Wei";
test("B (SGD): TPD as 100% of the death sum assured is shown in the chat, worked out on the Death line", () => {
  const h = TERM();
  assert.equal(amountOf(h, DANIEL, /permanent/), 450000);
  const a = ask(h, DANIEL, /permanent/);
  assert.deepEqual(a.amounts, ["S$450,000"]);
  assert.match(a.kept.find((s) => s.amount)!.basis ?? "", /100% of Daniel Tan Wei's sum insured of S\$450,000/);
  assert.deepEqual(a.refused, []);
  assert.ok(!a.kept.some((s) => /figure its table prints/.test(s.text)));
});
test("B (MYR, life assured named on its own line): the same rule in another currency", () => {
  const h = TERM({ sumLine: "Death\tRM 250,000", header: "Policy number: TG-5521\nLife assured\tDaniel Tan Wei\nCurrency: Ringgit Malaysia" });
  assert.deepEqual(ask(h, DANIEL, /permanent/).amounts, ["RM250,000"]);
});
test("B control: the schedule is linked to two people, so the Death line is not settled as Daniel's: no figure, and why is kept", () => {
  const h = TERM({ linked: [DANIEL, "Grace Tan Mei"] });
  const a = ask(h, DANIEL, /permanent/);
  assert.deepEqual(a.amounts, []);
  assert.match(a.refused.map((r) => r.why).join("|"), /does not name the person/);
  assert.ok(!a.kept.some((s) => /does not name the person/.test(`${s.text} ${s.fullText ?? ""}`)), "the reason is never shown");
});
test("B control: a page that names another household member gives no figure", () => {
  const a = ask(TERM({ extra: "Nominee: Grace Tan Mei" }), DANIEL, /permanent/);
  assert.deepEqual(a.amounts, []);
  assert.match(a.refused.map((r) => r.why).join("|"), /not printed for them alone/);
});
test("B control: a page that names a second life gives no figure", () => {
  const a = ask(TERM({ extra: "Second life assured: Lim Bee Hoon" }), DANIEL, /permanent/);
  assert.deepEqual(a.amounts, []);
  assert.match(a.refused.map((r) => r.why).join("|"), /not printed for them alone/);
});
test("B control: another line with the Death label printing another sum is doubt, so no figure in the chat", () => {
  const h = TERM({ extra: "Death\tS$400,000" });
  const a = ask(h, DANIEL, /permanent/);
  assert.deepEqual(a.amounts, []);
  assert.doesNotMatch(JSON.stringify(a.kept), /450,000|400,000/);
  assert.match(a.refused.map((r) => r.why).join("|"), /sum's own label prints a different sum/);
});
test("B control: two Death covers with different sums leave the TPD row with no amount", () => {
  const tpd = "Total and permanent disability\t100% of the death sum assured";
  const h = build({ person: DANIEL, product: "TERM GUARD", insurer: "Example Life", policyNumber: "TG-5521",
    page1: `TERM GUARD - POLICY SCHEDULE\nLife assured: Daniel Tan Wei\nDeath\tS$450,000\nDeath\tS$200,000\n${tpd}`,
    covers: [{ cover: "Death", sum: 450000, line: "Death\tS$450,000" }, { cover: "Death", sum: 200000, line: "Death\tS$200,000" }, { cover: "Total and permanent disability", sum: null, line: tpd }],
    benefits: [{ section: "TERM GUARD - POLICY SCHEDULE", benefit: "Total and permanent disability", value: 100, percentOf: "sum_insured", page: 1, quote: tpd }], link: "Total and permanent disability" });
  assert.equal(amountOf(h, DANIEL, /permanent/), null);
  assert.deepEqual(ask(h, DANIEL, /permanent/).amounts, []);
});
test("B control: a bare \"$\" on the Death line names no currency, so no figure", () => {
  const h = TERM({ sumLine: "Death\t$450,000", header: "Policy number: TG-5521\tLife assured: Daniel Tan Wei" });
  assert.deepEqual(ask(h, DANIEL, /permanent/).amounts, []);
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
test("gate check: the evidence's CI schedule layout (continuations start with a tab): early-stage RM50,000 on the table and in the chat; late-stage none; no row for the other member", () => {
  const head = "Serimas Takaful Berhad\nCI PROTECT PLUS - POLICY SCHEDULE\nCertificate number: SCI-2026-04417\tPerson covered: Aisyah Rahman\tCurrency: Ringgit Malaysia (RM)\nBenefit\tAmount\nSum covered (critical illness)\tRM 200,000\nDeath benefit\tRM 200,000\nMonthly contribution\tRM 186.40";
  const late = "Late-stage critical illness\t100% of the Sum Covered, less any\n\tearly-stage amount already paid";
  const early = "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\n\tRM 50,000, once per lifetime";
  const h = build({ person: "Aisyah Rahman", others: ["Hafiz Rahman"], product: "CI PROTECT PLUS", insurer: "Serimas Takaful Berhad", policyNumber: "SCI-2026-04417",
    page1: `${head}\nBENEFIT PROVISIONS\nBenefit\tWhat is paid\n${late}\n${early}\nHospital income (ICU)\tRM 300 per day of admission to an intensive\n\tcare unit, up to 30 days per year`,
    covers: [{ cover: "Sum covered (critical illness)", sum: 200000, line: "Sum covered (critical illness)\tRM 200,000" }, { cover: "Death benefit", sum: 200000, line: "Death benefit\tRM 200,000" }],
    benefits: [{ section: "BENEFIT PROVISIONS", page: 1, benefit: "Late-stage critical illness", value: 100, quote: late },
      { section: "BENEFIT PROVISIONS", page: 1, benefit: "Early-stage critical illness", value: 25, cap: 50000, capQuote: "up to a maximum of\n\tRM 50,000", quote: early }] });
  assert.equal(amountOf(h, "Aisyah Rahman", /Early/), 50000);
  assert.deepEqual(ask(h, "Aisyah Rahman", /Early/).amounts, ["RM50,000"]);
  assert.equal(amountOf(h, "Aisyah Rahman", /Late/), null);
  assert.equal(rowOf(h, "Hafiz Rahman", /Early/), undefined);
});
// B: the table put another life's line on Daniel's Death cover; the chat must not show it.
const TPD_LINE = "Total and permanent disability\t100% of the death sum assured";
const otherLifeDoc = (p1: string, sumLine: string, sum: number, p2?: string) => build({ person: DANIEL, others: ["Grace Tan Mei"], product: "TERM GUARD", insurer: "Example Life", policyNumber: "TG-5521",
  page1: p1, page2: p2, covers: [{ cover: "Death", sum, line: sumLine }, { cover: "Total and permanent disability", sum: null, line: TPD_LINE }],
  benefits: [{ section: "TERM GUARD - POLICY SCHEDULE", benefit: "Total and permanent disability", value: 100, percentOf: "sum_insured", page: 1, quote: TPD_LINE }], link: "Total and permanent disability" });
for (const [name, p1, sumLine, sum, p2] of [
  ["Life 1 / Life 2 blocks", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nLife 1: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}\nLife 2: Lim Bee Hoon\nDeath benefit\tS$200,000`, "Death benefit\tS$200,000", 200000],
  ["Life 2 on its own page", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nLife 1: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}`, "Death\tS$200,000", 200000, "Life 2: Lim Bee Hoon\nDeath\tS$200,000"],
  ["Mr & Mrs joint cover", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\tLife assured: Daniel Tan Wei\nJoint cover for Mr & Mrs Tan\nDeath\tS$450,000\n${TPD_LINE}`, "Death\tS$450,000", 450000],
  ["an empty second page", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\tLife assured: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}`, "Death\tS$450,000", 450000, ""],
  ["a header naming two people, the line naming the other", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nBenefit\tDaniel Tan Wei\tLim Bee Hoon\nDeath (Lim Bee Hoon)\tS$200,000\nDeath\tS$450,000\n${TPD_LINE}`, "Death (Lim Bee Hoon)\tS$200,000", 200000],
  ["an insured persons table", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nInsured Name\tDOB\tSum assured\nDaniel Tan Wei\t01/01/1980\tS$450,000\nLim Bee Hoon\t02/02/1982\tS$200,000\n${TPD_LINE}`, "Lim Bee Hoon\t02/02/1982\tS$200,000", 200000],
  ["LA1 / LA2 lines", "TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\tPolicy owner: Daniel Tan Wei", "LA2\tS$200,000", 200000, `Sum assured\nLA1\tS$450,000\nLA2\tS$200,000\n${TPD_LINE}`],
  ["a Member 2 block", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\tLife assured: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}\nMember 2: Lim Bee Hoon\nDeath cover\tS$200,000`, "Death cover\tS$200,000", 200000],
  ["the household spouse in short form", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nLife 1: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}\nLife 2: Grace Tan\nDeath benefit\tS$200,000`, "Death benefit\tS$200,000", 200000],
  ["a Malay Isteri block", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nHayat diinsuranskan: Daniel Tan Wei\nKematian\tS$450,000\n${TPD_LINE}\nIsteri: Lim Bee Hoon\nKematian (isteri)\tS$200,000`, "Kematian (isteri)\tS$200,000", 200000],
  ["lives assured X and Y with initials", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\nLives assured: Daniel Tan Wei and Lim Bee Hoon\nDeath - DTW\tS$450,000\nDeath - LBH\tS$200,000\n${TPD_LINE}`, "Death - LBH\tS$200,000", 200000],
  ["a rider's second Death line", `TERM GUARD - POLICY SCHEDULE\nPolicy number: TG-5521\tLife assured: Daniel Tan Wei\nDeath\tS$450,000\n${TPD_LINE}\nAccidental death rider\nDeath\tS$100,000`, "Death\tS$450,000", 450000],
] as [string, string, string, number, string?][]) test(`gate H3: ${name}: no TPD figure in the chat`, () => {
  const a = ask(otherLifeDoc(p1, sumLine, sum, p2), DANIEL, /permanent/);
  assert.deepEqual(a.amounts, []);
  assert.doesNotMatch(JSON.stringify(a.kept), /200,000|450,000/);
});
const lion = (person: string, header: string, others = ["Aisyah Rahman"]) => build({ person, others, product: "LIONSGATE TERM SHIELD", insurer: "Lionsgate Life Singapore Ltd", policyNumber: "LTS-90311",
  page1: `Lionsgate Life Singapore Ltd\nLIONSGATE TERM SHIELD - POLICY SCHEDULE\n${header}\nBenefit\tSum assured / amount\nDeath\tS$300,000\n${TPD_LINE}\nHospital income rider\tS$100 per day in hospital, up to 365 days per\n\tpolicy year`,
  covers: [{ cover: "Death", sum: 300000, line: "Death\tS$300,000" }, { cover: "Total and permanent disability", sum: null, line: TPD_LINE }],
  benefits: [{ section: "LIONSGATE TERM SHIELD - POLICY SCHEDULE", benefit: "Total and permanent disability", value: 100, percentOf: "sum_insured", page: 1, quote: TPD_LINE }], link: "Total and permanent disability" });
test("gate check: the evidence's term schedule layout still shows TPD S$300,000 in the chat, with the life assured printed with or without 'bin'", () => {
  assert.deepEqual(ask(lion("Hafiz Rahman", "Policy number: LTS-90311\tLife assured: Hafiz Rahman\tPolicy currency: Singapore dollars\n(SGD)"), "Hafiz Rahman", /permanent/).amounts, ["S$300,000"]);
  assert.deepEqual(ask(lion("Hafiz Rahman", "Policy number: LTS-90311\tLife assured: Hafiz bin Rahman\tPolicy currency: Singapore dollars (SGD)"), "Hafiz Rahman", /permanent/).amounts, ["S$300,000"]);
});
test("gate check: a household name shorter than the printed life assured is not settled as theirs, so no figure", () => {
  assert.deepEqual(ask(lion("Hafiz", "Policy number: LTS-90311\tLife assured: Hafiz bin Rahman\tPolicy currency: SGD"), "Hafiz", /permanent/).amounts, []);
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`benefit-table sum base: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`benefit-table sum base: ${passed} passed, 0 failed`);
