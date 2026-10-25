/** One benefit, one amount: for made-up households in three markets (a Singapore group scheme, a Malaysian individual
 * plan, a UK-style plan), the Home tile (lib/coverage/table-figures.ts), the claim estimate (lib/claims/table-benefits.ts)
 * and the chat's amount card (lib/benefit-table/chat.ts) all read the same benefit-table row, and say the same figure.
 * No model, database or network; no real household, scheme or insurer.
 *   npm run benefit-table:parity-test */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { assembleTable, coverKeyOf, sectionKeyOf, type BenefitTable, type FamilyMember, type TableRow } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import { categoryRows, tableDisplay } from "@/lib/coverage/table-figures";
import { assessClaim } from "@/lib/claims/rules";
import { enforceMonetarySafety } from "@/lib/claims/monetary-gate";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";
import type { Household } from "@/lib/simple-chat/library";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

type Page = { page: number; text: string };
type Market = {
  name: string; house: Household; family: FamilyMember[]; table: BenefitTable;
  /** The person's verified covers, as lib/coverage/facts.ts gives them to the claim rules. */
  coverages: OwnedCoverage[];
};

const doc = (policyId: string, name: string, insurer: string, people: string[], pages: Page[]) => ({ policyId, name, insurer, productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-01-05", uploadedFor: null, linkedPeople: people, supersededAt: null, processingStatus: "ready", pages });
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const b = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...o });
const owned = (o: Partial<OwnedCoverage>): OwnedCoverage => ({ id: "c", policyId: "p", familyMemberId: "m1", category: "Death", amount: null, currency: null, productName: null, sourcePage: 1,
  evidenceText: "", insurer: null, policyName: null, policyNumber: null, groupPolicyNumber: null, documentRole: "schedule", effectiveDate: "2025-01-01", renewalOrExpiryDate: null,
  currencyVerified: true, ...o });

/** Singapore: a company's group scheme. A certificate prints each employee's sums insured; the scheme terms print the
 * fracture scale as a percentage of the accident sum insured, and a daily hospital cash from day 4 for at most 10 days.
 * A first paid day and most days are kept only where the row's own quote prints them (lib/benefit-table/check.ts). */
function singapore(): Market {
  const CERT = "5a000000-0000-0000-0000-000000000001", TERMS = "5a000000-0000-0000-0000-000000000002";
  const people = ["Aditi Rao"];
  const house: Household = { accountId: "5a5a5a5a-0000-0000-0000-000000000000", members: [{ name: "Aditi Rao", relationship: "self" }], documents: [
    doc(CERT, "Member certificate.pdf", "Harbour Assurance", people, [{ page: 1, text: "GROUP SCHEME GX-1001\nGROUP PERSONAL ACCIDENT\nAditi Rao\tS$300,000\tAs of 01/01/2026\nGROUP TERM LIFE\nAditi Rao\tS$200,000\tAs of 01/01/2026" }]),
    doc(TERMS, "Scheme terms.pdf", "Harbour Assurance", people, [
      { page: 2, text: "GROUP PERSONAL ACCIDENT\nFracture Compensation Schedule (% of Sum Insured)\nWrist Fracture\t20%\nHip Fracture\t50%" },
      { page: 3, text: "GROUP TERM LIFE\nDaily Hospital Cash Benefit\tS$40 per day from the 4th day of hospitalisation, for a maximum of 10 days" },
    ]),
  ] };
  const family = [{ id: "m1", display_name: "Aditi Rao" }];
  const cover = (c: string, sum: number, quote: string) => ({ person: "Aditi Rao", product: "Group Scheme", cover: c, plan: null, sumInsured: sum, asOf: "01/01/2026", page: 1, quote });
  const cert = checkReading(src(house.documents[0]), reading("personal_proof", "Group Scheme", [
    cover("Group Personal Accident", 300000, "Aditi Rao S$300,000 As of 01/01/2026"), cover("Group Term Life", 200000, "Aditi Rao S$200,000 As of 01/01/2026")], []));
  const terms = checkReading(src(house.documents[1]), reading("scheme_terms", "Group Scheme", [], [
    b({ section: "Fractures", benefit: "Wrist Fracture", pays: "percent", value: 20, percentOf: "sum_insured", page: 2, quote: "Wrist Fracture 20%" }),
    b({ section: "Fractures", benefit: "Hip Fracture", pays: "percent", value: 50, percentOf: "sum_insured", page: 2, quote: "Hip Fracture 50%" }),
    b({ section: "Hospital", benefit: "Daily Hospital Cash Benefit", pays: "per_day", value: 40, fromDay: 4, maxDays: 10, page: 3, quote: "Daily Hospital Cash Benefit S$40 per day from the 4th day of hospitalisation, for a maximum of 10 days" }),
  ]));
  const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null }), gtl = coverKeyOf({ product: "Group Scheme", cover: "Group Term Life", plan: null });
  const table = assembleTable([cert, terms], family, [
    { section: sectionKeyOf(TERMS, { section: "Fractures", column: null }), cover: gpa, why: "the accident scale" },
    { section: sectionKeyOf(TERMS, { section: "Hospital", column: null }), cover: gtl, why: "the life cover's hospital cash" },
  ]);
  const coverages = [
    owned({ id: "sg-gpa", policyId: CERT, category: "Personal Accident", amount: 300000, currency: "SGD", productName: "Group Personal Accident", evidenceText: "Aditi Rao S$300,000", insurer: "Harbour Assurance", groupPolicyNumber: "GX-1001" }),
    owned({ id: "sg-gtl", policyId: CERT, category: "Death", amount: 200000, currency: "SGD", productName: "Group Term Life", evidenceText: "Aditi Rao S$200,000", insurer: "Harbour Assurance", groupPolicyNumber: "GX-1001" }),
  ];
  return { name: "Singapore group scheme", house, family, table, coverages };
}

