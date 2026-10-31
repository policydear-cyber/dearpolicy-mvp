/** A critical illness plan whose benefits are named by illness only ("Major Cancer", "Kanser", "Stroke") gets its Critical
 * Illness tile: the section or the cover's own name says it is critical illness cover. Made-up insurers, wordings,
 * languages and currencies; no database, no network, no model.
 *   npm run -s coverage:ci-by-cover-name-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;

import { categoryOfRow, categoryRows, lumpSumParts, tileRows } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0;
function t(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`ok ${name}`); } else { fail++; console.log(`FAIL ${name}${got === undefined ? "" : ` -> ${JSON.stringify(got)}`}`); }
}
type Row = SummaryRow & { coverKey: string; product?: string; cover?: string; plan?: string | null; source: { documentId: string } };
const row = (coverKey: string, names: { product?: string; cover?: string; plan?: string | null }, benefit: string, amount: number, currency: string, section: string | null = null): Row =>
  ({ benefit, section, pays: "amount", figure: { kind: "printed", amount, currency, unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [],
    coverKey, ...names, source: { documentId: coverKey + "-doc" } });

// Plans from several markets whose rows name only the illness; the cover or product name says critical illness.
const plans: { market: string; key: string; names: { product?: string; cover?: string }; rows: string[]; amount: number; currency: string; section?: string | null }[] = [
  { market: "SG", key: "kestrel", names: { product: "Kestrel CritiCare Critical Illness Plan" }, rows: ["Major Cancer", "Heart Attack of Specified Severity", "Stroke with Permanent Neurological Deficit"], amount: 150000, currency: "SGD" },
  { market: "MY", key: "maju", names: { cover: "Maju Dread Disease Takaful" }, rows: ["Kanser", "Serangan Jantung", "Kegagalan Buah Pinggang"], amount: 80000, currency: "MYR" },
  { market: "UK", key: "harbour", names: { product: "Harbour Protect", cover: "Harbour Protect" }, rows: ["Cancer - excluding less advanced cases", "Multiple sclerosis"], amount: 60000, currency: "GBP", section: "Critical Illness Cover" },
  { market: "HK", key: "lotus", names: { product: "Lotus 守護 Critical Illness Protector" }, rows: ["癌症 Cancer", "Major Organ Transplant"], amount: 500000, currency: "HKD" },
];
for (const p of plans) {
  const rows = p.rows.map((b) => row(p.key, p.names, b, p.amount, p.currency, p.section ?? null));
  for (const r of rows) t(`${p.market}: "${r.benefit}" is critical illness`, categoryOfRow(r) === "Critical Illness", categoryOfRow(r));
  const tile = lumpSumParts(tileRows(categoryRows("Critical Illness", rows)), [], [], "Critical Illness");
  t(`${p.market}: the Critical Illness tile has the plan's sum (${p.currency} ${p.amount})`, tile.total === p.amount && tile.parts.length === 1 && tile.parts[0].currency === p.currency, tile);
}

// Early or intermediate stage, from the row or the cover.
t("an early-stage row of a critical illness plan is early critical illness",
  categoryOfRow(row("multi", { product: "Dawn Multi-Stage Critical Illness" }, "Early Stage Cancer", 25000, "SGD")) === "Early Critical Illness");
t("carcinoma in situ of a critical illness plan is early critical illness",
  categoryOfRow(row("multi", { product: "Dawn Multi-Stage Critical Illness" }, "Carcinoma in situ", 25000, "SGD")) === "Early Critical Illness");
t("a row of an early critical illness cover is early critical illness",
  categoryOfRow(row("dawn", { cover: "Dawn Early Critical Illness Rider" }, "Angioplasty", 10000, "AUD")) === "Early Critical Illness");

// The cover's name never moves a row its own name places elsewhere, or a row of another kind of payment.
const ci = { product: "Kestrel CritiCare Critical Illness Plan" };
for (const [benefit, want] of [
  ["Death Benefit", "Death"], ["Daily Hospital Cash", "Hospital Cash"], ["Accidental Death", "Personal Accident"], ["Total and Permanent Disability", "Total Permanent Disability"],
  ["Waiver of premium", null], ["Surrender value", null], ["Terminal illness", null], ["Maturity benefit", null], ["Funeral expenses", null], ["Return of premiums", null],
  ["Surgical benefit", null], ["Personal liability", null],
] as const) {
  const got = categoryOfRow(row("kestrel", ci, benefit, 1000, "SGD"));
  t(`in a critical illness plan, "${benefit}" stays ${want ?? "uncategorised"}`, got === want, got);
}
t("a liability section of a critical illness plan stays out",
  categoryOfRow(row("kestrel", ci, "Cancer", 1000, "SGD", "Liability")) === null);

// A plan whose names never say critical illness is never made critical illness by its illness rows.
for (const names of [{ product: "Harbour Term Life" }, { product: "Acme Health Shield", cover: "Acme Health Shield" }, { cover: "Critical Care Hospital Plan" }]) {
  const r = row("other", names, "Major Cancer", 50000, "SGD");
  t(`"Major Cancer" in "${names.cover ?? names.product}" is not critical illness`, categoryOfRow(r) === null, categoryOfRow(r));
}
// A plan's other covers on Home: a life policy beside the CI plan keeps its own tile; the CI tile counts only the CI plan.
const household = [...plans[0].rows.map((b) => row("kestrel", plans[0].names, b, 150000, "SGD")), row("life", { product: "Harbour Term Life" }, "Death Benefit", 400000, "SGD"),
  row("life", { product: "Harbour Term Life" }, "Major Cancer", 400000, "SGD")];
const ciTile = lumpSumParts(tileRows(categoryRows("Critical Illness", household)), [], [], "Critical Illness");
t("a household's Critical Illness tile counts only the critical illness plan", ciTile.total === 150000 && ciTile.parts.length === 1, ciTile);
const deathTile = lumpSumParts(tileRows(categoryRows("Death", household)), [], [], "Death");
t("its Death tile is unchanged", deathTile.total === 400000 && deathTile.parts.length === 1, deathTile);

t("no outbound fetch", fetches === 0, fetches);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
