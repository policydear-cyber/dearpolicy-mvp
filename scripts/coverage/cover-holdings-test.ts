/** Cover matching on Home tiles (Critic Q4, TE P148-3, Critic R247 Q1b follow-up), on the route's path: assembleTable over
 * checked readings, then lumpSumParts(tileRows(categoryRows(category, rows)), lines, held, category).
 *  - Two policies of one product for one person, whose pages print different policy numbers, are two policies: each is a
 *    part, each takes its own document's rows and its own confirmed line, and they add up.
 *  - One cover printed twice (same number, or a page with no number) stays one cover, as before.
 *  - A schedule line whose name has an accident word ("AD&D", "Accident Benefit") is not given an amount on Death or TPD.
 * Made-up SG, MY and UK households. Synthetic only; no model, no database, no network.
 *   node --import tsx scripts/coverage/cover-holdings-test.ts */
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { CheckedBenefit, CheckedCover, CheckedReading } from "@/lib/benefit-table/check";
import { categoryRows, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail: unknown) {
  if (ok) { pass++; console.log("ok " + id); return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}

const MARKETS = [{ m: "SG", cur: "SGD" }, { m: "MY", cur: "MYR" }, { m: "UK", cur: "GBP" }] as const;
const family: FamilyMember[] = [{ id: "p-ana", display_name: "Ana Reyes" }, { id: "p-ben", display_name: "Ben Okafor" }];

for (const { m, cur } of MARKETS) {
  const src = (doc: string, page = 1) => ({ documentId: doc, document: `${doc}.pdf`, page, excerpt: "" });
  const cover = (doc: string, o: Partial<CheckedCover>): CheckedCover => ({ person: "Ana Reyes", product: "Alder Term", cover: "Alder Term", plan: null, riderOf: null,
    policyNumber: null, sumInsured: 100000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "",
    source: src(doc), currency: cur, ...o });
  const benefit = (doc: string, name: string, value: number | null, o: Partial<CheckedBenefit> = {}): CheckedBenefit => ({ section: "Benefits", column: null, benefit: name,
    pays: value == null ? "percent" : "amount", value: value ?? 100, period: null, basis: null, asOf: null, percentOf: value == null ? "sum_insured" : null, baseAmount: null,
    baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "", source: src(doc), currency: cur, baseSource: null,
    capSource: null, capUnread: false, droppedConditions: [], ...o });
  const reading = (doc: string, covers: CheckedCover[], benefits: CheckedBenefit[], kind: CheckedReading["kind"] = "personal_proof"): CheckedReading =>
    ({ documentId: doc, document: `${doc}.pdf`, kind, product: "Alder Term", plan: null, namedPeople: covers.map((c) => c.person), covers, benefits, dropped: [] });
  const KEY = coverKeyOf({ product: "Alder Term", cover: "Alder Term", plan: null });
  const linkAll = (rs: CheckedReading[]) => [...new Set(rs.flatMap((r) => r.benefits.map((b) => sectionKeyOf(r.documentId, b))))].map((section) => ({ section, cover: KEY, why: "test" }));
  const tile = (rs: CheckedReading[], category: string, lines: (ConfirmedLine & { name: string })[] = [], person = "p-ana") => {
    const p = assembleTable(rs, family, linkAll(rs)).people.find((x) => x.id === person)!;
    const held: HeldCover[] = p.covers.map((c) => ({ coverKey: c.coverKey, ...(c.holding ? { holding: c.holding } : {}), name: c.cover, documentId: c.source.documentId, sumInsured: c.sumInsured, currency: c.currency }));
    return { ...lumpSumParts(tileRows(categoryRows(category, p.rows)), lines, held, category), covers: p.covers.length, rows: p.rows.length };
  };
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, covers: r.covers, rows: r.rows, parts: r.parts.map((x) => `${x.name}=${x.amount ?? "?"} ${x.currency ?? ""}`) });
  const line = (name: string, docs: string[], amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });

  // H: two policies of one product, different printed numbers.
  const a = reading("polA", [cover("polA", { policyNumber: "AT-1001" })], [benefit("polA", "Death Benefit", 100000)]);
  const b = reading("polB", [cover("polB", { policyNumber: "AT-2002" })], [benefit("polB", "Death Benefit", 100000)]);
  const h1 = tile([a, b], "Death");
  t(`${m} H1 two policies of one product, equal sums, two numbers: two parts that add up`, h1.total === 200000 && h1.parts.length === 2 && h1.covers === 2, show(h1));
  t(`${m} H1b each policy takes only its own document's row (no doubled rows)`, h1.rows === 2, show(h1));
  const h2 = tile([a, b], "Death", [line("Alder Term", ["polA"], 100000), line("Alder Term", ["polB"], 100000)]);
  t(`${m} H2 each policy's confirmed line joins its own policy: total of both`, h2.total === 200000 && h2.parts.length === 2, show(h2));
  const b2 = reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [benefit("polB", "Death Benefit", 250000)]);
  const h3 = tile([a, b2], "Death");
  t(`${m} H3 two numbers, different sums: each part has its own sum, total 350,000`, h3.total === 350000 && h3.parts.length === 2, show(h3));
  // A wording printed on neither policy's document is shared: a percentage of the sum insured works out per policy.
  const w = reading("wording", [], [benefit("wording", "Death Benefit", null)], "policy_wording");
  const aNo = reading("polA", [cover("polA", { policyNumber: "AT-1001" })], []);
  const bNo = reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], []);
  const h4 = tile([aNo, bNo, w], "Death");
  t(`${m} H4 a shared wording's "100% of the sum insured" gives each policy its own sum`, h4.total === 350000 && h4.parts.length === 2, show(h4));
  const h5 = tile([a, b, reading("ben", [cover("ben", { person: "Ben Okafor", policyNumber: "AT-3003", sumInsured: 80000 })], [benefit("ben", "Death Benefit", 80000)])], "Death", [], "p-ben");
  t(`${m} H5 another person's policy of the same product never joins: Ben has his own one part`, h5.total === 80000 && h5.parts.length === 1, show(h5));

  // C: controls, as before this change.
  const c1 = tile([a, reading("summary", [cover("summary", { policyNumber: "AT-1001" })], [benefit("summary", "Death Benefit", 100000)])], "Death");
  t(`${m} C1 one policy printed on two documents with the same number: one cover, one part`, c1.covers === 1 && c1.total === 100000 && c1.parts.length === 1, show(c1));
  const c2 = tile([a, reading("summary", [cover("summary", { policyNumber: null })], [benefit("summary", "Death Benefit", 100000)])], "Death");
  t(`${m} C2 a second page with no number: still one cover`, c2.covers === 1 && c2.total === 100000 && c2.parts.length === 1, show(c2));
  const c3 = tile([reading("polA", [cover("polA", {}), cover("polA", {})], [benefit("polA", "Death Benefit", 100000)])], "Death");
  t(`${m} C3 a pack that repeats its schedule (no numbers): one cover`, c3.covers === 1 && c3.total === 100000, show(c3));
  const c4 = tile([a, reading("polB", [cover("polB", { policyNumber: "AT-2002", product: "Birch Term", cover: "Birch Term" })], [])], "Death");
  t(`${m} C4 a different product is never a holding of another (its own cover type)`, c4.covers === 2 && c4.parts.length === 1 && c4.total === 100000, show(c4));
  const held1 = assembleTable([a], family, linkAll([a])).people[0].covers;
  t(`${m} C5 a single policy has no holding (keys and rows unchanged)`, held1.length === 1 && held1[0].holding === undefined, held1.map((c) => c.holding));

  // Q: confirmed line names (Critic R247 Q1b).

  const q = (name: string, category = "Death") => lumpSumParts([], [line(name, ["x"], 50000)], [], category).parts[0];
  t(`${m} Q1 "AD&D Benefit" stored as Death: named, no amount`, q("AD&D Benefit").amount === null, q("AD&D Benefit"));
  t(`${m} Q2 "Accident Benefit" stored as Death: no amount`, q("Accident Benefit").amount === null, q("Accident Benefit"));
  t(`${m} Q3 "Injury Cover" stored as TPD: no amount`, q("Injury Cover", "Total Permanent Disability").amount === null, q("Injury Cover", "Total Permanent Disability"));
  t(`${m} Q4 "Group Term Life" stored as Death keeps its amount`, q("Group Term Life").amount === 50000, q("Group Term Life"));
  t(`${m} Q5 "Total Disability Accelerator" stored as TPD keeps its amount (no accident word)`, q("Total Disability Accelerator", "Total Permanent Disability").amount === 50000, q("Total Disability Accelerator", "Total Permanent Disability"));
  t(`${m} Q6 "Accident Benefit" stored as Personal Accident keeps its amount`, q("Accident Benefit", "Personal Accident").amount === 50000, q("Accident Benefit", "Personal Accident"));
  t(`${m} Q7 "AD&D Benefit" stored as Personal Accident keeps its amount`, q("AD&D Benefit", "Personal Accident").amount === 50000, q("AD&D Benefit", "Personal Accident"));
  t(`${m} Q8 "Death Benefit (illness or accident)" stored as Death keeps its amount`, q("Death Benefit (illness or accident)").amount === 50000, q("Death Benefit (illness or accident)"));

}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
