/**
 * V1.5: replay of the pre-registered actual-model run s52-live-1 (docs/rag-migration/live/RUN-s52-live-1-*) WITHOUT any
 * model call, through the REAL chat route, composer and save path of the checked-out code, on the same synthetic
 * household the run used (scripts/fixtures/rag2-livelib). All six recorded turns (four conversations) are played back
 * verbatim -- the same tool calls and arguments, grouped into the same model calls as the relay log recorded them.
 *   node --import tsx scripts/rag2-s52-replay.ts
 * Evidence class: REPLAY of recorded model output, not a new model result. A product change that would make the model
 * act differently (e.g. use a calculation that now succeeds) is NOT shown by a replay: the recorded next step is played.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as LH from "./fixtures/rag2-livelib/household";
import { recordedRun, replayScript, runDir } from "./fixtures/rag2-live-replay";
import { uniqueSteps } from "@/components/next-steps";

const HOUSEHOLD = LH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
// What the chat page shows (app/chat/page.tsx): summary, details, questions, and every saved next step in order, each
// once (components/next-steps.ts).
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 14).join("\n     ")); } }

type Saved = { scenario: string; user: string; answer: ChatAnswer; returned: ChatAnswer; trace: any; live: string; liveTrace: any };
async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const dir = runDir("RUN-s52-live-1-");
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const saved: Saved[] = [];
  for (const conv of recordedRun(dir)) {
    const liveConv = run.conversations.find((c: any) => c.scenario === conv.scenario);
    installLoopModel(new ScriptedLoopModel(replayScript(conv.turns)));
    let c: { id?: string; rev?: number } = {};
    for (const [i, t] of conv.turns.entries()) {
      const a = await h.send(t.user, c);
      c = { id: a.conversationId, rev: a.conversationRevision };
      const s = await h.savedAnswer(c.id!);
      saved.push({ scenario: conv.scenario, user: t.user, answer: s.answer, returned: a, trace: s.state.ragLoop?.turns.at(-1), live: visible(liveConv.loaded.turns[i].answer), liveTrace: liveConv.loaded.turns[i].trace });
    }
    installLoopModel(null);
  }
  if (h.networkCalls.length) throw new Error("network calls made: " + h.networkCalls.join(", "));
  console.log(`\n==== replay of ${path.basename(dir)} (tested live on ${String(run.testedCodeSha).slice(0, 7)}) on the checked-out code: no model call, ${h.networkCalls.length} network calls`);
  for (const s of saved) {
    console.log(`\n--- ${s.scenario}\nUSER: ${s.user}\nAPP (replay, saved):\n${visible(s.answer)}\nAPP (live):\n${s.live}`);
    console.log(`calculations: ${JSON.stringify((s.answer.calculations ?? []).map((r: any) => [r.result?.value, r.currency, (r.operands ?? []).map((o: any) => o.value)]))}`);
    console.log(`tools: ${(s.trace?.toolCalls ?? []).filter((x: any) => !x.args?.by).map((x: any) => `${x.name}:${x.ok}${x.error ? "(" + String(x.error).slice(0, 300) + ")" : ""}`).join(" ")}`);
    console.log(`gate=${JSON.stringify(s.trace?.gate ?? [])} dropped=${JSON.stringify((s.trace?.dropped ?? []).map((d: any) => [String(d.sentence ?? "").slice(0, 120), d.reason]))}`);
    console.log(`citations: ${JSON.stringify((s.answer.citations ?? []).map((x: any) => [x.policyId?.slice(-3), x.pageStart, String(x.excerpt ?? "").slice(0, 60)]))}`);
  }
  if (process.env.REPLAY_EXPLORE) process.exit(0);
  await checks(saved, h);
  fs.writeFileSync(path.join(dir, `REPLAY-${(process.env.REPLAY_TESTED_SHA ?? "local").slice(0, 7)}.json`), JSON.stringify({ replayedOn: process.env.REPLAY_TESTED_SHA ?? null, turns: saved.map((s) => ({ scenario: s.scenario, user: s.user, visible: visible(s.answer), questions: (s.answer.questions ?? []).map((q) => q.text), calculations: s.answer.calculations ?? [], figureBindings: s.answer.figureBindings, citations: s.answer.citations, tools: (s.trace?.toolCalls ?? []).filter((x: any) => !x.args?.by).map((x: any) => ({ name: x.name, ok: x.ok, error: x.error ?? null })), gate: s.trace?.gate ?? [], dropped: s.trace?.dropped ?? [] })) }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nreplay s52 ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
async function checks(saved: Saved[], h: Awaited<ReturnType<typeof startHarness>>) {
  void h;
  const T = (sc: string, n = 0) => saved.filter((s) => s.scenario === sc)[n];
  const asLive = visible; // the complete visible answer as the page shows it (live: run.json's saved answer, same rule)
  const tools = (t: any) => (t?.toolCalls ?? []).filter((x: any) => !x.args?.by).map((x: any) => `${x.name}:${x.ok}`);
  await check("the saved answer is what the chat route returned (the browser renders the returned answer), for all six turns", () => {
    assert.equal(saved.length, 6);
    for (const s of saved) assert.equal(visible(s.answer), visible(s.returned));
  });
  await check("every recorded model step replays with the same tools as live; the only changed outcome is S52D's calculate, refused live and now run (the same arguments)", () => {
    for (const s of saved) {
      const live = tools(s.liveTrace), now = tools(s.trace);
      if (s.scenario === "S52D") assert.deepEqual(now, live.map((x: string) => (x === "calculate:false" ? "calculate:true" : x)), s.scenario);
      else assert.deepEqual(now, live, s.scenario);
    }
  });
  await check("S52D: the recorded calculate call (proportion on the passage that stops above the leg row) now gives the conditional 50% x S$5,000 = S$2,500 on the Simple Fracture Benefit Limit", () => {
    const c = (T("S52D").trace.toolCalls as any[]).find((x) => x.name === "calculate");
    assert.ok(c.ok, JSON.stringify(c)); const sum = JSON.parse(c.summary ?? "{}");
    assert.equal(sum.amount, 2500); assert.equal(sum.kind, "conditional_illustration");
  });
  await check("S52D: \"The uploaded documents do not provide Adrian’s Group Personal Accident Sum Insured\" is not shown -- his certificate prints it -- and the dated limitations of S52A (\"do not establish the Sum Insured in force on 3 October 2026\") are kept", () => {
    assert.ok(!/do not provide Adrian’s Group Personal Accident Sum Insured/.test(visible(T("S52D").answer)), visible(T("S52D").answer));
    assert.ok((T("S52D").trace.dropped ?? []).some((d: any) => /Certificate lists S\$600,000/i.test(d.reason)), JSON.stringify(T("S52D").trace.dropped));
    assert.match(visible(T("S52A", 1).answer), /do not establish the Sum Insured in force on 3 October 2026/);
    assert.match(visible(T("S52A", 0).answer), /do not establish the amount in force at a hypothetical future event/);
  });
  await check("S52A: S$2,000 is no longer attributed to the policy wording (which prints a bare $2,000 and states no currency); the summary's S$2,000 for Repatriation of Mortal Remains is kept", () => {
    for (const s of [T("S52A", 0), T("S52A", 1)]) {
      const v = visible(s.answer);
      assert.ok(!/policy wording says[^.\n]*S\$2,000/.test(v), v);
      assert.match(v, /S\$2,000 for Repatriation of Mortal Remains if death occurs outside Singapore|Repatriation of Mortal Remains of S\$2,000 if death occurs outside Singapore/);
    }
  });
  await check("S52A: the six-month notification printed under the Group Term Life summary's Claims heading is kept for that policy's death claim (live took it out), in both turns", () => {
    assert.match(visible(T("S52A", 0).answer), /notify Kestrel Life Ltd within 6 months with the death certificate/);
    assert.match(visible(T("S52A", 1).answer), /notify Kestrel Life Ltd of a death within 6 months/);
    for (const s of [T("S52A", 0), T("S52A", 1)]) assert.ok(!(s.trace.dropped ?? []).some((d: any) => /within 6 months/.test(d.reason)), JSON.stringify(s.trace.dropped));
  });
  await check("S52A travel: the conclusion stays \"not documented\" (\"does not document cover for a hypothetical trip to Japan\"), never \"does not cover\"; the turn-2 sentence saying the same, wrongly taken out live as an exclusion, is now shown", () => {
    assert.match(visible(T("S52A", 0).answer), /does not document cover for a hypothetical trip to Japan\./);
    assert.match(visible(T("S52A", 1).answer), /does not document travel cover for Japan in October 2026\./);
    for (const s of saved) assert.ok(!/\b(?:does not|doesn['’]t|do not) cover\b[^.\n]*\b(?:trip|Japan|travel)\b|\bnot covered\b[^.\n]*\b(?:trip|Japan)\b/i.test(visible(s.answer)), visible(s.answer));
  });
  await check("S52D's Other Fracture statement (50% of the Sum Insured) is checked against ITS OWN table: the live-library policy wording, page 1, prints the leg row at 50% of the Sum Insured, and that page is cited; no Other Fracture amount is stated. (The 60% in PART=multiline is a different, deliberately different synthetic fixture -- scripts/fixtures/rag2-livelib/multiline.ts, Summary of Benefits page 13 -- checked against that table there.)", () => {
    const s = T("S52D"), v = visible(s.answer);
    assert.match(v, /Other Fracture table lists 50% of the Sum Insured for a leg, ankle, knee, jaw or pelvis fracture/);
    const wording = LH.doc("WORDING");
    assert.match(String((wording.pages as Record<number, string>)[1]), /Compensation \(% of Sum Insured\)[\s\S]*Jaw, Pelvis, Leg, Ankle or Knee \(Other Fracture\)\s*50%/);
    assert.ok((s.answer.citations ?? []).some((c: any) => c.policyId === wording.id && c.pageStart === 1), JSON.stringify(s.answer.citations));
    assert.ok(!/Other Fracture[^.\n]*S\$\d/.test(v), v);
  });
  await check("S52C: the inventory lists every readable upload for each person and the unreadable IMG_0042.jpg, without the generic \"I couldn’t confirm an answer\" line", () => {
    const v = visible(T("S52C").answer);
    for (const d of LH.DOCS.filter((x) => !x.account && x.key !== "SCAN")) assert.ok(v.includes(d.product), d.product);
    assert.match(v, /its contents could not be read: IMG_0042\.jpg\. Nothing in it can be used; linking it to a person would not change that/); assert.ok(!/link it to a person so it can be used/.test(v), v);
    assert.ok(!/couldn’t confirm an answer/.test(v), v);
  });
  await check("S52B is unchanged from live: amounts and certificate date, then Cheryl's PA S$600,000 correcting the S$1,000,000 premise", () => {
    assert.equal(asLive(T("S52B", 0).answer), T("S52B", 0).live); assert.equal(asLive(T("S52B", 1).answer), T("S52B", 1).live);
  });
  await check("no Living Care Plus figure, no 365-day condition borrowed for death, no limit stop, no question repeating a date, in any turn", () => {
    for (const s of saved) { const v = visible(s.answer); assert.ok(!/Living Care|S\$300,000/.test(v), v); assert.ok(!/(?:Accidental )?Death[^.\n]*365/.test(v), v); assert.ok(!s.trace?.limit, JSON.stringify(s.trace?.limit)); }
    assert.deepEqual(T("S52A", 1).answer.questions ?? [], []);
  });
  await check("the differences from the live answers (run.json's saved answers, shown as the page shows them) are exactly the fixes above", () => {
    const expected: Record<string, { removed: RegExp[]; added: RegExp[] }> = {
      // Expectation correction (PR #57 follow-up, Test engineer, EXPECTATION-CHANGES.md): the policy wording prints "up to $2,000" (bare "$",
      // scripts/fixtures/rag2-livelib/household.ts); the live sentence called it S$2,000. The code now states it as its own sentence with the
      // currency unresolved, so S52A#0 adds three statements, not two, and S52A#1 one more than before (the same sentence). Original: added: [repatriation S$2,000 sentence, notify within 6 months].
      "S52A#0": { removed: [/and the policy wording says reasonable costs/, /says to notify Kestrel Life Ltd with the death certificate/], added: [/^The group accident wording lists S\$2,000 for Repatriation of Mortal Remains if death occurs outside Singapore as a result of an Accident\.$/, /^The policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to 2,000 \(printed with a “\$” sign; the document does not say which currency\)\.$/, /says to notify Kestrel Life Ltd within 6 months with the death certificate/] },
      "S52A#1": { removed: [/and the policy wording says reasonable costs/, /says to notify Kestrel Life Ltd of a death and provide/, /^Contact the group personal accident insurer about .*; keep the death certificate/], added: [/^The policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to 2,000 \(printed with a “\$” sign; the document does not say which currency\)\.$/, /^For Adrian, the group accident wording provides Repatriation of Mortal Remains of S\$2,000 if death occurs outside Singapore as a result of an Accident\.$/, /notify Kestrel Life Ltd of a death within 6 months/, /does not document travel cover for Japan/,
        // reliable chat (contract C): the live next step's three independent actions are three steps, each checked whole
        /^Contact the group personal accident insurer about the Accidental Death and Repatriation of Mortal Remains benefits\.$/, /^Keep the death certificate and reasonable repatriation-cost records\.$/, /^Ask what claim forms and supporting documents are required\.$/] },
      "S52C#0": { removed: [/^I couldn’t confirm an answer to that from your documents\.$/, /IMG_0042\.jpg \(could not be read\) -- link it to a person so it can be used for them\.$/], added: [/its contents could not be read: IMG_0042\.jpg\. Nothing in it can be used; linking it to a person would not change that/] },
      "S52D#0": { removed: [/do not provide Adrian’s Group Personal Accident Sum Insured/], added: [] },
    };
    const seen: Record<string, number> = {};
    for (const s of saved) {
      const k = `${s.scenario}#${(seen[s.scenario] = (seen[s.scenario] ?? -1) + 1)}`;
      const live = s.live.split("\n"), now = asLive(s.answer).split("\n");
      const removed = live.filter((l) => !now.includes(l)), added = now.filter((l) => !live.includes(l));
      console.log(`${k}:\n  removed ${JSON.stringify(removed)}\n  added   ${JSON.stringify(added)}`);
      const e = expected[k] ?? { removed: [], added: [] };
      assert.equal(removed.length, e.removed.length, `${k} removed`); assert.equal(added.length, e.added.length, `${k} added`);
      e.removed.forEach((re) => assert.ok(removed.some((l) => re.test(l)), `${k}: ${re}`));
      e.added.forEach((re) => assert.ok(added.some((l) => re.test(l)), `${k}: ${re}`));
    }
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