/** Malaysia: one person's own plan, priced in ringgit, with a schedule that prints a death benefit and a daily hospital
 * income from day 1 for at most 180 days. */
function malaysia(): Market {
  const SCHED = "3b000000-0000-0000-0000-000000000001";
  const people = ["Nur Aina binti Hassan"];
  const house: Household = { accountId: "3b3b3b3b-0000-0000-0000-000000000000", members: [{ name: "Nur Aina binti Hassan", relationship: "self" }], documents: [
    doc(SCHED, "Policy schedule.pdf", "Lion Mutual", people, [{ page: 1, text: "POLICY SCHEDULE\nLife Assured\tNur Aina binti Hassan\nPlan\tFamily Shield\nSum Assured\tRM 250,000\nBenefit\tAmount\nDeath Benefit\tRM 250,000\nHospital Income\tRM 150 per day from day 1, up to 180 days\nTotal and Permanent Disability\t100% of Sum Assured (up to RM 200,000)\nAccidental Death\t200% of Sum Assured up to RM 400,000 or RM 300,000 after age 65" }]),
  ] };
  const family = [{ id: "m1", display_name: "Nur Aina binti Hassan" }];
  const sched = checkReading(src(house.documents[0]), reading("personal_proof", "Family Shield",
    [{ person: "Nur Aina binti Hassan", product: "Family Shield", cover: "Family Shield", plan: null, sumInsured: 250000, asOf: null, page: 1, quote: "Sum Assured RM 250,000" }],
    [b({ benefit: "Death Benefit", pays: "amount", value: 250000, page: 1, quote: "Death Benefit RM 250,000" }),
      b({ benefit: "Hospital Income", pays: "per_day", value: 150, fromDay: 1, maxDays: 180, page: 1, quote: "Hospital Income RM 150 per day from day 1, up to 180 days" }),
      b({ benefit: "Total and Permanent Disability", pays: "percent", value: 100, percentOf: "sum_insured", page: 1, quote: "Total and Permanent Disability 100% of Sum Assured (up to RM 200,000)" }),
      b({ benefit: "Accidental Death", pays: "percent", value: 200, percentOf: "sum_insured", cap: 400000, capQuote: "up to RM 400,000", page: 1, quote: "Accidental Death 200% of Sum Assured up to RM 400,000 or RM 300,000 after age 65" })]));
  const table = assembleTable([sched], family, [{ section: sectionKeyOf(SCHED, { section: null, column: null }), cover: coverKeyOf({ product: "Family Shield", cover: "Family Shield", plan: null }), why: "the plan's schedule" }]);
  const coverages = [owned({ id: "my-life", policyId: SCHED, category: "Death", amount: 250000, currency: "MYR", productName: "Family Shield", evidenceText: "Sum Assured RM 250,000", insurer: "Lion Mutual" })];
  return { name: "Malaysian individual plan", house, family, table, coverages };
}

