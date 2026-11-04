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
  { market: "MY", key: "maju", names: { cover: "Maju Dread Disease Takaful" }, rows: ["Cancer", "Heart Attack", "Kidney Failure"], amount: 80000, currency: "MYR" },
  { market: "UK", key: "harbour", names: { product: "Harbour Protect", cover: "Harbour Protect" }, rows: ["Cancer - excluding less advanced cases", "Multiple sclerosis"], amount: 60000, currency: "GBP", section: "Critical Illness Cover" },
  { market: "HK", key: "lotus", names: { product: "Lotus 守護 Critical Illness Protector" }, rows: ["癌症 Cancer", "Major Organ Transplant"], amount: 500000, currency: "HKD" },
];
for (const p of plans) {
  const rows = p.rows.map((b) => row(p.key, p.names, b, p.amount, p.currency, p.section ?? null));
  for (const r of rows) t(`${p.market}: "${r.benefit}" is critical illness`, categoryOfRow(r) === "Critical Illness", categoryOfRow(r));
  const tile = lumpSumParts(tileRows(categoryRows("Critical Illness", rows)), [], [], "Critical Illness");
  t(`${p.market}: the Critical Illness tile has the plan's sum (${p.currency} ${p.amount})`, tile.total === p.amount && tile.parts.length === 1 && tile.parts[0].currency === p.currency, tile);
}

// English only (DC 4 Nov): a cover named only in another language is not read as critical illness.
for (const [names, benefit] of [[{ cover: "Pelan Penyakit Kritikal Maju" }, "Kanser"], [{ cover: "Lotus 危疾保障" }, "癌症"]] as const)
  t(`"${benefit}" under a cover named in another language is not read as critical illness`, categoryOfRow(row("ne", names, benefit, 80000, "MYR")) === null, categoryOfRow(row("ne", names, benefit, 80000, "MYR")));

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
  ["Surgical benefit", null], ["Personal liability", null], ["Cancer hospital cash", "Hospital Cash"], ["Death due to cancer", "Death"], ["Kidney dialysis expenses reimbursed", null], ["Waiver of premium on cancer", null], ["Cancer surrender value", null],
] as const) {
  const got = categoryOfRow(row("kestrel", ci, benefit, 1000, "SGD"));
  t(`in a critical illness plan, "${benefit}" stays ${want ?? "uncategorised"}`, got === want, got);
}
t("a liability section of a critical illness plan stays out",
  categoryOfRow(row("kestrel", ci, "Cancer", 1000, "SGD", "Liability")) === null);

// TE pr252 F1: under a takaful or Chinese-language critical illness cover, rows that are not an illness stay out, in any
// language: death, disability, waivers, surrender values, refunds, cash, and periods.
for (const cover of ["Maju Dread Disease Takaful", "Kestrel CritiCare Critical Illness Plan", "Pelan Penyakit Kritikal Maju", "Lotus 危疾保障"]) {
  for (const benefit of ["Manfaat Kematian", "Kematian", "Hilang Upaya Menyeluruh dan Kekal", "Pengecualian Caruman", "Nilai Penyerahan", "Pemulangan sumbangan",
    "Wang tunai", "身故保险金", "全残保障", "豁免保费", "Free-look period", "Grace period", "Waiting period", "Survival period", "Tempoh bertenang", "Policy term", "Sum assured"]) {
    const got = categoryOfRow(row("t", { cover }, benefit, 90000, "MYR"));
    t(`under "${cover}", "${benefit}" is never critical illness`, got !== "Critical Illness" && got !== "Early Critical Illness", got);
  }
}
// Illnesses and procedures in Malay and Chinese, and surgery that is itself a covered condition, under each such cover.
for (const cover of ["Pelan Penyakit Kritikal Maju", "Lotus 危疾保障", "Kestrel Major Illness Plan"]) {
  for (const benefit of ["Serangan Jantung", "Strok", "Kegagalan Buah Pinggang", "癌症", "中风", "心脏病发作", "Coronary artery by-pass surgery", "Heart valve surgery", "Surgery to aorta"]) {
    const got = categoryOfRow(row("t", { cover }, benefit, 90000, "MYR"));
    // English only (DC 4 Nov): only an English illness under an English cover name is read; anything else stays out.
    const english = cover === "Kestrel Major Illness Plan";
    t(`under "${cover}", "${benefit}" is ${english ? "critical illness" : "not read (English only)"}`, english ? got === "Critical Illness" : got === null, got);
  }
}
t("an intermediate-stage heart disease row is early critical illness",
  categoryOfRow(row("t", { cover: "Kestrel CritiCare Critical Illness Plan" }, "Intermediate stage heart disease", 30000, "SGD")) === "Early Critical Illness");
