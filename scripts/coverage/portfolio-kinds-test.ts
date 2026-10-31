/** One rule for whole-policy kinds across Home, the Coverage drill-down, Family and Documents (live 31 Oct: a travel trip
 * showed "Not found" on Home while Coverage listed its limits; an endowment plan was not savings anywhere; a Death tile
 * hid every amount because one policy's death benefit has no fixed sum).
 *  - Plan type from the policy's own name or its document's sentence about itself ("This is a ... endowment ... policy"),
 *    never from a maturity benefit or cash value alone (a whole life plan has both).
 *  - Travel by the cover's own name, current or ended by its printed period; a renewed trip is current.
 *  - A lump-sum tile gives the fixed sums added up and names the policy with none, never as the whole.
 * Made-up SG, MY and UK households, invented insurers and wordings. Synthetic only; no model, no database, no network.
 *   node --import tsx scripts/coverage/portfolio-kinds-test.ts */
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type CheckedBenefit, type CheckedCover, type CheckedReading } from "@/lib/benefit-table/check";
import { categoryRows, documentKinds, lumpSumParts, personKinds, tileRows, type HeldCover } from "@/lib/coverage/table-figures";
import { planKindOfName, planTypeOf, planTypeOfPages } from "@/lib/coverage/plan-type";
import { documentTableKinds, endedKinds, kindsOfTable } from "@/components/cover-kinds";

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail: unknown) {
  if (ok) { pass++; console.log("ok " + id); return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}
const pg = (text: string, page = 5) => [{ page, text }];

// Plan type from a document's own words.
const P: [string, { page: number; text: string }[], string | null][] = [
  ["endowment over two lines", pg("Policy contract\nThis is a regular premium\nparticipating endowment insurance policy that provides you with a cash value growth over the long\nterm."), "savings"],
  ["savings plan, long term", pg("This is a long term savings plan that pays a lump sum at maturity."), "savings"],
  ["MY investment-linked", pg("Polisi ini.\nThis plan is a non-participating, regular premium investment-linked insurance plan."), "investment"],
  ["UK unit-linked", pg("This policy is a unit-linked whole of life assurance policy."), "investment"],
  ["whole life with cash value is protection", pg("This is a participating whole life plan which builds cash value and pays a maturity benefit at age 100."), null],
  ["term plan is protection", pg("This is a non-participating term plan which offers you critical illness coverage."), null],
  ["not a savings plan", pg("This is not a savings plan. It is a protection policy."), null],
  ["definition with a clause number", pg("Medical condition. This is a medical condition as defined in clause 26 of this policy."), null],
  ["mixed pack is unsure", [{ page: 2, text: "This is a regular premium endowment plan." }, { page: 9, text: "This is a yearly renewable term plan." }], null],
  ["savings and investment together is unsure", pg("This is an investment-linked endowment plan."), null],
  ["source of funds form is not a type", pg("13. Source of Funds\tEmployment\tInheritance\tInvestment\tSavings\nThis is an application for an insurance product."), null],
];
for (const [id, pages, want] of P) t(`plan type: ${id}`, (planTypeOfPages(pages)?.kind ?? null) === want, planTypeOfPages(pages));
t("plan type keeps its page and sentence", planTypeOfPages(P[0][1])?.page === 5 && /endowment insurance policy/.test(planTypeOfPages(P[0][1])!.quote), planTypeOfPages(P[0][1]));

const N: [string, string | null][] = [["Maju Endowment Plan", "savings"], ["Polisi Endowmen Cahaya", "savings"], ["Harbour Savings Plan", "savings"],
  ["Growth Investment-Linked Plan", "investment"], ["Thistle Unit Linked Bond", "investment"], ["Life Journey Saver", null], ["Alder Whole Life", null], ["Endowment Investment-Linked Mix", null]];
for (const [name, want] of N) t(`plan name: ${name}`, planKindOfName(name) === want, planKindOfName(name));
t("a rider is never a savings plan", planTypeOf({ product: "Maju Endowment Plan", cover: "Waiver of premium", riderOf: "Maju Endowment Plan" }, null) === null, null);
t("the name decides before the pages", planTypeOf({ product: "Growth Investment-Linked Plan", cover: "Growth Investment-Linked Plan" }, { kind: "savings", page: 3, quote: "x" })?.kind === "investment", null);

// Review findings (Critic R418, TE #213).
t("non-savings term plan is not savings (TE F5)", planTypeOfPages(pg("This is a non-savings, term plan.")) === null, planTypeOfPages(pg("This is a non-savings, term plan.")));
t("a health plan named Health Savings Plan is not savings (TE F2)", planKindOfName("Prairie Health Savings Plan") === null, null);
const endowSentence = planTypeOfPages(pg("This is a regular premium participating endowment insurance policy."));
t("a Shield plan never takes a cross-sell page's savings sentence (TE F2)", planTypeOf({ product: "Kestrel Shield Plan A", cover: "Kestrel Shield Plan A" }, endowSentence, { product: "Kestrel Shield Plan A", baseCovers: 1 }) === null, null);
t("a second base plan in the pack takes no savings (Critic M2)", planTypeOf({ product: "Maju Term Guard", cover: "Maju Term Guard" }, endowSentence, { product: "Maju Endow 10", baseCovers: 2 }) === null, null);
t("the pack's own base plan takes its sentence", planTypeOf({ product: "Maju Endow 10", cover: "Maju Endow 10", plan: "Maju Endow 10" }, endowSentence, { product: "Maju Endow 10", baseCovers: 3 })?.kind === "savings", null);
t("an unlinked cover of the pack takes nothing (Critic M2)", planTypeOf({ product: "Maju Endow 10", cover: "Terminal Illness Benefit" }, endowSentence, { product: "Maju Endow 10", baseCovers: 3 }) === null, null);
t("a rider named as one takes no savings from its plan's name (Critic M3)", planTypeOf({ product: "Great Endowment Plan", cover: "Great Endowment Term Rider" }, null) === null, null);
t("a CI cover under an endowment product takes none (Critic M3)", planTypeOf({ product: "Great Endowment Plan", cover: "Critical Illness Benefit" }, null) === null, null);
const rp = (benefit: string) => ({ benefit, section: null, pays: "words", figure: { kind: "none", why: "words" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], product: "Cedar Life", cover: "Cedar Life", plan: null }) as never;
for (const b of ["Critical illness rider premium: 12% of basic premium", "Accidental death rider premium: 5% of the basic premium", "Hospital cash rider premium 10% of the basic premium", "Total and permanent disability premium 3% of basic premium"])
  t(`a rider premium line is on no tile (Critic M1, TE F1): ${b}`, ["Critical Illness", "Personal Accident", "Hospital Cash", "Total Permanent Disability", "Death"].every((c) => categoryRows(c, [rp(b)]).length === 0), null);
const acc = lumpSumParts([], [{ name: "Group Term Life", documentIds: ["a"], amount: 500000, currency: "SGD" }, { name: "Accidental Death Benefit", documentIds: ["b"], amount: 300000, currency: "SGD" }, { name: "Maju Endow 10", documentIds: ["c"], amount: null, currency: "SGD" }], [], "Death");
t("an accident-only sum is not called 'no fixed sum' (TE F4)", acc.known?.amount === 500000 && JSON.stringify(acc.known.without) === JSON.stringify(["Maju Endow 10"]) && JSON.stringify(acc.known.otherTile) === JSON.stringify(["Accidental Death Benefit"]), acc.known);

// Through checkReading and assembleTable: the document's sentence reaches the person's cover, in three markets.
const family: FamilyMember[] = [{ id: "p-ana", display_name: "Ana Reyes" }, { id: "p-ben", display_name: "Ben Okafor" }];
for (const { m, sign, cur } of [{ m: "SG", sign: "S$", cur: "SGD" }, { m: "MY", sign: "RM", cur: "MYR" }, { m: "UK", sign: "£", cur: "GBP" }]) {
  const doc = { id: `doc-${m}`, name: `Maju ${m}.pdf`, readable: true, people: ["Ana Reyes"], pages: [
    { page: 3, text: `POLICY SCHEDULE\nLife Assured: Ana Reyes\nMAJU ENDOW 10\t${sign}49,000.00\t01 JAN 2020\t01 JAN 2112` },
    { page: 5, text: "This is a regular premium participating endowment insurance policy that provides you with a cash value growth." },
    { page: 13, text: "DEATH BENEFIT\nWe will pay the higher of:\n(i)\t105% of total premiums paid to date; or\n(ii)\t101% of the cash-in value." },
  ] };
  const raw = { document: { kind: "personal_proof", product: "MAJU ENDOW 10", insurer: "Maju Life", namedPeople: ["Ana Reyes"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Ana Reyes", product: "MAJU ENDOW 10", cover: "MAJU ENDOW 10", plan: null, riderOf: null, policyNumber: null, sumInsured: 49000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 3, quote: `MAJU ENDOW 10\t${sign}49,000.00` }],
    benefits: [] };
  const r = checkReading(doc as never, raw);
  const table = assembleTable([r], family, []);
  const ana = table.people.find((p) => p.id === "p-ana")!;
  t(`${m}: endowment sentence makes the cover savings`, ana.covers[0]?.planType?.kind === "savings" && ana.covers[0].planType.page === 5, ana.covers[0]?.planType);
  const kinds = personKinds(ana.covers, ana.rows);
  t(`${m}: Home's Savings tile names the plan once, with the page`, JSON.stringify(kinds.get("Savings")?.current) === JSON.stringify(["MAJU ENDOW 10"]) && /page 5/.test(kinds.get("Savings")!.note ?? ""), kinds.get("Savings"));
  t(`${m}: Family lists savings and investment`, kindsOfTable(ana.rows, ana.covers).includes("Savings and investment"), kindsOfTable(ana.rows, ana.covers));
  t(`${m}: Ben, not on the document, has no savings`, !personKinds(table.people.find((p) => p.id === "p-ben")?.covers ?? [], []).has("Savings"), null);
  t(`${m}: currency not used for the type`, r.planType?.kind === "savings", r.planType);
}

// Travel by policy: current, ended, renewed, annual, and never a group scheme named after a hotel.
type KC = Parameters<typeof personKinds>[0][number];
const tc = (o: Partial<KC>): KC => ({ product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold", riderOf: null, ended: null, endDate: "20/11/2026", ...o });
const k1 = personKinds([tc({})], []);
t("current single trip is current Travel", JSON.stringify(k1.get("Travel")) === JSON.stringify({ current: ["Single Trip · Gold plan"], endedOn: null, note: null, undated: [] }), k1.get("Travel"));
const k2 = personKinds([tc({ ended: "04/10/2026" })], []);
t("an ended trip gives its last day", k2.get("Travel")?.current.length === 0 && k2.get("Travel")?.endedOn === "04/10/2026", k2.get("Travel"));
const k3 = personKinds([tc({ ended: "04/10/2026" }), tc({ ended: "12/09/2026" })], []);
t("two ended trips give the later day (day first)", k3.get("Travel")?.endedOn === "04/10/2026", k3.get("Travel"));
const k4 = personKinds([tc({ ended: "04/10/2026" }), tc({ plan: "Silver" })], []);
t("a renewed trip beside an ended one is current", k4.get("Travel")?.current.length === 1 && k4.get("Travel")?.endedOn === null, k4.get("Travel"));
const k5 = personKinds([tc({ endDate: null })], []);
t("a single trip whose dates were not read is neither current nor ended", k5.get("Travel")?.current.length === 0 && !k5.get("Travel")?.endedOn && k5.get("Travel")?.undated.length === 1, k5.get("Travel"));
t("a single trip dated by its document's period is current", personKinds([tc({ endDate: null, documentPeriodTo: "2026-12-01" })], []).get("Travel")?.current.length === 1, null);
t("Family and Documents say the dates were not found", JSON.stringify(endedKinds([], [{ product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold", endDate: null, documentPeriodTo: null }])) === JSON.stringify(["Travel: trip dates not found"]), null);
t("a cover sent without date fields (older callers) is current, as before", personKinds([{ product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold" }], []).get("Travel")?.current.length === 1, null);
t("a row cannot say its dates were not read: an unmatched single trip's row is current unless it ended", personKinds([], [{ product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold", pays: "up_to", coverEnded: null }]).get("Travel")?.current.length === 1, null);
t("annual multi-trip with no end is current", personKinds([tc({ product: "Osprey Cover", cover: "Annual Multi-Trip", plan: null })], []).get("Travel")?.current.length === 1, null);
t("a hotel's group scheme is not travel", !personKinds([tc({ product: "Holiday Inn Group Insurance", cover: "Group Term Life", plan: null })], []).has("Travel"), null);
t("a life plan with a journey name is not travel", !personKinds([tc({ product: "Life Journey Saver", cover: "Life Journey Saver", plan: null })], []).has("Travel"), null);
t("a whole life with a maturity benefit row is not savings", !personKinds([{ product: "Alder Whole Life", cover: "Alder Whole Life", plan: null }],
  [{ benefit: "Maturity Benefit", section: null, pays: "words", figure: { kind: "none", why: "words" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], product: "Alder Whole Life", cover: "Alder Whole Life", plan: null } as never]).has("Savings"), null);

// Travel rows for the Travel category (Coverage drill-down): the travel policy's rows, never a hospital plan's overseas row.
const row = (benefit: string, o: Record<string, unknown> = {}) => ({ benefit, section: null, pays: "up_to", figure: { kind: "printed", amount: 10000, currency: "GBP", unit: "up_to" }, qualifier: null, fromDay: null, maxDays: null, conditions: [],
  product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold", ...o }) as never;
const travelRows = categoryRows("Travel", [row("Trip cancellation"), row("Baggage delay"), row("Daily hospital cash while overseas", { product: "Alder Hospital Plan", cover: "Alder Hospital Plan", plan: null }),
  row("Old trip cancellation", { coverEnded: "04/10/2026" }), row("Home cover", { pays: "not_covered" })]);
t("Travel rows: the travel policy's current paying rows only", JSON.stringify((travelRows as { benefit: string }[]).map((r) => r.benefit)) === JSON.stringify(["Trip cancellation", "Baggage delay"]), travelRows);

// A Death tile with one policy whose death benefit has no fixed sum: the fixed sums added up, the other named.
for (const cur of ["SGD", "MYR", "GBP"]) {
  const src = (doc: string) => ({ documentId: doc, document: `${doc}.pdf`, page: 1, excerpt: "" });
  const cover = (doc: string, product: string, sumInsured: number | null): CheckedCover => ({ person: "Ana Reyes", product, cover: product, plan: null, riderOf: null,
    policyNumber: null, sumInsured, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "", source: src(doc), currency: cur });
  const benefit = (doc: string, name: string, value: number | null, o: Partial<CheckedBenefit> = {}): CheckedBenefit => ({ section: "Benefits", column: null, benefit: name,
    pays: value == null ? "percent" : "amount", value: value ?? 105, period: null, basis: null, asOf: null, percentOf: value == null ? "other" : null, baseAmount: null,
    baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "", source: src(doc), currency: cur, baseSource: null,
    capSource: null, capUnread: false, droppedConditions: [], ...o });
  const reading = (doc: string, c: CheckedCover, b: CheckedBenefit[]): CheckedReading => ({ documentId: doc, document: `${doc}.pdf`, kind: "personal_proof", product: c.product, plan: null, namedPeople: ["Ana Reyes"], covers: [c], benefits: b, dropped: [] });
  const rs = [reading("gtl", cover("gtl", "Birch Group Term Life", 1000000), [benefit("gtl", "Death Benefit", 1000000)]),
    reading("wl", cover("wl", "Cedar Lifetime Protector", 100000), [benefit("wl", "Death Benefit", 100000)]),
    reading("en", cover("en", "Maju Endow 10", 49000), [benefit("en", "Death benefit: higher of 105% of total premiums paid to date", null), benefit("en", "Death benefit: higher of 101% of the cash-in value", null)])];
  const links = rs.flatMap((r) => r.benefits.map((b) => ({ section: sectionKeyOf(r.documentId, b), cover: coverKeyOf(r.covers[0]), why: "test" })));
  const p = assembleTable(rs, family, links).people.find((x) => x.id === "p-ana")!;
  const held: HeldCover[] = p.covers.map((c) => ({ coverKey: c.coverKey, name: c.cover, documentId: c.source.documentId, sumInsured: c.sumInsured, currency: c.currency }));
  const r = lumpSumParts(tileRows(categoryRows("Death", p.rows)), [], held, "Death");
  t(`${cur}: Death total stays withheld when one policy has no fixed sum`, r.total === null, r);
  t(`${cur}: Death gives the fixed sums added up and names the other`, r.known?.amount === 1100000 && r.known.currency === cur && JSON.stringify(r.known.without) === JSON.stringify(["Maju Endow 10"]), r.known);
  // A death benefit printed only as a share of the premiums paid is still a death benefit, never a premium row.
  const onlyPremiums = rs.slice(0, 2).concat([reading("en", cover("en", "Maju Endow 10", 49000), [benefit("en", "Death benefit: 101% of total premiums paid", null)])]);
  const p2 = assembleTable(onlyPremiums, family, onlyPremiums.flatMap((x) => x.benefits.map((b) => ({ section: sectionKeyOf(x.documentId, b), cover: coverKeyOf(x.covers[0]), why: "test" })))).people.find((x) => x.id === "p-ana")!;
  const r2 = lumpSumParts(tileRows(categoryRows("Death", p2.rows)), [], held, "Death");
  t(`${cur}: a death benefit of 101% of premiums keeps its policy on the tile`, r2.total === null && r2.known?.without[0] === "Maju Endow 10", r2);
  t(`${cur}: a premium row stays out of the tile`, categoryRows("Death", [{ ...p2.rows[0], benefit: "Death cover annual premium" }]).length === 0, null);
  // Negative controls: a second currency, or every policy fixed, gives no known sum.
  const mixed = lumpSumParts([], [{ name: "A", documentIds: ["a"], amount: 1000, currency: cur }, { name: "B", documentIds: ["b"], amount: 2000, currency: cur === "GBP" ? "SGD" : "GBP" }, { name: "C", documentIds: ["c"], amount: null, currency: cur }], [], "Death");
  t(`${cur}: fixed sums in two currencies are never added`, mixed.known === null, mixed.known);
  const all = lumpSumParts([], [{ name: "A", documentIds: ["a"], amount: 1000, currency: cur }, { name: "B", documentIds: ["b"], amount: 2000, currency: cur }], [], "Death");
  t(`${cur}: every policy fixed gives the total, not a known sum`, all.total === 3000 && all.known === null, all);
  const twice = lumpSumParts([], [{ name: "Group Term Life", documentIds: ["a"], amount: 5000, currency: cur }, { name: "GROUP TERM LIFE", documentIds: ["b"], amount: 5000, currency: cur }, { name: "C", documentIds: ["c"], amount: null, currency: cur }], [], "Death");
  t(`${cur}: one policy maybe read twice gives no known sum`, twice.known === null, twice.known);
}

// Every page reads the same answer: Home (personKinds), Family (kindsOfTable, endedKinds), Documents (documentTableKinds),
// Benefits (documentKinds) and Coverage cards (the cover's own `ended`), on one assembled table per market.
for (const { m, sign } of [{ m: "SG", sign: "S$" }, { m: "MY", sign: "RM" }, { m: "UK", sign: "£" }]) {
  const trip = { id: `trip-${m}`, name: "Kestrel trip.pdf", readable: true, people: ["Ana Reyes"], pages: [
    { page: 1, text: `TRAVEL INSURANCE SUMMARY\nInsured: Ana Reyes\nSingle Trip\tGold\nPeriod of insurance: 29/09/2026 to 04/10/2026\nTrip cancellation\t${sign}10,000` }] };
  const tripRaw = { document: { kind: "personal_proof", product: "Kestrel Travel Insurance", insurer: "Kestrel", namedPeople: ["Ana Reyes"], plan: "Gold", periodFrom: "29/09/2026", periodTo: "04/10/2026" },
    covers: [{ person: "Ana Reyes", product: "Kestrel Travel Insurance", cover: "Single Trip", plan: "Gold", riderOf: null, policyNumber: null, sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "Single Trip\tGold" }],
    benefits: [{ section: "Benefits", column: null, benefit: "Trip cancellation", pays: "up_to", value: 10000, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: `Trip cancellation\t${sign}10,000` }] };
  const endow = { id: `endow-${m}`, name: "Maju.pdf", readable: true, people: ["Ana Reyes"], pages: [
    { page: 3, text: `POLICY SCHEDULE\nLife Assured: Ana Reyes\nMAJU ENDOW 10\t${sign}49,000.00` },
    { page: 5, text: "This is a regular premium participating endowment insurance policy." }] };
  const endowRaw = { document: { kind: "personal_proof", product: "MAJU ENDOW 10", insurer: "Maju Life", namedPeople: ["Ana Reyes"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Ana Reyes", product: "MAJU ENDOW 10", cover: "MAJU ENDOW 10", plan: null, riderOf: null, policyNumber: null, sumInsured: 49000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 3, quote: `MAJU ENDOW 10\t${sign}49,000.00` }], benefits: [] };
  const rs = [checkReading(trip as never, tripRaw), checkReading(endow as never, endowRaw)];
  const links = rs[0].benefits.map((b) => ({ section: sectionKeyOf(rs[0].documentId, b), cover: coverKeyOf(rs[0].covers[0]), why: "test" }));
  const table = assembleTable(rs, family, links, [], new Date("2026-10-31T04:00:00Z"));
  const ana = table.people.find((p) => p.id === "p-ana")!;
  const home = personKinds(ana.covers, ana.rows);
  const family_ = kindsOfTable(ana.rows, ana.covers), familyEnded = endedKinds(ana.rows, ana.covers);
  const docs = documentTableKinds([ana]), bens = documentKinds([ana]);
  const card = ana.covers.find((c) => c.cover === "Single Trip");
  t(`${m}: Home says the trip ended on 04/10/2026`, home.get("Travel")?.current.length === 0 && home.get("Travel")?.endedOn === "04/10/2026", home.get("Travel"));
  t(`${m}: Family does not list travel as cover and says it ended`, !family_.includes("Travel") && familyEnded.includes("Travel cover ended on 04/10/2026"), { family_, familyEnded });
  t(`${m}: Documents says the trip ended`, (docs[`trip-${m}`] ?? []).includes("Travel cover ended on 04/10/2026") && !(docs[`trip-${m}`] ?? []).includes("Travel"), docs);
  t(`${m}: Benefits says the trip ended`, bens[`trip-${m}`]?.endedOn === "04/10/2026", bens);
  t(`${m}: Coverage card says the trip ended`, card?.ended === "04/10/2026", card?.ended);
  t(`${m}: savings on Home, Family, Documents and Benefits alike`, !!home.get("Savings")?.current.length && family_.includes("Savings and investment")
    && (docs[`endow-${m}`] ?? []).includes("Savings and investment") && bens[`endow-${m}`]?.plan === "Savings", { home: home.get("Savings"), family_, docs, bens });
  // The same trip read before it ended is current everywhere.
  const before = assembleTable(rs, family, links, [], new Date("2026-10-01T04:00:00Z")).people.find((p) => p.id === "p-ana")!;
  t(`${m}: during the trip every page says travel is current`, !!personKinds(before.covers, before.rows).get("Travel")?.current.length && kindsOfTable(before.rows, before.covers).includes("Travel")
    && !endedKinds(before.rows, before.covers).length && !documentKinds([before])[`trip-${m}`]?.endedOn && !before.covers.find((c) => c.cover === "Single Trip")?.ended, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
