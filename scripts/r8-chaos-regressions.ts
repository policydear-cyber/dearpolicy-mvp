/**
 * Round 8 chaos suite (npm run r8:chaos-test).
 *
 * DearPolicy had only been driven by a well-behaved deterministic stand-in.
 * This suite replaces it with the chaos model (lib/ai/chaos-model.ts), which
 * per call mutates the stand-in's output across every way a real model fails
 * (invented, rounded or off-by-a-digit figures, dates and percentages; a
 * figure on the wrong person or policy; promises, "not covered", advice;
 * markup, emoji, other languages, repetition, truncation, empty output;
 * refusals; leaked prompts, model and tool names, ids; injection text; pages
 * and benefits that do not exist; two questions at once; the wrong intent or
 * person; the wrong JSON shape, types or nulls; timeouts, provider errors and
 * exhausted quota mid-turn) and drives the REAL chat route through the Round 6
 * and Round 7 batteries (answers and claim conversations) under several fixed
 * seeds.
 *
 * Every turn must show grounded content or an honest, plain fallback: every
 * Round 6/7 detector and the Round 8 ones (scripts/r8/detectors.ts: nothing
 * the chaos model wrote on screen, every date traceable to a document) must
 * stay silent, the output guard must never have to act, and conversations
 * must still progress. Only usefulness rules (an honest fallback in place of
 * an answer) are counted instead of failed, and bounded here. Unit controls
 * run first: the chaos model can never be selected in production, the prose
 * gate refuses every text mutation, and the detectors detect.
 *
 * Deterministic: fixed seeds; R8_SEEDS=1,2,3 overrides them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SEEDS = (process.env.R8_SEEDS ?? "1,2").split(",").map((s) => s.trim()).filter(Boolean);
const BATTERIES = [
  { suite: "r6", script: "scripts/r6-chat-quality-regressions.ts" },
  { suite: "r7-answers", script: "scripts/r7-answers-regressions.ts" },
  { suite: "r7-claims", script: "scripts/r7-claims-regressions.ts" },
];
/** At most this share of turns may fall back to an honest "could not" under a broken model. */
const MAX_DEGRADED_SHARE = 0.05;

async function unitControls() {
  const { chaosModelSeed, deterministicModelEnabled } = await import("@/lib/ai/deterministic-model");
  const { checkDeterministicModelNotInProduction } = await import("@/lib/launch/guards");
  const C = await import("@/lib/ai/chaos-model");
  const { modelProseProblem } = await import("@/lib/chat/model-text");
  const { detectR8 } = await import("./r8/detectors");
  const { ruleInterpretation } = await import("@/lib/chat/facts");
  // ---------------------------------------------------- never in production
  const test = { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "chaos-3", E2E_RUN_ID: "r8" } as unknown as NodeJS.ProcessEnv;
  assert.equal(chaosModelSeed(test), 3);
  for (const env of [{ ...test, NODE_ENV: "production" }, { ...test, NODE_ENV: "development" }, { ...test, VERCEL: "1" }, { ...test, E2E_RUN_ID: "" }])
    assert.equal(deterministicModelEnabled(env as unknown as NodeJS.ProcessEnv), false, JSON.stringify(env));
  assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "production", DEARPOLICY_DETERMINISTIC_MODEL: "chaos-3" } as unknown as NodeJS.ProcessEnv).ok, false);
  // ---------------------------------------------------- the prose gate refuses every text mutation
  const clean = "Your MediGuard deductible is S$3,000 a year, and the co-insurance is 10%.";
  const proof = clean + "\nMediGuard Integrated Shield\nRahman bin Yusof";
  const check = { proof, names: ["Rahman bin Yusof", "Aminah binte Ismail"], echoOf: ["You are DearPolicy, talking to someone who has just had something happen to their family and wants to know where they stand."] };
  assert.equal(modelProseProblem(clean, check), null, "a clean rewording passes");
  const ctx = { system: check.echoOf[0], user: JSON.stringify({ name: "Aminah binte Ismail", amount: "S$400" }) };
  for (const mode of ["invent_amount", "digit_off", "rounded", "invent_percent", "invent_date", "wrong_attribution", "guarantee", "not_covered", "advice", "markdown", "html", "emoji", "repeat",
    "truncate_text", "empty_text", "refusal", "leak_system", "leak_model", "leak_ids", "mixed_language", "very_long", "injection", "fake_page", "hallucinated_benefit", "two_questions"] as const) {
    for (const r of [0.05, 0.42, 0.77, 0.97]) {
      const text = C.mutateText(clean, mode, () => r, ctx);
      assert.notEqual(modelProseProblem(text, check), null, mode + " passed the gate: " + text);
    }
  }
  assert.equal(modelProseProblem("You will definitely be paid in full.", { proof: "Benefits are not guaranteed." }), "promise");
  assert.equal(modelProseProblem("Any other driver is not insured. You are not insured for this.", { proof: "Any other driver is not insured by this policy." }), "not covered");
  assert.equal(modelProseProblem("Any other driver is not insured by this policy.", { proof: "Any other driver is not insured by this policy." }), null, "a document's own 'not insured' may be restated");
  // ---------------------------------------------------- rules when the interpreter is unusable
  assert.equal(ruleInterpretation({ message: "What is my deductible?", state: { subjects: {} }, subjectIds: ["m"] }).intent, "policy_question");
  const died = ruleInterpretation({ message: "My father died yesterday.", state: { subjects: {} }, subjectIds: ["m"] });
  assert.equal(died.intent, "claim"); assert.ok(died.facts.some((f) => f.key === "death" && f.value === true));
  assert.equal(ruleInterpretation({ message: "Do I have dental cover?", state: { subjects: {}, intent: "claim" }, subjectIds: ["m"] }).facts.length, 0);
  // ---------------------------------------------------- R8 detectors detect
  const base = { mode: "answer" as const, summary: "Your deductible is S$3,000 (page 2).", details: [] as string[], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] };
  const g = { pages: new Map([["p", "Deductible S$3,000. Cover ends 31 January 2027. Start date 1 August 2018."]]), today: "2026-10-04" };
  assert.equal(detectR8(base as never, { userText: "" }, g).length, 0, "clean answer");
  assert.equal(detectR8({ ...base, summary: "Renews 1 February 2027; year 10 ends 1 August 2028." } as never, { userText: "" }, g).length, 0, "derived dates");
  for (const bad of ["Your deductible is S$3,000. You can claim S$12,000 for this.", "As an AI language model, I cannot help.", "Polisi anda akan membayar sepenuhnya.", "Your deductible is S$3,000 🎉.", "Your cover renews on 3 March 2027.", "It ends on 9 May 2029."])
    assert.ok(detectR8({ ...base, summary: bad } as never, { userText: "" }, g).length > 0, "not detected: " + bad);
  // ---------------------------------------------------- the chaos model is deterministic
  const call = (seed: number) => { C.resetChaos(); const out: string[] = []; for (let i = 0; i < 40; i++) { try { out.push(C.chaosReply(seed, { system: "Interpret this", user: JSON.stringify({ currentMessage: "My son was admitted on 2026-09-01.", subjects: [{ id: "s1" }] }) }, () => ({ content: JSON.stringify({ intent: "claim", newTopic: false, searchTerms: [], facts: [], scenarioCandidates: [] }), truncated: false, usage: { input: 1, output: 1 }, resolved: { resolvedModel: "x", providerRequestId: null, finishReason: "stop", region: null } })).content); } catch (e) { out.push("throw:" + (e as Error).message); } } return out; };
  assert.deepEqual(call(5), call(5)); assert.notDeepEqual(call(5), call(6));
  C.resetChaos();
}

