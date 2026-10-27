/** Two intake checks of the benefit table, for made-up households in three markets (Singapore, Malaysia, UK). Synthetic
 * pages only, no household data and no model: each case hands checkReading the JSON a model might write.
 *  1. A limit on what several benefits or policies pay together ("Limits of compensation ... in total on the same life")
 *     is not cover in a category, and never what a claim or an event card pays (live 27f35c1: a whole-life plan's
 *     S$2,000,000 limit row was read as critical illness cover).
 *  2. A cover for one short term (a single trip) whose printed period has ended is not current cover, but its rows stay in
 *     the table for an event inside the trip (live 27f35c1: an ended trip's accident cover stayed on Personal Accident).
 *   npm run benefit-table:intake-test */
import assert from "node:assert/strict";
import { checkReading, combinedLimit, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, coverEnded, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { amountsFromRows, chatRows } from "@/lib/benefit-table/chat";
import { categoryRows } from "@/lib/coverage/table-figures";
import { withTableBenefits } from "@/lib/claims/table-benefits";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import type { Household } from "@/lib/simple-chat/library";
import { claimTable, personCover, printed, tableRow } from "../fixtures/claim-table";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const MARKETS = [
  { m: "SG", person: "Lim Wei Jie", sign: "S$", code: "SGD" },
  { m: "MY", person: "Aminah binti Yusof", sign: "RM ", code: "MYR" },
  { m: "UK", person: "Oliver Grant", sign: "£", code: "GBP" },
] as const;
const b = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[], period: { from?: string; to?: string } = {}) =>
  ({ document: { kind, product, insurer: null, namedPeople: [], plan: null, periodFrom: period.from ?? null, periodTo: period.to ?? null }, covers, benefits });
const sgt = (iso: string) => new Date(`${iso}T12:00:00+08:00`);

// ---------------------------------------------------------------------------------------------------- 1. combined limits

