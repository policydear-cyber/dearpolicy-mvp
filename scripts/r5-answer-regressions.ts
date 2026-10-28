/**
 * Round 5 answer/cost/currentness/privacy regressions.
 *
 * PGlite (real PostgreSQL SQL), real library code, a simulated provider.
 * Every check runs; failures are collected; exit 1 if any failed.
 *
 *  S  Shield plan (synthetic ShieldCare Premier schedule, text extracted from
 *     the PDF fixture with extractPdfPages): wrapped cell fragments, dates and
 *     premiums are never rendered as benefit amounts or conflicts; the
 *     person's tier column (policy_members.benefit_tier) is the one shown;
 *     deductible / co-insurance / rider questions answer from those rows.
 *  P  portfolio cost: every premium component (plan + rider under one policy
 *     number), MediSave added back and split out, missing policies named.
 *  C  currentness: a future payment/renewal date is current; the "Active
 *     status not recently verified" note is said once per answer.
 *  D  deletion privacy: deleted documents' and households' stored files are
 *     removed (0 files remain), idempotently, with failures retried and a key
 *     still used by an active document kept.
 *  E  empty portfolio: dashboard and chat say nothing is on file.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { extractPdfPages } from "@/lib/documents/pdf";
import { answerPolicyQuestion, readPage, printedAmount, tierApplies } from "@/lib/chat/policy-answer";
import { assessCurrentness, consolidateActiveStatus } from "@/lib/policies/currentness";
import { isOneOffPremium, isShortPeriodPremium, premiumSplit, summarisePremiums } from "@/lib/policies/premium-summary";
import { documentName, insurerShortName, isMachineFilename } from "@/lib/policies/inventory";
import { whoIsCovered } from "@/lib/chat/household-status";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { drainStoragePurge, enqueueStoragePurge, PURGE_MAX_ATTEMPTS } from "@/lib/storage/purge";
import { localCleanupDriver } from "@/lib/storage/cleanup";
import type { ChatAnswer } from "@/types";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     "));
  }
}
async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  return n;
}
const FRAGMENTS = /\bward\)|\(B1 ward\)\s*[:(]|days: days|\bdays\b\s*\|\s*days|no currency|Period of insurance|Date of issue|different figures|date of birth/i;

async function main() {
  delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "r5-purge-"));
  const roots = { policy: path.join(tmp, "policy"), evidence: path.join(tmp, "evidence"), exports: path.join(tmp, "exports") };
  for (const r of Object.values(roots)) await mkdir(r, { recursive: true });
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: roots.policy, LOCAL_CLAIM_EVIDENCE_DIR: roots.evidence, LOCAL_HOUSEHOLD_EXPORT_DIR: roots.exports });

  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "claim-evidence.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "storage-purge.sql", "benefit-table.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  for (const t of ["policy_coverages", "policy_benefits", "coverage_rules"])
    await db.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS source_text_start int; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS source_text_end int;
      ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS extraction_method text; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS passage_verified boolean; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS conflict_note text;`);
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_date date;");
  // The round-5 ingestion interface (r5-ingest): typed table rows and the
  // member's tier column. Added here exactly as ingestion adds them.
  await db.exec(`ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS tier text; ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS row_kind text;
    ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS benefit_tier text;`);

  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = globalThis.fetch;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (/googleapis\.com\/v1beta\/models\?/.test(url)) return Response.json({ models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }] });
    if (!/googleapis\.com/.test(url)) throw new Error("Unexpected request: " + url);
    const body = JSON.parse(String(init?.body));
    const system = String(body.systemInstruction.parts[0].text);
    const result = system.startsWith("Interpret this") ? { intent: "policy_question", newTopic: false, searchTerms: ["hospital"], facts: [], scenarioCandidates: [] }
      : system.startsWith("Read insurance") ? { benefits: [], observations: [], nextSteps: [] }
      : system.startsWith("You decide which of a person") ? { applies: [], ruledOut: [] } : { summary: "Here is what the documents say.", details: [] };
    return Response.json({ modelVersion: "gemini-3.6-flash", responseId: "r", candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  }) as typeof fetch;
  Object.assign(process.env, { MODEL_PRESET: "gemini", GEMINI_API_KEY: "AQ.test-key", DEV_AUTH_ENABLED: "1" });

  // ---------------------------------------------------------------- fixture
  const H = "00000000-0000-0000-0000-0000000005a1";
  const id = (n: number) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const mei = { id: id(1), display_name: "Tan Mei Ling", preferred_name: "Mei Ling", relationship: "self" };
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Tan household')", [H]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [H]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [mei.id, H, mei.display_name, mei.preferred_name, mei.relationship]);
  const pdf = async (name: string) => extractPdfPages(Buffer.from((await readFile(path.resolve("scripts/fixtures/r5-answer/" + name), "utf8")).trim(), "base64"));
  const schedulePages = await pdf("shieldcare-schedule-2026.pdf.b64"), renewalPages = await pdf("shieldcare-renewal-2027.pdf.b64");
  const SCHED = id(101), RENEW = id(102), TERM = id(103);
  const addDoc = async (docId: string, product: string, number: string, pages: { pageNumber: number; text: string }[], effective: string, expiry: string | null, tier: string | null, role = "certificate") => {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,renewal_or_expiry_date,quarantine_status,lifecycle_state,file_hash,benefits_indexed_at,conditions_indexed_at,ledger_read_at)
      VALUES($1,$2,$3,'Merlion Mutual Assurance',$4,$5,'Health',$6,true,90,'ready',$7,$8,$9,$10,'scan_clean','active',$11,now(),now(),now())`,
      [docId, H, mei.id, product, number, role, product.replace(/\W+/g, "-") + ".pdf", H + "/" + docId + ".pdf", effective, expiry, "sha256:" + docId]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,benefit_tier) VALUES($1,$2,$3,$4)", [docId, mei.id, H, tier]);
    for (const p of pages) {
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [H, docId, p.pageNumber, p.text]);
      await db.query("INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,text) VALUES($1,$2,$3,$4,$4,$5)", [H, mei.id, docId, p.pageNumber, p.text]);
    }
  };
  await addDoc(SCHED, "ShieldCare Premier", "MMA-ISP-7730152", schedulePages, "2026-04-01", "2027-03-31", "Private hospital");
  await addDoc(RENEW, "ShieldCare Premier", "MMA-ISP-7730152", renewalPages, "2027-04-01", null, null);
  await addDoc(TERM, "TermSecure 20", "TS-20-5531", [{ pageNumber: 1, text: "TermSecure 20 certificate for Tan Mei Ling.\nDeath benefit\tS$200,000" }], "2025-01-01", null, null);

  // Typed rows as the round-5 ingestion stores them: one per tier column; the
  // quote is the whole table line (tabs as spaces).
  const page2 = schedulePages.find((p) => p.pageNumber === 2)!.text.split("\n");
  const quoteOf = (start: string) => page2.find((l) => l.startsWith(start))!.replace(/\t/g, " ");
  const TIERS = ["Private hospital", "Restructured hospital (A ward)", "Restructured hospital (B1 ward)"];
  const typed = async (name: string, lineStart: string, kind: string, values: (number | null)[], currency: string | null, formulaKind = "none") => {
    for (const [i, tier] of TIERS.entries())
      await db.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,tier,row_kind)
        VALUES($1,$2,'ShieldCare Premier',$3,ARRAY['hospitalisation']::text[],$4,$5,$6,2,$7,'[]'::jsonb,'[]'::jsonb,false,$8,$9)`,
        [H, SCHED, name, formulaKind, values[i], currency, quoteOf(lineStart), tier, kind]);
  };
  await typed("Daily room, board and hospital services", "Daily room, board", "as_charged", [null, null, null], null);
  await typed("Intensive care unit", "Intensive care unit", "as_charged", [null, null, null], null);
  await typed("Outpatient kidney dialysis", "Outpatient kidney dialysis", "benefit", [4000, 4000, 3000], "SGD", "expense_cap");
  await typed("Policy year limit", "Policy year limit", "policy_year_limit", [2000000, 1000000, 500000], "SGD");
  await typed("Deductible per policy year", "Deductible per policy year", "deductible", [3500, 3500, 2500], "SGD");
  await typed("Co-insurance", "Co-insurance", "co_insurance", [0.1, 0.1, 0.1], null);
  // Premium evidence as ingestion records it: the schedule's plan and rider
  // premiums, then the renewal notice's plan cash portion and rider premium.
  const prem = async (docId: string, product: string, amount: number, date: string, notes: string | null) =>
    db.query(`INSERT INTO premium_records(account_id,policy_id,source_document_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,payment_date,source_page,notes)
      VALUES($1,$2,$2,$3,'Merlion Mutual Assurance',$4,'MMA-ISP-7730152',$5,'SGD','annual',$6,1,$7)`, [H, docId, mei.id, product, amount, date, notes]);
  await prem(SCHED, "ShieldCare Premier", 1284, "2026-04-01", "S$1,284.00, of which S$1,050.00 is payable from MediSave and S$234.00 in cash");
  await prem(SCHED, "ShieldCare Plus Rider", 689, "2026-04-01", "payable in cash");
  await prem(RENEW, "ShieldCare Premier", 362, "2027-04-01", "cash portion after MediSave S$1,050");
  await prem(RENEW, "ShieldCare Plus Rider", 758, "2027-04-01", "cash");

  const now = new Date("2026-09-30T04:00:00Z");
  const text = (a: { summary: string; details: string[] }) => [a.summary, ...a.details].join(" | ");
  try {
    // ================================================================ S shield plan
    await check("S0 readPage: wrapped table cells, dates and premiums are never benefit rows", () => {
      const p1 = readPage(1, schedulePages[0].text), p2 = readPage(2, page2.join("\n"));
      assert.deepEqual(p2.rows, [], "table page yields no label/value rows: " + JSON.stringify(p2.rows.map((r) => r.label)));
      assert.ok(!p1.rows.some((r) => /period|issue|plan|life assured|premium/i.test(r.label)), "page 1 rows: " + JSON.stringify(p1.rows.map((r) => r.label)));
      assert.ok(p1.meta.some((r) => r.label === "Period of insurance") && p1.meta.some((r) => r.label === "Date of issue"), "dates are metadata");
      assert.equal(p1.premiums.length, 2, "both premium lines are premiums");
      const r = readPage(1, renewalPages[0].text);
      assert.ok(!r.rows.some((x) => /premium|medisave|cash payable|less/i.test(x.label)), "renewal premiums are not rows: " + JSON.stringify(r.rows.map((x) => x.label)));
      assert.ok(r.meta.some((x) => x.label === "Payment due date"));
      for (const v of ["1 April 2026 to 31 March 2027", "18 March 2026", "days", "(B1 ward)"]) assert.equal(printedAmount(v).amount, null, v + " is not an amount");
      assert.equal(tierApplies("Restructured hospital (B1 ward)", "Private hospital"), false);
      assert.equal(tierApplies("Private hospital", "Private hospital"), true);
    });
    await check("S1 'What does Mei Ling's shield plan cover for hospital stays?' shows her Private hospital column only, no fragments, dates, premiums or false conflicts", async () => {
      const r = await answerPolicyQuestion({ accountId: H, question: "What does Mei Ling's shield plan cover for hospital stays?", people: [mei], now });
      assert.equal(r.handled, true, "handled: " + JSON.stringify(r.rejected.map((x) => x.reason)) + " notFound " + JSON.stringify(r.notFound));
      const t = text(r.answer), all = JSON.stringify(r.answer);
      assert.ok(!FRAGMENTS.test(t), "fragment/date/conflict text: " + t.match(FRAGMENTS)?.[0] + " in " + t.slice(0, 600));
      assert.ok(!/premium/i.test(t), "a premium was rendered as a benefit: " + t.slice(0, 600));
      assert.match(t, /Daily room, board and hospital services: as charged/i);
      assert.ok(!/S\$3,000|S\$2,500|S\$500,000|S\$1,000,000/.test(t), "another tier's column shown: " + t.slice(0, 600));
      for (const l of r.answer.policyStatedLimits) assert.ok(![2026, 2027, 1984, 14, 18, 44].includes(l.amount), "a date/age became an amount: " + l.amount);
      assert.ok(!/\b(?:2026|2027)\b/.test(r.answer.policyStatedLimits.map((l) => String(l.amount)).join(" ")));
      assert.ok(!/1,284|689|1,412|758/.test(t), "premium figures in a coverage answer");
      void all;
    });
    await check("S2 deductible and co-insurance route to those rows, in her column (S$3,500 and 10%), not every benefit", async () => {
      const r = await answerPolicyQuestion({ accountId: H, question: "What is Mei Ling's deductible and co-insurance on her shield plan?", people: [mei], now });
      assert.equal(r.handled, true, JSON.stringify(r.rejected.map((x) => x.reason)));
      const t = text(r.answer);
      assert.match(t, /deductible of S\$3,500/i); assert.match(t, /10% \(co-insurance\)/i);
      assert.ok(!/S\$2,500/.test(t), "B1 column shown to a Private-hospital member");
      assert.ok(!/Daily room|kidney dialysis|Intensive care/i.test(t), "unrelated benefits listed: " + t.slice(0, 400));
    });
    await check("S3 the plan and rider premiums are two facts, never 'different figures for annual premium'", async () => {
      const r = await answerPolicyQuestion({ accountId: H, question: "What premium does Mei Ling pay for her shield plan?", people: [mei], now });
      const t = text(r.answer);
      assert.ok(!/different figures|conflict/i.test(t), "false conflict: " + t.slice(0, 500));
      if (r.handled) assert.ok(/689|758|1,284|362|1,412/.test(t), "premium answered: " + t.slice(0, 300));
    });
    await check("S4 without a known tier every column is shown, each labelled with its column", async () => {
      await db.query("UPDATE policy_members SET benefit_tier=NULL WHERE policy_id=$1", [SCHED]);
      try {
        const r = await answerPolicyQuestion({ accountId: H, question: "What is Mei Ling's deductible on her shield plan?", people: [mei], now });
        const t = text(r.answer);
        assert.match(t, /S\$2,500/); assert.match(t, /S\$3,500/);
        assert.match(t, /Restructured hospital \(B1 ward\)/, "column label shown: " + t.slice(0, 400));
      } finally { await db.query("UPDATE policy_members SET benefit_tier='Private hospital' WHERE policy_id=$1", [SCHED]); }
    });

    // ================================================================ P portfolio cost
    await check("P1 premiumSplit reads both printed MediSave forms", () => {
      assert.deepEqual(premiumSplit(362, "cash portion after MediSave S$1,050"), { total: 1412, cash: 362, medisave: 1050 });
      assert.deepEqual(premiumSplit(1284, "S$1,284.00, of which S$1,050.00 is payable from MediSave and S$234.00 in cash"), { total: 1284, cash: 234, medisave: 1050 });
      assert.deepEqual(premiumSplit(758, null), { total: 758, cash: null, medisave: null });
    });
    await check("P2 Mei Ling's total is plan S$1,412 + rider S$758 = S$2,170/year (cash S$1,120, MediSave S$1,050); TermSecure 20 named as missing", async () => {
      const s = await summarisePremiums(H, mei);
      assert.equal(s.items.length, 2, "plan and rider are separate lines: " + JSON.stringify(s.items.map((i) => i.product_name)));
      assert.equal(Math.round(s.annual * 100) / 100, 2170);
      assert.equal(Math.round(s.monthly * 100) / 100, 180.83);
      assert.equal(s.cashAnnual, 1120); assert.equal(s.medisaveAnnual, 1050);
      assert.ok(s.missing.some((m) => /TermSecure/i.test(m)), "missing: " + JSON.stringify(s.missing));
      assert.ok(!s.missing.some((m) => /ShieldCare/i.test(m)));
      assert.equal(s.complete, false); assert.match(s.note ?? "", /TermSecure 20/);
    });
    await check("P3 dashboard premiums: total, split and missing policies (never the rider alone)", async () => {
      const { GET } = await import("@/app/api/dashboard/route");
      process.env.DEV_ACCOUNT_ID = H;
      const res = await GET(new NextRequest("http://localhost/api/dashboard"));
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data).slice(0, 300));
      assert.equal(Math.round(data.premiums.annual), 2170, "annual " + data.premiums.annual);
      assert.notEqual(Math.round(data.premiums.annual), 758);
      assert.equal(data.premiums.medisaveAnnual, 1050); assert.equal(data.premiums.cashAnnual, 1120);
      assert.ok(data.reminders.some((r: { title: string; detail: string }) => /premiums are missing/i.test(r.title) && /TermSecure 20/.test(r.detail)));
      assert.equal(data.empty, false);
    });

    await check("P4 a short-period premium with no frequency (a trip) is never annualised into the yearly or monthly cost (Home tile S$6.10, 27 Oct)", async () => {
      const trip = { period_start: "2026-09-29", period_end: "2026-10-04" }, year = { period_start: "2026-01-01", period_end: "2026-12-31" };
      assert.equal(isOneOffPremium({ frequency: "Single premium" }), true);
      assert.equal(isOneOffPremium({ frequency: null }), false, "no frequency is not proof of a one-off premium");
      assert.equal(isShortPeriodPremium({ frequency: null, ...trip }), true);
      assert.equal(isShortPeriodPremium({ frequency: null, period_start: "2026-10-01", period_end: "2026-10-31" }), true, "a month's statement with no frequency is not a year's premium (Critic R264)");
      assert.equal(isShortPeriodPremium({ frequency: "annual", ...trip }), false, "a stated yearly premium stays yearly");
      assert.equal(isShortPeriodPremium({ frequency: null, ...year }), false, "a renewal for a year with no frequency stays yearly (Critic R263)");
      assert.equal(isShortPeriodPremium({ frequency: null, period_start: null, period_end: "2026-10-04" }), false, "an end date alone proves no short period");
      for (const f of ["Monthly", "per annum", "p.a.", "Fortnightly", "Tahunan", "Bulanan", "Yearly"]) assert.equal(isShortPeriodPremium({ frequency: f, ...trip }), false, f);
      assert.equal(isShortPeriodPremium({ frequency: null, period_start: null, period_end: null }), false, "unchanged: no frequency and no period");
      const tripRow = await db.query<{ id: string }>(`INSERT INTO premium_records(account_id,policy_id,source_document_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,payment_date,period_start,period_end,source_page,notes)
        VALUES($1,NULL,NULL,$2,'Harbour Travel Insurance','Travel Insurance','HTI-TRIP-5521',73.17,'SGD',NULL,'2026-09-28','2026-09-29','2026-10-04',1,'Total premium') RETURNING id`, [H, mei.id]);
      try {
        const s = await summarisePremiums(H, mei);
        assert.equal(Math.round(s.annual * 100) / 100, 2170, "the trip premium is not a yearly cost: " + s.annual);
        assert.equal(s.items.length, 2);
        assert.deepEqual(s.shortPeriod.map((i) => i.amount), [73.17]);
        assert.equal(s.complete, false, "a total that leaves a premium out is not complete");
        assert.match(s.note ?? "", /also leaves out Travel Insurance \(S\$73\.17 for 29 September 2026 to 4 October 2026\)/);
        assert.ok(!s.missing.some((m) => /travel/i.test(m)), "a policy with a one-off premium is not 'missing' a premium");
        const { GET } = await import("@/app/api/dashboard/route");
        process.env.DEV_ACCOUNT_ID = H;
        const data = await (await GET(new NextRequest("http://localhost/api/dashboard"))).json();
        assert.equal(Math.round(data.premiums.annual), 2170, "Home annual " + data.premiums.annual);
        assert.ok(!data.premiums.items.some((i: { amount: number }) => i.amount === 73.17), "the trip is not a current premium line on Home");
      } finally { await db.query("DELETE FROM premium_records WHERE id=$1", [tripRow.rows[0].id]); }
    });

    await check("P5 a policy with no premium record is counted on Home from the premium its own schedule prints (CI II S$470.85, 28 Oct)", async () => {
      const CI = id(104);
      await addDoc(CI, "LifeGuard Critical Illness", "LG-88120", [{ pageNumber: 1, text: "LifeGuard Critical Illness\nPolicy Schedule\nLife Assured\t: Tan Mei Ling\nPolicy Effective Date\t: 01/03/2026\n: Singapore Dollar\nInstalment Premium\t: 95.40\tCurrency\nPayment Frequency\t: Monthly\nCritical Illness Benefit\t150,000.00\t01/03/2026\t01/03/2046" }], "2026-03-01", null, null, "personal_schedule");
      // The premium is not in the reading: the table takes it from the page's one plain premium line (check.ts).
      const reading = { pages: [], document: { covers: [{ page: 1, person: "Tan Mei Ling", product: "LifeGuard Critical Illness", cover: "Critical Illness Benefit", plan: null, quote: "Critical Illness Benefit\t150,000.00\t01/03/2026\t01/03/2046", sumInsured: 150000 }],
        benefits: [], document: { kind: "personal_proof", product: "LifeGuard Critical Illness", plan: null, insurer: "Merlion Mutual Assurance", periodFrom: "01/03/2026", periodTo: "01/03/2046", namedPeople: ["Tan Mei Ling"] } } };
      await db.query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3::jsonb,'test','test')", [CI, H, JSON.stringify(reading)]);
      const env = { table: process.env.DEARPOLICY_BENEFIT_TABLE, alpha: process.env.DEARPOLICY_ALPHA_ACCOUNTS };
      try {
        const { GET } = await import("@/app/api/dashboard/route");
        process.env.DEV_ACCOUNT_ID = H;
        // Without the benefit table, unchanged: no premium record, so it is named as missing and not counted.
        const before = await (await GET(new NextRequest("http://localhost/api/dashboard"))).json();
        assert.equal(Math.round(before.premiums.annual), 2170, "without the table " + before.premiums.annual);
        assert.ok(before.premiums.missing.some((m: string) => /LifeGuard/.test(m)), JSON.stringify(before.premiums.missing));
        Object.assign(process.env, { DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: H });
        const data = await (await GET(new NextRequest("http://localhost/api/dashboard"))).json();
        const line = data.premiums.items.find((i: { product_name: string }) => i.product_name === "LifeGuard Critical Illness");
        assert.ok(line, "the schedule's premium is a line on Home: " + JSON.stringify(data.premiums.items.map((i: { product_name: string }) => i.product_name)));
        assert.equal(line.amount, 95.4); assert.equal(line.currency, "SGD"); assert.equal(line.frequency, "Monthly"); assert.equal(Math.round(line.annual * 100) / 100, 1144.8);
        assert.equal(Math.round(data.premiums.annual * 100) / 100, 3314.8, "S$2,170 + S$95.40 x 12: " + data.premiums.annual);
        assert.ok(!data.premiums.missing.some((m: string) => /LifeGuard/.test(m)), "no longer missing: " + JSON.stringify(data.premiums.missing));
        assert.ok(data.premiums.missing.some((m: string) => /TermSecure/.test(m)), "a policy whose document prints no premium is still named");
        // Records stay as they were: the ShieldCare lines are the records', never doubled by the table.
        assert.equal(data.premiums.items.filter((i: { product_name: string }) => /ShieldCare/.test(i.product_name)).length, 2);
        // The chat's premium total is not changed by this (it reads records only).
        const chat = await summarisePremiums(H, mei);
        assert.equal(Math.round(chat.annual), 2170);
        // A first-year premium on the page: the first-year figure is paid in the first policy year, the other after it.
        await db.query("UPDATE policy_pages SET text=replace(text, ': Singapore Dollar', 'First Year Instalment Premium * : 76.32' || chr(10) || ': Singapore Dollar') WHERE policy_id=$1", [CI]);
        const today = singaporeDay(new Date("2026-10-28T04:00:00Z"));
        const { tableFor } = await import("@/lib/benefit-table/service");
        const { appDb } = await import("@/lib/benefit-table/app");
        const covers = (await tableFor(appDb, H)).table.people.find((p) => p.id === mei.id)!.covers;
        const first = await summarisePremiums(H, mei, { covers, today });
        const lg = first.items.find((i) => i.product_name === "LifeGuard Critical Illness")!;
        assert.equal(lg.amount, 76.32); assert.match(lg.detail ?? "", /first policy year; S\$95\.40 monthly from 1 March 2027/);
        const later = await summarisePremiums(H, mei, { covers, today: singaporeDay(new Date("2027-03-02T04:00:00Z")) });
        assert.equal(later.items.find((i) => i.product_name === "LifeGuard Critical Illness")!.amount, 95.4);
        // A deleted document's premium is never counted, even while its reading is still stored.
        await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [CI]);
        assert.ok(!(await summarisePremiums(H, mei, { covers, today })).items.some((i) => i.product_name === "LifeGuard Critical Illness"));
      } finally {
        Object.assign(process.env, { DEARPOLICY_BENEFIT_TABLE: env.table ?? "", DEARPOLICY_ALPHA_ACCOUNTS: env.alpha ?? "" });
        for (const t of ["benefit_readings", "policy_chunks", "policy_pages", "policy_members"]) await db.query(`DELETE FROM ${t} WHERE policy_id=$1`, [CI]);
        await db.query("DELETE FROM policies WHERE id=$1", [CI]);
      }
    });

    await check("P6 the premium note names a document with no product name by what it is, never by a made-up file name (Home note named \"817d6e8b 874f ...\", 28 Oct)", async () => {
      const name = (original_filename: string, insurer: string | null = null, document_role: string | null = null, product_name: string | null = null) => documentName({ product_name, original_filename, insurer, document_role });
      // Made-up file names, in any market: the insurer (without its company form) and the kind of document.
      assert.equal(name("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "Example Life", "policy_wording"), "Example Life policy wording");
      assert.equal(name("output_202609281146053.pdf", "Harbour Travel Insurance Pte. Ltd.", "endorsement"), "Harbour Travel Insurance endorsement");
      assert.equal(name("IMG_2041.jpg", "Contoh Takaful Berhad", "personal_schedule"), "Contoh Takaful policy schedule");
      assert.equal(name("scan 3.pdf", "Example Assurance Limited", "premium_receipt"), "Example Assurance premium receipt");
      assert.equal(name("doc (1).pdf", null, "certificate"), "Certificate");
      assert.equal(name("20240101.pdf"), "Document");
      // A name a person chose, or the product name, is kept as before.
      assert.equal(name("Certificate of Insurance.pdf", "Example Life", "certificate"), "Certificate of Insurance");
      assert.equal(name("careshield_life_welcome_booklet.pdf"), "Careshield Life Welcome Booklet");
      assert.equal(name("Polisi Takaful 2024.pdf"), "Polisi Takaful 2024");
      assert.equal(name("MSIG_2024_receipt.pdf"), "MSIG 2024 receipt");
      assert.equal(name("817d6e8b-874f.pdf", "Example Life", "policy_wording", "Example Shield Plan"), "Example Shield Plan");
      assert.equal(isMachineFilename("Bupa.pdf"), false); assert.equal(isMachineFilename("a1b2c3d4e5.pdf"), true);
      // Letters of any script, and two-letter names, are a person's choice; device and app names are not (TE P159 F1, F2).
      for (const f of ["保险单.pdf", "보험증권.pdf", "Bảo hiểm nhân thọ.pdf", "ประกันชีวิต.pdf", "GE.pdf", "My CI.pdf"]) assert.equal(isMachineFilename(f), false, f);
      for (const f of ["DSC_0042.JPG", "PXL_20260101_123456789.jpg", "WhatsApp Image 2026-10-01 at 10.15.32.jpeg", "CamScanner 10-01-2026 10.15.pdf", "Microsoft Word - Document1.pdf", "Adobe Scan 28 Oct 2026.pdf", "fbdcaeef-1234-4abc-8def-0123456789ab.pdf"]) assert.equal(isMachineFilename(f), true, f);
      // A company form is a word of its own (TE P159 F3).
      for (const n of ["Tesco", "Zinc", "Seguros Mexico", "Allianz Morocco"]) assert.equal(insurerShortName(n), n);
      assert.equal(insurerShortName("Contoh Insurans Sdn. Bhd."), "Contoh Insurans");
      assert.equal(insurerShortName("Example Insurance Australia Pty Ltd"), "Example Insurance Australia");
      assert.equal(isMachineFilename("Screenshot_20261001-101500_Chrome.jpg"), true);
      // Two policies named by insurer and kind alone are told apart by their numbers, the same wherever the document is named (Critic R285 H1, TE P159 G1-G3).
      const sched = (original_filename: string, policy_number: string | null) => documentName({ product_name: null, original_filename, insurer: "Example Life Ltd", document_role: "personal_schedule", policy_number });
      assert.equal(sched("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "EL-11-4821"), "Example Life policy schedule (ending 4821)");
      assert.equal(sched("output_202609281146053.pdf", "EL-22-9017"), "Example Life policy schedule (ending 9017)");
      assert.equal(sched("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", null), "Example Life policy schedule", "no number: no ending, and never the made-up file name");
      assert.equal(documentName({ product_name: "Example Shield", original_filename: "x.pdf", insurer: "Example Life", document_role: "personal_schedule", policy_number: "EL-11-4821" }), "Example Shield", "a product name is kept as it is");
      assert.equal(sched("scan.pdf", "N/A"), "Example Life policy schedule", "a number with no digit is no number");
      // Two documents that share a name are two policies in "who is covered", never one plan covering both people (Critic R287 M1).
      const ann = { id: "pa", display_name: "Ann Example", preferred_name: "Ann", relationship: "self" }, ben = { id: "pb", display_name: "Ben Example", preferred_name: "Ben", relationship: "spouse" };
      const pd = (id: string) => ({ id, name: "Example Life policy schedule", filename: id + ".pdf", role: "personal_schedule", policyType: "Life", confirmed: true, tier: null, insurer: "Example Life", status: "ready" as const, effectiveDate: null, renewalOrExpiryDate: null });
      const who = whoIsCovered("who is covered by the life plan?", [ann, ben], new Map([["pa", [pd("d1"), pd("d3")]], ["pb", [pd("d2")]]]))!.text;
      assert.equal(who, "Example Life policy schedule covers you, going by the documents on file. Example Life policy schedule covers Ben, going by the documents on file.", who);
      assert.equal(insurerShortName("Example Assurance Company Singapore (Pte) Limited"), "Example Assurance Company Singapore");
      const doc = id(105);
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,lifecycle_state,file_hash)
        VALUES($1,$2,$3,'Merlion Mutual Assurance Pte. Ltd.',NULL,'MMA-CI-4410','Health','certificate',true,90,'ready','3f9a1c2e-7b4d-4e21-9c0a-55d2e1f0a9b7.pdf',$4,'2026-01-01','scan_clean','active',$5)`, [doc, H, mei.id, H + "/" + doc + ".pdf", "sha256:" + doc]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [doc, mei.id, H]);
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [H, doc, "Certificate for Tan Mei Ling.\nCritical illness benefit\tS$100,000"]);
      try {
        const s = await summarisePremiums(H, mei);
        assert.ok(s.missing.includes("Merlion Mutual Assurance certificate (ending 4410)"), "missing: " + JSON.stringify(s.missing));
        assert.match(s.note ?? "", /leaves out [^:]*Merlion Mutual Assurance certificate \(ending 4410\)/);
        assert.doesNotMatch(s.note ?? "", /3f9a1c2e|7b4d|55d2e1f0a9b7/i, "no made-up file name in the note");
      } finally { await db.query("DELETE FROM policy_pages WHERE policy_id=$1", [doc]); await db.query("DELETE FROM policy_members WHERE policy_id=$1", [doc]); await db.query("DELETE FROM policies WHERE id=$1", [doc]); }
    });

    // ================================================================ C currentness
    await check("C1 a future payment/renewal date means current, not 'older than 400 days'", () => {
      const c = assessCurrentness({ now, lastEvidenceOn: "2027-04-05", renewalOrExpiryDate: "2027-03-31" });
      assert.equal(c.state, "verified_recent", JSON.stringify(c));
      assert.ok(!/400 days|older/i.test(c.detail), c.detail);
      assert.equal(assessCurrentness({ now, lastEvidenceOn: "2024-01-01", renewalOrExpiryDate: null }).state, "not_recently_verified");
    });
    await check("C2 'Active status not recently verified' is said once per answer, not under every benefit card", () => {
      const note = "Active status not recently verified: no payment evidence since 2024.";
      const a = { details: ["x"], claimItems: [{ conditions: [note, "c1"] }, { conditions: [note] }, { conditions: ["c2"] }] };
      consolidateActiveStatus(a);
      assert.equal(a.details.filter((d) => d === note).length, 1);
      assert.ok(a.claimItems.every((i) => !i.conditions.includes(note)));
      assert.deepEqual(a.claimItems.map((i) => i.conditions), [["c1"], [], ["c2"]]);
      consolidateActiveStatus(a); assert.equal(a.details.filter((d) => d === note).length, 1, "idempotent");
    });

    // ================================================================ D deletion privacy
    const { createOrGetDeletionRequest } = await import("@/lib/lifecycle/deletion-requests");
    const { finishPolicyDocumentDeletion, finishClaimEvidenceDeletion } = await import("@/lib/lifecycle/coordinator");
    const { deleteHousehold } = await import("@/lib/household/repo");
    const put = async (root: string, key: string) => { await mkdir(path.dirname(path.join(root, key)), { recursive: true }); await writeFile(path.join(root, key), "synthetic"); };
    await check("D1 a deleted policy document's file is removed when its deletion completes; re-running is a no-op", async () => {
      const key = H + "/" + TERM + ".pdf"; await put(roots.policy, key);
      await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [TERM]);
      const { row } = await createOrGetDeletionRequest(pool as never, { accountId: H, resourceType: "policy_document", resourceId: TERM, requestedBy: H, reasonCategory: "user_request" as never, idempotencyKey: "r5-d1" });
      await finishPolicyDocumentDeletion({ accountId: H, actorUserId: H, policyId: TERM, deletionRequestId: row.id });
      assert.equal(await countFiles(roots.policy), 0, "file remains");
      const q = await db.query<{ purged: boolean }>("SELECT purged_at IS NOT NULL AS purged FROM storage_purge_queue WHERE storage_key=$1", [key]);
      assert.equal(q.rows[0]?.purged, true);
      await finishPolicyDocumentDeletion({ accountId: H, actorUserId: H, policyId: TERM, deletionRequestId: row.id });
      const again = await drainStoragePurge({}); assert.equal(again.failed, 0);
    });
    await check("D2 a deleted claim-evidence file is removed when its deletion completes", async () => {
      const session = id(301), ev = id(302), key = H + "/evidence/" + ev + "/bill.pdf";
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status) VALUES($1,$2,$3,'fact_finding')", [session, H, mei.id]);
      await db.query(`INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,lifecycle_state)
        VALUES($1,$2,$3,$4,'other_official_document','bill.pdf',$5,'application/pdf',9,'h-ev','soft_deleted')`, [ev, H, mei.id, session, key]);
      await put(roots.evidence, key);
      const { row } = await createOrGetDeletionRequest(pool as never, { accountId: H, resourceType: "claim_evidence", resourceId: ev, requestedBy: H, reasonCategory: "user_request" as never, idempotencyKey: "r5-d2" });
      await finishClaimEvidenceDeletion({ accountId: H, actorUserId: H, evidenceDocumentId: ev, deletionRequestId: row.id });
      assert.equal(await countFiles(roots.evidence), 0);
    });
    await check("D3 a failed removal is retried (backoff), then succeeds; attempts are bounded", async () => {
      const key = "retry/" + id(401) + ".pdf"; await put(roots.policy, key);
      await enqueueStoragePurge([{ domain: "policy", storageKey: key }], "document_deleted");
      let fail = true; const real = localCleanupDriver(roots.policy);
      const flaky = () => ({ ...real, async deleteObject(k: string) { if (fail) throw new Error("storage unavailable"); return real.deleteObject(k); } });
      const first = await drainStoragePurge({ driverFor: flaky as never });
      assert.equal(first.failed, 1); assert.equal(await countFiles(roots.policy), 1);
      const row = await db.query<{ attempts: number; due: boolean }>("SELECT attempts,next_attempt_at>now() AS due FROM storage_purge_queue WHERE storage_key=$1", [key]);
      assert.equal(row.rows[0].attempts, 1); assert.equal(row.rows[0].due, true, "backed off");
      await db.query("UPDATE storage_purge_queue SET next_attempt_at=now() WHERE storage_key=$1", [key]);
      fail = false;
      const second = await drainStoragePurge({ driverFor: flaky as never });
      assert.equal(second.removed, 1); assert.equal(await countFiles(roots.policy), 0);
      assert.ok(PURGE_MAX_ATTEMPTS >= 5 && PURGE_MAX_ATTEMPTS <= 50);
    });
    await check("D4 a key an active document still references is never removed; a later deletion of that document still removes it", async () => {
      const key = H + "/" + SCHED + ".pdf"; await put(roots.policy, key);
      await enqueueStoragePurge([{ domain: "policy", storageKey: key }], "document_deleted");
      const r = await drainStoragePurge({});
      assert.equal(r.keptReferenced, 1); assert.equal(await countFiles(roots.policy), 1, "active file removed");
      await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [SCHED]);
      await enqueueStoragePurge([{ domain: "policy", storageKey: key }], "document_deleted");
      await drainStoragePurge({});
      assert.equal(await countFiles(roots.policy), 0, "reopened entry was purged");
      await db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [SCHED]);
    });
    await check("D5 deleting a household removes every stored file it had (policies, claim evidence, exports): 0 files remain", async () => {
      const H2 = "00000000-0000-0000-0000-0000000005b2", m2 = id(501), p2 = id(502), s2 = id(503), e2 = id(504);
      await db.query("INSERT INTO accounts(id,name) VALUES($1,'Leaving household')", [H2]);
      await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [H2]);
      await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Lim Wei','self')", [m2, H2]);
      const pk = H2 + "/" + p2 + ".pdf", ek = H2 + "/evidence/" + e2 + ".pdf", xk = H2 + "/export.zip";
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,product_name,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,lifecycle_state,file_hash) VALUES($1,$2,$3,'Plan','certificate',true,'ready','p.pdf',$4,'active','h-p2')`, [p2, H2, m2, pk]);
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status) VALUES($1,$2,$3,'fact_finding')", [s2, H2, m2]);
      await db.query(`INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash) VALUES($1,$2,$3,$4,'other_official_document','b.pdf',$5,'application/pdf',9,'h-e2')`, [e2, H2, m2, s2, ek]);
      await db.query(`INSERT INTO household_exports(household_id,requested_by,idempotency_key,status,storage_key) VALUES($1,$1,'k','ready',$2)`, [H2, xk]);
      await put(roots.policy, pk); await put(roots.evidence, ek); await put(roots.exports, xk);
      await deleteHousehold(H2, H2);
      assert.equal((await db.query("SELECT 1 FROM accounts WHERE id=$1", [H2])).rows.length, 0, "household row gone");
      const left = (await countFiles(roots.policy)) + (await countFiles(roots.evidence)) + (await countFiles(roots.exports));
      assert.equal(left, 0, left + " file(s) remain");
      const again = await drainStoragePurge({}); assert.equal(again.failed, 0, "idempotent re-run");
    });
    await check("D6 another member's failed (non-owner) household deletion removes nothing", async () => {
      const H3 = "00000000-0000-0000-0000-0000000005c3", member = "00000000-0000-0000-0000-0000000005c4", p3 = id(601);
      await db.query("INSERT INTO accounts(id,name) VALUES($1,'Staying household')", [H3]);
      await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner'),($1,$2,'member')", [H3, member]);
      const pk = H3 + "/" + p3 + ".pdf", m3 = id(602);
      await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Goh Min','self')", [m3, H3]);
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,product_name,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,lifecycle_state,file_hash) VALUES($1,$2,$3,'Plan','certificate',true,'ready','p.pdf',$4,'active','h-p3')`, [p3, H3, m3, pk]);
      await put(roots.policy, pk);
      await assert.rejects(() => deleteHousehold(member, H3));
      await drainStoragePurge({});
      assert.equal(await countFiles(roots.policy), 1, "a non-owner's attempt removed a file");
    });

    // ================================================================ E empty portfolio
    await check("E1 an empty household is not 'everything current': the dashboard says nothing is on file", async () => {
      const E = "00000000-0000-0000-0000-0000000005e1";
      await db.query("INSERT INTO accounts(id,name) VALUES($1,'Empty household')", [E]);
      await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [E]);
      const { GET } = await import("@/app/api/dashboard/route");
      process.env.DEV_ACCOUNT_ID = E;
      const data = await (await GET(new NextRequest("http://localhost/api/dashboard"))).json();
      assert.equal(data.empty, true); assert.ok(data.reminders.length > 0, "no reminders means the page says 'Everything looks current'");
      assert.equal(data.premiums.annual, 0); assert.equal(data.premiums.complete, false);
      await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Ong Kai','self')", [id(701), E]);
      const d2 = await (await GET(new NextRequest("http://localhost/api/dashboard"))).json();
      assert.equal(d2.empty, true); assert.ok(d2.reminders.length > 0);
    });
    await check("E2 chat portfolio with no policies says so, with no reference to a table", async () => {
      const { POST } = await import("@/app/api/chat/route");
      process.env.DEV_ACCOUNT_ID = "00000000-0000-0000-0000-0000000005e1";
      const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyMemberId: id(701), scope: "member", question: "Show me my policy portfolio", asynchronous: false, timeZone: "Asia/Singapore" }) }));
      const data = await res.json(); const a = data.answer as ChatAnswer;
      assert.equal(res.status, 200, JSON.stringify(data).slice(0, 300));
      const t = text(a);
      assert.ok(!/I found 0|The table separates/i.test(t), "empty portfolio text: " + t.slice(0, 300));
    });
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect; globalThis.fetch = originalFetch; await db.close();
    await rm(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRound 5 answer regressions: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) { console.log("FAILED:\n- " + failed.map((f) => f.name).join("\n- ")); process.exitCode = 1; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
