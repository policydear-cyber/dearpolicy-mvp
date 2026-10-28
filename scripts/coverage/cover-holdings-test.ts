/** Cover matching on Home tiles (Critic Q4, TE P148-3, Critic R247 Q1b follow-up), on the route's path: assembleTable over
 * checked readings, then lumpSumParts(tileRows(categoryRows(category, rows)), lines, held, category).
 *  - One person's covers of one product whose pages print different policy numbers are each a part, with their own
 *    document's rows and confirmed line, or no amount when their own document gives the tile none. They are never added
 *    up: a different number does not prove a second policy (a renewal, a group number beside a certificate number;
 *    Critic R258 H1, H2). Before, the tile showed one sum as if complete, or left a policy out.
 *  - One cover printed twice (same number, or a page with no number) stays one cover, as before.
 *  - A schedule line whose name has an accident word ("AD&D", "Accident Benefit") is not given an amount on Death or TPD.
 * Made-up SG, MY and UK households. Synthetic only; no model, no database, no network.
 *   node --import tsx scripts/coverage/cover-holdings-test.ts */
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { CheckedBenefit, CheckedCover, CheckedReading } from "@/lib/benefit-table/check";
import { chatRows } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
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
  t(`${m} H1 two numbers, equal sums: two parts, each 100,000, no total`, h1.total === null && h1.parts.length === 2 && h1.parts.every((x) => x.amount === 100000) && h1.covers === 2, show(h1));
  t(`${m} H1b each policy takes only its own document's row (no doubled rows)`, h1.rows === 2, show(h1));
  const h2 = tile([a, b], "Death", [line("Alder Term", ["polA"], 100000), line("Alder Term", ["polB"], 100000)]);
  t(`${m} H2 each policy's confirmed line joins its own policy: two parts, no total`, h2.total === null && h2.parts.length === 2 && h2.parts.every((x) => x.amount === 100000), show(h2));
  const b2 = reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [benefit("polB", "Death Benefit", 250000)]);
  const h3 = tile([a, b2], "Death");
  t(`${m} H3 two numbers, different sums: each part has its own sum, no total`, h3.total === null && h3.parts.map((x) => x.amount).sort().join() === "100000,250000", show(h3));
  // A wording printed on neither policy's document is shared: a percentage of the sum insured works out per policy.
  const w = reading("wording", [], [benefit("wording", "Death Benefit", null)], "policy_wording");
  const aNo = reading("polA", [cover("polA", { policyNumber: "AT-1001" })], []);
  const bNo = reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], []);
  const h4 = tile([aNo, bNo, w], "Death");
  t(`${m} H4 a shared wording's "100% of the sum insured" gives each policy its own sum, no total`, h4.total === null && h4.parts.map((x) => x.amount).sort().join() === "100000,250000", show(h4));
  const h5 = tile([a, b, reading("ben", [cover("ben", { person: "Ben Okafor", policyNumber: "AT-3003", sumInsured: 80000 })], [benefit("ben", "Death Benefit", 80000)])], "Death", [], "p-ben");
  t(`${m} H5 another person's policy of the same product never joins: Ben has his own one part`, h5.total === 80000 && h5.parts.length === 1, show(h5));

  // R: Critic R258 probes. A renewal that re-numbers, a scheme's group number beside a certificate number, and a policy
  // whose own document prints no row for the tile.
  const r1 = tile([reading("y2025", [cover("y2025", { policyNumber: "AT-1001" })], [benefit("y2025", "Death Benefit", 100000)]),
    reading("y2026", [cover("y2026", { policyNumber: "AT-1001-R1" })], [benefit("y2026", "Death Benefit", 100000)])], "Death");
  t(`${m} R1 one policy renewed under a new number: never 200,000`, r1.total !== 200000, show(r1));
  const r2 = tile([reading("summary", [cover("summary", { policyNumber: "G-55000" })], [benefit("summary", "Death Benefit", 100000)]),
    reading("cert", [cover("cert", { policyNumber: "C-000123" })], [benefit("cert", "Death Benefit", 100000)])], "Death");
  t(`${m} R2 summary (group number) and certificate (own number) of one policy: never 200,000`, r2.total !== 200000, show(r2));
  const r3 = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], [benefit("polA", "Death Benefit", 100000)]),
    reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [])], "Death");
  t(`${m} R3 policy B's document prints no row: A listed, B not claimed, and no total`, r3.total === null && r3.parts.length === 1 && r3.parts[0].amount === 100000, show(r3));
  const r3b = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], [benefit("polA", "Death Benefit", 100000)]),
    reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [])], "Death", [line("Alder Term", ["polB"], 250000)]);
  t(`${m} R3b B's confirmed line joins B's own part, still no total`, r3b.total === null && r3b.parts.length === 2 && r3b.parts.some((x) => x.amount === 250000), show(r3b));

  // R4 (Critic R259 M1): a tile of confirmed lines only, whose documents are two holdings, never adds them.
  const r4 = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], []), reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [])], "Death",
    [line("Alder Term", ["polA"], 100000), line("Alder Term", ["polB"], 250000)]);
  t(`${m} R4 confirmed lines only, on two holdings' documents: both listed, no total`, r4.total === null && r4.parts.length === 2, show(r4));
  const r4b = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], []), reading("polB", [cover("polB", { policyNumber: "AT-2002", sumInsured: 250000 })], [])], "Death",
    [line("Alder Term", ["polA"], 100000)]);
  t(`${m} R4b a line on one holding's document only: its own figure, no total (the other policy may hold it too)`, r4b.total === null && r4b.parts.length === 1, show(r4b));
  // N1 (TE P152): a policy with no row for the tile is not listed on it.
  const n1 = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], [benefit("polA", "Critical Illness Benefit", 100000)]),
    reading("polB", [cover("polB", { policyNumber: "AT-2002" })], [benefit("polB", "Death Benefit", 100000)])], "Critical Illness");
  t(`${m} N1 B prints no CI: the CI tile lists A only, with no total`, n1.parts.length === 1 && n1.parts[0].amount === 100000 && n1.total === null, show(n1));

  // F: TE P152. One policy's number written two ways is one policy (F1); an un-numbered copy never absorbs two numbered
  // policies, in either order (F2).
  for (const [x, y] of [["MT-104455", "MT104455"], ["00104455", "104455"], ["MT/104455", "mt 104455"], ["104455-01", "104455"]]) {
    const f1 = tile([reading("cert", [cover("cert", { policyNumber: x })], [benefit("cert", "Death Benefit", 100000)]),
      reading("summary", [cover("summary", { policyNumber: y })], [benefit("summary", "Death Benefit", 100000)])], "Death");
    t(`${m} F1 "${x}" and "${y}" are one policy: one part, 100,000`, f1.covers === 1 && f1.total === 100000 && f1.parts.length === 1, show(f1));
  }
  const un = reading("summary", [cover("summary", { policyNumber: null })], [benefit("summary", "Death Benefit", 100000)]);
  for (const [order, rs] of [["summary first", [un, a, b]], ["summary last", [a, b, un]]] as const) {
    const f2 = tile([...rs], "Death");
    t(`${m} F2 two numbered policies and an un-numbered summary (${order}): both policies listed, no total`, f2.covers === 2 && f2.total === null && f2.parts.length === 2, show(f2));
  }
  // F3 (TE P152): a number that only starts with the other is another policy: listed, never one policy's total.
  for (const [x, y] of [["AB1234567", "AB12345678"], ["7", "7104455"], ["MT1001", "MT10011"]]) {
    const f3 = tile([reading("polA", [cover("polA", { policyNumber: x })], [benefit("polA", "Death Benefit", 100000)]),
      reading("polB", [cover("polB", { policyNumber: y })], [benefit("polB", "Death Benefit", 100000)])], "Death");
    t(`${m} F3 "${x}" and "${y}" are two policies: two parts, no total`, f3.covers === 2 && f3.total === null && f3.parts.length === 2, show(f3));
  }
  // X8 (TE P152 mutant): a holding's own stated sum insured is compared with its own printed sum only.
  const x8 = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001", sumInsured: 120000 })], [benefit("polA", "Death Benefit", 100000)]), b], "Death");
  t(`${m} X8 A prints 100,000 but states a 120,000 sum insured: A gets no amount; B keeps its own`, x8.parts.some((x) => x.amount === null) && x8.parts.some((x) => x.amount === 100000), show(x8));
  // X7: rows are grouped by held policy, not cover type: A's only row is a threshold clause, which is left out only when
  // another row of the SAME policy gives the figure (TE P152 mutant X7).
  const x7 = tile([reading("polA", [cover("polA", { policyNumber: "AT-1001" })], [benefit("polA", "Death Benefit, paid in instalments where the sum payable is above S$200,000", 100000)]), b], "Death");
  t(`${m} X7 a policy whose only row is a clause keeps its own figure beside another policy`, x7.parts.filter((x) => x.amount === 100000).length === 2, show(x7));

  // M: the chat keeps each held policy's own start date (Critic R258 M1: the last one used to win for both).
  const aS = reading("polA", [cover("polA", { policyNumber: "AT-1001", startDate: "2020-01-01" })], [benefit("polA", "Death Benefit", 100000)]);
  const bS = reading("polB", [cover("polB", { policyNumber: "AT-2002", startDate: "2026-06-01" })], [benefit("polB", "Death Benefit", 100000)]);
  const doc = (id: string) => ({ policyId: id, name: `${id}.pdf`, insurer: null, productName: null, policyNumber: null, documentType: null, documentRole: null,
    effectiveDate: null, expiryDate: null, uploadedAt: null, uploadedFor: null, linkedPeople: [], supersededAt: null, processingStatus: "ready", pages: [] });
  const hh = { accountId: "a", members: [], documents: [doc("polA"), doc("polB")] } as unknown as Household;
  const cr = chatRows(assembleTable([aS, bS], family, linkAll([aS, bS])), hh).filter((r) => r.personId === "p-ana");
  const since = Object.fromEntries(cr.filter((r) => r.benefit === "Death Benefit").map((r) => [r.source.documentId, r.coverSince]));
  t(`${m} M1 each policy's chat rows carry its own start date`, since.polA === "2020-01-01" && since.polB === "2026-06-01", since);

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
  for (const n of ["Death by Misadventure", "Unintentional death benefit", "Manfaat Kematian Akibat Kemalangan", "ADD Benefit"]) {
    t(`${m} Q9 "${n}" stored as Death: no amount`, q(n).amount === null, q(n));
    t(`${m} Q9b "${n}" stored as Personal Accident keeps its amount`, q(n, "Personal Accident").amount === 50000, q(n, "Personal Accident"));
  }
  t(`${m} Q11 "ADD-ON TERM COVER", "TERM LIFE ADD ON" and "DEATH ADD-ONS" keep their amount`, q("ADD-ON TERM COVER").amount === 50000 && q("TERM LIFE ADD ON").amount === 50000 && q("DEATH ADD-ONS").amount === 50000, [q("ADD-ON TERM COVER"), q("TERM LIFE ADD ON"), q("DEATH ADD-ONS")]);
  t(`${m} Q10 "Additional Death Benefit" (not the capital ADD) keeps its amount`, q("Additional Death Benefit").amount === 50000, q("Additional Death Benefit"));
  t(`${m} Q8 "Death Benefit (illness or accident)" stored as Death keeps its amount`, q("Death Benefit (illness or accident)").amount === 50000, q("Death Benefit (illness or accident)"));

}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
