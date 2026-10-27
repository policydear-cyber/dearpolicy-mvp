/** Test engineer, PR #152: two policies of one product (two printed numbers) are two tile parts; accident-worded confirmed
 * lines give no amount on Death / TPD / CI. Independent of cover-holdings-test. Path as the route: assembleTable over
 * checked readings, then lumpSumParts(tileRows(categoryRows(category, rows)), lines, held, category).
 * Made-up SG / MY / UK households; no model, no database, no network.
 *   node --import tsx scripts/coverage/te-pr152-test.ts
 * Grades: PASS/FAIL are requirements. NOTE lines record behaviour for review (not graded). A doubled sum is the worst
 * outcome; a total of null (no total shown) is the safe outcome when two documents may be one policy.
 * Grader corrections for df4c84b (Critic R258, builder decision: same-product policies with different printed numbers are
 * listed, never added): M1, M1b, M3, M4, M5 (Lina), M7 expected a sum on 85841ce; they now expect each policy's own
 * amount as a part and NO total. Original grades (PASS on 85841ce) are kept in pr152-results.md. */
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { CheckedBenefit, CheckedCover, CheckedReading } from "@/lib/benefit-table/check";
import { categoryRows, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown) { if (ok) { pass++; return; } fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); }
const note = (s: string) => notes.push(s);

const family: FamilyMember[] = [{ id: "p-1", display_name: "Lina Chua" }, { id: "p-2", display_name: "Omar Rashid" }, { id: "p-3", display_name: "Grace Whitfield" }];
const PRODUCT = "Maple Term Life";

