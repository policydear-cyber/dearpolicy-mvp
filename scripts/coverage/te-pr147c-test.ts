/** Test engineer, PR #147 round 3 at ad30d58: fresh phrasings for the tile rules the builder has not seen (limits that the
 * eligibility list hides, standing cover worded like a trip, real benefits worded like a threshold). Made-up SG, MY and UK
 * households. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr147c-test.ts */
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

for (const [m, cur, sum] of [["SG", "SGD", 300000], ["MY", "MYR", 250000], ["UK", "GBP", 150000]] as const) {
  const lump = (key: string, benefit: string, amount: number, o: Partial<SummaryRow> = {}) =>
    row(key, benefit, { figure: { kind: "printed", amount, currency: cur, unit: "lump_sum" }, ...o });
  // X: exclusion-shaped conditions on one row only that still change what is paid.
  for (const [id, c] of [["X1", "excluding juveniles, who receive a halved benefit"], ["X2", "except for juveniles: fifty percent"],
    ["X3", "not payable for a second disability"], ["X4", "excluding juveniles, who get one-quarter"], ["X5", "excludes the portion over the ward entitlement"],
    ["X6", "no benefit for juveniles beyond the juvenile cap"], ["X7", "excluding stays in a private room, paid at the ward rate"], ["X8", "except where the insured is over seventy, when the benefit is scaled down"],
    ["X9", "exclusions: amounts recovered from a third party"], ["X10", "excluding the deductible"]] as const) {
    const r = tile("Total Permanent Disability", [lump("gtl", "Total and Permanent Disability Benefit", sum, { conditions: [c] }), lump("gtl", "TPD Benefit", sum)]);
    t(`${m} ${id} '${c}' on one row only: no figure, or the figure with it`, r == null || r.includes(c), cash(r));
  }
  // Y: plain exclusions of a cause (eligibility): the figure still shows (safe side if not; note).
  for (const [id, c] of [["Y1", "excluding pre-existing conditions"], ["Y2", "not payable for self-inflicted injury"], ["Y3", "no cover for war or terrorism"]] as const) {
    const r = tile("Total Permanent Disability", [lump("gtl", "Total and Permanent Disability Benefit", sum, { conditions: [c] }), lump("gtl", "TPD Benefit", sum)]);
    t(`${m} ${id} '${c}' on one row only: the figure shows`, !!r && r.includes(sum.toLocaleString("en-US")), cash(r), true);
  }
}
console.log(notes.length ? `notes:\n${notes.join("\n")}` : "");
console.log(`\nte pr147c: ${pass} passed, ${fail} failed, ${notes.length} notes`);
process.exitCode = fail ? 1 : 0;
