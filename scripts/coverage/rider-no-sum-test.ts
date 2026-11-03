/** A plan whose death benefit has no fixed sum, with a rider that pays that same death benefit another way (3 Nov). The
 * schedule's confirmed line prints no amount (its notional sum is withheld at intake) and a terminal illness rider's wording
 * says "we will pay the death benefit". Before, the Death tile listed the plan twice (the line and its cover) and the rider
 * as a third policy, and lost its known total. Now:
 *  - a confirmed line with no amount is its document's one plan cover with no amount: listed once;
 *  - a rider with no amount, whose plan is on the tile with no amount, is folded into the plan (it adds nothing);
 *  - a rider beside a plan WITH an amount, or a rider with a sum insured of its own, is still listed;
 *  - several plan covers on the line's document, or a plan cover with an amount: unchanged (no known total).
 * On the route's path: assembleTable over checked readings, then lumpSumParts(tileRows(categoryRows(...))).
 * Made-up SG, MY and UK households. Synthetic only; no model, no database, no network.
 *   npm run -s coverage:rider-no-sum-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;

import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { CheckedBenefit, CheckedCover, CheckedReading } from "@/lib/benefit-table/check";
import { categoryRows, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail: unknown) {
  if (ok) { pass++; console.log("ok " + id); return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}
const family: FamilyMember[] = [{ id: "p-ana", display_name: "Ana Reyes" }];
const MARKETS = [
  { m: "SG", cur: "SGD", plan: "Harbour Builder 10", rider: "TERMINAL ILLNESS" },
  { m: "MY", cur: "MYR", plan: "Pelan Simpanan Maju 15", rider: "Terminal Illness Benefit Rider" },
  { m: "UK", cur: "GBP", plan: "Alder Savings Builder", rider: "Terminal Illness Cover" },
] as const;

for (const { m, cur, plan: PLAN, rider: RIDER } of MARKETS) {
  const src = (doc: string) => ({ documentId: doc, document: `${doc}.pdf`, page: 1, excerpt: "" });
  const cover = (doc: string, o: Partial<CheckedCover>): CheckedCover => ({ person: "Ana Reyes", product: PLAN, cover: PLAN, plan: PLAN, riderOf: null,
    policyNumber: "77001234", sumInsured: 49000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "",
    source: src(doc), currency: cur, ...o });
  const row = (doc: string, section: string, name: string, value: number | null, o: Partial<CheckedBenefit> = {}): CheckedBenefit => ({ section, column: null, benefit: name,
    pays: "amount", value, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null,
    maxDays: null, conditions: [], page: 1, quote: "", source: src(doc), currency: cur, baseSource: null, capSource: null, capUnread: false, droppedConditions: [], ...o });
  const reading = (doc: string, covers: CheckedCover[], benefits: CheckedBenefit[], product: string): CheckedReading =>
    ({ documentId: doc, document: `${doc}.pdf`, kind: "personal_proof", product, plan: product, namedPeople: ["Ana Reyes"], covers, benefits, dropped: [] });
  const PLAN_KEY = coverKeyOf({ product: PLAN, cover: PLAN, plan: PLAN });
  const RIDER_KEY = coverKeyOf({ product: PLAN, cover: RIDER, plan: PLAN, riderOf: PLAN });
  const GTL = "Kestrel Group Term Life", GTL_KEY = coverKeyOf({ product: GTL, cover: GTL, plan: null });
  const LIFE = "Lotus Lifetime Protector", LIFE_KEY = coverKeyOf({ product: LIFE, cover: LIFE, plan: null });

  // The plan: a notional sum, a death benefit that is the higher of a premium refund or the cash value, and a terminal
  // illness rider that pays that death benefit early, with the insurer's limits for all policies on the life.
  const planDoc = (o: { riderSum?: number | null; planSum?: boolean; secondPlan?: boolean } = {}) => reading("builder", [
    cover("builder", { notionalSum: 49000 } as Partial<CheckedCover>),
    cover("builder", { cover: RIDER, riderOf: PLAN, sumInsured: o.riderSum ?? null }),
    cover("builder", { cover: "WAIVER OF PREMIUM ON TPD BENEFIT", riderOf: PLAN, sumInsured: null }),
    ...(o.secondPlan ? [cover("builder", { cover: "Builder Death Plus", sumInsured: null })] : []),
  ], [
    o.planSum ? row("builder", "5. Death benefit", "Death benefit", 49000) : row("builder", "5. Death benefit", "Death benefit: 105% of total premiums paid on the basic plan", 105, { pays: "percent", percentOf: "other" }),
    row("builder", "6. Terminal illness (TI) benefit", "Terminal illness benefit", o.riderSum ?? null, o.riderSum ? {} : { pays: "words", quote: "we will pay the death benefit in a lump sum." }),
    row("builder", "6. Terminal illness (TI) benefit", "Limits of compensation: most paid for TI claims in total on the same life", 1000000, { pays: "up_to" }),
    row("builder", "Terminal illness benefit", "Exclusion for the death benefit: suicide within one year from the policy issue date", null, { pays: "words" }),
    ...(o.secondPlan ? [row("builder", "8. Death plus", "Death plus benefit", null, { pays: "words" })] : []),
  ], PLAN);
  const others = [reading("gtl", [cover("gtl", { product: GTL, cover: GTL, plan: null, sumInsured: 1000000, policyNumber: "G-1" })], [row("gtl", "Benefits", "Death", 1000000)], GTL),
    reading("life", [cover("life", { product: LIFE, cover: LIFE, plan: null, sumInsured: 100000, policyNumber: "L-9" })], [row("life", "Benefits", "Death Benefit", 100000)], LIFE)];
  const linkOf = (doc: string, section: string | null) => doc === "gtl" ? GTL_KEY : doc === "life" ? LIFE_KEY
    : section === "5. Death benefit" ? PLAN_KEY : section === "8. Death plus" ? coverKeyOf({ product: PLAN, cover: "Builder Death Plus", plan: PLAN }) : RIDER_KEY;
  const tile = (rs: CheckedReading[], lines: (ConfirmedLine & { name: string })[]) => {
    const links = rs.flatMap((r) => r.benefits.map((b) => ({ section: sectionKeyOf(r.documentId, b), cover: linkOf(r.documentId, b.section), why: "test" })));
    const p = assembleTable(rs, family, links).people[0];
    const held: HeldCover[] = p.covers.map((c) => ({ coverKey: c.coverKey, name: c.cover, documentId: c.source.documentId, sumInsured: c.sumInsured, currency: c.currency,
      policyNumber: c.policyNumber, notionalSum: c.notionalSum ?? null }));
    return lumpSumParts(tileRows(categoryRows("Death", p.rows)), lines, held, "Death");
  };
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, known: r.known, parts: r.parts.map((x) => `${x.name}=${x.amount ?? "?"}`) });
  const line = (name: string, doc: string, amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: [doc], amount, currency: cur });
  const lines = [line(PLAN, "builder", null), line(GTL, "gtl", 1000000), line(LIFE, "life", 100000)];
  const names = (r: ReturnType<typeof tile>) => r.parts.map((x) => x.name);

  // R1/R2: the 3 Nov shape, with and without the plan's amount-less confirmed line.
  for (const [label, ls] of [["with the plan's line (no amount)", lines], ["with no line for the plan", lines.slice(1)]] as const) {
    const r = tile([planDoc(), ...others], [...ls]);
    t(`${m} R1 ${label}: known ${cur} 1,100,000 without the plan`, r.known?.amount === 1100000 && r.known.without.length === 1 && r.known.without[0] === PLAN, show(r));
    t(`${m} R1b ${label}: the plan listed once, the rider not listed as another policy`, names(r).filter((n) => n === PLAN).length === 1 && !names(r).includes(RIDER), show(r));
  }
  // R3: the plan prints its own death sum: the amount-less rider beside it is still listed (it may pay on top).
  {
    const r = tile([planDoc({ planSum: true }), ...others], lines.slice(1));
    t(`${m} R3 plan with its own sum: the amount-less rider is still listed, no total`, names(r).includes(RIDER) && r.total === null, show(r));
  }
  // R4: a rider with a sum insured of its own beside the amount-less plan is never folded: still listed, no total.
  {
    const r = tile([planDoc({ riderSum: 25000 }), ...others], lines);
    t(`${m} R4 a rider with its own sum insured stays listed, no total`, names(r).includes(RIDER) && r.total === null, show(r));
  }
  // R5: the amount-less line's document holds two plan covers on this tile: which is the line's cannot be told.
  {
    const r = tile([planDoc({ secondPlan: true }), ...others], lines);
    t(`${m} R5 two plan covers on the line's document: no total and no known figure`, r.total === null && r.known === null, show(r));
  }
  // R6: an amount-less line on a document whose plan cover prints an amount: unchanged, no known figure.
  {
    const r = tile([planDoc({ planSum: true }), ...others], lines);
    t(`${m} R6 an amount-less line beside a plan with an amount: no total and no known figure`, r.total === null && r.known === null, show(r));
  }
}
t("no network calls", fetches === 0, fetches);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
