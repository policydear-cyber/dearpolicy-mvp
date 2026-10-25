/** Test engineer, PR #147 round 2 at 9d62193: fresh phrasings for the tile rules the builder has not seen (limits that the
 * eligibility list hides, standing cover worded like a trip, real benefits worded like a threshold). Made-up SG, MY and UK
 * households. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr147b-test.ts */
import { categoryRows, tableDisplay, tileRows } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type K = SummaryRow & { coverKey: string; product: string };
const row = (coverKey: string, benefit: string, o: Partial<SummaryRow> = {}): K => ({ coverKey, product: coverKey, benefit, section: null, pays: "amount",
  figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as K);
const tile = (category: string, rows: K[]) => tableDisplay(tileRows(categoryRows(category, rows)));
const cash = (r: string | null) => r ?? "(no figure)";

for (const [m, cur, rate, sum] of [["SG", "SGD", 40, 300000], ["MY", "MYR", 100, 250000], ["UK", "GBP", 20, 150000]] as const) {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const daily = (key: string, benefit: string, amount: number, o: Partial<SummaryRow> = {}) =>
    row(key, benefit, { pays: "per_day", figure: { kind: "printed", amount, currency: cur, unit: "per_day" }, fromDay: 2, maxDays: 90, ...o });
  const lump = (key: string, benefit: string, amount: number, o: Partial<SummaryRow> = {}) =>
    row(key, benefit, { figure: { kind: "printed", amount, currency: cur, unit: "lump_sum" }, ...o });

  // E: a condition on one row only that the eligibility list matches but that changes what is paid.
  for (const [id, c] of [["E1", "excluding any amount already paid under the accident benefit"], ["E2", "excludes sums paid under any other policy of the insured"],
    ["E3", "not payable in full where the life assured is a juvenile"], ["E4", "inpatient; paid as a proportion of the sum insured"],
    ["E5", "confined to bed: benefit scaled by the disability grade"], ["E6", "continuous stay; benefit pro-rated"]] as const) {
    const r = tile("Total Permanent Disability", [lump("gtl", "Total and Permanent Disability Benefit", sum, { conditions: [c] }), lump("gtl", "TPD Benefit", sum)]);
    t(`${m} ${id} '${c}' on one row only: no figure, or the figure with it`, r == null || r.includes(c), cash(r));
  }
  // E7 plain eligibility wording that differs: the figure still shows (the live fix).
  const e7 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, { conditions: ["insured admitted as an inpatient"] }), daily("gtl", "Hospital Cash Benefit", rate, { conditions: ["medically necessary confinement"] })]);
  t(`${m} E7 differing eligibility wording only: the figure still shows`, !!e7 && e7.includes(`${rate} a day`), cash(e7));
  // E8 "inpatient only" against "continuous stay" (round 1 P147-4): the figure shows.
  const e8 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, { conditions: ["inpatient only"] }), daily("gtl", "Hospital Cash Benefit", rate, { conditions: ["continuous stay"] })]);
  t(`${m} E8 'inpatient only' vs 'continuous stay': the figure shows`, !!e8 && e8.includes(`${rate} a day`), cash(e8));

  // T: standing cover worded like a trip, beside another cover with a different rate: no single figure.
  for (const [id, b] of [["T1", "Daily hospital cash while overseas or at home"], ["T2", "Daily hospital cash, whether in your home country or while overseas"],
    ["T3", "Hospital income worldwide, also when travelling"], ["T4", "Daily hospital cash at home and while abroad"]] as const) {
    const r = tile("Hospital Cash", [daily("a", b, rate * 2), daily("b", "Hospital Cash Benefit", rate)]);
    t(`${m} ${id} '${b}' is standing cover: no single figure beside another cover's rate`, r == null, cash(r));
  }
  // T5 a trip-only row that also names a second item ("cash and transport while overseas"): safe side either way (probe).
  console.log(`TE-PROBE ${m} T5:`, cash(tile("Hospital Cash", [daily("a", "Hospital Cash Benefit", rate), daily("trip", "Daily hospital cash and transport while overseas", rate * 3)])));

  // C: real benefits that print a guaranteed minimum or a floor, beside another cover's figure: never the other figure alone.
  for (const [id, b] of [["C1", `Death benefit of at least ${cur} ${fmt(sum)}`], ["C2", `TPD benefit: not less than ${cur} ${fmt(sum)}`],
    ["C3", `Total and Permanent Disability: minimum ${cur} ${fmt(sum)}`], ["C4", `TPD benefit, at least ${fmt(sum)} ${cur} guaranteed`]] as const) {
    const cat = /^Death/.test(b) ? "Death" : "Total Permanent Disability";
    const r = tile(cat, [lump("a", b, sum), lump("b", cat === "Death" ? "Death Benefit" : "Total and Permanent Disability Benefit", sum / 2)]);
    t(`${m} ${id} '${b}' beside another cover's ${fmt(sum / 2)}: never ${fmt(sum / 2)} alone`, r == null, cash(r));
  }
  // C5 a true threshold clause still never decides the tile.
  const c5 = tile("Total Permanent Disability", [lump("gtl", "Total and Permanent Disability Benefit", sum), lump("gtl", `TPD paid in instalments where the sum payable exceeds ${cur} ${fmt(200000)}`, 200000)]);
  t(`${m} C5 a threshold clause never decides the TPD tile`, !!c5 && c5.endsWith(fmt(sum)), cash(c5));
}
console.log(notes.length ? `notes:\n${notes.join("\n")}` : "");
console.log(`\nte pr147b: ${pass} passed, ${fail} failed, ${notes.length} notes`);
process.exitCode = fail ? 1 : 0;
