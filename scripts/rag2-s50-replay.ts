/**
 * V1.4: replay of the actual-model run s50-live-2 (docs/rag-migration/live/RUN-s50-live-2-*) WITHOUT any model call,
 * through the REAL chat route, composer and save path of the checked-out code, on the same synthetic household (the
 * binding household with its certificate one cell per line). Every recorded model step is played back verbatim (the
 * same tool calls and arguments, grouped into the same model calls as the relay log recorded them), so this shows what
 * the CURRENT product does with the model output the real model actually produced.
 *   REPLAY=s50 node --import tsx scripts/rag2-s50-replay.ts   (the death conversation)
 *   REPLAY=injury node --import tsx scripts/rag2-s50-replay.ts (positive control, scripted moves: a fracture benefit
 *                                                              whose wording requires an X-ray, through the same note path)
 * Evidence class: REPLAY of recorded model output, not a new model result.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as BINDING from "./fixtures/rag2-binding/household";
import * as SCENARIO from "./fixtures/rag2-scenario/household";
import { recordedTurns, replayScript, runDir } from "./fixtures/rag2-live-replay";

const MODE = process.env.REPLAY === "injury" ? "injury" : "s50";
const HOUSEHOLD = (MODE === "s50" ? { ...BINDING, DOCS: BINDING.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BINDING.certLayout("cells") } : d)) } : SCENARIO) as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => q.text), ...(a.nextSteps ?? [])].join("\n");
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 12).join("\n     ")); } }
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const canon = (v: unknown): string => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(v);

async function injuryControl() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { REPORTED_MEDICAL_NOTE, REPORTED_MEDICAL_STEP } = await import("@/lib/rag2/loop/compose");
  const D = SCENARIO.M.raymond.id;
  const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
  const xray = (v: any) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const hit = ((o.result?.data?.hits ?? []) as any[]).find((x) => /confirmed by X-ray/.test(x.evidence?.excerpt ?? "")); if (hit) return [hit.evidence.evidence_id as string]; } return [] as string[]; };
  const S1 = "Fracture benefits are payable for a fracture confirmed by X-ray.";
  installLoopModel(new ScriptedLoopModel([
    { user: "Raymond broke his leg (tibia) in a fall. What can he claim?", steps: [
      () => [call("resolve_person", { mention: "Raymond" })],
      () => [call("search_passages", { query: "fracture benefits payable confirmed by X-ray", subject_id: D })],
      (v: any) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "xray_confirmed", question: "Was the fracture confirmed by X-ray?", because_evidence_ids: xray(v), statements: [{ text: `The Personal Accident wording says: “${S1}”`, evidence_ids: xray(v), subject_id: D }] })],
    ] },
    { user: "Yes, the X-ray confirmed it.", steps: [
      () => [call("note_facts", { subject_id: D, facts: [{ key: "xray_confirmed", value: "yes", words: "the X-ray confirmed it" }] })],
      () => [call("search_passages", { query: "fracture benefits payable confirmed by X-ray", subject_id: D })],
      (v: any) => [call("final_answer", { subject_id: D, sentences: [{ text: `The Personal Accident wording says: “${S1}”`, evidence_ids: xray(v), subject_id: D }] })],
    ] },
  ]));
  let c: { id?: string; rev?: number } = {}; const out: ChatAnswer[] = [];
  for (const u of ["Raymond broke his leg (tibia) in a fall. What can he claim?", "Yes, the X-ray confirmed it."]) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; out.push((await h.savedAnswer(c.id!)).answer); console.log(`\nUSER: ${u}\nAPP:  ${visible(out.at(-1)!).replace(/\n/g, "\n      ")}`); }
  installLoopModel(null);
  await check("positive control: when the selected injury benefit's wording requires an X-ray, the answer after the household confirms it keeps the medical paperwork (the doctor's report and the test or scan results), labelled as a suggestion to confirm with the insurer -- the same note path that now gives a death answer the non-medical wording", () => {
    const v = visible(out[1]);
    assert.ok((out[1].nextSteps ?? []).includes(REPORTED_MEDICAL_STEP), JSON.stringify(out[1].nextSteps));
    assert.match(v, /doctor’s report and the test or scan results/); void REPORTED_MEDICAL_NOTE;
  });
  const failed = results.filter((r) => !r.ok);
  console.log(`\ninjury control ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

async function main() {
  if (MODE === "injury") return injuryControl();
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const dir = runDir("RUN-s50-live-2-");
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const liveConv = run.conversations.find((c: any) => c.scenario === "S50");
  const turns = recordedTurns(dir, "S50");
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { SYSTEM_PROMPT, LOOP_PROMPT_VERSION } = await import("@/lib/rag2/loop/prompt");
  const { loopToolSpecs } = await import("@/lib/rag2/loop/loop");
  installLoopModel(new ScriptedLoopModel(replayScript(turns)));
  const saved: { answer: ChatAnswer; trace: any; returned: ChatAnswer }[] = [];
  let c: { id?: string; rev?: number } = {};
  for (const t of turns) {
    const a = await h.send(t.user, c);
    c = { id: a.conversationId, rev: a.conversationRevision };
    const s = await h.savedAnswer(c.id!);
    saved.push({ answer: s.answer, trace: s.state.ragLoop?.turns.at(-1), returned: a });
  }
  installLoopModel(null);
  if (h.networkCalls.length) throw new Error("network calls made: " + h.networkCalls.join(", "));
  const tools = loopToolSpecs().map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  console.log(`\n==== replay of ${path.basename(dir)} on the checked-out code (no model call; ${h.networkCalls.length} network calls)`);
  console.log(`prompt ${LOOP_PROMPT_VERSION}: system ${sha(SYSTEM_PROMPT).slice(0, 12)} (run: ${String(run.prompt?.systemPromptSha256).slice(0, 12)}), tools ${sha(canon(tools)).slice(0, 12)} (run: ${String(run.prompt?.toolSchemaSha256).slice(0, 12)})`);
  for (const [i, s] of saved.entries()) {
    console.log(`\n--- turn ${i + 1}\nUSER: ${turns[i].user}\nAPP (replay, saved):\n${visible(s.answer)}\nAPP (live ${run.testedCodeSha?.slice(0, 7)}):\n${liveConv.loaded.turns[i].visible}`);
    console.log(`bindings: ${JSON.stringify((s.answer.figureBindings ?? []).map((b: any) => [b.value, b.benefit, b.rowPerson, b.layout, b.policyId?.slice(-3), b.pageStart]))}`);
    console.log(`citations: ${JSON.stringify((s.answer.citations ?? []).map((x: any) => [x.policyId?.slice(-3), x.pageStart]))}  gate=${JSON.stringify(s.trace?.gate ?? [])} dropped=${JSON.stringify((s.trace?.dropped ?? []).map((d: any) => d.reason))}`);
  }
  await check("the system prompt the model saw is byte-identical on this code (same sha256 as the run recorded); the tool schema is reported (V1.5 added person_benefits' optional topic, so it differs from the run's)", () => {
    assert.equal(sha(SYSTEM_PROMPT), run.prompt.systemPromptSha256);
    const same = sha(canon(tools)) === run.prompt.toolSchemaSha256;
    console.log(`tool schema: ${same ? "identical to the run's" : "DIFFERS from the run's (the model would see a changed tool schema; the replay plays the recorded calls, which remain valid)"}`);
  });
  await check("every recorded model step replays with the same tool outcomes as live (same tools, same ok / refused)", () => {
    for (const [i, s] of saved.entries()) {
      const live = (liveConv.loaded.turns[i].trace.toolCalls as any[]).filter((x) => !x.args?.by).map((x) => `${x.name}:${x.ok}`);
      const now = (s.trace.toolCalls as any[]).filter((x) => !x.args?.by).map((x) => `${x.name}:${x.ok}`);
      assert.deepEqual(now, live, `turn ${i + 1}`);
    }
  });
  await check("the saved answer is what the chat route returned (the browser renders the returned answer)", () => {
    for (const s of saved) assert.equal(visible(s.answer), visible(s.returned));
  });
  {
    const DARREN = BINDING.M.darren.id, CERT = BINDING.doc("CERT").id;
    const { gradeBindingV4, inventedPaperwork } = await import("./rag2-live/binding-check");
    const bound = (s: (typeof saved)[number], value: number, re: RegExp) => (s.answer.figureBindings ?? []).find((b: any) => b.value === value && re.test(b.benefit) && b.subjectId === DARREN && /Darren/.test(b.rowPerson ?? "") && b.policyId === CERT);
    await check("turn 1 keeps Darren's Term Life S$1,000,000 and PA S$600,000, each bound to his row in the certificate and cited", () => {
      const s = saved[0], v = visible(s.answer);
      assert.match(v, /Group Term Life of S\$1,000,000/); assert.match(v, /Group Personal Accident of S\$600,000/);
      assert.ok(bound(s, 1000000, /Term Life/) && bound(s, 600000, /Personal Accident/), JSON.stringify(s.answer.figureBindings));
      assert.ok((s.answer.citations ?? []).some((x: any) => x.policyId === CERT), "the certificate is cited");
    });
    await check("turn 2 keeps every amount the model stated (PA S$600,000, bound and cited; the model did not restate Term Life in turn 2); the only thing taken out is the clause relying on Michelle's endorsement", () => {
      const s = saved[1], v = visible(s.answer);
      assert.match(v, /Group Personal Accident sum insured as S\$600,000 as of 6 October 2022, but the uploaded documents do not establish the amount applicable on the accident date\./); assert.ok(bound(s, 600000, /Personal Accident/));
      assert.ok((s.answer.citations ?? []).some((x: any) => x.policyId === CERT));
      assert.deepEqual((s.trace?.dropped ?? []).map((d: any) => d.reason), ["relies on an endorsement that applies only to Michelle Ong Li Ting, not to Darren Tan Kai Ming (that clause was taken out)"]);
      assert.deepEqual(s.trace?.gate ?? [], []);
    });
    await check("Michelle's endorsement supports no conclusion about Darren: no endorsement, amendment or its date in either answer; policies_for for Darren reports no amendment, while Michelle's still does", async () => {
      for (const s of saved) assert.ok(!/endorsement|amend|1 January 2024/i.test(visible(s.answer)), visible(s.answer));
      const { policiesFor } = await import("@/lib/rag2/policies");
      const d = await policiesFor({ accountId: BINDING.ACCOUNT, subjectId: DARREN, topic: "death" } as any);
      const m = await policiesFor({ accountId: BINDING.ACCOUNT, subjectId: BINDING.M.michelle.id, topic: "accident" } as any);
      const cert = (x: any) => [...x.covering, ...x.notCovering].find((c: any) => c.policyId === CERT);
      assert.deepEqual(cert(d).version.amendments, []); assert.equal(cert(d).version.current, "the schedule as issued");
      assert.ok(!JSON.stringify(d).includes(BINDING.doc("ENDORSE").id), "Darren's coverage mentions the endorsement");
      assert.deepEqual(cert(m).version.amendments.map((a: any) => [a.policyId, a.scope]), [[BINDING.doc("ENDORSE").id, "applies"]]);
    });
    await check("the person typing is not addressed by name: the sign-in does not establish who is typing (no 'Michelle' as the reader in either turn)", () => {
      for (const s of saved) assert.ok(!/\b(?:loss|sorry|hello|hi|thank you|thanks),?\s+Michelle\b|^Michelle,/im.test(visible(s.answer)), visible(s.answer));
    });
    await check("no injury-specific paperwork note (doctor's report, test or scan results, medical record) in either turn", () => {
      for (const s of saved) assert.ok(!/doctor|scan results|medical record|diagnos|specialist|medical assessment/i.test(visible(s.answer)), visible(s.answer));
    });
    await check("no unsupported paperwork presented as required (grader v4's independent check)", () => {
      for (const s of saved) assert.deepEqual(inventedPaperwork(visible(s.answer)), []);
    });
    await check("the dates, once given, are not asked again; turn 1 asks one question, for the accident date", () => {
      assert.deepEqual((saved[0].answer.questions ?? []).map((q) => q.text), ["On what date did the accident happen?"]);
      assert.deepEqual(saved[1].answer.questions ?? [], []);
    });
    await check("grader v4 (written before s50-live-2) on the replayed conversation: PASS", () => {
      const conv = [{ scenario: "S50", turns: turns.map((t) => ({ user: t.user })), loaded: { turns: saved.map((s) => ({ visible: visible(s.answer), questions: (s.answer.questions ?? []).map((q) => q.text), answer: s.answer, trace: s.trace })) } }];
      const g = gradeBindingV4(conv);
      assert.equal(g.verdict, "PASS", JSON.stringify(g.checks.filter((x) => !x.ok)));
    });
    await check("the differences from the live answer are exactly: the reader's name, the clauses relying on Michelle's endorsement, and the application's note", () => {
      const diffs: string[][] = [];
      for (const [i, s] of saved.entries()) {
        const live = String(liveConv.loaded.turns[i].visible).split("\n").filter((l: string) => !/^This changes what your policy pays under/.test(l));
        const now = visible(s.answer).split("\n");
        const removed = live.filter((l: string) => !now.includes(l)), added = now.filter((l) => !live.includes(l));
        console.log(`turn ${i + 1}:\n  removed ${JSON.stringify(removed)}\n  added   ${JSON.stringify(added)}`);
        diffs.push([...removed, ...added]);
        const norm = (t: string) => t.replace(/, Michelle(?=;)/, "").replace(/: an endorsement effective 1 January 2024 is linked to the policy, and/, ", and").replace(/; an endorsement effective 1 January 2024 is linked to the policy\./, ".")
          .replace(/What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for \(such as the doctor’s report and the test or scan results\) and decides/, "What you’ve told me is your own account: the insurer will check it against the documents it asks for and decides");
        assert.deepEqual(live.map(norm), now, `turn ${i + 1}: a difference other than the three expected`);
      }
    });
    fs.writeFileSync(path.join(dir, `REPLAY-${(process.env.REPLAY_TESTED_SHA ?? "local").slice(0, 7)}.json`), JSON.stringify({ replayedOn: process.env.REPLAY_TESTED_SHA ?? null, turns: saved.map((s, i) => ({ user: turns[i].user, visible: visible(s.answer), questions: (s.answer.questions ?? []).map((q) => q.text), figureBindings: s.answer.figureBindings, citations: s.answer.citations, gate: s.trace?.gate ?? [], dropped: s.trace?.dropped ?? [] })) }, null, 2));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nreplay ${MODE} ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