t("an early-stage row in Malay is not read (English only)",
  categoryOfRow(row("t", { cover: "Pelan Penyakit Kritikal Maju" }, "Kanser peringkat awal", 20000, "MYR")) === null);
// A partial benefit beside the plan's sum (TE pr252 note): with the plan's own sum insured, the tile shows that sum; without
// it, two different sums give no total, never a wrong one.
{
  const rows = [row("kestrel", ci, "Major Cancer", 150000, "SGD"), row("kestrel", ci, "Angioplasty", 30000, "SGD")];
  const held = [{ coverKey: "kestrel", name: ci.product, documentId: "kestrel-doc", sumInsured: 150000, currency: "SGD" }];
  const withSum = lumpSumParts(tileRows(categoryRows("Critical Illness", rows)), [], held, "Critical Illness");
  t("a partial angioplasty row beside the sum: the tile shows the plan's sum insured", withSum.total === 150000, withSum);
  const noSum = lumpSumParts(tileRows(categoryRows("Critical Illness", rows)), [], [], "Critical Illness");
  t("without the plan's sum insured, two different sums give no total", noSum.total === null, noSum);
}

// Critic H1 on #252: rows of a critical illness plan that are not an illness, in several languages, and cover for others.
for (const benefit of ["Pembebasan Premi", "Bantuan Pengebumian", "Annual Cash Payout", "Guaranteed Cash Benefit", "Survival Benefit",
  "Health Screening Benefit", "Second Medical Opinion", "Wellness Reward", "Vaccination", "Policy Loan", "Rente mensuelle", "Child Benefit",
  "Spouse Benefit", "Dependant's benefit", "Lump sum payout", "Benefit A", "Premium Holiday", "Coverage Multiplier", "Monthly Payout for 3 years"]) {
  const got = categoryOfRow(row("kestrel", { product: "Acme CritiCare Critical Illness Plan", cover: "Acme CritiCare Critical Illness Plan" }, benefit, 5000, "SGD"));
  t(`in a critical illness plan, "${benefit}" is not critical illness`, got === null, got);
}
// Critic H1 round 3 and TE F2/F3 on #252: a row whose name has any word outside the illness list (a service, a payout,
// another person, a death or waiver in another language, a treatment bill) is never critical illness.
for (const benefit of ["Cancer Screening Benefit", "Heart Health Check-up", "Second Medical Opinion for Cancer", "Cancer Vaccination", "Child Cancer Benefit",
  "Juvenile Heart Conditions", "Spouse's Cancer Benefit", "Kanser Kanak-kanak", "子女癌症保险金",
  "Pengecualian Caruman selepas Kanser", "癌症豁免保费", "Nilai Tunai Kanser", "Cancer Cash Payout", "Annual payout after Cancer", "Cancer Monthly Payout",
  "Cancer Survival Payout", "Cancer Relapse Benefit", "Kidney Dialysis Treatment", "Cancer Treatment (Chemotherapy, Radiotherapy)", "Cancer drug list treatment",
  "Brain Health Wellness Programme", "Cancer Care Concierge", "Liver function test", "Cancer Booster", "Cancer Treatment", "Juvenile stroke", "Spouse cancer cover",
  "Pre-existing cancer exclusion", "Cancer care allowance daily", "Total loss", "Breast"]) {
  const got = categoryOfRow(row("kestrel", { cover: "Acme CritiCare Critical Illness Plan" }, benefit, 25000, "SGD"));
  t(`in a critical illness plan, "${benefit}" is not critical illness`, got === null, got);
}
// A death row is Death: never critical illness. English only (DC 4 Nov): a death row in another language is not read, so
// it stays uncategorised (no figure on any tile), never critical illness.
for (const benefit of ["Death due to Cancer"]) {
  const got = categoryOfRow(row("kestrel", { cover: "Acme CritiCare Critical Illness Plan" }, benefit, 25000, "SGD"));
  t(`in a critical illness plan, "${benefit}" is Death`, got === "Death", got);
}
for (const benefit of ["Santunan Meninggal Dunia", "Prestation décès", "Kematian akibat Kanser", "癌症身故保险金", "癌症身故"]) {
  const got = categoryOfRow(row("kestrel", { cover: "Acme CritiCare Critical Illness Plan" }, benefit, 25000, "SGD"));
  t(`in a critical illness plan, "${benefit}" in another language is not read`, got === null, got);
}
// An illness named only with words from the closed condition list is critical illness in any of its listed forms.
for (const [benefit, want] of [["Kanser Tahap Akhir", "Critical Illness"], ["Kanser Tahap Kritikal", "Critical Illness"], ["Heart Attack", "Critical Illness"],
  ["Carcinoma in situ of the breast", "Early Critical Illness"], ["Loss of hearing", "Critical Illness"], ["End-stage liver failure", "Critical Illness"]] as const) {
  const got = categoryOfRow(row("kestrel", { cover: "Acme CritiCare Critical Illness Plan" }, benefit, 25000, "SGD"));
  t(`in a critical illness plan, "${benefit}" is ${want}`, got === want, got);
}
// The tile path the Critic traced: a screening or a child's benefit with an amount beside an illness with none never gives
// the tile that amount.
for (const other of ["Cancer Screening Benefit", "Child Cancer Benefit"]) {
  const rows = [{ ...row("kestrel", ci, "Major Cancer", 0, "SGD"), figure: { kind: "none" as const, why: "see the page" } }, row("kestrel", ci, other, 25000, "SGD")];
  const tile = lumpSumParts(tileRows(categoryRows("Critical Illness", rows)), [], [], "Critical Illness");
  t(`"${other}" S$25,000 beside "Major Cancer" (no figure) never becomes the CI amount`, tile.total === null && tile.parts.every((p) => p.amount == null), tile);
}