/** UK-style: a term life and critical illness plan in pounds sterling, with an ambulance limit on the accident rider. */
function uk(): Market {
  const SCHED = "4c000000-0000-0000-0000-000000000001";
  const people = ["Oliver Bennett"];
  const house: Household = { accountId: "4c4c4c4c-0000-0000-0000-000000000000", members: [{ name: "Oliver Bennett", relationship: "self" }], documents: [
    doc(SCHED, "Plan summary.pdf", "Thames Life", people, [{ page: 1, text: "PLAN SUMMARY\nLife Assured\tOliver Bennett\nThames Protect\tSum assured £250,000\nDeath Benefit\t£250,000\nCritical Illness Benefit\t£80,000\nAmbulance costs\tUp to £300 per accident" }]),
  ] };
  const family = [{ id: "m1", display_name: "Oliver Bennett" }];
  const sched = checkReading(src(house.documents[0]), reading("personal_proof", "Thames Protect",
    [{ person: "Oliver Bennett", product: "Thames Protect", cover: "Thames Protect", plan: null, sumInsured: 250000, asOf: null, page: 1, quote: "Thames Protect Sum assured £250,000" }],
    [b({ benefit: "Death Benefit", pays: "amount", value: 250000, page: 1, quote: "Death Benefit £250,000" }),
      b({ benefit: "Critical Illness Benefit", pays: "amount", value: 80000, page: 1, quote: "Critical Illness Benefit £80,000" }),
      b({ benefit: "Ambulance costs", pays: "up_to", value: 300, page: 1, quote: "Ambulance costs Up to £300 per accident" })]));
  const table = assembleTable([sched], family, [{ section: sectionKeyOf(SCHED, { section: null, column: null }), cover: coverKeyOf({ product: "Thames Protect", cover: "Thames Protect", plan: null }), why: "the plan's summary" }]);
  const coverages = [
    owned({ id: "uk-life", policyId: SCHED, category: "Death", amount: 250000, currency: "GBP", productName: "Thames Protect", evidenceText: "Sum assured £250,000", insurer: "Thames Life" }),
    owned({ id: "uk-ci", policyId: SCHED, category: "Critical Illness", amount: 80000, currency: "GBP", productName: "Thames Protect", evidenceText: "Critical Illness Benefit £80,000", insurer: "Thames Life" }),
  ];
  return { name: "UK-style plan", house, family, table, coverages };
}

const MARKETS = [singapore(), malaysia(), uk()];
const person = (m: Market) => m.table.people[0];
const rowOf = (m: Market, benefit: string): TableRow => {
  const r = person(m).rows.find((x) => x.benefit === benefit);
  assert.ok(r, `${m.name}: no "${benefit}" row in the table (${person(m).rows.map((x) => x.benefit).join(", ")})`);
  return r;
};
const rowAmount = (r: TableRow) => ("amount" in r.figure ? r.figure.amount : null);
const rowCurrency = (r: TableRow) => ("currency" in r.figure ? r.figure.currency : null);

/** The tile text for a category, from the person's rows. */
const tile = (m: Market, category: string) => tableDisplay(categoryRows(category, person(m).rows));

/** The claim items for an event, with the person's table, through the monetary gate. */
function claim(m: Market, f: Partial<ClaimFacts>) {
  const facts = { ...EMPTY_CLAIM_FACTS, eventDate: "2026-09-01", uncertainFacts: [], ...f } as ClaimFacts;
  const table = { rows: person(m).rows, covers: person(m).covers };
  return enforceMonetarySafety(assessClaim(facts, m.coverages, [], [], null, [], [], undefined, undefined, undefined, table), facts, m.coverages);
}