for (const { m, sign } of MARKETS) {
  test(`${m}: a limit on several benefits or policies together is a combined limit`, () => {
    for (const [benefit, section, quote] of [
      ["Limits of compensation: most paid for TI and critical illness (CI) claims in total on the same life", null, `Limits of compensation ${sign}2,000,000`],
      ["Limit of compensation for critical illness", null, `${sign}1,500,000 under all policies`],
      ["Overall limit: the most we pay for all benefits combined", null, `Overall limit ${sign}250,000`],
      ["Maximum amount payable", null, `The maximum amount payable across all policies on the same life is ${sign}3,000,000`],
      ["Aggregate limit (all policies)", null, `Aggregate limit ${sign}1,000,000`],
      ["Most paid across all policies", null, `The most we pay across all policies on the same life is ${sign}1,000,000`],
    ] as const) assert.equal(combinedLimit({ benefit, section, quote }), true, benefit);
  });
  test(`${m}: a benefit's own amount or cap is not a combined limit`, () => {
    for (const [benefit, section, quote] of [
      ["Critical Illness Benefit", null, `Critical Illness Benefit ${sign}300,000`],
      ["Overseas medical expenses", "Section 1 Medical", `Overseas medical expenses up to ${sign}1,000,000 in total for all claims during the trip`],
      ["Maximum benefit on any one life", null, `Maximum benefit on any one life ${sign}1,000,000`],
      ["Death benefit", null, `Death benefit ${sign}100,000 per life`],
      ["Personal liability", null, `Personal liability: limit of indemnity ${sign}2,000,000`],
      ["Room and board", "LIMITS OF BENEFITS", `Room and board up to ${sign}500 a day`],
      ["Loss of sight of one eye", "SCALE OF COMPENSATION", `Loss of sight of one eye ${sign}50,000`],
      ["Sub-limit for laptop / tablet (in total)", null, `Sub-limit for laptop / tablet (in total) ${sign}1,000`],
      ["Death or TPD (the most paid on this policy)", null, `Death or TPD ${sign}500,000`],
      ["Death benefit for all plans", null, `Death benefit ${sign}50,000`],
      // A benefit whose own line adds a cap across policies or plans is that benefit (Critic R251 Q1).
      ["Total Permanent Disability", null, `TPD benefit: 100% of sum assured, up to a maximum of ${sign}5,000,000 for all policies on the same life`],
      ["Critical Illness", null, `Critical Illness ${sign}300,000; the maximum we pay across all policies on the same life is ${sign}3,000,000`],
      ["Daily Hospital Cash", null, `${sign}100 a day, up to 30 days a year in total for all plans`],
      ["Accidental Death", null, `${sign}200,000; in aggregate across all your policies with us the most we pay is ${sign}1,000,000`],
      ["Death Benefit", "Benefits and limits of compensation", `Sum assured ${sign}500,000`],
      ["Death Benefit", null, `Sum assured ${sign}500,000 (see limits of compensation)`],
      ["Critical Illness", "LIMITS OF COMPENSATION", `Critical Illness ${sign}2,000,000`],
      ["Death Benefit", "LIMITS OF COMPENSATION", `Death Benefit ${sign}500,000 for all policies on the same life`],
      // TE P150-1 L5-L7.
      ["Critical Illness Benefit", null, `Critical Illness Benefit ${sign}200,000. The maximum we pay for critical illness across all policies on the same life is ${sign}2,000,000.`],
      ["TPD Benefit", null, `TPD Benefit 100% of the sum assured ${sign}400,000, subject to a maximum of ${sign}5,000,000 for all plans on the same life`],
      ["Critical Illness Benefit limited to the same life cap", null, `Critical Illness Benefit limited to ${sign}350,000 on the same life`],
      // Limit wording with no scope wider than one benefit: that benefit's own limit.
      ["Maximum amount payable", null, `Maximum amount payable ${sign}10,000 per claim`],
    ] as const) assert.equal(combinedLimit({ benefit, section, quote }), false, benefit);
  });

  // A whole-life plan's schedule with its own CI cover, and a page printing the limit across policies on the same life.
  const PLAN = "aaaaaaaa-0000-0000-0000-00000000c001";
  const pages = [
    { page: 1, text: `POLICY SCHEDULE\nEvergreen Whole Life\nLife Assured\t${MARKETS.find((x) => x.m === m)!.person}\nSum Assured\t${sign}100,000\nCritical Illness Benefit\t${sign}100,000` },
    { page: 9, text: `LIMITS OF COMPENSATION\nThe most paid for terminal illness and critical illness claims in total on the same life is ${sign}2,000,000.` },
  ];
  const person = MARKETS.find((x) => x.m === m)!.person;
  const doc: SourceDoc = { id: PLAN, name: "Evergreen schedule.pdf", readable: true, pages };
  const family: FamilyMember[] = [{ id: "p1", display_name: person }];
  const planReading = checkReading(doc, reading("personal_proof", "Evergreen Whole Life",
    [{ person, product: "Evergreen Whole Life", cover: "Evergreen Whole Life", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: `Sum Assured\t${sign}100,000` }],
    [b({ section: "Benefits", benefit: "Critical Illness Benefit", pays: "amount", value: 100000, quote: `Critical Illness Benefit\t${sign}100,000` }),
      b({ section: "LIMITS OF COMPENSATION", benefit: "Limits of compensation: most paid for TI and critical illness (CI) claims in total on the same life", pays: "up_to", value: 2000000, page: 9,
        quote: `The most paid for terminal illness and critical illness claims in total on the same life is ${sign}2,000,000.` })]));
  const key = coverKeyOf({ product: "Evergreen Whole Life", cover: "Evergreen Whole Life", plan: null });
  const links = [{ section: sectionKeyOf(PLAN, { section: "Benefits", column: null }), cover: key, why: "the plan" },
    { section: sectionKeyOf(PLAN, { section: "LIMITS OF COMPENSATION", column: null }), cover: key, why: "the plan" }];
  const table = assembleTable([planReading], family, links);
  const rows = table.people[0].rows;

  test(`${m}: the limit row is kept in the table, marked, and is not critical illness cover`, () => {
    assert.equal(planReading.benefits.length, 2, JSON.stringify(planReading.dropped));
    const limit = rows.find((r) => /Limits of compensation/.test(r.benefit))!;
    assert.equal(limit.combinedLimit, true);
    assert.equal(rows.find((r) => r.benefit === "Critical Illness Benefit")!.combinedLimit, false);
    assert.deepEqual(categoryRows("Critical Illness", rows).map((r) => r.benefit), ["Critical Illness Benefit"]);
  });
  test(`${m}: a household whose only critical illness row is the limit has no critical illness cover from it`, () => {
    assert.deepEqual(categoryRows("Critical Illness", rows.filter((r) => r.combinedLimit)), []);
  });

  const HOUSE: Household = { accountId: "11111111-1111-1111-1111-111111111111", members: [{ name: person, relationship: "self" }],
    documents: [{ policyId: PLAN, name: "Evergreen schedule.pdf", insurer: "Testlife", productName: "Evergreen Whole Life", policyNumber: null, documentType: null, documentRole: null,
      effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: [person], supersededAt: null, processingStatus: "ready", pages }] } as Household;
  const chat = chatRows(table, HOUSE);
  const limitId = chat.find((r) => r.combinedLimit)!.id;
  const card = (eventFit: string) => amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [
    { kind: "amount", text: "Cover.", person, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
      row: limitId, rowBenefit: chat.find((r) => r.id === limitId)!.benefit, eventFit }] }, chat, HOUSE);
  test(`${m}: the chat never gives the limit as what an event pays; asked about the limit itself, it is shown`, () => {
    for (const fit of ["on_list", "any_event"]) {
      const r = card(fit);
      assert.deepEqual(r.report.labels, [], fit);
      assert.match(r.report.dropped.map((d) => d.why).join(" "), /several benefits together/, fit);
    }
    assert.equal(card("no_event").report.labels.length, 1);
  });
}

