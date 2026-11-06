/** A real-model measuring run for the figure guards (category 3: real models on made-up documents). PAID: run only with
 * authorisation, and never on a household's own documents. Every document here is made up (Example Insurance, made-up
 * names). Each document is read by reader 1 (the table reading), checked as on main, then guarded; the run reports, per
 * document, the figures guarded, how many settled in round 0 and in each re-read, how many would go to the household,
 * the calls made and the spend.
 *
 * Spend: one limit for the whole run (FIGURE_GUARDS_LIVE_CAP_USD, default 0.95). Every call is admitted on its worst case
 * (whole prompt uncached plus its full output allowance): the reading here, the guards inside runGuards.
 *   FIGURE_GUARDS_LIVE_RUN_ID=<unique id> node --import tsx scripts/benefit-table/figure-guards-live.ts <out dir> */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { READING_PROMPT, READING_SCHEMA, renderDocument } from "@/lib/benefit-table/reading";
import { anthropicTableModel, type TableModel, type TableReply } from "@/lib/benefit-table/model";
import { claimsOf } from "@/lib/benefit-table/guards";
import { runGuards, worstUsd, type GuardReader } from "@/lib/benefit-table/guard-run";
import { DEFAULT_GUARDS, supportsEffort } from "@/lib/benefit-table/guard-flag";
import { DEFAULT_TABLE_MODEL } from "@/lib/benefit-table/flag";
import { priceFor } from "@/lib/ai/providers";

const RUN_ID = process.env.FIGURE_GUARDS_LIVE_RUN_ID ?? "";
const CAP = Number(process.env.FIGURE_GUARDS_LIVE_CAP_USD ?? "0.95");
const READ_MAX = 8_000;
const out = process.argv[2];
if (!RUN_ID || !out) { console.error("set FIGURE_GUARDS_LIVE_RUN_ID and pass an output directory"); process.exit(2); }
if (existsSync(path.join(out, "result.json"))) { console.error(`run ${RUN_ID} already has a result; use a new run id`); process.exit(2); }

/** Made-up documents in plain English, each a different kind of insurance and layout. */
export const DOCS: SourceDoc[] = [
  { id: "travel", name: "Example Travel Insurance policy", readable: true, people: ["Tan Mei Ling"], pages: [
    { page: 1, text: "EXAMPLE INSURANCE LTD\nTRAVEL INSURANCE POLICY SCHEDULE\nInsured Person: Tan Mei Ling\nPlan: Premier\nPeriod of Insurance: 01/12/2026 to 15/12/2026\nPolicy No.: TRV-000123\nPremium Paid: S$86.40" },
    { page: 2, text: "TABLE OF BENEFITS (S$)\nSection\tBenefit\tStandard\tPremier\tElite\n1\tAccidental death and permanent disablement\t100,000\t200,000\t300,000\n2\tOverseas medical expenses\t150,000\t500,000\t1,000,000\n3\tOverseas hospital cash (per day, up to 30 days)\t50\t100\t150\n4\tTrip cancellation\t5,000\t10,000\t15,000\n5\tTrip postponement\t500\t1,000\t1,500\n6\tBaggage delay (per 6 hours)\t100\t200\t300\n7\tLoss of baggage\t3,000\t5,000\t7,000\n8\tTravel delay (per 6 hours, up to)\t100 (max 1,000)\t100 (max 1,500)\t100 (max 2,000)" },
  ] },
  { id: "hospital", name: "Example Hospital Plan benefit schedule", readable: true, people: ["Lim Ah Kow"], pages: [
    { page: 1, text: "EXAMPLE INSURANCE BERHAD\nHOSPITAL & SURGICAL PLAN - CERTIFICATE\nLife Assured: Lim Ah Kow\nPlan: Gold\nAnnual Limit: S$250,000\nPremium: S$1,284.00 yearly\nCertificate No. HS-55021" },
    { page: 2, text: "SCHEDULE OF BENEFITS - PLAN GOLD (all amounts in Singapore dollars)\nDaily room and board (maximum 120 days per year)\tS$300 per day\nIntensive care unit (maximum 30 days per year)\tS$600 per day\nSurgical fees\tas charged, up to S$20,000 per operation\nPre-hospitalisation treatment (within 90 days before admission)\tup to S$3,000\nPost-hospitalisation treatment (within 90 days after discharge)\tup to S$3,000\nAmbulance fees\tup to S$500 per admission\nOutpatient cancer treatment\tup to S$60,000 per year\nCo-insurance: you pay 10% of the claimable amount" },
  ] },
  { id: "life", name: "Example Life policy schedule", readable: true, people: ["Wong Siew Lan"], pages: [
    { page: 1, text: "EXAMPLE LIFE ASSURANCE\nPOLICY SCHEDULE\nLife Assured: Wong Siew Lan\nPolicy Number: L-778812\nCommencement Date: 05/03/2024\n\nBenefit\tSum Assured\tPremium (monthly)\nWhole Life Basic Plan\tS$150,000\tS$212.35\nCritical Illness Rider\tS$100,000\tS$64.10\nTotal and Permanent Disability Rider\tS$150,000\tS$18.75\nTotal Monthly Premium\t\tS$295.20" },
    { page: 2, text: "SUMMARY OF BENEFITS\nDeath: the Sum Assured of the Whole Life Basic Plan, S$150,000, plus any bonuses.\nCritical illness: 100% of the Critical Illness Rider Sum Assured on diagnosis of a covered critical illness.\nEarly critical illness: 25% of the Critical Illness Rider Sum Assured, up to S$25,000.\nTotal and permanent disability: the TPD Rider Sum Assured, paid in 3 yearly instalments." },
  ] },
  { id: "accident", name: "Example Group Personal Accident terms", readable: true, people: [], pages: [
    { page: 1, text: "EXAMPLE INSURANCE - GROUP PERSONAL ACCIDENT\nSCALE OF COMPENSATION (percentage of the Sum Insured)\nDeath\t100%\nPermanent total disablement\t100%\nLoss of sight of one eye\t50%\nLoss of one hand at or above the wrist\t60%\nLoss of hearing in both ears\t75%\nFracture of the skull\t20%\nFracture of the hip\t15%\nFracture of the wrist\t5%\nBurns (third degree, more than 50% of body)\t50%, up to S$100,000\nThe most payable for all fractures from one accident is S$50,000." },
  ] },
  // An OCR'd scan of a travel schedule, with the misreadings a poor scan gives (O for 0, l for 1, a smudged cell).
  { id: "travel-scan", name: "Example Travel Insurance (scanned)", readable: true, people: ["Ng Boon Huat"], pages: [
    { page: 1, text: "EXAMPLE INSURANCE LTD\nTRAVEL POLICY SCHEDULE\nInsured: Ng Boon Huat\nPlan: Classic\nPremium Paid: S$4l.20" },
    { page: 2, text: "BENEFITS (S$)\tClassic\tDeluxe\nMedical expenses overseas\t2O0,000\t500,000\nTrip cancellation\t5,000\t1O,000\nLoss of baggage\t2,5OO\t5,000\nPersonal liability\t25O,0~0\t500,000\nHospital cash per day\t5O\t100" },
  ] },
];

