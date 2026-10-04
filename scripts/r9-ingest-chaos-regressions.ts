/**
 * Round 9 ingestion chaos suite (npm run r9:ingest-chaos-test).
 *
 * Round 8 broke the model while a family member chats. This suite breaks it
 * while a DOCUMENT IS READ -- the policy extraction, the benefit catalogue and
 * its row categories, the condition catalogue, the Coverage Ledger read and
 * its verification, hosted OCR -- with the ingestion chaos stand-in
 * (lib/ai/chaos-ingest.ts): invented benefits, amounts, percentages and dates;
 * figures off by a digit or in the wrong unit; values from the wrong column;
 * the wrong person or document role; swapped policy numbers; hallucinated
 * insurer, product and benefit names; quotes not on the page; wrong pages; a
 * changed status; invented conditions; injection text; duplicates; malformed
 * JSON, nulls, wrong types; timeouts and provider errors mid-document.
 *
 *   1. Unit controls: the stand-in can never be selected in production; it is
 *      deterministic; every plain-code check refuses the facts each mutation
 *      plants; hosted OCR keeps only the pages it asked for.
 *   2. Stored facts: both fixture households are read under several seeds and
 *      every fact the chat could state is audited against the verbatim text of
 *      its own page (scripts/r9/audit.ts) and against the same household read
 *      by the well-behaved stand-in. Any violation fails.
 *   3. Partial failure: every document is read again while the reader fails
 *      on every call -- with its cached readings gone (a new model) and kept
 *      (a plain retry); nothing the first read established may be lost or
 *      duplicated.
 *   4. Answers: the Round 6 and Round 7 batteries run on households read under
 *      chaos, with the NORMAL chat stand-in, so anything planted at upload
 *      would surface; every Round 6/7/8/9 detector must stay silent and the
 *      output guard must never act. Usefulness lost to a broken reader (an
 *      honest "not found") is counted and bounded, not failed.
 *
 * Deterministic. R9_SEEDS (stored facts, default 1-6) and R9_CHAT_SEEDS
 * (answers, default 1,2) override the seeds.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const AUDIT_SEEDS = (process.env.R9_SEEDS ?? "1,2,3,4,5,6").split(",").map((s) => s.trim()).filter(Boolean);
const CHAT_SEEDS = (process.env.R9_CHAT_SEEDS ?? "1,2").split(",").map((s) => s.trim()).filter(Boolean);
/** At most this share of turns may fall back to an honest "could not find" because a document was read badly. */
const MAX_DEGRADED_SHARE = Number(process.env.R9_MAX_DEGRADED ?? 0.15);