/** The amount card the chat shows when the model names the row for this benefit. */
function chatCard(m: Market, benefit: string, eventFit = "any_event") {
  const rows = chatRows(m.table, m.house);
  const row = rows.find((r) => r.benefit === benefit);
  assert.ok(row, `${m.name}: the chat has no "${benefit}" row`);
  const raw = { bottomLine: "The amount below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: row.person, document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit, waiting: { applies: "no" } }] };
  const fromRows = amountsFromRows(raw, rows, m.house, new Date("2026-09-01T00:00:00Z"));
  const parsed = readModelAnswer(fromRows.json)!;
  const { answer } = verifyAnswer(m.house, parsed, ["How much?"], new Set(fromRows.report.labels));
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount);
  assert.equal(cards.length, 1, `${m.name}: one card for ${benefit}, got ${JSON.stringify(fromRows.report.dropped)}`);
  return cards[0].amount!;
}

/** The figure written as it is shown ("S$60,000", "RM 250,000"), without its currency sign, for comparing texts. */
const digits = (n: number) => n.toLocaleString("en-US");

test("Singapore: the wrist fracture row's worked-out amount is the same on the claim and the chat card", () => {
  const m = MARKETS[0];
  const row = rowOf(m, "Wrist Fracture");
  assert.equal(rowAmount(row), 60000, "20% of the S$300,000 accident sum insured");
  assert.equal(rowCurrency(row), "SGD");
  const item = claim(m, { eventType: "accident", injured: true, injuries: ["fracture"], fractureBodyPart: "right wrist" }).find((i) => i.id.startsWith("table-fracture"));
  assert.equal(item?.calculatedAmount, 60000); assert.equal(item?.currency, "SGD"); assert.equal(item?.coverageId, "sg-gpa");
  assert.match(chatCard(m, "Wrist Fracture").text, new RegExp(digits(60000)));
});

test("Singapore: the life cover's hospital cash shows one daily rate on the tile, the claim and the chat", () => {
  const m = MARKETS[0];
  const row = rowOf(m, "Daily Hospital Cash Benefit");
  assert.equal(rowAmount(row), 40); assert.equal(row.fromDay, 4); assert.equal(row.maxDays, 10);
  assert.equal(tile(m, "Hospital Cash"), "S$40 a day · from day 4 · up to 10 days");
  // 20 nights: days 4 to 13 are paid, 10 days at most.
  const item = claim(m, { eventType: "hospitalisation", diagnosis: "dengue", hospitalised: true, hospitalNights: 20 }).find((i) => i.id.startsWith("table-hospital-cash"));
  assert.equal(item?.calculatedAmount, 400); assert.equal(item?.currency, "SGD"); assert.equal(item?.coverageId, "sg-gtl");
  assert.match(chatCard(m, "Daily Hospital Cash Benefit").text, /S\$40/);
});

test("Malaysia: the death benefit is RM 250,000 on the tile, the claim and the chat, in ringgit", () => {
  const m = MARKETS[1];
  const row = rowOf(m, "Death Benefit");
  assert.equal(rowAmount(row), 250000); assert.equal(rowCurrency(row), "MYR");
  assert.match(tile(m, "Death") ?? "", new RegExp(`${digits(250000)}`));
  assert.doesNotMatch(tile(m, "Death") ?? "", /S\$/);
  const item = claim(m, { eventType: "death", death: true, deathDate: "2026-09-01" }).find((i) => i.id.startsWith("table-death"));
  assert.equal(item?.calculatedAmount, 250000); assert.equal(item?.currency, "MYR");
  const card = chatCard(m, "Death Benefit");
  assert.match(card.text, new RegExp(digits(250000))); assert.doesNotMatch(card.text, /S\$/);
});

test("Malaysia: the hospital income counts from day 1, at most 180 days, at the printed RM 150", () => {
  const m = MARKETS[1];
  assert.match(tile(m, "Hospital Cash") ?? "", /150 a day · from day 1 · up to 180 days/);
  const item = claim(m, { eventType: "hospitalisation", diagnosis: "pneumonia", hospitalised: true, hospitalNights: 5 }).find((i) => i.id.startsWith("table-hospital-cash"));
  assert.equal(item?.calculatedAmount, 750); assert.equal(item?.currency, "MYR");
  assert.match(chatCard(m, "Hospital Income").text, /150/);
});

