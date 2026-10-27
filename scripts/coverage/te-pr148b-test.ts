/** Test engineer, PR #148 at 2d9d127 (S5 corrected for #149 c252ed5): the sum-rule tiles (lumpSumParts in lib/coverage/table-figures.ts) for Death, TPD, CI,
 * Early CI and PA, on the path the dashboard route takes: lumpSumParts(tileRows(categoryRows(category, rows)), lines, held).
 * Made-up multi-document SG, MY and UK households with negative controls. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr148b-test.ts */
import { categoryRows, LUMP_SUM_CATEGORIES, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type R = SummaryRow & { coverKey: string; product: string; cover: string; plan: string | null; source: { documentId: string } | null };
const MARKETS = [
  { m: "SG", cur: "SGD", sign: "S$" },
  { m: "MY", cur: "MYR", sign: "RM" },
  { m: "UK", cur: "GBP", sign: "£" },
] as const;

for (const { m, cur, sign } of MARKETS) {
  const row = (doc: string | null, coverKey: string, benefit: string, amount: number | null, o: Partial<SummaryRow> = {}): R => ({
    coverKey, product: coverKey, cover: coverKey, plan: null, source: doc ? { documentId: doc } : null, benefit, section: null, pays: "amount",
    figure: amount == null ? { kind: "none", why: "See the page" } : { kind: "printed", amount, currency: sign, unit: "lump_sum" },
    qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as R);
  const line = (name: string, docs: string[], amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });
  const held = (coverKey: string, doc: string | null, sumInsured: number | null, currency: string | null = sign): HeldCover => ({ coverKey, name: coverKey, documentId: doc, sumInsured, currency });
  const tile = (category: string, rows: R[], lines: (ConfirmedLine & { name: string })[] = [], h: HeldCover[] = []) => lumpSumParts(tileRows(categoryRows(category, rows)), lines, h);
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, parts: r.parts.map((p) => `${p.name}=${p.amount ?? "?"} ${p.currency ?? ""}`) });

  // S: the sum rule on a multi-document household.
  const hh = [
    row("cert1", "Group Term Life", "Death Benefit", 400000), row("sum1", "Group Term Life", "Death Benefit", 400000),
    row("pol2", "Alder Whole Life", "Death Benefit", 150000),
    row("pol3", "Birch Term Plan", "Death Benefit", 250000),
  ];
  const s1 = tile("Death", hh, [line("Group Term Life", ["cert1"], 400000)], [held("Alder Whole Life", "pol2", 150000), held("Birch Term Plan", "pol3", 250000)]);
  t(`${m} S1 a line and two table-only policies add up to their sum`, s1.total === 800000 && s1.parts.length === 3, show(s1));
  t(`${m} S2 the summary and certificate of one scheme (same cover) count once`, s1.parts.filter((p) => p.amount === 400000).length === 1, show(s1));
  const s3 = tile("Death", hh, [line("Group Term Life", ["cert1"], 400000)], [held("Alder Whole Life", "pol2", 150000), held("Birch Term Plan", "pol3", null)]);
  t(`${m} S3 a policy with no stated sum insured still gives its one printed sum`, s3.total === 800000, show(s3));
  const s4 = tile("Death", [...hh, row("pol4", "Cedar Plan", "Death Benefit", null)], [line("Group Term Life", ["cert1"], 400000)]);
  t(`${m} S4 a policy whose sum is not read: no total, the policy named with no amount`, s4.total === null && s4.parts.some((p) => p.name === "Cedar Plan" && p.amount === null), show(s4));
  // Grader correction (TE, #149 c252ed5): S5 expected a cover printing no amount to give its stated sum insured. Original grade
  // kept: S5 passed (total 90,000) on #148 2d9d127 to 450969f, and failed on #149 c252ed5. Reason: a sum insured can be
  // notional (a plan whose death benefit is the higher of premiums or cash value), so the fallback now needs a row that pays a
  // share of the sum insured; with none, the unsure case shows no figure. S5 now expects no amount; S5b is the positive case.
  const s5 = tile("Death", [row("pol4", "Cedar Plan", "Death Benefit", null)], [], [held("Cedar Plan", "pol4", 90000)]);
  t(`${m} S5 no row prints an amount and none pays a share of the sum insured: no amount`, s5.total === null, show(s5));
  const s5b = tile("Death", [{ ...row("pol4", "Cedar Plan", "Death Benefit", null), pays: "percent", percentOf: "sum_insured" } as R], [], [held("Cedar Plan", "pol4", 90000)]);
  t(`${m} S5b no row prints an amount, a row pays a share of the sum insured: the sum insured with its currency`, s5b.total === 90000, show(s5b));
  const s6 = tile("Death", [row("pol4", "Cedar Plan", "Death Benefit", null)], [], [held("Cedar Plan", "pol4", 90000, null)]);
  t(`${m} S6 a sum insured with no currency: no amount`, s6.total === null, show(s6));
  const s7 = tile("Death", [row("pol4", "Cedar Plan", "Death Benefit", null)], [], [held("Cedar Plan", "pol4", 90000, "$")]);
  t(`${m} S7 a sum insured with a bare "$": no amount`, s7.total === null, show(s7));
  const s8 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000)], [line("Alder Whole Life", ["d1"], null)]);
  t(`${m} S8 a confirmed line with no amount: no total`, s8.total === null, show(s8));

  const s9 = tile("Death", [row(null, "Group Term Life", "Death Benefit", 400000)], [line("Group Term Life", ["cert1"], 400000)], [held("Group Term Life", "cert1", 400000)]);
  t(`${m} S9 a cover known by its held document (rows carry no source) takes its line once`, s9.total === 400000 && s9.parts.length === 1, show(s9));
  const s10 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 300000), row("d1", "Alder Term Rider", "Death Benefit (term rider)", 100000)], [line("Alder Whole Life", ["d1"], 300000)]);
  t(`${m} S10 a rider with its own sum on the line's document is its own part`, s10.total === 400000 && s10.parts.length === 2, show(s10));

  // N: negative controls.
  const n1 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000)], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} N1 the printed sum differs from the stated sum insured: no amount`, n1.total === null && n1.parts[0]?.amount === null, show(n1));
  const n2 = tile("Death", [row("a1", "Alder Whole Life", "Death Benefit", 100000), row("b1", "Birch Term Plan", "Death Benefit", 100000)]);
  t(`${m} N2 two covers joined only by an equal amount stay two policies`, n2.total === 200000 && n2.parts.length === 2, show(n2));
  const n3 = tile("Death", [row("a1", "Alder Whole Life", "Death Benefit", 100000), row("b1", "Birch Term Plan", "Death Benefit", 100000)], [line("Alder Whole Life", ["a1"], 100000)]);
  t(`${m} N3 an equal-amount line does not swallow the other policy`, n3.total === 200000 && n3.parts.length === 2, show(n3));
  const hosp = [row("h1", "Alder Shield", "Daily Hospital Cash Benefit", 100, { pays: "per_day", figure: { kind: "printed", amount: 100, currency: sign, unit: "per_day" } }),
    row("h2", "Birch Shield", "Daily Hospital Cash Benefit", 150, { pays: "per_day", figure: { kind: "printed", amount: 150, currency: sign, unit: "per_day" } })];
  t(`${m} N4 Hospital Cash is not a lump-sum category`, !LUMP_SUM_CATEGORIES.has("Hospital Cash") && !LUMP_SUM_CATEGORIES.has("Hospitalisation") && !LUMP_SUM_CATEGORIES.has("Outpatient"), [...LUMP_SUM_CATEGORIES]);
  const n5 = tile("Death", [...hh.slice(2), ...hosp]);
  t(`${m} N5 hospital rows never enter a Death tile's sum`, n5.total === 400000 && n5.parts.length === 2, show(n5));
  const n6 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000, { figure: { kind: "printed", amount: 150000, currency: sign, unit: "up_to" } })]);
  t(`${m} N6 an "up to" figure is not a sum: no amount`, n6.total === null, show(n6));
  const n7 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000, { conditions: ["reduced by half after age sixty-five"] })]);
  t(`${m} N7 a sum with a limit: no amount`, n7.total === null, show(n7));
  const n8 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000), row("d1", "Alder Whole Life", "Death Benefit (from age 70)", 75000)]);
  t(`${m} N8 one cover printing two different sums: no amount`, n8.total === null, show(n8));
  const n9 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000, { figure: { kind: "printed", amount: 150000, currency: "$", unit: "lump_sum" } })]);
  t(`${m} N9 a bare "$" sum: no amount`, n9.total === null, show(n9));
  const n10 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000, { figure: { kind: "printed", amount: 150000, currency: "USD", unit: "lump_sum" } }), ...hh.slice(3)]);
  t(`${m} N10 two currencies: no total`, n10.total === null && n10.parts.every((p) => p.amount != null), show(n10));
  const n11 = tile("Death", [row("d1", "Alder Whole Life", "Death Benefit", 150000, { figure: { kind: "projected", amount: 900000, currency: sign, basis: "illustrated", asOf: null } })]);
  t(`${m} N11 a projected value is never a part`, n11.parts.length === 0, show(n11));

  // C: the other lump-sum categories.
  const c1 = tile("Total Permanent Disability", [row("a1", "Alder Whole Life", "Total and Permanent Disability Benefit", 150000), row("w1", "Waiver", "Waiver of premium on total and permanent disability", null, { pays: "words" })]);
  t(`${m} C1 TPD: a waiver-of-premium cover is not a part`, c1.total === 150000 && c1.parts.length === 1, show(c1));
  const c2 = tile("Critical Illness", [row("a1", "Alder CI", "Critical Illness Benefit", 200000), row("b1", "Birch CI", "Early Critical Illness Benefit", 50000)]);
  t(`${m} C2 CI: an early CI row is not added into CI`, c2.total === 200000 && c2.parts.length === 1, show(c2));
  const c3 = tile("Early Critical Illness", [row("b1", "Birch CI", "Early Critical Illness Benefit", 50000)]);
  t(`${m} C3 Early CI on its own tile`, c3.total === 50000, show(c3));
  const c4 = tile("Personal Accident", [row("p1", "Group Personal Accident", "Accidental Death Benefit", 300000), row("a1", "Alder Whole Life", "Death Benefit", 150000)]);
  t(`${m} C4 PA: a plain death benefit is not added into PA`, c4.total === 300000 && c4.parts.length === 1, show(c4));
  const TRAVEL = "Kestrel Single Trip Travel Insurance";
  const trip = { ...row("t1", TRAVEL, "Accidental death while overseas", 100000), product: TRAVEL, cover: TRAVEL } as R;
  const c5 = tile("Personal Accident", [row("p1", "Group Personal Accident", "Accidental Death Benefit", 300000), trip]);
  t(`${m} C5 PA: a trip-only travel cover is not added to standing accident cover`, c5.total === 300000 && c5.parts.length === 1, show(c5));
  const c6 = tile("Personal Accident", [row("p1", "Group Personal Accident", "Accidental Death Benefit", 300000), row("p1", "Group Personal Accident", "Accidental Death Benefit (double indemnity on public transport)", 600000)]);
  t(`${m} C6 PA: one cover printing two sums: no amount, never 900,000`, c6.total === null, show(c6));
  const c7 = tile("Total Permanent Disability", [row("g1", "Group Term Life", "Total and Permanent Disability Benefit", 400000), row("g1", "Group Term Life", `TPD: paid in instalments where the sum payable is above ${sign}200,000`, 200000)]);
  t(`${m} C7 TPD: a threshold clause row of the same cover is not a second sum`, c7.total === 400000, show(c7));

  // P: probes of the joins.
  // P148-2: a scheme's certificate holds the confirmed line but its rows are not in this tile (another category name, or not
  // read), and its summary prints the same sum under its own name. The two are one policy.
  const p2 = tile("Death", [row("sum1", "GTL Scheme Summary", "Death Benefit", 400000)], [line("Group Term Life", ["cert1"], 400000)]);
  t(`${m} P2 the same scheme's summary (no shared document) beside its certificate's line: never a doubled total`, p2.total !== 800000, show(p2));
  // P148-3: two policies of the same product, same sum, separate documents, no lines: one coverKey.
  const p3 = tile("Death", [row("a1", "Alder Term Plan", "Death Benefit", 100000), row("a2", "Alder Term Plan", "Death Benefit", 100000)], [], [held("Alder Term Plan", "a1", 100000), held("Alder Term Plan", "a2", 100000)]);
  t(`${m} P3 two policies of one product with the same sum: never shown as one policy's sum`, p3.total !== 100000, show(p3), true);
}

console.log(`\nte pr148b: ${pass} passed, ${fail} failed, ${notes.length} notes`);
if (fail) process.exit(1);