async function unitControls() {
  const D = await import("@/lib/ai/deterministic-model");
  const { checkDeterministicModelNotInProduction } = await import("@/lib/launch/guards");
  const C = await import("@/lib/ai/chaos-ingest");
  const FC = await import("@/lib/documents/fact-check");
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");
  const { conditionsFromExtraction } = await import("@/lib/policies/condition-catalog");
  const { acceptTranscribedPages } = await import("@/lib/documents/ocr-hosted");
  // ---------------------------------------------------- never in production
  const test = { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-4", E2E_RUN_ID: "r9" } as unknown as NodeJS.ProcessEnv;
  assert.equal(D.ingestChaosModelSeed(test), 4);
  assert.equal(D.deterministicModelEnabled(test), true);
  for (const env of [{ ...test, NODE_ENV: "production" }, { ...test, NODE_ENV: "development" }, { ...test, VERCEL: "1" }, { ...test, VERCEL_ENV: "preview" }, { ...test, E2E_RUN_ID: "" }, { ...test, DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-" }, { ...test, DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-x" }]) {
    assert.equal(D.ingestChaosModelSeed(env as unknown as NodeJS.ProcessEnv), null, JSON.stringify(env));
    assert.equal(D.deterministicModelEnabled(env as unknown as NodeJS.ProcessEnv), false, JSON.stringify(env));
  }
  assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "production", DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-4" } as unknown as NodeJS.ProcessEnv).ok, false);
  assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "test", VERCEL: "1", DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-4" } as unknown as NodeJS.ProcessEnv).ok, false);
  // Chat-time calls are left to the normal stand-in.
  assert.equal(C.ingestOpOf("Interpret this insurance conversation"), null);
  // ---------------------------------------------------- deterministic
  const ledgerCall = { system: "Build the coverage ledger for an insurance document.", user: JSON.stringify({ document: { plan: "PA Guardian" }, familyMembers: ["Lim Xin Yi"], pages: [{ page: 2, text: "Accidental death S$100,000\nHospital cash for accidents S$100 per day, up to 30 days" }] }) };
  const run = (seed: number) => { C.resetIngestChaos(); const out: string[] = []; for (let i = 0; i < 30; i++) { try { out.push(C.ingestChaosReply(seed, ledgerCall, () => { throw new Error("unused"); }).content); } catch (e) { out.push("throw:" + (e as Error).message); } } return out; };
  assert.deepEqual(run(5), run(5)); assert.notDeepEqual(run(5), run(6));
  C.resetIngestChaos();

  // ---------------------------------------------------- every mutation of a policy reading is refused
  const pages = [
    { pageNumber: 1, text: "Orchid Assurance (fictitious)\nPA GUARDIAN - POLICY SCHEDULE\nPolicy number PAG-2026-4471\nGroup policy no GP-88123\nInsured person: Lim Xin Yi (child)\nDate of birth 3 March 2015\nPeriod of insurance 1 January 2026 to 31 December 2026\nSum insured S$100,000\nAnnual premium S$188.00" },
    { pageNumber: 2, text: "PA Guardian - Schedule of Benefits\nAccidental death S$100,000\nHospital cash for accidents S$100 per day, up to 30 days\nFracture benefit 80% of the fracture limit" },
  ];
  const good = PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Orchid Assurance (fictitious)", productName: "PA Guardian", productsMentioned: ["PA Guardian"],
    policyNumber: "PAG-2026-4471", groupPolicyNumber: "GP-88123", policyType: "Personal Accident", policyholder: null, personalCoverageConfirmed: true, startDate: "2026-01-01", renewalOrExpiryDate: "2026-12-31",
    insuredPeople: [{ name: "Lim Xin Yi", relationshipHint: "child", coverages: [{ category: "Personal Accident", productName: "PA Guardian", policyNumber: "PAG-2026-4471", amount: 100000, currency: "SGD", notes: null, sourcePage: 1, evidenceText: "Sum insured S$100,000", evidenceVerified: true }] }],
    referenceCoverages: [], premium: { amount: 188, currency: "SGD", frequency: "annual" }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  (globalThis as { __dpChaosHouseholdNames?: string[] }).__dpChaosHouseholdNames = ["Lim Xin Yi", "Tan Mei Ling", "Lim Wei Jie"];
  const sample = pages.map((p) => p.text).join("\n");
  const fullText = sample;
  const check = (x: typeof good) => verifiedExtraction(x, pages);
  const clean = check(good);
  assert.equal(clean.insuredPeople[0]?.coverages[0]?.evidenceVerified, true, "the honest reading keeps its verified cover");
  assert.equal(clean.premium.amount, 188); assert.equal(clean.policyNumber, "PAG-2026-4471"); assert.equal(clean.renewalOrExpiryDate, "2026-12-31");
  for (const mode of C.INGEST_CHAOS_MODES.filter((m) => m.startsWith("px_"))) {
    for (const roll of [0.05, 0.37, 0.71, 0.97]) {
      const mutated = PolicyExtractionSchema.safeParse(C.mutateIngestValue("policy_extraction", good as never, mode, () => roll, { sample }));
      if (!mutated.success) continue; // the schema already refuses it
      const out = check(mutated.data);
      const where = mode + "@" + roll;
      const text = JSON.stringify(out);
      assert.ok(!C.INGEST_SENTINEL_PATTERN.test(text.replace(/"Not kept because[^"]*"/g, "")), where + ": a planted name or instruction survived: " + text.slice(0, 300));
      for (const field of ["insurer", "productName", "policyholder"] as const) if (out[field]) assert.ok(FC.namePrinted(fullText, out[field]!), where + ": unprinted " + field + " " + out[field]);
      for (const p of out.insuredPeople) {
        assert.ok(FC.personPrinted(fullText, p.name), where + ": person not printed: " + p.name);
        for (const c of p.coverages) if (c.evidenceVerified) {
          assert.ok(c.amount == null || pages.some((pg) => pg.pageNumber === c.sourcePage && FC.moneyPrinted(pg.text, c.amount!)), where + ": verified cover figure not on its page: " + JSON.stringify(c));
          assert.ok(pages.some((pg) => pg.pageNumber === c.sourcePage && pg.text.includes(p.name)), where + ": verified cover on a page that does not name " + p.name);
        }
      }
      assert.equal(new Set(out.insuredPeople.map((p) => p.name.toLowerCase())).size, out.insuredPeople.length, where + ": duplicate person");
      if (out.policyNumber) assert.ok(fullText.includes(out.policyNumber) && !FC.onlyPrintedAsGroupNumber(pages, out.policyNumber), where + ": policy number " + out.policyNumber);
      for (const d of [out.startDate, out.renewalOrExpiryDate]) if (d) assert.ok(["2026-01-01", "2026-12-31"].includes(d), where + ": date " + d);
      if (out.startDate && out.renewalOrExpiryDate) assert.ok(out.startDate <= out.renewalOrExpiryDate, where + ": start after expiry");
      if (out.premium.amount != null) assert.equal(out.premium.amount, 188, where + ": premium");
      assert.ok(out.paymentRecords.every((p) => p.amount == null || FC.moneyPrinted(fullText, p.amount)), where + ": payment not printed");
      for (const t of [...out.keyExclusions, ...out.waitingPeriods, ...out.documentNotes, ...out.riders]) assert.ok(!/covered for everything|pre-approved|IN FORCE/i.test(t), where + ": " + t);
    }
  }
  // ---------------------------------------------------- figures, units, events, dates, names: the plain-code checks
  assert.equal(FC.moneyPrinted("Sum insured S$100,000", 100000), true);
  assert.equal(FC.moneyPrinted("Sum insured S$100,000", 10000), false, "off by a digit");
  assert.equal(FC.moneyPrinted("Co-insurance 80%", 80), false, "a percentage is not money");
  assert.equal(FC.moneyPrinted("Hospital cash S$100 per day, up to 30 days", 30), false, "a count of days is not money");
  assert.equal(FC.rowFigureSupported("Hospital cash for accidents S$100 per day, up to 30 days", "per_day", 100), true);
  assert.equal(FC.rowFigureSupported("Accidental death S$100,000", "per_day", 100000), false, "a lump sum is not a daily rate");
  assert.equal(FC.rowFigureSupported("Hospital cash for accidents S$100 per day, up to 30 days", "lump_sum", 100), false, "a daily rate is not a lump sum");
  assert.equal(FC.rowFigureSupported("Accidental death S$100,000", "percent_of_sum", 0.8), false, "S$ is not a percentage");
  assert.equal(FC.rowFigureSupported("Fracture benefit 80% of the fracture limit", "lump_sum", 80), false, "a percentage is not S$");
  assert.equal(FC.eventSupported("death", "Hospital cash for accidents S$100 per day"), false);
  assert.equal(FC.eventSupported("hospital_daily_cash", "Hospital cash for accidents S$100 per day"), true);
  assert.equal(FC.dateFitsRole(pages, "2015-03-03", "end"), false, "a birth date is never an expiry date");
  assert.equal(FC.dateFitsRole(pages, "2026-12-31", "end"), true);
  assert.equal(FC.onlyPrintedAsGroupNumber(pages, "GP-88123"), true);
  assert.equal(FC.namePrinted("NOTICE OF LAPSE - ASSURETERM 65", "NOTICE OF LAPSE - ASSURETE"), false, "a cut-off word is not the printed name");
  assert.equal(FC.namePrinted("SAFEGUARD JUNIOR PERSONAL ACCIDENT - POLICY SCHEDULE", "SafeGuard Junior PA"), true, "an abbreviation the page spells out");
  assert.equal(FC.namePrinted(fullText, C.INGEST_SENTINELS.product), false);
  assert.equal(FC.personPrinted(fullText, "Tan Mei Ling"), false);
  assert.equal(FC.readerTextSupported(fullText, C.INGEST_SENTINELS.injection), false);
  assert.equal(FC.readerTextSupported(fullText, C.INGEST_SENTINELS.status), false);
  assert.equal(FC.plausibleRole("premium_receipt", "Policy wording. Definitions. We will pay the benefit."), null);
  assert.equal(FC.plausibleRole("policy_wording", fullText), null, "a document printing one person's particulars is not generic wording");
  assert.equal(FC.frequencyContradicted("Monthly premium S$15.70", "annual"), true);
  // ---------------------------------------------------- conditions read by a model
  const page = { page_number: 2, text: pages[1].text + "\nWe will not pay for any claim caused by war, unless caused solely by an Accident." };
  for (const mode of ["cond_invented", "cond_wrong_product", "cond_injection"] as const) {
    const raw = C.mutateIngestValue("condition_page", { conditions: [] }, mode, () => 0.5, { payload: { page: 2, text: page.text } });
    for (const c of conditionsFromExtraction({ page, productName: "PA Guardian", raw })) {
      assert.ok(page.text.includes(c.quote), mode + ": quote not on the page");
      assert.ok(!C.INGEST_SENTINEL_PATTERN.test(JSON.stringify(c)), mode + ": " + JSON.stringify(c));
    }
  }
  // ---------------------------------------------------- hosted OCR keeps only the pages it asked for
  for (const mode of C.INGEST_CHAOS_MODES.filter((m) => m.startsWith("ocr_"))) {
    const transcript = C.mutateOcrTranscript(JSON.stringify({ pages: [{ pageNumber: 3, text: "Scanned page 3" }, { pageNumber: 4, text: "Scanned page 4" }] }), mode, () => 0.4);
    const kept = acceptTranscribedPages([3, 4], JSON.parse(transcript).pages);
    assert.ok(kept.every((p) => [3, 4].includes(p.pageNumber) && typeof p.text === "string"), mode + ": " + JSON.stringify(kept));
    assert.equal(new Set(kept.map((p) => p.pageNumber)).size, kept.length, mode + ": a page kept twice");
    assert.ok(!kept.some((p) => /S\$900,000|S\$750,000/.test(p.text)), mode + ": an unrequested or repeated page replaced a real one");
  }
  delete (globalThis as { __dpChaosHouseholdNames?: string[] }).__dpChaosHouseholdNames;
}

type Child = { status: number | null; out: string };
function child(script: string, env: Record<string, string>, timeoutMin = 20): Child {
  const run = spawnSync(process.execPath, ["--import", "tsx", script], { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMin * 60_000 });
  return { status: run.status, out: (run.stdout + run.stderr).trim() };
}

async function main() {
  const started = Date.now();
  await unitControls();
  console.log("unit controls: ok (never in production, deterministic, every policy-reading mutation refused, plain-code checks, conditions, hosted OCR pages)");
  const { INGEST_CHAOS_MODES } = await import("@/lib/ai/chaos-ingest");
  const dir = mkdtempSync(path.join(os.tmpdir(), "r9-ingest-"));
  const fails: string[] = [];
  const seenModes = new Set<string>();
  // ---------------------------------------------------- stored facts
  let violations = 0;
  for (const suite of ["r6", "r7"]) {
    const pristine = path.join(dir, suite + "-pristine.json");
    const p = child("scripts/r9/ingest-run.ts", { R9_SUITE: suite, R9_OUT: pristine, R9_INGEST_SEED: "" });
    if (p.status !== 0 || !existsSync(pristine)) { fails.push(suite + " pristine read failed:\n" + p.out.slice(-1500)); continue; }
    for (const seed of AUDIT_SEEDS) {
      const out = path.join(dir, suite + "-" + seed + ".json");
      const r = child("scripts/r9/ingest-run.ts", { R9_SUITE: suite, R9_INGEST_SEED: seed, R9_PRISTINE: pristine, R9_OUT: out, R9_SHOW: "20" });
      console.log(r.out.split("\n").filter((l) => /seed|✗/.test(l)).join("\n"));
      if (r.status !== 0 || !existsSync(out)) { fails.push(`${suite} seed ${seed}: read failed:\n` + r.out.slice(-1500)); continue; }
      const result = JSON.parse(readFileSync(out, "utf8")) as { violations: { kind: string; file: string; detail: string }[]; modes: string[] };
      for (const m of result.modes) seenModes.add(m.split(":")[1]);
      violations += result.violations.length;
      if (result.violations.length) fails.push(`${suite} seed ${seed}: ${result.violations.length} stored fact(s) not traceable to their page:\n  ` + result.violations.slice(0, 10).map((v) => `${v.kind} [${v.file}] ${v.detail}`).join("\n  "));
    }
    // ---------------------------------------------------- partial failure: a failing re-read loses nothing
    for (const variant of ["1", "cached"]) {
      const reread = path.join(dir, suite + "-reread-" + variant + ".json");
      const rr = child("scripts/r9/ingest-run.ts", { R9_SUITE: suite, R9_REREAD: variant, R9_OUT: reread, R9_INGEST_SEED: "" });
      console.log(rr.out.split("\n").filter((l) => /re-read|✗/.test(l)).join("\n"));
      if (rr.status !== 0 || !existsSync(reread)) fails.push(suite + " re-read failed:\n" + rr.out.slice(-1500));
      else {
        const res = JSON.parse(readFileSync(reread, "utf8")) as { lost: string[]; violations: { kind: string; file: string; detail: string }[] };
        if (res.lost.length || res.violations.length) fails.push(`${suite}: a failing re-read lost ${res.lost.length} fact(s) and planted or duplicated ${res.violations.length}:\n  `
          + [...res.lost, ...res.violations.map((v) => `${v.kind} [${v.file}] ${v.detail}`)].slice(0, 10).join("\n  "));
      }
    }
    // ---------------------------------------------------- answers
    for (const seed of CHAT_SEEDS) {
      const batteries = suite === "r6" ? [["r6", "scripts/r6-chat-quality-regressions.ts"], ["r7-claims", "scripts/r7-claims-regressions.ts"]] : [["r7-answers", "scripts/r7-answers-regressions.ts"]];
      for (const [name, script] of batteries) {
        const summary = path.join(dir, "summary-" + name + "-" + seed + ".jsonl");
        const t0 = Date.now();
        const r = child(script, { R9_INGEST_SEED: seed, R9_PRISTINE: pristine, R8_SUMMARY: summary, R6_SHOW: "8", R7_SHOW: "8", R6_DUMP: "", R7_DUMP: "", R8_CHAOS_SEED: "" });
        const line = existsSync(summary) ? JSON.parse(readFileSync(summary, "utf8").trim().split("\n").at(-1)!) as { turns: number; failures: number; degradedTurns: number; guard: number; byRule: Record<string, number> } : undefined;
        console.log(`seed ${seed} ${name}: exit ${r.status}, ${line ? `${line.turns} turns, ${line.failures} failing hits, ${line.degradedTurns} degraded turns, guard ${line.guard}` : "no summary"} (${Math.round((Date.now() - t0) / 1000)} s)`);
        if (r.status !== 0 || !line) { fails.push(`seed ${seed} ${name} failed:\n` + r.out.split("\n").slice(-40).join("\n")); continue; }
        if (line.guard) fails.push(`seed ${seed} ${name}: the output guard had to act ${line.guard} time(s)`);
        if (line.degradedTurns > line.turns * MAX_DEGRADED_SHARE) fails.push(`seed ${seed} ${name}: ${line.degradedTurns} of ${line.turns} turns degraded (limit ${Math.round(MAX_DEGRADED_SHARE * 100)}%)`);
      }
    }
  }
  // The documents must actually have met every failure mode (hosted OCR is covered by the unit controls: the fixtures have no scanned pages).
  const missing = INGEST_CHAOS_MODES.filter((m) => !m.startsWith("ocr_") && !seenModes.has(m));
  if (missing.length) fails.push("ingestion chaos modes never exercised: " + missing.join(", "));
  console.log(`\n${AUDIT_SEEDS.length} seed(s) x 2 households read under chaos: ${violations} stored fact(s) not traceable; ${[...seenModes].filter((m) => m !== "none").length} failure modes exercised; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (fails.length) { console.log("\nFAIL:\n- " + fails.join("\n- ")); process.exitCode = 1; }
  else console.log("r9 ingestion chaos regressions passed");
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
