/** Test engineer, PR #149 at c252ed5: sums insured on the sum-rule tiles (lumpSumParts in lib/coverage/table-figures.ts):
 * (1) a lump sum equal to the cover's sum insured counts whatever its conditions; (2) a cover printing no amount gives its sum
 * insured only where a row pays a share of it; (3) labels (accelerates, policy numbers, a line named for another category).
 * Made-up SG, MY and UK households with negative controls. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr149-test.ts */
import { categoryRows, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type R = SummaryRow & { coverKey: string; product: string; cover: string; plan: string | null; source: { documentId: string } | null; percentOf?: string | null };
const MARKETS = [
  { m: "SG", cur: "SGD", sign: "S$", other: "USD" },
  { m: "MY", cur: "MYR", sign: "RM", other: "SGD" },
  { m: "UK", cur: "GBP", sign: "£", other: "EUR" },
] as const;

for (const { m, cur, sign, other } of MARKETS) {
  const row = (doc: string | null, coverKey: string, benefit: string, amount: number | null, o: Partial<R> = {}): R => ({
    coverKey, product: coverKey, cover: coverKey, plan: null, source: doc ? { documentId: doc } : null, benefit, section: null, pays: "amount",
    figure: amount == null ? { kind: "none", why: "See the page" } : { kind: "printed", amount, currency: sign, unit: "lump_sum" },
    qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as R);
  const share = (doc: string, coverKey: string, benefit: string, pct: number, percentOf: string) =>
    row(doc, coverKey, benefit, null, { pays: "percent", percentOf, figure: { kind: "none", why: `${pct}% of the sum insured: see the document` } } as Partial<R>);
  const line = (name: string, docs: string[], amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });
  const held = (coverKey: string, doc: string | null, sumInsured: number | null, currency: string | null = sign, name = coverKey): HeldCover => ({ coverKey, name, documentId: doc, sumInsured, currency });
  const tile = (category: string, rows: R[], lines: (ConfirmedLine & { name: string })[] = [], h: HeldCover[] = []) => lumpSumParts(tileRows(categoryRows(category, rows)), lines, h, category);
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, parts: r.parts.map((p) => `${p.name}=${p.amount ?? "?"} ${p.currency ?? ""}${p.accelerates ? " (acc)" : ""}`) });
  const D = "Death";

  // I: a lump sum equal to the sum insured is the sum insured, whatever its conditions.
  const cond = (c: string) => tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { conditions: [c] })], [], [held("Alder Whole Life", "d1", 200000)]);
  for (const [id, c] of [["I1", "reduced by half after age sixty-five"], ["I2", "less any amount already paid under the TPD benefit"],
    ["I3", "only the higher of premiums paid or cash value is payable in the first policy year"], ["I4", "payable in five yearly instalments"],
    ["I5", "No benefit if death occurs within 12 months due to suicide"]] as const) {
    const r = cond(c);
    t(`${m} ${id} a reducing condition ("${c.slice(0, 40)}"), printed = sum insured: the part is the sum insured, never a lower or other figure`, r.parts.length === 1 && (r.parts[0].amount === 200000 || r.parts[0].amount === null), show(r));
  }
  const i6 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { conditions: ["reduced by half after age sixty-five"] })], [], [held("Alder Whole Life", "d1", 250000)]);
  t(`${m} I6 negative control: the same condition, printed sum is not the sum insured: no amount`, i6.total === null && i6.parts[0]?.amount === null, show(i6));
  const i7 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { conditions: ["reduced by half after age sixty-five"] })]);
  t(`${m} I7 negative control: the condition and no stated sum insured: no amount`, i7.total === null, show(i7));
  const i8 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { conditions: ["reduced by half after age sixty-five"], figure: { kind: "printed", amount: 200000, currency: sign, unit: "up_to" } })], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} I8 negative control: an "up to" figure equal to the sum insured with a condition: no amount`, i8.total === null, show(i8));
  const i9 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { conditions: ["reduced by half after age sixty-five"], figure: { kind: "printed", amount: 200000, currency: "$", unit: "lump_sum" } })], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} I9 negative control: a bare "$" figure equal to the sum insured: no amount`, i9.total === null, show(i9));
  const i10 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { figure: { kind: "printed", amount: 200000, currency: other, unit: "lump_sum" }, conditions: ["reduced by half after age sixty-five"] })], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} I10 the figure equals the sum insured's number but in another currency: no amount`, i10.total === null, show(i10));
  const i11 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000), row("d1", "Alder Whole Life", "Death Benefit (from age 70)", 100000)], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} I11 two sums, one equal to the sum insured: the sum insured, never 300,000 or 100,000`, i11.parts.length === 1 && (i11.parts[0].amount === 200000 || i11.parts[0].amount === null), show(i11));
  const i12 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 200000, { figure: { kind: "projected", amount: 200000, currency: sign, basis: "illustrated", asOf: null } } as Partial<R>)], [], [held("Alder Whole Life", "d1", 200000)]);
  t(`${m} I12 a projected value equal to the sum insured never counts`, i12.parts.length === 0, show(i12));
  const i13 = tile("Personal Accident", [row("g1", "Group Personal Accident", "Accidental Death Benefit", 600000), row("g1", "Group Personal Accident", "Accidental dismemberment: loss of one hand", 300000)], [], [held("Group Personal Accident", "g1", 450000)]);
  t(`${m} I13 a PA printing several sums, none equal to the sum insured: no amount`, i13.total === null, show(i13));

  // F: the sum-insured fallback needs a row paying a share of it.
  const f1 = tile("Critical Illness", [share("c1", "Cedar CI", "Critical Illness Benefit", 100, "sum_insured")], [], [held("Cedar CI", "c1", 150000)]);
  t(`${m} F1 no amount printed, a row pays 100% of the sum insured: the sum insured`, f1.total === 150000, show(f1));
  const f2 = tile("Critical Illness", [row("c1", "Cedar CI", "Critical Illness Benefit", null)], [], [held("Cedar CI", "c1", 150000)]);
  t(`${m} F2 negative control: no amount and no share of the sum insured (a notional sum insured): no amount`, f2.total === null, show(f2));
  const f3 = tile("Critical Illness", [share("c1", "Cedar CI", "Critical Illness Benefit", 50, "fixed_amount")], [], [held("Cedar CI", "c1", 150000)]);
  t(`${m} F3 negative control: a share of a fixed amount, not of the sum insured: no amount`, f3.total === null, show(f3));
  const f4 = tile("Critical Illness", [share("c1", "Cedar CI", "Critical Illness Benefit", 100, "sum_insured")], [], [held("Cedar CI", "c1", 150000, null)]);
  t(`${m} F4 negative control: the sum insured's currency not stated: no amount`, f4.total === null, show(f4));
  const f5 = tile("Critical Illness", [row("c1", "Cedar CI", "Critical Illness Benefit", null), share("c2", "Dogwood CI", "Critical Illness Benefit", 100, "sum_insured")], [], [held("Cedar CI", "c1", 150000)]);
  t(`${m} F5 negative control: another cover's share row does not lend the fallback`, f5.parts.find((p) => p.name === "Cedar CI")?.amount === null && f5.total === null, show(f5));

  // L: labels.
  const l1 = tile("Total Permanent Disability", [row("a1", "Alder Whole Life", "Accelerated Total and Permanent Disability Benefit", 200000)], [], [held("Alder Whole Life", "a1", 200000)]);
  t(`${m} L1 an accelerated TPD is marked as paid instead of the death benefit`, l1.parts[0]?.accelerates === true, show(l1));
  const l2 = tile("Critical Illness", [row("a1", "Alder CI Rider", "Non-accelerated Critical Illness Benefit", 100000)], [], [held("Alder CI Rider", "a1", 100000)]);
  t(`${m} L2 a non-accelerated CI is never marked as paid instead of the death benefit`, !l2.parts[0]?.accelerates, show(l2));
  const l3 = tile("Critical Illness", [row("a1", "Alder CI Rider", "Critical Illness Benefit (does not accelerate the death benefit)", 100000)], [], [held("Alder CI Rider", "a1", 100000)]);
  t(`${m} L3 "does not accelerate" is never marked as paid instead of the death benefit`, !l3.parts[0]?.accelerates, show(l3));
  const l4 = tile("Critical Illness", [row("a1", "Alder CI Rider", "Critical Illness Benefit", 100000)], [], [held("Alder CI Rider", "a1", 100000)]);
  t(`${m} L4 negative control: plain CI is not marked`, !l4.parts[0]?.accelerates, show(l4));
  const l5 = tile(D, [row("a1", "Alder Whole Life", "Accelerated Death Benefit", 200000)], [], [held("Alder Whole Life", "a1", 200000)]);
  t(`${m} L5 the Death tile is never marked`, !l5.parts[0]?.accelerates, show(l5));
  const l6 = tile(D, [row("g1", "GROUP TERM LIFE(POLICY NO.12345)", "Death Benefit", 400000), row("g2", "Birch Term Plan (Group Policy No. G-9)", "Death Benefit", 100000)]);
  t(`${m} L6 a policy number printed into a name is dropped`, l6.parts.map((p) => p.name).join("|") === "GROUP TERM LIFE|Birch Term Plan", show(l6));
  const l7 = tile(D, [row("g1", "(Policy No. 777)", "Death Benefit", 400000)]);
  t(`${m} L7 a name that is only a policy number is kept`, l7.parts[0]?.name === "(Policy No. 777)", show(l7));
  const l8 = tile(D, [row("a1", "Alder Whole Life", "Death Benefit", 200000)], [line("Alder Whole Life", ["a1"], 200000), line("Kestrel Accidental Death Plan", ["k1"], 300000)]);
  t(`${m} L8 a line named for another category (accidental death) gives no amount on Death, and no total`, l8.parts.find((p) => p.name.startsWith("Kestrel"))?.amount === null && l8.total === null, show(l8));
  const l9 = tile(D, [row("a1", "Alder Whole Life", "Death Benefit", 200000)], [line("Alder Whole Life", ["a1"], 200000), line("Birch Term Plan", ["b1"], 300000)]);
  t(`${m} L9 negative control: a line with a plain product name counts`, l9.total === 500000, show(l9));
  const l10 = tile("Total Permanent Disability", [row("a1", "Alder Whole Life", "Total and Permanent Disability Benefit", 200000)], [line("Alder Whole Life", ["a1"], 200000)], [held("Alder Whole Life", "a1", 200000, sign, "Alder Whole Life (accelerated TPD)")]);
  t(`${m} L10 a joined line carries its cover's accelerated mark`, l10.parts[0]?.accelerates === true && l10.total === 200000, show(l10));
}

console.log(`\nte pr149: ${pass} passed, ${fail} failed, ${notes.length} notes`);
if (fail) process.exit(1);