test("a claim for a critical illness never takes the combined limit as what it pays", () => {
  const facts = { ...EMPTY_CLAIM_FACTS, eventType: "diagnosis", eventDate: "2026-09-01", uncertainFacts: [] } as ClaimFacts;
  const limit = tableRow("k", "Evergreen Whole Life", "Limits of compensation: most paid for critical illness claims in total on the same life", printed(2000000, "up_to"), { combinedLimit: true });
  const ci = tableRow("k", "Evergreen Whole Life", "Critical Illness Benefit", printed(100000, "lump_sum"));
  const covers = [personCover("k", "Evergreen Whole Life")];
  const withLimit = withTableBenefits(facts, [], claimTable([limit], covers), []);
  assert.equal(withLimit.length, 0);
  // The same row unmarked (as before this check) did reach the claim: the test can fail.
  assert.equal(withTableBenefits(facts, [], claimTable([{ ...limit, combinedLimit: false }], covers), []).length, 1);
  assert.equal(withTableBenefits(facts, [], claimTable([limit, ci], covers), []).length, 1);
});

// ------------------------------------------------------------------------------------------------- 2. ended short terms

test("coverEnded: a single trip whose short printed term is over has ended; a long, undated or running one has not", () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
  const trip = { cover: "Single Trip", plan: "Business", product: "Travel insurance summary", startDate: null, endDate: null };
  assert.equal(coverEnded(trip, { periodFrom: "29/09/2026", periodTo: "04/10/2026" }, day("2026-10-27")), "04/10/2026");
  assert.equal(coverEnded(trip, { periodFrom: "29/09/2026", periodTo: "04/10/2026" }, day("2026-10-04")), null, "the last day is still covered");
  assert.equal(coverEnded(trip, { periodFrom: "29/09/2026", periodTo: "04/10/2026" }, day("2026-10-05")), "04/10/2026");
  assert.equal(coverEnded(trip, { periodFrom: "29 September 2026", periodTo: "4 October 2026" }, day("2026-10-27")), "4 October 2026");
  assert.equal(coverEnded(trip, { periodFrom: "2026-09-29", periodTo: "2026-10-04" }, day("2026-10-27")), "2026-10-04");
  assert.equal(coverEnded({ ...trip, startDate: "01/08/2026", endDate: "15/08/2026" }, { periodFrom: null, periodTo: null }, day("2026-10-27")), "15/08/2026");
  // An annual multi-trip plan past its printed end may have been renewed.
  assert.equal(coverEnded({ ...trip, cover: "Annual Multi-Trip" }, { periodFrom: "01/04/2025", periodTo: "31/03/2026" }, day("2026-10-27")), null);
  // Only one end printed, an unreadable date, or an end before the start: kept.
  assert.equal(coverEnded(trip, { periodFrom: null, periodTo: "04/10/2026" }, day("2026-10-27")), null);
  assert.equal(coverEnded(trip, { periodFrom: "29/09/2026", periodTo: "Oct 4th" }, day("2026-10-27")), null);
  assert.equal(coverEnded(trip, { periodFrom: "04/10/2026", periodTo: "29/09/2026" }, day("2026-10-27")), null);
  // The cover line's own dates come first.
  assert.equal(coverEnded({ ...trip, startDate: "01/10/2026", endDate: "10/10/2026" }, { periodFrom: "01/01/2026", periodTo: "31/12/2026" }, day("2026-10-27")), "10/10/2026");
  assert.equal(coverEnded({ ...trip, startDate: "01/01/2026", endDate: "31/12/2026" }, { periodFrom: "01/10/2026", periodTo: "10/10/2026" }, day("2026-10-27")), null);
});
test("coverEnded: a short, passed term on anything but a single trip may have been renewed, so it stays current (Critic R251 Q2)", () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000), today = day("2026-10-27");
  const none = { periodFrom: null, periodTo: null };
  // A mid-year joiner's group certificate (renewed each 1 January).
  assert.equal(coverEnded({ cover: "Group Term Life", plan: null, product: "Acme Staff Group Insurance Scheme", startDate: "01/10/2025", endDate: "31/12/2025" }, none, today), null);
  // A monthly renewable accident plan printing the current month.
  assert.equal(coverEnded({ cover: "Personal Accident", plan: null, product: "MonthlyGuard PA", startDate: "01/09/2026", endDate: "30/09/2026" }, none, today), null);
  // A rider attached mid-term, ending with its annual base.
  assert.equal(coverEnded({ cover: "Hospital Cash Rider", plan: null, product: "LifeFirst", startDate: "01/06/2026", endDate: "31/08/2026" }, none, today), null);
  // A short period printed for a whole group certificate never ends its covers.
  assert.equal(coverEnded({ cover: "Group Personal Accident", plan: null, product: "Group Scheme", startDate: null, endDate: null }, { periodFrom: "01/07/2026", periodTo: "30/09/2026" }, today), null);
  // A group travel scheme is a scheme, not one trip.
  assert.equal(coverEnded({ cover: "Group Travel Insurance", plan: null, product: "Staff Benefits", startDate: "01/07/2026", endDate: "30/09/2026" }, none, today), null);
  // A product name with a travel-like word is standing cover.
  assert.equal(coverEnded({ cover: "Life Journey Saver", plan: null, product: "Life Journey Saver", startDate: "01/07/2026", endDate: "30/09/2026" }, none, today), null);
});