async function main() {
  const started = Date.now();
  await unitControls();
  console.log("unit controls: ok (never in production, prose gate refuses every text mutation, detectors detect, deterministic)");
  const { CHAOS_MODES } = await import("@/lib/ai/chaos-model");
  const dir = mkdtempSync(path.join(os.tmpdir(), "r8-chaos-"));
  const summary = path.join(dir, "summary.jsonl");
  const fails: string[] = [];
  const seen = new Set<string>();
  for (const seed of SEEDS) for (const b of BATTERIES) {
    const t0 = Date.now();
    const run = spawnSync(process.execPath, ["--import", "tsx", b.script], {
      env: { ...process.env, R8_CHAOS_SEED: seed, R8_SUMMARY: summary, R6_SHOW: "8", R7_SHOW: "8", R6_DUMP: "", R7_DUMP: "" },
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000,
    });
    const tail = (run.stdout + run.stderr).trim().split("\n").slice(-60).join("\n");
    const line = existsSync(summary) ? readFileSync(summary, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { suite: string; seed: string; turns: number; failures: number; degradedTurns: number; guard: number; modes: Record<string, number> }).find((x) => x.suite === b.suite && x.seed === seed) : undefined;
    console.log(`seed ${seed} ${b.suite}: exit ${run.status}, ${line ? `${line.turns} turns, ${line.failures} failing hits, ${line.degradedTurns} degraded turns, guard ${line.guard}` : "no summary"} (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (run.status !== 0 || !line) { fails.push(`seed ${seed} ${b.suite} failed:\n${tail}`); continue; }
    for (const m of Object.keys(line.modes)) seen.add(m.split(":")[1]);
    if (line.degradedTurns > line.turns * MAX_DEGRADED_SHARE) fails.push(`seed ${seed} ${b.suite}: ${line.degradedTurns} of ${line.turns} turns degraded (limit ${Math.round(MAX_DEGRADED_SHARE * 100)}%)`);
  }
  // The batteries must actually have met every failure mode.
  const missing = CHAOS_MODES.filter((m) => !seen.has(m));
  if (missing.length) fails.push("chaos modes never exercised: " + missing.join(", "));
  console.log(`\n${SEEDS.length} seed(s) x ${BATTERIES.length} batteries; ${seen.size - (seen.has("none") ? 1 : 0)} of ${CHAOS_MODES.length} failure modes exercised; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (fails.length) { console.log("\nFAIL:\n- " + fails.join("\n- ")); process.exitCode = 1; }
  else console.log("r8 chaos regressions passed");
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
