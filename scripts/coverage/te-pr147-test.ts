/** Test engineer, PR #147 at 0330ab1 / 069e483 / d942627: Home tile amounts (lib/coverage/table-figures.ts), on the path the dashboard route
 * takes (tableDisplay(tileRows(categoryRows(category, rows)))), plus the claim side of the section rule. Made-up SG, MY and
 * UK households with negative controls. Synthetic only; no model, no database.
 *   node --import tsx scripts/coverage/te-pr147-test.ts */
import { categoryOfBenefit, categoryRows, tableDisplay, tileRows } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";
import { assessClaim } from "@/lib/claims/rules";
import { enforceMonetarySafety } from "@/lib/claims/monetary-gate";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { claimTable, personCover, printed, tableRow } from "../fixtures/claim-table";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type K = SummaryRow & { coverKey: string; product: string };
const row = (coverKey: string, benefit: string, o: Partial<SummaryRow> = {}): K => ({ coverKey, product: coverKey, benefit, section: null, pays: "amount",
  figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as K);
/** What the Home tile shows for the category (app/api/dashboard/route.ts). */
const tile = (category: string, rows: K[]) => tableDisplay(tileRows(categoryRows(category, rows)));

const TRAVEL = "Kestrel Single Trip Travel Insurance";
const MARKETS = [
  { m: "SG", cur: "SGD", sign: "S$", rate: 40, sum: 300000 },
  { m: "MY", cur: "MYR", sign: "MYR ", rate: 100, sum: 250000 },
  { m: "UK", cur: "GBP", sign: "£", rate: 20, sum: 150000 },
] as const;

for (const { m, cur, rate, sum } of MARKETS) {
  const daily = (key: string, benefit: string, amount: number, currency: string | null, o: Partial<SummaryRow> = {}) =>
    row(key, benefit, { pays: "per_day", figure: { kind: "printed", amount, currency, unit: "per_day" }, fromDay: 3, maxDays: 60, ...o });
  const tpd = (key: string, amount: number, o: Partial<SummaryRow> = {}) =>
    row(key, "Total and Permanent Disability Benefit", { figure: { kind: "printed", amount, currency: cur, unit: "lump_sum" }, ...o });
  const cash = (r: string | null) => r ?? "(no figure)";
  // J: the journey. A standing cover read from its summary (currency printed) and its certificate (bare "$", other wording),
  // a payment-term clause, a waiver of premium, and a travel policy's trip-only cash and accident-section TPD.
  const home = [
    daily("gtl", "Daily Hospital Cash Benefit", rate, cur, { conditions: ["continuous stay"] }),
    daily("gtl", "Hospital Cash Benefit", rate, null, { conditions: ["inpatient only", "no benefit for self-inflicted injury"] }),
    tpd("gtl", sum),
    row("gtl", `Total and permanent disability: paid in instalments where the sum payable is above ${cur} 200,000`, { figure: { kind: "printed", amount: 200000, currency: cur, unit: "lump_sum" } }),
    row("life", "Waiver of premium on total and permanent disability", { pays: "words", figure: { kind: "none", why: "no figure printed" } }),
    // Grader correction (TE, ee1e2f9): the travel cover was named only "trip"; it now carries a realistic travel name. Original
    // grade kept: J1 passed on 0330ab1-34f5a8a with the bare name. Reason: travel is now decided from two signals, and a cover
    // named only "trip" is not a realistic travel policy name.
    { ...daily("trip", "Daily hospital cash while overseas", rate * 3, cur, { fromDay: 1, maxDays: 30 }), product: TRAVEL, cover: TRAVEL } as K,
    { ...row("trip", "Total and permanent disability", { section: "Personal accident", figure: { kind: "printed", amount: 50000, currency: cur, unit: "lump_sum" } }), product: TRAVEL, cover: TRAVEL } as K,
  ];
  const hc = tile("Hospital Cash", home), td = tile("Total Permanent Disability", home);
  t(`${m} J1 the Hospital Cash tile shows the standing cover's rate with its currency`, !!hc && new RegExp(`^(?:S\\$|MYR |GBP |£)${rate} a day · from day 3 · up to 60 days`).test(hc) && !hc.includes("not stated"), cash(hc));
  t(`${m} J2 the TPD tile shows the standing cover's sum`, !!td && new RegExp(`^(?:S\\$|MYR |GBP |£)${sum.toLocaleString("en-US")}$`).test(td), cash(td));
  t(`${m} J3 the Coverage page still lists every hospital cash and TPD row`, categoryRows("Hospital Cash", home).length === 3 && categoryRows("Total Permanent Disability", home).length === 3, [categoryRows("Hospital Cash", home).length, categoryRows("Total Permanent Disability", home).length]);

  // N1 bare "$" only: shown as printed, never with a currency.
  const n1 = tile("Hospital Cash", [daily("gtl", "Hospital Cash Benefit", rate, null)]);
  t(`${m} N1 bare "$" only: '(currency not stated)', never ${cur}`, !!n1 && /not stated/.test(n1) && !n1.includes(cur) && !/S\$|£|MYR/.test(n1), cash(n1));
  // N2 bare "$" with a different amount on the same cover: no figure.
  const n2 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur), daily("gtl", "Hospital Cash Benefit", rate + 5, null)]);
  t(`${m} N2 bare "$" with a different amount: no figure`, n2 == null, cash(n2));
  // N3 the same figure, bare "$", on a different cover: no figure (never read as this cover's currency).
  const n3 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur), daily("other", "Hospital Cash Benefit", rate, null)]);
  t(`${m} N3 the same figure with a bare "$" on another cover: no figure`, n3 == null, cash(n3));
  // N4 different days on the bare-sign row, and on a currency row: no figure.
  const n4 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur), daily("gtl", "Hospital Cash Benefit", rate, null, { fromDay: 1 })]);
  const n4b = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur), daily("gtl", "Hospital Cash Benefit", rate, cur, { maxDays: 90 })]);
  t(`${m} N4 different days: no figure`, n4 == null && n4b == null, [cash(n4), cash(n4b)]);
  // N5 trip-only: alone it is the tile's row; beside a standing cover it never decides the figure.
  const n5 = tile("Hospital Cash", [daily("trip", "Daily hospital cash while overseas", rate * 3, cur, { fromDay: 1, maxDays: 30 })]);
  t(`${m} N5 travel cover only: its own trip rate shows`, !!n5 && n5.includes(`${rate * 3} a day`), cash(n5));
  // N6 a waiver only: no figure.
  const n6 = tile("Total Permanent Disability", [row("life", "Waiver of premium on total and permanent disability", { pays: "words", figure: { kind: "none", why: "no figure" } })]);
  t(`${m} N6 a waiver of premium only: no figure`, n6 == null, cash(n6));
  // N7 a waiver that prints a figure (the premium waived) beside a TPD: the TPD's sum shows, never the premium.
  const n7 = tile("Total Permanent Disability", [tpd("gtl", sum), row("life", "Waiver of premium on total and permanent disability", { figure: { kind: "printed", amount: 1200, currency: cur, unit: "lump_sum" } })]);
  t(`${m} N7 a waiver printing the premium never decides the TPD tile`, !!n7 && !n7.includes("1,200"), cash(n7));
  // N8 a "higher of" TPD: the floor figure printed with a "higher of" condition, and the same cover's other document
  // printing the bare figure. The tile must not show the floor as the amount without saying "higher of".
  const n8 = tile("Total Permanent Disability", [tpd("ilp", sum, { conditions: ["the higher of this amount or the policy's account value"] }), tpd("ilp", sum)]);
  t(`${m} N8 'higher of' TPD: never the floor figure alone`, n8 == null || /higher/i.test(n8), cash(n8));
  // N9 a "higher of" TPD whose name prints the floor, beside another cover's TPD: no single figure.
  const n9 = tile("Total Permanent Disability", [row("ilp", `TPD: the higher of ${cur} ${sum.toLocaleString("en-US")} or the account value`, { figure: { kind: "printed", amount: sum, currency: cur, unit: "lump_sum" } }), tpd("gtl", sum / 2)]);
  t(`${m} N9 a 'higher of' TPD named with its floor, and another cover's TPD: never the other cover's figure alone`, n9 == null, cash(n9));
  // N10 a real benefit named with its own figure, and another cover with a different rate: no single figure.
  const n10 = tile("Hospital Cash", [daily("a", `Daily Hospital Cash ${cur} ${rate * 2} per day`, rate * 2, cur), daily("b", "Hospital Cash Benefit", rate, cur)]);
  t(`${m} N10 a benefit named with its own figure beside another cover's different rate: no single figure`, n10 == null, cash(n10));
  // N11 a standing cover that also pays abroad ("including while overseas"), and another cover's different rate.
  const n11 = tile("Hospital Cash", [daily("a", "Daily Hospital Cash, including while overseas", rate * 2, cur), daily("b", "Hospital Cash Benefit", rate, cur)]);
  t(`${m} N11 'including while overseas' is standing cover: with another cover's different rate, no single figure`, n11 == null, cash(n11));
  // L: limiting conditions (069e483 compares them). A limit printed on only one row: no figure, or the limit shown.
  for (const [id, lim] of [["L1", "Max 6 claims per policy year"], ["L2", "payable once per life"], ["L3", "reduced by half after age sixty-five"], ["L4", "less any amount already paid under the critical illness benefit"], ["L5", "the lower of this amount or 5 times annual salary"]] as const) {
    const r = tile("Total Permanent Disability", [tpd("gtl", sum, { conditions: [lim] }), tpd("gtl", sum)]);
    t(`${m} ${id} a limit on one row only ('${lim}'): no figure, or the figure with the limit`, r == null || r.includes(lim), cash(r));
  }
  const l6 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur, { conditions: ["Max 6 claims per policy year"] }), daily("gtl", "Hospital Cash Benefit", rate, null)]);
  t(`${m} L6 a bare-sign restatement without the limit is not dropped as 'the same': no figure, or the figure with the limit`, l6 == null || l6.includes("Max 6"), cash(l6));
  const l7 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur, { conditions: ["Max 6 claims per policy year"] }), daily("gtl", "Hospital Cash Benefit", rate, cur, { conditions: ["Max 6 claims per policy year"] })]);
  t(`${m} L7 the same limit on both rows: shown with the limit`, !!l7 && l7.includes("Max 6"), cash(l7));
  const l8 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur, { conditions: ["continuous stay"] }), daily("gtl", "Hospital Cash Benefit", rate, cur, { conditions: ["inpatient only"] })]);
  t(`${m} L8 differing non-limit wording: the figure still shows`, !!l8 && l8.includes(`${rate} a day`), cash(l8), true);
  const l9 = tile("Hospital Cash", [daily("gtl", "Daily Hospital Cash Benefit", rate, cur), daily("gtl", "Hospital Cash Benefit", rate, null, { conditions: ["Max 6 claims per policy year"] })]);
  t(`${m} L9 a bare-sign row carrying a limit the currency row lacks: no figure, or the figure with the limit`, l9 == null || l9.includes("Max 6"), cash(l9));
  // N12 two covers printing the same rate with currency: one figure is fine (probe).
  console.log(`TE-PROBE ${m} N12 two covers, same rate:`, cash(tile("Hospital Cash", [daily("a", "Hospital Cash Benefit", rate, cur), daily("b", "Hospital Income", rate, cur)])));
}
// S: section rule.
{
  for (const s of ["Accident and Sickness Benefits", "Accident & Illness cover", "Section 2: Accident or Sickness"])
    t(`S1 TPD under '${s}' stays TPD (any cause)`, categoryOfBenefit("Total and permanent disability", s) === "Total Permanent Disability", categoryOfBenefit("Total and permanent disability", s));
  for (const s of ["PERSONAL ACCIDENT", "Part B - Accidental Injury Benefits", "Injury cover"])
    t(`S2 death under '${s}' is personal accident`, categoryOfBenefit("Death benefit", s) === "Personal Accident", categoryOfBenefit("Death benefit", s));
  t("S3 a hospital cash row under an accident section stays hospital cash", categoryOfBenefit("Daily Hospital Cash", "Personal accident") === "Hospital Cash", categoryOfBenefit("Daily Hospital Cash", "Personal accident"));
  t("S5 'Death from any cause' under 'Personal accident' stays Death", categoryOfBenefit("Death from any cause", "Personal accident") === "Death", categoryOfBenefit("Death from any cause", "Personal accident"));
  console.log("TE-PROBE S4 TPD under 'Accident & Health':", categoryOfBenefit("Total and permanent disability", "Accident & Health"));
}
// C: the claim side. An illness death never takes a death row printed under an accident section.
{
  const life = { id: "c1", policyId: "p", familyMemberId: "m", category: "Death", amount: null, currency: "GBP", productName: "Fenway Travel", sourcePage: 1,
    evidenceText: "Sum insured £50,000", insurer: "Fenway Mutual", policyName: "Fenway Travel", policyNumber: "FT-1", groupPolicyNumber: null, documentRole: "schedule",
    effectiveDate: "2025-01-01", renewalOrExpiryDate: null, currencyVerified: true } as OwnedCoverage;
  const f = { ...EMPTY_CLAIM_FACTS, eventType: "death", death: true, deathDate: "2026-09-01", eventDate: "2026-09-01", deathCause: "illness", uncertainFacts: [] } as unknown as ClaimFacts;
  const rows = [tableRow("t", "Fenway Travel", "Death benefit", printed(50000, "lump_sum", "GBP"), { section: "Personal accident" })];
  const items = enforceMonetarySafety(assessClaim(f, [life], [], [], null, [], [], undefined, undefined, undefined, claimTable(rows, [personCover("t", "Fenway Travel")])), f, [life]);
  const paid = items.filter((i) => i.id.startsWith("table-") && (i.calculatedAmount ?? 0) > 0);
  t("C1 illness death: a death row under 'Personal accident' pays nothing", paid.length === 0, paid.map((i) => [i.id, i.amountText]));
}
console.log(notes.length ? `notes:\n${notes.join("\n")}` : "");
console.log(`\nte pr147: ${pass} passed, ${fail} failed, ${notes.length} notes`);
process.exitCode = fail ? 1 : 0;