// The product names the whole policy: a base plan's row is never critical illness because a rider's name is in the product;
// the rider's own row is.
t("a base savings plan's illness-named row is not critical illness because the product names a CI rider",
  categoryOfRow(row("base", { product: "LifeGuard Saver with Critical Illness Rider", cover: "LifeGuard Saver" }, "Kidney failure", 20000, "SGD")) === null);
t("the rider's own row is critical illness",
  categoryOfRow(row("rider", { product: "LifeGuard Saver", cover: "CritiCare Critical Illness Rider" }, "Cancer", 20000, "MYR")) === "Critical Illness");
t("a plan tier name is never read",
  categoryOfRow(row("tier", { product: "Acme Health", cover: "Acme Health", plan: "Critical Illness Option" }, "Major Cancer", 20000, "SGD")) === null);

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
// A bilingual illness label is critical illness only when every word on every side is an illness word (closed list): a
// side or a character that names a death, a hospital stay, treatment or an allowance keeps the row off the CI tile
// (Critic H1 on #343 1dcf0f36).
for (const benefit of ["癌症 Cancer", "Cancer 癌症", "Kanser / Cancer", "Cancer / Kanser", "Stroke / 中风"]) {
  const got = categoryOfRow({ benefit, section: "Critical Illness Benefits" } as never);
  t(`under "Critical Illness Benefits", "${benefit}" is critical illness`, got === "Critical Illness", got);
}
for (const benefit of ["癌症身故保险金 Cancer", "Kematian akibat Kanser / Cancer", "Cancer / Kematian", "Cancer (身故)", "Cancer / 癌症身故", "Cancer 住院",
  "癌症医疗 Cancer", "Cancer / Rawatan", "Cancer / Kos Rawatan", "Cancer / Elaun Harian", "Accident / Cancer"]) {
  const got = categoryOfRow({ benefit, section: "Critical Illness Benefits" } as never);
  t(`under "Critical Illness Benefits", "${benefit}" is not critical illness`, got !== "Critical Illness", got);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