test("Malaysia: a percentage capped in ringgit is worked out to its RM cap, and one printed with a second RM limit is not", () => {
  const m = MARKETS[1];
  const tpd = rowOf(m, "Total and Permanent Disability");
  assert.equal(rowAmount(tpd), 200000, "100% of RM 250,000, capped at RM 200,000"); assert.equal(rowCurrency(tpd), "MYR");
  assert.match(tile(m, "Total Permanent Disability") ?? "", new RegExp(digits(200000)));
  const item = claim(m, { eventType: "disability" }).find((i) => i.id.startsWith("table-disability"));
  assert.equal(item?.calculatedAmount, undefined); assert.match(item?.reason ?? "", new RegExp(digits(200000)));
  assert.match(chatCard(m, "Total and Permanent Disability").text, new RegExp(digits(200000)));
  // "up to RM 400,000 or RM 300,000 after age 65": two limits, so no single amount is worked out, as for the same row in S$.
  const ad = rowOf(m, "Accidental Death");
  assert.notEqual(rowAmount(ad), 400000); assert.notEqual(rowAmount(ad), 500000);
});

test("UK-style: the death benefit is £250,000 everywhere; critical illness and ambulance show their printed figures with no estimate", () => {
  const m = MARKETS[2];
  assert.equal(rowCurrency(rowOf(m, "Death Benefit")), "GBP");
  assert.match(tile(m, "Death") ?? "", new RegExp(digits(250000)));
  const death = claim(m, { eventType: "death", death: true, deathDate: "2026-09-01" }).find((i) => i.id.startsWith("table-death"));
  assert.equal(death?.calculatedAmount, 250000); assert.equal(death?.currency, "GBP");
  assert.match(chatCard(m, "Death Benefit").text, new RegExp(digits(250000)));
  // The tile and chat print the critical illness figure; the claim never estimates one before its definition is checked.
  assert.match(tile(m, "Critical Illness") ?? "", new RegExp(digits(80000)));
  const ci = claim(m, { eventType: "diagnosis", diagnosis: "stroke", diagnosisDate: "2026-09-01" }).find((i) => i.id.startsWith("table-critical-illness"));
  assert.equal(ci?.calculatedAmount, undefined); assert.match(ci?.reason ?? "", new RegExp(digits(80000)));
  const amb = claim(m, { eventType: "accident", ambulanceUsed: true, ambulanceBill: 180 }).find((i) => i.id.startsWith("table-ambulance"));
  assert.equal(amb?.calculatedAmount, undefined); assert.match(amb?.reason ?? "", /300/);
});

test("no market's amount is ever shown in another market's currency", () => {
  for (const m of MARKETS) {
    const own = new Set(m.coverages.map((c) => c.currency));
    for (const r of person(m).rows) {
      const c = rowCurrency(r);
      if (c) assert.ok(own.has(c), `${m.name}: row ${r.benefit} is in ${c}`);
    }
  }
});

/** One schedule, printed in a currency. Each line tests one check that asks "is a money figure printed here?". */
const swapped = (sign: string) => {
  const t = (x: string) => x.replace(/S\$/g, sign);
  const page = t([
    "BENEFIT SCHEDULE",
    // A cap on the row's next line, then a row of its own with a figure (never this row's cap).
    "Total and Permanent Disability\t100% of Sum Insured",
    "up to S$200,000",
    "Ambulance Cost S$500 per accident",
    // A cap printed with a second limit: no single cap.
    "Accidental Death\t200% of Sum Insured up to S$400,000 or S$300,000 after age 65",
    "Wrist Fracture\t20% of Sum Insured (up to S$50,000)",
    "Premium : S$120.50",
  ].join("\n"));
  const docu: SourceDoc = { id: "d", name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: `Life Assured\tAlex Tan\nSum Insured\t${t("S$250,000")}\n${page}` }] };
  const pct = (benefit: string, value: number, quote: string, extra: Record<string, unknown> = {}) => b({ benefit, pays: "percent", value, percentOf: "sum_insured", page: 1, quote: t(quote), ...extra });
  return checkReading(docu, reading("personal_proof", "Shield", [{ person: "Alex Tan", product: "Shield", cover: "Shield", plan: null, sumInsured: 250000, asOf: null, page: 1, quote: t("Sum Insured S$250,000") }], [
    pct("Total and Permanent Disability", 100, "Total and Permanent Disability 100% of Sum Insured"),
    pct("Accidental Death", 200, "Accidental Death 200% of Sum Insured up to S$400,000 or S$300,000 after age 65", { cap: 400000, capQuote: t("up to S$400,000") }),
    pct("Wrist Fracture", 20, "Wrist Fracture 20% of Sum Insured (up to S$50,000)"),
  ]));
};

