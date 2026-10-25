/** Test engineer, PR #147 round 4 at 34f5a8a: travel cover known from the cover's own names, rows left out only within a
 * cover. Made-up SG, MY and UK households. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr147d-test.ts */
import { categoryRows, tableDisplay, tileRows } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type K = SummaryRow & { coverKey: string; product: string; cover: string; plan: string | null };
const row = (coverKey: string, product: string, benefit: string, o: Partial<K> = {}): K => ({ coverKey, product, cover: product, plan: null, benefit, section: null, pays: "amount",
  figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as K);
const tile = (category: string, rows: K[]) => tableDisplay(tileRows(categoryRows(category, rows) as K[]));
const cash = (r: string | null) => r ?? "(no figure)";

for (const [m, cur, rate, sum] of [["SG", "SGD", 40, 300000], ["MY", "MYR", 100, 250000], ["UK", "GBP", 20, 150000]] as const) {
  const daily = (key: string, product: string, benefit: string, amount: number, o: Partial<K> = {}) =>
    row(key, product, benefit, { pays: "per_day", figure: { kind: "printed", amount, currency: cur, unit: "per_day" }, fromDay: 2, maxDays: 90, ...o });
  const lump = (key: string, product: string, benefit: string, amount: number, o: Partial<K> = {}) =>
    row(key, product, benefit, { figure: { kind: "printed", amount, currency: cur, unit: "lump_sum" }, ...o });
  // P: standing life or health covers whose product names carry a travel-like word, beside another standing cover with a
  // different figure: no single figure (the other cover's figure alone would be wrong).
  for (const [id, product] of [["P1", "LifeJourney Protect"], ["P2", "Life Journey Saver"], ["P3", "Sunny Holidays Staff Group Insurance"],
    ["P4", "TripleCare Health"], ["P5", "Journey of Life Hospital Income Plan"], ["P6", "Trip Advisors Employees Group Term Life"]] as const) {
    const hc = tile("Hospital Cash", [daily("a", product, "Hospital Cash Benefit", rate * 2), daily("b", "Kestrel Health", "Hospital Cash Benefit", rate)]);
    t(`${m} ${id} standing cover '${product}' with another cover's lower rate: no single figure`, hc == null, cash(hc));
    const tp = tile("Total Permanent Disability", [lump("a", product, "Total and Permanent Disability Benefit", sum), lump("b", "Kestrel Life", "TPD Benefit", sum / 2)]);
    t(`${m} ${id} TPD: standing '${product}' with another cover's smaller sum: no single figure`, tp == null, cash(tp));
  }
  // V: real travel covers. Named as travel: only the standing cover's figure shows. Not named as travel: safe side.
  const v1 = tile("Hospital Cash", [daily("a", "Kestrel Health", "Hospital Cash Benefit", rate), daily("t", "Kestrel Single Trip Travel Insurance", "Daily hospital cash while overseas", rate * 3)]);
  t(`${m} V1 a travel cover named as travel never decides the tile`, !!v1 && v1.startsWith(cur === "SGD" ? "S$" : cur) && v1.includes(`${rate} a day`), cash(v1));
  const v2 = tile("Hospital Cash", [daily("a", "Kestrel Health", "Hospital Cash Benefit", rate), daily("t", "Wanderlust Protect", "Daily hospital cash while overseas", rate * 3)]);
  t(`${m} V2 a travel cover not named as travel: no single figure (safe side)`, v2 == null, cash(v2));
  // W: a waiver-only cover and a clause row of the same cover never decide; a clause row of ANOTHER cover is not dropped.
  const w1 = tile("Total Permanent Disability", [lump("a", "Kestrel Life", "TPD Benefit", sum), lump("w", "Kestrel Saver", "Waiver of premium on TPD", 1200)]);
  t(`${m} W1 a waiver-only cover never decides the tile`, !!w1 && w1.endsWith(sum.toLocaleString("en-US")), cash(w1));
  const w2 = tile("Total Permanent Disability", [lump("a", "Kestrel Life", "TPD Benefit", sum), lump("b", "Kestrel Group", `TPD paid in instalments where the sum payable exceeds ${cur} 200,000`, 200000)]);
  t(`${m} W2 another cover's threshold clause row: no single figure`, w2 == null, cash(w2), true);
  // D: identical conditions that differ only in case or a full stop: no figure (safe side; note).
  const d1 = tile("Hospital Cash", [daily("a", "Kestrel Health", "Hospital Cash Benefit", rate, { conditions: ["Max 6 claims per year"] }), daily("a", "Kestrel Health", "Daily Hospital Cash", rate, { conditions: ["max 6 claims per year."] })]);
  t(`${m} D1 the same limit worded with other case/punctuation: the figure shows with it`, !!d1 && /6 claims/i.test(d1), cash(d1), true);
}
console.log(notes.length ? `notes:\n${notes.join("\n")}` : "");
console.log(`\nte pr147d: ${pass} passed, ${fail} failed, ${notes.length} notes`);
process.exitCode = fail ? 1 : 0;