for (const { m, cur } of [{ m: "SG", cur: "SGD" }, { m: "MY", cur: "MYR" }, { m: "UK", cur: "GBP" }] as const) {
  const src = (doc: string) => ({ documentId: doc, document: `${doc}.pdf`, page: 1, excerpt: "" });
  const cover = (doc: string, o: Partial<CheckedCover> = {}): CheckedCover => ({ person: "Lina Chua", product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null,
    policyNumber: null, sumInsured: 100000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "", source: src(doc), currency: cur, ...o });
  const ben = (doc: string, name: string, value: number | null, o: Partial<CheckedBenefit> = {}): CheckedBenefit => ({ section: "Benefits", column: null, benefit: name,
    pays: value == null ? "percent" : "amount", value: value ?? 100, period: null, basis: null, asOf: null, percentOf: value == null ? "sum_insured" : null, baseAmount: null,
    baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "", source: src(doc), currency: cur, baseSource: null,
    capSource: null, capUnread: false, droppedConditions: [], ...o });
  const rd = (doc: string, covers: CheckedCover[], benefits: CheckedBenefit[], kind: CheckedReading["kind"] = "personal_proof"): CheckedReading =>
    ({ documentId: doc, document: `${doc}.pdf`, kind, product: PRODUCT, plan: null, namedPeople: covers.map((c) => c.person), covers, benefits, dropped: [] });
  const keyOf = (product = PRODUCT) => coverKeyOf({ product, cover: product, plan: null });
  const links = (rs: CheckedReading[], to: Record<string, string> = {}) => [...new Set(rs.flatMap((r) => r.benefits.map((b) => sectionKeyOf(r.documentId, b))))]
    .map((section) => ({ section, cover: to[section.split("|")[0]] ?? keyOf(), why: "te" }));
  const line = (name: string, docs: string[], amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });
  const tile = (rs: CheckedReading[], category = "Death", lines: (ConfirmedLine & { name: string })[] = [], person = "p-1", to: Record<string, string> = {}) => {
    const p = assembleTable(rs, family, links(rs, to)).people.find((x) => x.id === person)!;
    const held: HeldCover[] = p.covers.map((c) => ({ coverKey: c.coverKey, ...(c.holding ? { holding: c.holding } : {}), name: c.cover, documentId: c.source.documentId, sumInsured: c.sumInsured, currency: c.currency }));
    const r = lumpSumParts(tileRows(categoryRows(category, p.rows)), lines, held, category);
    return { ...r, covers: p.covers.length, holdings: p.covers.map((c) => c.holding ?? "-"), show: { total: r.total, parts: r.parts.map((x) => `${x.name}=${x.amount ?? "?"}`), covers: p.covers.length } };
  };
  const amounts = (r: { parts: { amount: number | null }[] }) => r.parts.map((p) => p.amount).sort((a, b) => (b ?? -1) - (a ?? -1)).join(",");
  const numbered = (doc: string, num: string | null, sum = 100000, o: Partial<CheckedCover> = {}) => rd(doc, [cover(doc, { policyNumber: num, sumInsured: sum, ...o })], [ben(doc, "Death Benefit", sum)]);

  // S: ONE policy whose two documents print its number differently. Must never become two policies (doubled sum).
  const spellings: [string, string, string][] = [
    ["S1 hyphen vs none", "MT-104455", "MT104455"],
    ["S2 leading zeros", "00104455", "104455"],
    ["S3 spaces vs hyphen", "MT 104 455", "MT-104-455"],
    ["S4 case", "mt104455", "MT104455"],
    ["S5 slash vs none", "MT/104455", "MT104455"],
    ["S6 rider suffix", "104455-01", "104455"],
  ];
  for (const [id, x, y] of spellings) {
    const r = tile([numbered("cert", x), numbered("summary", y)]);
    t(`${m} ${id}: "${x}" and "${y}" are one policy: total never doubled`, r.total !== 200000, r.show);
    t(`${m} ${id}: a total is either 100,000 or none`, r.total === 100000 || r.total === null, r.show);
    if (r.total !== 100000) note(`${m} ${id}: total ${r.total}, parts ${r.show.parts.join("; ")}`);
  }
  // S7: the scheme's number on its benefit summary, the member certificate's own number on the certificate: same cover, same person.
  {
    const r = tile([numbered("scheme-summary", "GRP-5521"), numbered("member-cert", "CERT-88-0192")]);
    t(`${m} S7 group number vs certificate number for one cover: never doubled`, r.total !== 200000, r.show);
    if (r.total !== 100000) note(`${m} S7: total ${r.total} (${r.covers} covers)`);
  }

  // M: multi-document households.
  // M1 two numbered policies plus a shared wording (100% of sum insured).
  {
    const w = rd("wording", [], [ben("wording", "Death Benefit", null)], "policy_wording");
    const r = tile([rd("pA", [cover("pA", { policyNumber: "MT-1001" })], []), rd("pB", [cover("pB", { policyNumber: "MT-2002", sumInsured: 60000 })], []), w]);
    t(`${m} M1 two numbered policies + shared wording: parts 100,000 and 60,000, no total`, r.total === null && amounts(r) === "100000,60000", r.show);
  }
  // M1b same, and each policy document also prints its own lump sum.
  {
    const w = rd("wording", [], [ben("wording", "Death Benefit", null)], "policy_wording");
    const r = tile([numbered("pA", "MT-1001"), numbered("pB", "MT-2002", 60000), w]);
    t(`${m} M1b numbered policies with own rows + wording: parts 100,000 and 60,000, no total`, r.total === null && amounts(r) === "100000,60000", r.show);
  }
  // M2 summary and certificate of ONE policy, only the certificate prints a number.
  {
    const r = tile([numbered("cert", "MT-1001"), numbered("summary", null)]);
    t(`${m} M2 certificate (numbered) + summary (no number) of one policy: one part, 100,000`, r.total === 100000 && r.parts.length === 1 && r.covers === 1, r.show);
    const r2 = tile([numbered("summary", null), numbered("cert", "MT-1001")]);
    t(`${m} M2b same, summary read first: one part`, r2.total === 100000 && r2.parts.length === 1, r2.show);
  }
  // M3 two numbered policies with EQUAL sums, plus an un-numbered summary of the first.
  for (const order of ["summary-last", "summary-first"]) {
    const docs = [numbered("pA", "MT-1001"), numbered("pB", "MT-2002"), numbered("summary", null)];
    const r = tile(order === "summary-first" ? [docs[2], docs[0], docs[1]] : docs);
    t(`${m} M3 two equal numbered policies + un-numbered summary (${order}): both policies listed, no total`, r.total === null && amounts(r) === "100000,100000", r.show);
    t(`${m} M3 ${order}: total is never 300,000`, r.total !== 300000, r.show);
  }
  // M4 a scheme cover and a personal policy of the same product for one person, with confirmed lines.
  {
    const rs = [numbered("scheme", "GRP-77", 200000), numbered("personal", "PP-55", 100000)];
    const r = tile(rs, "Death", [line(PRODUCT, ["scheme"], 200000), line(PRODUCT, ["personal"], 100000)]);
    t(`${m} M4 scheme 200,000 + personal 100,000, each with its own line: both listed, no total`, r.total === null && amounts(r) === "200000,100000", r.show);
  }
  // M5 a scheme summary that lists two members, plus one member's own personal policy of the same product.
  {
    const summary = rd("scheme", [cover("scheme", { policyNumber: "GRP-77", sumInsured: 200000 }), cover("scheme", { person: "Omar Rashid", policyNumber: "GRP-77", sumInsured: 150000 })],
      [ben("scheme", "Death Benefit", null)]);
    const rs = [summary, numbered("personal", "PP-55", 100000)];
    const lina = tile(rs, "Death", [], "p-1"), omar = tile(rs, "Death", [], "p-2");
    t(`${m} M5 Lina: scheme 200,000 and personal 100,000 listed, no total`, lina.total === null && amounts(lina) === "200000,100000", lina.show);
    t(`${m} M5 Omar: scheme only, 150,000, one part (Lina's personal policy never reaches him)`, omar.total === 150000 && omar.parts.length === 1, omar.show);
  }
  // M6 one confirmed line that names both numbered documents: never counted as each.
  {
    const r = tile([numbered("pA", "MT-1001"), numbered("pB", "MT-2002")], "Death", [line(PRODUCT, ["pA", "pB"], 200000)]);
    t(`${m} M6 one line over both policies' documents: total 200,000 or none, never 400,000`, r.total === 200000 || r.total === null, r.show);
    if (r.total !== 200000) note(`${m} M6: total ${r.total} parts ${r.show.parts.join("; ")}`);
  }
  // M7 a third person with two numbered policies and an ended single-trip travel cover (not Death).
  {
    const g = (doc: string, num: string, sum: number) => rd(doc, [cover(doc, { person: "Grace Whitfield", policyNumber: num, sumInsured: sum })], [ben(doc, "Death Benefit", sum)]);
    const r = tile([g("g1", "MT-9001", 80000), g("g2", "MT-9002", 45000)], "Death", [], "p-3");
    t(`${m} M7 Grace: 80,000 and 45,000 listed, no total`, r.total === null && amounts(r) === "80000,45000", r.show);
  }
  // M8 a different product with the other policy's number never merges or splits.
  {
    const r = tile([numbered("pA", "MT-1001"), rd("pB", [cover("pB", { product: "Cedar Whole Life", cover: "Cedar Whole Life", policyNumber: "MT-1001", sumInsured: 30000 })],
      [ben("pB", "Death Benefit", 30000)])], "Death", [], "p-1", { pB: keyOf("Cedar Whole Life") });
    t(`${m} M8 two products: 100,000 + 30,000`, r.total === 130000 && r.parts.length === 2, r.show);
  }
  // M9 a numbered policy's own document carries a CI section too: CI rows stay with that policy only.
  {
    const a = rd("pA", [cover("pA", { policyNumber: "MT-1001" })], [ben("pA", "Death Benefit", 100000), ben("pA", "Critical Illness Benefit", 40000, { section: "CI" })]);
    const b = numbered("pB", "MT-2002", 60000);
    const r = tile([a, b], "Critical Illness");
    // Graded first as 40,000 / one part; main 44fb9ec gives the same null (a CI sum that differs from the base sum
    // insured has no amount under the #148 sum rule), so it is not this PR's: kept as a note, and as a guard that the CI
    // row never becomes one part per policy.
    t(`${m} M9 CI printed only on policy A: policy B (no CI anywhere) never gets a CI amount, and no total`, r.parts.filter((p) => p.amount != null).length <= 1 && r.total !== 80000, r.show);
    note(`${m} M9: CI tile parts ${r.show.parts.join("; ")} total ${r.total}`);
    if (r.total !== 40000) note(`${m} M9 (also on main): CI-only-on-policy-A tile total ${r.total}, parts ${r.show.parts.join("; ")}`);
  }

  // M11 policy B's documents give this tile no row. Grader correction (logged in pr152-results.md): graded at df4c84b as
  // "B listed without an amount, no total" (PASS there, original grade kept); since 90797b1 (TE N1, a holding whose own
  // document gives the tile no row is not listed) B is not listed. Still required: no total, and B never gets an amount.
  {
    const r = tile([numbered("pA", "MT-1001"), rd("pB", [cover("pB", { policyNumber: "MT-2002", sumInsured: 60000 })], [])]);
    t(`${m} M11 a holding with no row: never given an amount, and no total`, r.total === null && amounts(r) === "100000", r.show);
  }
  // M12 holdings of one product never stop another person's or another product's tile from adding up.
  {
    const rs = [numbered("pA", "MT-1001"), numbered("pB", "MT-2002", 60000),
      rd("om", [cover("om", { person: "Omar Rashid", policyNumber: "MT-3003", sumInsured: 90000 })], [ben("om", "Death Benefit", 90000)]),
      rd("om2", [cover("om2", { person: "Omar Rashid", product: "Cedar Whole Life", cover: "Cedar Whole Life", policyNumber: "CW-1", sumInsured: 10000 })], [ben("om2", "Death Benefit", 10000)])];
    const o = tile(rs, "Death", [], "p-2", { om2: keyOf("Cedar Whole Life") });
    t(`${m} M12 Omar (one Maple policy, one Cedar): 100,000 total`, o.total === 100000 && o.parts.length === 2, o.show);
  }

  // P (9b3dd5a): the "one number starts with the other" rule must not merge two real policies of equal sum.
  for (const [id, x, y] of [["P1 one digit longer", "AB1234567", "AB12345678"], ["P2 short member number", "7", "7104455"], ["P3 shared stem", "MT1001", "MT10011"]]) {
    const r = tile([numbered("pA", x), numbered("pB", y)]);
    t(`${m} ${id}: "${x}" and "${y}" (two policies, equal sums) never show a one-policy total`, r.total !== 100000, r.show);
  }
  // P5-P6 (a1db9a1, notes): a 1-3 character suffix after a separator is read as the same policy.
  for (const [x, y] of [["MT-1001-2", "MT-1001"], ["P-12345-01", "P-12345-02"]]) {
    const r = tile([numbered("pA", x), numbered("pB", y)]);
    note(`${m} P5 "${x}" vs "${y}" (equal sums): total ${r.total}, parts ${r.show.parts.join("; ")}`);
    t(`${m} P6 "${x}" vs "${y}": never 200,000`, r.total !== 200000, r.show);
  }
  // Unrelated-looking numbers of one policy: listed, no total (R258).
  {
    const r = tile([numbered("pA", "SG-104455"), numbered("pB", "104455")]);
    t(`${m} P4 "SG-104455" vs "104455": total 100,000 or none, never 200,000`, r.total === 100000 || r.total === null, r.show);
  }

  // M10 a table row named "AD&D Benefit" (not a confirmed line) belongs on the Personal Accident tile, not Death.
  {
    const rs = [rd("pA", [cover("pA", { policyNumber: "MT-1001" })], [ben("pA", "Death Benefit", 100000), ben("pA", "AD&D Benefit", 250000, { section: "Riders" })])];
    const d = tile(rs, "Death"), pa = tile(rs, "Personal Accident");
    t(`${m} M10 Death tile: 100,000 only (the AD&D row is not death cover)`, d.total === 100000 && d.parts.length === 1, d.show);
    t(`${m} M10 Personal Accident tile shows the AD&D row`, pa.parts.length === 1, pa.show);
  }

  // A: confirmed-line names with accident wording, on Death / TPD / CI: no amount. Controls keep theirs.
  const q = (name: string, category: string) => lumpSumParts([], [line(name, ["x"], 50000)], [], category).parts[0].amount;
  const accident = ["AD&D Benefit", "AD & D", "ad&d", "Accidental Death & Dismemberment", "Accidental Death and Disablement", "Accident Benefit", "Accidental Death Benefit",
    "Death by Accident", "Accident Death Benefit Rider", "Injury Benefit", "Accidental TPD", "Personal Accident Cover", "Death due to accident only", "Death (Accident)",
    "Travel Accident Death", "Accidental Dismemberment", "Accident Plan", "Accidents Cover", "Injured Person Benefit", "Accidental Total Permanent Disability",
    // Added at 9b3dd5a (were notes at 85841ce/df4c84b, where they showed an amount):
    "Manfaat Kematian Akibat Kemalangan", "Death by Misadventure", "ADD Benefit", "Unintentional death benefit"];
  for (const cat of ["Death", "Total Permanent Disability", "Critical Illness"]) for (const n of accident)
    t(`${m} A ${cat}: "${n}" gives no amount`, q(n, cat) === null, q(n, cat));
  for (const n of ["AD&D Benefit", "Accident Benefit", "Accidental Death Benefit", "Injury Benefit", "Manfaat Kematian Akibat Kemalangan", "Death by Misadventure", "ADD Benefit"])
    t(`${m} A-PA control: "${n}" on the Personal Accident tile keeps its amount`, q(n, "Personal Accident") === 50000, q(n, "Personal Accident"));
  const anyCause: [string, string][] = [["Group Term Life", "Death"], ["Whole Life Plan", "Death"], ["Death Benefit (illness or accident)", "Death"],
    ["Term Life", "Death"], ["Total Permanent Disability Benefit", "Total Permanent Disability"], ["Critical Illness Plus", "Critical Illness"], ["Life Assurance", "Death"],
    ["Addendum Life Cover", "Death"], ["Add-on Term Cover", "Death"], ["Roadside Death"]].filter((x) => x.length === 2) as [string, string][];
  for (const [n, cat] of anyCause) t(`${m} A-control ${cat}: "${n}" keeps its amount`, q(n, cat) === 50000, q(n, cat));
  // Notes: phrasings outside the English word list (recorded, not graded).
  for (const n of ["Accidents excluded: Death Benefit", "ADD-ON TERM COVER", "TERM LIFE ADD ON", "ADDITIONAL DEATH BENEFIT", "Manfaat Kematian", "Hayat Berkelompok"])
    note(`${m} A-note Death: "${n}" -> ${q(n, "Death") === null ? "no amount" : "amount shown"}`);
}

console.log(`te-pr152: ${pass} passed, ${fail} failed`);
for (const n of [...new Set(notes)]) console.log("NOTE " + n);
process.exit(fail ? 1 : 0);