test("the same schedule printed in S$, RM, £ or € reads the same: the same caps, the same refusals, the same premium", () => {
  const shape = (sign: string) => {
    const r = swapped(sign);
    return JSON.stringify({ benefits: r.benefits.map((x) => ({ benefit: x.benefit, cap: x.cap, capUnread: x.capUnread })),
      covers: r.covers.map((c) => ({ sumInsured: c.sumInsured, premium: c.premium })), dropped: r.dropped.map((d) => d.why) });
  };
  const sg = shape("S$");
  assert.match(sg, /"benefit":"Wrist Fracture","cap":50000/, "the S$ schedule reads the wrist cap");
  assert.match(sg, /"benefit":"Accidental Death","cap":null,"capUnread":true/, "the S$ schedule refuses a cap printed with a second limit");
  assert.match(sg, /"premium":120.5/, "the S$ schedule reads the premium line");
  for (const sign of ["RM ", "RM", "£", "€", "MYR ", "GBP "]) assert.equal(shape(sign), sg, `printed in ${sign.trim()}`);
});

test("no check that reads figures knows only Singapore dollars, and no claim text names one scheme's authority", () => {
  const files = ["lib/benefit-table", "lib/simple-chat", "lib/claims", "lib/ai"].flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // A money test written as "S$ or US$ or SGD or $" misses RM, £, € and every other code: use MONEY_SIGN.
    assert.doesNotMatch(src, /\(\?:S\\\$\|(?:US\\\$\|)?SGD(?:\\s\?)?\|(?:US\\\$\|)?\\\$\)/, `${f} tests for money in Singapore and US dollars only`);
    assert.doesNotMatch(src, /MINDEF\/MHA|MINDEF & MHA|G007500/, `${f} names one scheme`);
  }
});

test("a cap printed with a second limit is refused in every currency, and words like FORM 2 are never money (TE P145-1, P145-2)", () => {
  const read = (line: string, cap: number, capQuote: string) => {
    const docu: SourceDoc = { id: "d", name: "S.pdf", readable: true, pages: [{ page: 1, text: `Life Assured\tAlex Tan\nSum Insured\t250,000\n${line}` }] };
    const r = checkReading(docu, reading("personal_proof", "Shield", [], [b({ benefit: "Accidental Death", pays: "percent", value: 200, percentOf: "sum_insured", cap, capQuote, page: 1, quote: line.replace(/\t/g, " ") })]));
    return r.benefits[0]?.cap ?? null;
  };
  for (const sign of ["₹", "Rs.", "Rp", "฿", "RMB ", "NT$", "₩", "VND ", "C$", "CAD ", "ZAR ", "R ", "¥", "NZ$"])
    assert.equal(read(`Accidental Death\t200% of Sum Insured up to ${sign}500,000 or ${sign}250,000 for juveniles`, 500000, `up to ${sign}500,000`), null, sign);
  assert.equal(read("Accidental Death\t200% of Sum Insured up to 500,000 EUR or 250,000 EUR for juveniles", 500000, "up to 500,000 EUR"), null, "a code after the figure");
  for (const words of ["(submit claim FORM 2)", "(TERM 5 applies)", "(PLATFORM 3)", "(ARM 2 excluded)"])
    assert.equal(read(`Accidental Death\t200% of Sum Insured up to S$400,000 ${words}`, 400000, "up to S$400,000"), 400000, words);
});

console.log(`benefit table parity: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
