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
      // Limit wording whose head names one benefit is that benefit (Critic R253 L1).
      ["Total amount payable for death", null, `Total amount payable for death ${sign}500,000 for all plans`],
      // TE P150-1 L5-L7.
      ["Critical Illness Benefit", null, `Critical Illness Benefit ${sign}200,000. The maximum we pay for critical illness across all policies on the same life is ${sign}2,000,000.`],
      ["TPD Benefit", null, `TPD Benefit 100% of the sum assured ${sign}400,000, subject to a maximum of ${sign}5,000,000 for all plans on the same life`],
      ["Critical Illness Benefit limited to the same life cap", null, `Critical Illness Benefit limited to ${sign}350,000 on the same life`],
      // Limit wording with no scope wider than one benefit: that benefit's own limit.
      ["Maximum amount payable", null, `Maximum amount payable ${sign}10,000 per claim`],
    ] as const) assert.equal(combinedLimit({ benefit, section, quote }), false, benefit);
  });

  // A row named only as a limit ("TI/CI limit") whose own sentence on its page caps several policies on one life is that
  // limit, never what the plan pays (audit of 1912d73). Its name and quote alone may not say so: the sentence does.
  test(`${m}: a row named as a limit, capped across policies by its own sentence, is a combined limit`, () => {
    const s = (sentence: string) => ({ quote: `is ${sign}2,000,000 (the TI/CI limit)`, sentence });
    for (const [benefit, sentence] of [
      ["TI/CI limit", `The most we will pay for TI and CI benefits for the policy and other policies we issue on the life insured is ${sign}2,000,000 (the TI/CI limit).`],
      ["TI/CI limit", `The total we pay under this plan and any other plans on the life insured is ${sign}2,000,000 (the TI/CI limit).`],
      ["CI limit", `Claims under all other policies we have issued on the same life count towards ${sign}2,000,000 (the CI limit).`],
      ["TI benefits limit within TI/CI limit", `The most we will pay for the policy and other policies on the life insured is ${sign}2,000,000 (the TI/CI limit). Of this amount, the TI benefits cannot be more than ${sign}1,000,000.`],
      // TE pr180 A1-A10: other wordings of the same scope.
      ["TI/CI limit", `The most we will pay under this and other policies issued on the life insured is ${sign}2,000,000 (the TI/CI limit).`],
      ["TI/CI limit", `The most we will pay under this policy and any other policy on the life assured is ${sign}2,000,000 (the TI/CI limit).`],
      ["TI benefits limit within the TI/CI limit", `The most we will pay for this policy and all other policies on the same life is ${sign}2,000,000 (the TI/CI limit).`],
      ["TI/CI limit", `The most we will pay for this policy and all other policies is ${sign}2,000,000 (i.e. the TI/CI limit).`],
      ["TI/CI limit", `The most we will pay is ${sign}2,000,000 (the TI/CI limit); this includes all other policies on the life insured.`],
      ["TI benefits limit", `The most we will pay for this policy and all other policies is ${sign}2,000,000. Out of this amount, the TI benefits cannot be more than ${sign}1,000,000.`],
      ["TI/CI limit", `The most we will pay across all our policies on the life insured is ${sign}2,000,000 (the TI/CI limit).`],
      ["TI/CI cap", `The most we will pay for this policy and any other policy on the life insured is ${sign}2,000,000 (the TI/CI cap).`],
      // TE pr180 A14: a limit's name that says it sits under another limit is still a limit.
      ["TI benefits limit subject to the TI/CI limit", `The most we will pay for this policy and all other policies on the same life is ${sign}2,000,000. Of this amount, the TI benefits cannot be more than ${sign}1,000,000.`],
    ] as const) assert.equal(combinedLimit({ benefit, section: null, ...s(sentence) }), true, `${benefit}: ${sentence}`);
  });
  test(`${m}: a row named as a limit with no scope across policies, or not named as a limit, is not a combined limit`, () => {
    for (const [benefit, quote, sentence] of [
      ["Non-Medical Limit", `Non-Medical Limit ${sign}250,000`, `Non-Medical Limit ${sign}250,000 per life.`],
      ["Annual limit", `${sign}1,000 per policy year`, `Annual limit ${sign}1,000 per policy year.`],
      ["Trip cut short: Overall limit for family plan", `${sign}25,000`, `Overall limit for family plan ${sign}25,000.`],
      ["Sub-limit", `${sign}500`, `Sub-limit ${sign}500 for all other items.`],
      ["Limit of indemnity", `${sign}2,000,000`, `Limit of indemnity ${sign}2,000,000 under this policy and any other policies.`],
      // A benefit whose sentence names other policies is that benefit (Critic R251 Q1).
      ["Terminal illness benefit", `${sign}100,000`, `We pay ${sign}100,000 less any amount paid under this policy and other policies on the life insured.`],
      ["Death Benefit", `${sign}50,000`, `The most we will pay for the policy and other policies is ${sign}2,000,000 (the TI/CI limit).`],
      // The limit's sentence names no other policy: "of this amount" alone does not reach past one sentence before it.
      ["TI benefits limit", `${sign}1,000,000`, `The TI/CI limit is ${sign}2,000,000. Of this amount, the TI benefits cannot be more than ${sign}1,000,000.`],
      ["Policy limit", `${sign}100,000`, `The most we will pay under this policy is ${sign}100,000.`],
      // A plan's own limit that names other plans only to say it is not shared (TE pr180 B3).
      ["Policy year limit", `${sign}1,000`, `The policy year limit of ${sign}1,000 applies separately to this plan and any other plans you hold.`],
      ["Annual limit", `${sign}1,000`, `This limit is not shared with any other policies.`],
      ["Annual limit", `${sign}1,000`, `Claims under other policies do not reduce this limit of ${sign}1,000.`],
      // Periods are not policies.
      ["Annual limit", `${sign}1,000`, `The most we will pay in any policy year is ${sign}1,000, and unused amounts do not carry to other policy years.`],
    ] as const) assert.equal(combinedLimit({ benefit, section: null, quote, sentence }), false, `${benefit}: ${sentence}`);
  });
  test(`${m}: other policies named only in the next sentence are not a limit's scope`, () => {
    const ID = "aaaaaaaa-0000-0000-0000-00000000c0ac";
    const text = `ANNUAL LIMIT\nThe most we will pay under this policy in a year is ${sign}1,000 (the annual limit). Other policies we have issued have their own limits; see each policy.`;
    const rd = checkReading({ id: ID, name: "Plan.pdf", readable: true, pages: [{ page: 3, text }] }, reading("personal_proof", "Example Plan", [], [
      b({ benefit: "Annual limit", pays: "up_to", value: 1000, page: 3, quote: `is ${sign}1,000 (the annual limit)` })]));
    assert.deepEqual(rd.benefits.map((x) => x.combinedLimit), [false], JSON.stringify(rd.dropped));
  });
  test(`${m}: a scope printed on a heading or another table row is not a limit's own sentence (Critic R318 H1)`, () => {
    for (const [i, [benefit, value, text, quote]] of ([
      ["Overseas medical expenses limit", 500000, `Benefits below apply to all plans\nOverseas medical expenses limit\t${sign}500,000\t${sign}1,000,000`, `Overseas medical expenses limit\t${sign}500,000`],
      ["Annual limit", 1000, `These benefits are the same across all plans\nAnnual limit\t${sign}1,000`, `Annual limit\t${sign}1,000`],
      ["Annual limit", 1000, `These benefits are the same across all plans\nAnnual limit is ${sign}1,000 a year.`, `Annual limit is ${sign}1,000 a year.`],
      ["Personal accident limit", 100000, `Personal accident limit\t${sign}100,000\nWe will not pay where any other policies covering the same loss have paid.`, `Personal accident limit\t${sign}100,000`],
      ["Hospital cash limit", 5000, `FREE LOOK\nThis policy and any other plans you hold with us may be cancelled within 14 days\nHospital cash limit\t${sign}5,000`, `Hospital cash limit\t${sign}5,000`],
    ] as const).entries()) {
      const ID = `aaaaaaaa-0000-0000-0000-00000000c0b${i}`;
      const rd = checkReading({ id: ID, name: "Plan.pdf", readable: true, pages: [{ page: 2, text }] }, reading("personal_proof", "Example Plan", [], [
        b({ benefit, pays: "up_to", value, page: 2, quote })]));
      assert.deepEqual(rd.benefits.map((x) => x.combinedLimit), [false], `${benefit}: ${JSON.stringify(rd.dropped)}`);
    }
  });
  test(`${m}: a ";", an "i.e." or an "Out of this amount" keeps the limit's sentence whole on the page (TE pr180 r2 mutants)`, () => {
    for (const [i, [benefit, value, text, quote]] of ([
      ["TI/CI limit", 2000000, `TERMINAL ILLNESS\nThe most we will pay is ${sign}2,000,000 (the TI/CI limit); this includes all other policies on the life insured.`, `is ${sign}2,000,000 (the TI/CI limit)`],
      ["TI/CI limit", 2000000, `TERMINAL ILLNESS\nThe most we will pay is ${sign}2,000,000 (i.e. the TI/CI limit) for this policy and all other policies.`, `is ${sign}2,000,000`],
      ["TI benefits limit", 1000000, `TERMINAL ILLNESS\nThe most we will pay for this policy and all other policies is ${sign}2,000,000. Out of this amount, the TI benefits cannot be more than ${sign}1,000,000.`, `the TI benefits cannot be more than ${sign}1,000,000`],
      // TE pr180 A18, A19: a wrapped line that opens with a capital (an insurer's name, "TI") after a line ending mid-phrase.
      ["TI/CI limit", 2000000, `The most we will pay under this policy and all other policies issued by\nKestrel Mutual Life on the life insured is ${sign}2,000,000 (the TI/CI limit).`, `is ${sign}2,000,000 (the TI/CI limit)`],
      ["TI/CI limit", 2000000, `The most we will pay for this policy and all other policies on the same life for\nTI and CI claims is ${sign}2,000,000 (the TI/CI limit).`, `is ${sign}2,000,000 (the TI/CI limit)`],
    ] as const).entries()) {
      const ID = `aaaaaaaa-0000-0000-0000-00000000c0c${i}`;
      const rd = checkReading({ id: ID, name: "Term plan.pdf", readable: true, pages: [{ page: 2, text }] }, reading("personal_proof", "Example Term", [], [
        b({ benefit, pays: "up_to", value, page: 2, quote })]));
      assert.deepEqual(rd.benefits.map((x) => x.combinedLimit), [true], `${benefit} ${i}: ${JSON.stringify(rd.dropped)}`);
    }
  });
  test(`${m}: a scope split by a line's end ("poli-\\ncies") is still read`, () => {
    const ID = "aaaaaaaa-0000-0000-0000-00000000c0ab";
    const text = `TERMINAL ILLNESS\nThe most we will pay for this policy and all other poli-\ncies we have issued on the life insured is ${sign}2,000,000 (the TI/CI limit).`;
    const rd = checkReading({ id: ID, name: "Term plan.pdf", readable: true, pages: [{ page: 2, text }] }, reading("personal_proof", "Example Term", [], [
      b({ benefit: "TI/CI limit", pays: "up_to", value: 2000000, page: 2, quote: `is ${sign}2,000,000 (the TI/CI limit)` })]));
    assert.deepEqual(rd.benefits.map((x) => x.combinedLimit), [true], JSON.stringify(rd.dropped));
  });
  test(`${m}: checkReading finds a named limit's scope in its own sentence on the page`, () => {
    const ID = "aaaaaaaa-0000-0000-0000-00000000c0aa";
    // Laid out as a life plan's terms print it: the sentence wraps across lines, and the TI limit points back at it.
    const text = `TERMINAL ILLNESS\nIf the life insured is diagnosed with TI while this policy is in force, we will pay the TI\nbenefit as an advancement of the death benefit. However, this will not be more than the\nTI/Critical Illness (CI) limit. The most we will pay for this policy and all other policies we\nhave issued (or policies which we are otherwise legally responsible for) covering the same\nlife providing for any TI benefits or any CI benefits is ${sign}2,000,000 (the TI/CI limit). Of this\namount, the TI benefits cannot be more than ${sign}1,000,000. When we make a payment for\nTI, we will reduce the TI/CI limit by the amount we have paid.\nPOLICY LIMIT\nThe most we will pay under this policy is ${sign}300,000 (the policy limit).`;
    const rd = checkReading({ id: ID, name: "Term plan.pdf", readable: true, pages: [{ page: 13, text }] }, reading("personal_proof", "Example Term", [], [
      b({ benefit: "TI/CI limit", pays: "up_to", value: 2000000, page: 13, quote: `is ${sign}2,000,000 (the TI/CI limit)` }),
      b({ benefit: "TI benefits limit within TI/CI limit", pays: "up_to", value: 1000000, page: 13, quote: `Of this amount, the TI benefits cannot be more than ${sign}1,000,000.` }),
      b({ benefit: "Policy limit", pays: "up_to", value: 300000, page: 13, quote: `is ${sign}300,000 (the policy limit)` }),
    ]));
    assert.equal(rd.benefits.length, 3, JSON.stringify(rd.dropped));
    assert.deepEqual(rd.benefits.map((x) => [x.benefit, x.combinedLimit]), [["TI/CI limit", true], ["TI benefits limit within TI/CI limit", true], ["Policy limit", false]]);
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

  // TE P150-2: under a heading naming the limits of compensation, only a figure that is the cover's own sum insured is
  // cover; any other figure, or any figure with no sum insured held, is a limit (coordinator decision, 27 Oct).
  test(`${m}: under a limits-of-compensation heading, a figure that is not the cover's sum insured is a limit`, () => {
    const LIM = "aaaaaaaa-0000-0000-0000-00000000c002";
    const lpages = [{ page: 1, text: `POLICY SCHEDULE\nLife Assured\t${person}\nSum Assured\t${sign}100,000\nBENEFITS AND LIMITS OF COMPENSATION\nDeath Benefit\t${sign}100,000\nEarly Critical Illness\t25% of the sum assured\nDaily Hospital Cash\t${sign}100 a day\nFuneral Benefit\t${sign}5,000\nLIMITS OF COMPENSATION\nCritical Illness\tup to ${sign}2,000,000` }];
    const covers = (sumInsured: number | null) => [{ person, product: "Evergreen Whole Life", cover: "Evergreen Whole Life", plan: null, sumInsured, asOf: null, page: 1, quote: sumInsured ? `Sum Assured\t${sign}100,000` : `Life Assured\t${person}` }];
    const rowsOf = (sumInsured: number | null) => {
      const rd = checkReading({ id: LIM, name: "Evergreen.pdf", readable: true, pages: lpages }, reading("personal_proof", "Evergreen Whole Life", covers(sumInsured), [
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Death Benefit", pays: "amount", value: 100000, quote: `Death Benefit\t${sign}100,000` }),
        b({ section: "LIMITS OF COMPENSATION", benefit: "Critical Illness", pays: "up_to", value: 2000000, quote: `Critical Illness\tup to ${sign}2,000,000` }),
        b({ section: "LIMITS OF COMPENSATION", benefit: "Critical Illness (lump sum)", pays: "amount", value: 2000000, quote: `Critical Illness\tup to ${sign}2,000,000` }),
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Funeral Benefit", pays: "amount", value: 5000, quote: `Funeral Benefit\t${sign}5,000` }),
        // TE P150-3: a share of the sum insured and a daily payment under the heading stay cover.
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Early Critical Illness", pays: "percent", value: 25, percentOf: "sum_insured", quote: "Early Critical Illness\t25% of the sum assured" }),
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Daily Hospital Cash", pays: "per_day", value: 100, quote: `Daily Hospital Cash\t${sign}100 a day` })]));
      const ls = ["BENEFITS AND LIMITS OF COMPENSATION", "LIMITS OF COMPENSATION"].map((section) => ({ section: sectionKeyOf(LIM, { section, column: null }), cover: key, why: "the plan" }));
      return assembleTable([rd], family, ls).people[0].rows;
    };
    const held = rowsOf(100000);
    assert.equal(held.find((r) => r.benefit === "Death Benefit")!.combinedLimit, false, "the cover's own sum insured stays cover");
    assert.equal(held.find((r) => r.benefit === "Early Critical Illness")!.combinedLimit, false, "a share of the sum insured stays cover");
    assert.equal(held.find((r) => r.benefit === "Daily Hospital Cash")!.combinedLimit, false, "a daily payment stays cover");
    assert.equal(held.find((r) => r.benefit === "Early Critical Illness")!.figure.kind, "worked_out");
    // A lump sum below the sum insured stays cover, with its own line as a condition (so no tile gives it as the sum).
    const funeral = held.find((r) => r.benefit === "Funeral Benefit")!;
    assert.equal(funeral.combinedLimit, false);
    assert.ok(funeral.conditions.includes(funeral.source.excerpt));
    assert.ok(!held.find((r) => r.benefit === "Death Benefit")!.conditions.length);
    assert.ok(held.filter((r) => /^Critical Illness/.test(r.benefit)).every((r) => r.combinedLimit));
    assert.deepEqual(categoryRows("Critical Illness", held), []);
    assert.deepEqual(categoryRows("Death", held).map((r) => r.benefit), ["Death Benefit"]);
    // No sum insured held: no figure under the heading is cover, a claim amount or a tile amount.
    const none = rowsOf(null);
    assert.equal(none.length, 6);
    assert.ok(none.filter((r) => r.figure.kind === "printed" && r.pays !== "per_day").every((r) => r.combinedLimit));
    assert.equal(none.find((r) => r.benefit === "Daily Hospital Cash")!.combinedLimit, false);
    const facts = { ...EMPTY_CLAIM_FACTS, eventType: "diagnosis", eventDate: "2026-09-01", uncertainFacts: [] } as ClaimFacts;
    const items = withTableBenefits(facts, [], claimTable(held, table.people[0].covers), []);
    assert.ok(!JSON.stringify(items).includes("2,000,000") && !JSON.stringify(items).includes("2000000"), "a CI claim never answers with the limit");
    assert.equal(withTableBenefits(facts, [], claimTable(held.filter((r) => /^Critical Illness/.test(r.benefit)), table.people[0].covers), []).length, 0);
  });

  test(`${m}: limit wording that names one benefit is that benefit, with its cap kept as a condition (Critic R253 L1)`, () => {
    const D = "aaaaaaaa-0000-0000-0000-00000000c003";
    const line = `Total amount payable for death\t${sign}500,000 for all plans`;
    const rd = checkReading({ id: D, name: "Plan.pdf", readable: true, pages: [{ page: 1, text: line }] }, reading("policy_wording", "Evergreen Whole Life", [],
      [b({ benefit: "Total amount payable for death", pays: "amount", value: 500000, quote: line })]));
    assert.equal(rd.benefits[0].combinedLimit, false);
    assert.ok(rd.benefits[0].conditions.some((c) => c.includes("for all plans")), JSON.stringify(rd.benefits[0].conditions));
  });

  test(`${m}: an accident plan's scale under "Benefits and limits of compensation" stays cover (Critic R254 probe)`, () => {
    const PA = "aaaaaaaa-0000-0000-0000-00000000c004";
    const text = `PERSONAL ACCIDENT SCHEDULE\nInsured\t${person}\tSum Insured\t${sign}200,000\nBENEFITS AND LIMITS OF COMPENSATION\nFracture\t15% of Sum Insured\nMedical expenses\tup to ${sign}2,000\nHospital cash\t${sign}100 per day`;
    const rd = checkReading({ id: PA, name: "PA.pdf", readable: true, pages: [{ page: 1, text }] }, reading("personal_proof", "Accident Plan",
      [{ person, product: "Accident Plan", cover: "Accident Plan", plan: null, sumInsured: 200000, asOf: null, page: 1, quote: `Insured\t${person}\tSum Insured\t${sign}200,000` }],
      [b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Fracture", pays: "percent", value: 15, percentOf: "sum_insured", quote: "Fracture\t15% of Sum Insured" }),
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Medical expenses", pays: "up_to", value: 2000, quote: `Medical expenses\tup to ${sign}2,000` }),
        b({ section: "BENEFITS AND LIMITS OF COMPENSATION", benefit: "Hospital cash", pays: "per_day", value: 100, quote: `Hospital cash\t${sign}100 per day` })]));
    const k = coverKeyOf({ product: "Accident Plan", cover: "Accident Plan", plan: null });
    const rows = assembleTable([rd], family, [{ section: sectionKeyOf(PA, { section: "BENEFITS AND LIMITS OF COMPENSATION", column: null }), cover: k, why: "the plan" }]).people[0].rows;
    assert.equal(rows.length, 3, JSON.stringify(rd.dropped));
    assert.ok(rows.every((r) => !r.combinedLimit), JSON.stringify(rows.map((r) => [r.benefit, r.combinedLimit])));
    assert.equal(rows.find((r) => r.benefit === "Fracture")!.figure.kind, "worked_out");
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
  // A travel-named rider ends with its base plan (Critic R253 L2).
  assert.equal(coverEnded({ cover: "Overseas Travel Cover", plan: null, product: "LifeFirst", riderOf: "LifeFirst", startDate: "01/07/2026", endDate: "30/09/2026" }, none, today), null);
  assert.equal(coverEnded({ cover: "Overseas Travel Cover", plan: null, product: "LifeFirst", startDate: "01/07/2026", endDate: "30/09/2026" }, none, today), "30/09/2026");
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