for (const { m, person, sign } of MARKETS) {
  const TRIP = "aaaaaaaa-0000-0000-0000-00000000d001", GPA = "aaaaaaaa-0000-0000-0000-00000000d002";
  const tripPages = [
    { page: 1, text: `TRAVEL INSURANCE SUMMARY\nSingle Trip\tPlan: Business\nPeriod of insurance: 29/09/2026 to 04/10/2026\nInsured person\t${person}` },
    { page: 7, text: `Section 3 Personal accident\nAdult below 70 years of age\tup to ${sign}300,000\nDaily hospital cash while overseas\tup to ${sign}8,000` },
  ];
  const gpaPages = [{ page: 1, text: `CERTIFICATE OF INSURANCE\nGROUP PERSONAL ACCIDENT\n${person}\t${sign}200,000\tPeriod 01/04/2026 to 31/03/2027` }];
  const tripReading = (period: { from?: string; to?: string }, pages = tripPages) => checkReading({ id: TRIP, name: "Travel summary.pdf", readable: true, pages }, reading("personal_proof", "Travel insurance summary",
    [{ person, product: "Travel insurance summary", cover: "Single Trip", plan: "Business", sumInsured: null, asOf: "29/09/2026", page: 1, quote: `Insured person\t${person}` }],
    [b({ section: "Section 3 Personal accident", benefit: "Personal accident: Adult below 70 years of age", pays: "up_to", value: 300000, page: 7, quote: `Adult below 70 years of age\tup to ${sign}300,000` }),
      b({ section: "Section 3 Personal accident", benefit: "Daily hospital cash while overseas", pays: "up_to", value: 8000, page: 7, quote: `Daily hospital cash while overseas\tup to ${sign}8,000` })], period));
  const gpaReading = checkReading({ id: GPA, name: "Certificate.pdf", readable: true, pages: gpaPages }, reading("personal_proof", "Group Scheme",
    [{ person, product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured: 200000, asOf: null, startDate: "01/04/2026", endDate: "31/03/2027", page: 1, quote: `${person}\t${sign}200,000` }],
    [b({ section: "GROUP PERSONAL ACCIDENT", benefit: "Accidental death", pays: "amount", value: 200000, quote: `${person}\t${sign}200,000` })], { from: "01/04/2026", to: "31/03/2027" }));
  const family: FamilyMember[] = [{ id: "p1", display_name: person }];
  const trip = coverKeyOf({ product: "Travel insurance summary", cover: "Single Trip", plan: "Business" });
  const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null });
  const links = [{ section: sectionKeyOf(TRIP, { section: "Section 3 Personal accident", column: null }), cover: trip, why: "the trip" },
    { section: sectionKeyOf(GPA, { section: "GROUP PERSONAL ACCIDENT", column: null }), cover: gpa, why: "the scheme" }];
  const tableOn = (iso: string, r = tripReading({ from: "29/09/2026", to: "04/10/2026" })) => assembleTable([r, gpaReading], family, links, [], sgt(iso));

  test(`${m}: after the trip, its rows stay in the table, marked, but are not Personal Accident or Hospital Cash cover`, () => {
    const t = tableOn("2026-10-27"), p = t.people[0];
    assert.equal(p.covers.find((c) => c.coverKey === trip)!.ended, "04/10/2026");
    assert.equal(p.covers.find((c) => c.coverKey === gpa)!.ended, null);
    const tripRows = p.rows.filter((r) => r.coverKey === trip);
    assert.equal(tripRows.length, 2);
    assert.ok(tripRows.every((r) => r.coverEnded === "04/10/2026"));
    assert.deepEqual(categoryRows("Personal Accident", p.rows).map((r) => r.coverKey), [gpa]);
    assert.deepEqual(categoryRows("Hospital Cash", p.rows), []);
  });
  test(`${m}: during the trip, the same rows are current cover`, () => {
    const p = tableOn("2026-10-01").people[0];
    assert.equal(p.covers.find((c) => c.coverKey === trip)!.ended, null);
    assert.deepEqual(categoryRows("Personal Accident", p.rows).map((r) => r.coverKey).sort(), [gpa, trip].sort());
    assert.equal(categoryRows("Hospital Cash", p.rows).length, 1);
    // On its last day in Singapore it is still current; from the next day it is not.
    assert.equal(tableOn("2026-10-04").people[0].covers.find((c) => c.coverKey === trip)!.ended, null);
    assert.equal(assembleTable([tripReading({ from: "29/09/2026", to: "04/10/2026" }), gpaReading], family, links, [], new Date("2026-10-04T16:30:00Z"))
      .people[0].covers.find((c) => c.coverKey === trip)!.ended, "04/10/2026");
  });
  test(`${m}: a period the document does not print, or prints only one end of, never ends the cover`, () => {
    const unprinted = tripReading({ from: "29/09/2026", to: "04/10/2026" }, [{ ...tripPages[0], text: tripPages[0].text.replace(/Period of insurance:[^\n]*/, "Period of insurance: see schedule") }, tripPages[1]]);
    assert.equal(unprinted.periodTo, null);
    assert.equal(tableOn("2026-10-27", unprinted).people[0].covers.find((c) => c.coverKey === trip)!.ended, null);
    assert.equal(tableOn("2026-10-27", tripReading({ to: "04/10/2026" })).people[0].covers.find((c) => c.coverKey === trip)!.ended, null);
  });
  test(`${m}: an ended yearly scheme (no renewal papers on file) stays current cover`, () => {
    const lapsed = checkReading({ id: GPA, name: "Certificate.pdf", readable: true, pages: [{ page: 1, text: gpaPages[0].text.replace("01/04/2026 to 31/03/2027", "01/04/2025 to 31/03/2026") }] },
      reading("personal_proof", "Group Scheme", [{ person, product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured: 200000, asOf: null, startDate: "01/04/2025", endDate: "31/03/2026", page: 1, quote: `${person}\t${sign}200,000` }],
        [b({ section: "GROUP PERSONAL ACCIDENT", benefit: "Accidental death", pays: "amount", value: 200000, quote: `${person}\t${sign}200,000` })]));
    const p = assembleTable([lapsed], family, links, [], sgt("2026-10-27")).people[0];
    assert.equal(p.covers[0].ended, null);
    assert.equal(categoryRows("Personal Accident", p.rows).length, 1);
  });
}

console.log(`benefit-table intake: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