type Row = { doc: string; figures: number; round0: number; rereads: number[]; corrected: number; confirm: number; checking: number; calls: number; usd: number;
  readerUsd: number; dropped: number; stopped: string | null; details: { where: string; reader1: number; status: string; value: number | null; candidates: number[]; seen?: unknown }[] };

async function main() {
  mkdirSync(out, { recursive: true });
  let spent = 0, calls = 0;
  const price = (m: TableModel, r: TableReply) => { const p = priceFor(m.choice)!; return (r.input * p.input + (r.cacheWrite ?? 0) * p.input * 1.25 + (r.cacheRead ?? 0) * (p.cachedInput ?? p.input) + r.output * p.output) / 1e6; };
  const reader1 = anthropicTableModel(DEFAULT_TABLE_MODEL);
  const guards: GuardReader[] = [{ model: reader1, prompt: "direct" }, ...DEFAULT_GUARDS.map((g) => ({ model: anthropicTableModel(g.choice, undefined, { effort: supportsEffort(g.choice.model) }), prompt: g.prompt }))];
  const rows: Row[] = [];
  const only = (process.env.FIGURE_GUARDS_LIVE_DOCS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const doc of DOCS.filter((d) => !only.length || only.includes(d.id))) {
    const user = renderDocument(doc);
    const worst = worstUsd(reader1, user.length + READING_PROMPT.length, READ_MAX);
    if (spent + worst > CAP) { console.log(`skip ${doc.id}: reading's worst case would pass the run limit`); continue; }
    const reply = await reader1.call({ system: READING_PROMPT, user, schema: READING_SCHEMA, maxTokens: READ_MAX });
    calls++; const readerUsd = price(reader1, reply); spent += readerUsd;
    writeFileSync(path.join(out, `reading-${doc.id}.json`), JSON.stringify(reply.json, null, 1));
    if (reply.json == null) { console.log(`${doc.id}: reading failed (${reply.stopReason})`); continue; }
    const checked = checkReading(doc, reply.json);
    const claims = claimsOf(checked);
    const g = await runGuards(doc, checked, guards, { capUsd: Math.max(0, CAP - spent) });
    calls += g.calls; spent += g.spentUsd;
    writeFileSync(path.join(out, `guards-${doc.id}.json`), JSON.stringify(g, null, 1));
    const v = claims.map((c) => ({ c, v: g.verdicts[c.key] }));
    const rereads = [1, 2, 3].map((r) => v.filter((x) => x.v.rounds === r && (x.v.status === "agreed" || x.v.status === "corrected")).length);
    rows.push({ doc: doc.id, figures: claims.length, round0: v.filter((x) => x.v.rounds === 0 && x.v.status !== "confirm" && x.v.status !== "checking").length, rereads,
      corrected: v.filter((x) => x.v.status === "corrected").length, confirm: v.filter((x) => x.v.status === "confirm").length, checking: v.filter((x) => x.v.status === "checking").length,
      calls: g.calls, usd: Math.round(g.spentUsd * 1e4) / 1e4, readerUsd: Math.round(readerUsd * 1e4) / 1e4, dropped: checked.dropped.length, stopped: g.stopped ?? null,
      details: v.map((x) => ({ where: `${x.c.field}: ${x.c.where}`, reader1: x.c.value, status: x.v.status, value: x.v.value, candidates: x.v.candidates, ...(x.v.seen ? { seen: x.v.seen } : {}) })) });
    console.log(`${doc.id}: ${claims.length} figures, ${rows.at(-1)!.confirm} to confirm, ${g.calls} guard calls, US$${g.spentUsd.toFixed(4)} (run so far US$${spent.toFixed(4)})`);
  }
  const result = { runId: RUN_ID, at: new Date().toISOString(), capUsd: CAP, spentUsd: Math.round(spent * 1e4) / 1e4, calls, models: [DEFAULT_TABLE_MODEL, ...DEFAULT_GUARDS.map((g) => g.choice)], rows };
  writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ spentUsd: result.spentUsd, calls }));
}
void main();
