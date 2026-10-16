/**
 * ADVERSARIAL behaviour suite for the conversational RAG path (npm run rag2:adversarial-test).
 * INTEGRATION TESTS: PGlite with the real schema, two new synthetic households (scripts/fixtures/rag2-adv), every turn
 * posted to the REAL chat route with DEARPOLICY_RAG_LOOP=1 and a TEST-ONLY scripted model; assertions read what was
 * persisted (chat_messages.answer_json / chat_conversations.state). Expectations are the REQUIRED behaviour, not the
 * current one: on the base commit several checks fail by design (see REVIEW.md for the defect list).
 *
 *   S1..S10  the ten required demonstrations (with paraphrases and adversarial variants)
 *   X1..X8   adversarial extras (prompt injection, forged ids, payout wording, totals, household figures as policy
 *            operands, two questions at once, re-asking a known fact, irrelevant "why" evidence)
 *   U1..U3   usage limits (household spend cap, per-turn token budget, usage accounting)
 *   T9/V9/T10  tool-level and verifier-level isolation and lifecycle checks
 * Each check prints PASS/FAIL; a final JSON line lists the results. Exit 1 if any check failed.
 * Filter with RAG2_ADV_ONLY=<regex on check names>.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setAdvEnv, startAdvHarness, type AdvHarness, type Saved } from "./fixtures/rag2-adv/harness";
import { ACCOUNT_N, ACCOUNT_T, doc, N, T } from "./fixtures/rag2-adv/household";
import { AdvModel, call, type Turn } from "./fixtures/rag2-adv/model";
import * as SC from "./fixtures/rag2-adv/scenarios";

setAdvEnv();
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const ONLY = process.env.RAG2_ADV_ONLY ? new RegExp(process.env.RAG2_ADV_ONLY) : null;
async function check(name: string, fn: () => Promise<void> | void) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const visible = (a: ChatAnswer | undefined) => !a ? "" : [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q) => q.text), ...(a.nextSteps ?? [])].join(" ");
const MONEY = /S\$\s?\d/;
const acct = (s: "T" | "N") => (s === "T" ? ACCOUNT_T : ACCOUNT_N);
type TurnOut = { saved: Saved; a: ChatAnswer; v: string; loop: any; trace: any };
const refusals = (t: TurnOut) => (t.trace?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => `${x.name}: ${x.error}`);
const scriptErrors = (t: TurnOut) => (t.trace?.toolCalls ?? []).filter((x: any) => x.name === "model" && !x.ok).map((x: any) => x.error);
const ctxOf = (t: TurnOut) => `\n     visible: ${t.v.slice(0, 400)}\n     refused: ${JSON.stringify(refusals(t)).slice(0, 400)}\n     dropped: ${JSON.stringify(t.trace?.dropped ?? []).slice(0, 300)}\n     gate: ${JSON.stringify(t.trace?.gate ?? []).slice(0, 300)}${scriptErrors(t).length ? "\n     script/model error: " + scriptErrors(t).join("; ").slice(0, 300) : ""}`;
/** A verified record of a computed figure: a ComputationRecord (compute) or a CalculationRecord (calculate). */
const recordFor = (a: ChatAnswer | undefined, value: number) => [...((a?.computations ?? []) as any[]), ...(((a as any)?.calculations ?? []) as any[])].find((c) => Math.abs(Number(c?.result?.value) - value) < 1e-9);
const evidenceOf = (t: TurnOut) => ((t.trace?.evidenceChosen ?? []) as string[]).map((id) => t.loop?.evidence?.[id]).filter(Boolean);

let H: AdvHarness;
let installLoopModel: (m: any) => void;
async function converse(account: string, turns: Turn[], messages: string[], between?: (i: number, convId: string) => Promise<void>, opts: { metered?: boolean } = {}): Promise<{ turns: TurnOut[]; model: AdvModel; error?: string }> {
  const model = new AdvModel(turns, opts); installLoopModel(model);
  const out: TurnOut[] = [];
  let conv: { id?: string; rev?: number } = {};
  try {
    for (const [i, m] of messages.entries()) {
      if (i && between) await between(i, conv.id!);
      const answer = await H.send(account, m, conv);
      conv = { id: answer.conversationId, rev: answer.conversationRevision };
      const saved = await H.saved(account, conv.id!);
      out.push({ saved, a: saved.answer, v: visible(saved.answer), loop: saved.state?.ragLoop, trace: saved.state?.ragLoop?.turns?.at(-1) });
    }
  } catch (e) { installLoopModel(null); return { turns: out, model, error: e instanceof Error ? e.message : String(e) }; }
  installLoopModel(null);
  return { turns: out, model };
}
const run = (s: SC.Scenario, between?: (i: number, convId: string) => Promise<void>) => converse(acct(s.account), s.turns, s.messages, between);
function need(r: { turns: TurnOut[]; error?: string }, n: number) { if (r.error) throw new Error("the chat route failed: " + r.error); if (r.turns.length < n) throw new Error(`only ${r.turns.length} of ${n} turns completed`); }

async function main() {
  ({ installLoopModel } = await import("@/lib/rag2/loop/model"));
  const tools = await import("@/lib/rag2/tools");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  H = await startAdvHarness();
  const KS = doc("KIDSAFE").id, KS1 = doc("KIDSAFE_V1").id, FF = doc("FAMILYFIRST").id;
  const toolEnv = { ...process.env, DEARPOLICY_RAG_TOOLS: "1" } as NodeJS.ProcessEnv;
  const ctxT = () => tools.createToolContext({ accountId: ACCOUNT_T, speakerId: T.marcus.id });

  // ============================ 1. factual answer from the right column ============================
  { const r = await run(SC.S1);
    await check("S1 factual: Ethan's fracture benefit S$600 from the Child column, cited and bound to Ethan", () => {
      need(r, 1); const t = r.turns[0];
      assert.match(t.v, /S\$600 per fracture/, "S$600 per fracture shown" + ctxOf(t));
      assert.doesNotMatch(t.v, /1,000/, "the Adult figure never shown");
      assert.equal(t.a.questions?.length ?? 0, 0);
      assert.deepEqual(t.trace.gate, [], "the save-time gate accepted it" + ctxOf(t));
      const b = (t.a.figureBindings ?? []).find((x) => x.value === 600);
      assert.ok(b, "a figure binding for 600"); assert.equal(b!.subjectId, T.ethan.id); assert.equal(b!.column, "Child"); assert.equal(b!.policyId, KS); assert.equal(b!.pageStart, 1);
      assert.ok(t.a.citations.some((c) => c.policyId === KS && c.pageStart === 1), "cites KidSafe p1");
    }); }
  { const r = await run(SC.S1b);
    await check("S1b factual paraphrase (household N): Daniel's daily hospital cash S$120 from Insured Child, never S$200", () => {
      need(r, 1); const t = r.turns[0];
      assert.match(t.v, /S\$120 per day/, ctxOf(t)); assert.doesNotMatch(t.v, /S\$200/);
      const b = (t.a.figureBindings ?? []).find((x) => x.value === 120);
      assert.ok(b && b.subjectId === N.daniel.id && b.column === "Insured Child" && b.policyId === FF, "bound to Daniel / Insured Child / FamilyFirst" + ctxOf(t));
    }); }
  { const r = await run(SC.S1c);
    await check("S1c adversarial: the Adult S$1,000 stated for Ethan by citing the table passage never reaches the household", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /1,000/, "S$1,000 (Adult column) shown for Ethan" + ctxOf(t));
    }); }

  // ============================ 2. broken arm ============================
  { const r = await run(SC.S2);
    await check("S2.1 broken arm: 'accident' is NOT recorded from 'broke his arm' alone", () => {
      need(r, 1); const t = r.turns[0];
      assert.notEqual(t.loop?.claim?.facts?.cause?.value, "accident", "cause=accident was recorded from the words 'broke his arm'" + ctxOf(t));
    });
    await check("S2.2 broken arm: the reply asks how it happened (accident vs illness changes the benefit), one question, no figure", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(t.a.questions?.length, 1, "exactly one question" + ctxOf(t));
      assert.match(t.a.questions[0].text, /accident|illness|how/i);
      assert.doesNotMatch(t.v, MONEY);
      assert.ok(["cause", "how_it_happened", "circumstances", "how_injured", "mechanism"].includes(t.loop?.pending?.factKey), "pending is the how-it-happened question");
      assert.match(String(t.loop?.pending?.why ?? ""), /Accident|Sickness/, "the why quotes the accident-only wording");
    });
    await check("S2.3 broken arm: after the cause is given, the user-reported fracture is never presented as medically confirmed/approved", () => {
      need(r, 2); const t = r.turns[1];
      assert.match(t.v, /S\$600 per fracture/, ctxOf(t));
      assert.doesNotMatch(t.v, /medically confirmed|is approved|approved\b/i, "a household report presented as reviewed medical evidence" + ctxOf(t));
      assert.equal((t.loop?.claim?.facts?.how_it_happened ?? t.loop?.claim?.facts?.cause)?.words, "He fell off the monkey bars at school");
    }); }

  // ============================ 3. hospital stay day-count rule ============================
  { const r = await run(SC.S3);
    await check("S3.1 hospital (24-hour rule): admission date/time asked first, one question, citing the 24-hour wording", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(t.a.questions?.length, 1, ctxOf(t)); assert.match(t.a.questions[0].text, /admitted/i); assert.doesNotMatch(t.v, MONEY);
      assert.match(String(t.loop?.pending?.why ?? ""), /24 hours/, "why = the complete-24-hours passage");
    });
    await check("S3.2 hospital: nights are never used as payable days (no S$270 = 3 nights x S$90)", () => {
      need(r, 3); const t = r.turns[2];
      assert.doesNotMatch(t.v, /S\$270/, "3 nights x S$90 shown as an estimate" + ctxOf(t));
      assert.doesNotMatch(t.v, /payout/i);
    });
    await check("S3.3 hospital (positive, interface-dependent): the policy's own rule gives 2 complete 24-hour periods -> indicative estimate S$180", () => {
      need(r, 3); const t = r.turns[2];
      assert.match(t.v, /Indicative estimate[^.]*S\$180\b/, "S$180 indicative estimate" + ctxOf(t));
      assert.deepEqual(t.trace.gate, []);
      assert.ok(recordFor(t.a, 180), "a verified calculation record for 180");
    }); }

  // ============================ 4. side question about the speaker ============================
  { const r = await run(SC.S4);
    await check("S4.1 side question: 'my deductible' answered for Marcus (S$2,500, bound to Marcus)", () => {
      need(r, 2); const t = r.turns[1];
      assert.match(t.v, /S\$2,500 per policy year/, ctxOf(t));
      assert.ok((t.a.figureBindings ?? []).some((b) => b.value === 2500 && b.subjectId === T.marcus.id));
    });
    await check("S4.2 side question: Ethan's pending bill question is preserved and re-asked", () => {
      need(r, 2); const t = r.turns[1];
      assert.equal(t.a.questions?.length, 1, ctxOf(t)); assert.match(t.a.questions[0].text, /bill/i);
      assert.equal(t.loop?.pending?.factKey, "bill_amount"); assert.equal(t.loop?.pending?.subjectId, T.ethan.id);
    });
    await check("S4.3 side question: Ethan's recorded claim facts survive a fact noted about the speaker", () => {
      need(r, 2); const t = r.turns[1];
      assert.equal(t.loop?.claim?.subjectId, T.ethan.id, "the claim's subject changed to the speaker" + ctxOf(t));
      assert.equal(t.loop?.claim?.facts?.injury?.value, "broken arm", "Ethan's facts were wiped");
    }); }
  { const r = await run(SC.S4b);
    await check("S4b.1 shared login: 'my deductible' -> one short clarification between the two adults, no figure", () => {
      need(r, 2); const t = r.turns[1];
      assert.equal(t.a.questions?.length, 1, ctxOf(t)); assert.doesNotMatch(t.v, MONEY);
      assert.deepEqual((t.a.personCandidates ?? []).map((p) => p.id).sort(), [N.arjun.id, N.sofia.id].sort());
    });
    await check("S4b.2 shared login: after 'Sofia', S$1,750 (never Arjun's S$3,000) and Rohan's admission-time question re-asked", () => {
      need(r, 3); const t = r.turns[2];
      assert.match(t.v, /S\$1,750/, ctxOf(t)); assert.doesNotMatch(t.v, /3,000/);
      assert.ok((t.a.questions ?? []).some((q) => /admitted/i.test(q.text)), "the child's pending question was lost" + ctxOf(t));
      assert.equal(t.loop?.pending?.factKey, "admitted_time");
    }); }

  // ============================ 5. stepchild ============================
  { const r = await run(SC.S5);
    await check("S5.1 stepchild: 'my son' asks who, listing Rohan AND the stepsons Daniel and Lucas as candidates", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(t.a.questions?.length, 1, "a person question" + ctxOf(t));
      assert.deepEqual((t.a.personCandidates ?? []).map((p) => p.id).sort(), [N.rohan.id, N.daniel.id, N.lucas.id].sort());
    });
    await check("S5.2 stepchild: stepsons are labelled as stepsons in the candidates or the question", () => {
      need(r, 1); const t = r.turns[0];
      const labels = (t.a.personCandidates ?? []).map((p) => p.label).join(" | ") + " " + (t.a.questions?.[0]?.text ?? "") + " " + (t.a.questions?.[0]?.options ?? []).join(" | ");
      assert.match(labels, /step/i, "no stepson label: " + labels);
    });
    await check("S5.3 stepchild: no cover/eligibility statement before the person is resolved", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /insured|covered|FamilyFirst/i, ctxOf(t));
    });
    await check("S5.4 stepchild: once 'Lucas' is chosen, eligibility is stated from the wording (not named -> not covered), no figure", () => {
      need(r, 2); const t = r.turns[1];
      assert.match(t.v, /not covered|not named/i, ctxOf(t)); assert.doesNotMatch(t.v, MONEY);
      assert.ok(evidenceOf(t).some((e: any) => e.policyId === FF && e.passage.onPage === 2));
      assert.equal(t.loop.subjectId, N.lucas.id);
    }); }

  // ============================ 7. deductible / cap calculation survives the verifier ============================
  { const r = await run(SC.S7);
    await check("S7 min(bill, per-accident limit) - excess = S$1,100: shown as an indicative estimate with a ComputationRecord the gate accepts", () => {
      need(r, 1); const t = r.turns[0];
      assert.match(t.v, /Indicative estimate[^.]*S\$1,100/, "the S$1,100 estimate was dropped" + ctxOf(t));
      assert.deepEqual(t.trace.gate, [], "gate problems");
      assert.ok(recordFor(t.a, 1100), "a verified calculation record for 1,100");
      assert.ok(t.a.disclaimer && /not a payout/i.test(t.a.disclaimer));
      assert.doesNotMatch(t.v, /payout/i);
    }); }

  { const r = await run(SC.S7b);
    await check("S7b min(S$1,000 bill, S$1,200 limit) - S$100 excess = S$900 (order-independent): indicative estimate with a verified record", () => {
      need(r, 1); const t = r.turns[0];
      assert.match(t.v, /Indicative estimate[^.]*S\$900\b/, "the S$900 estimate was dropped" + ctxOf(t));
      assert.deepEqual(t.trace.gate, [], "gate problems");
      assert.ok(recordFor(t.a, 900), "a verified calculation record for 900");
      assert.ok(t.a.disclaimer && /not a payout/i.test(t.a.disclaimer));
      assert.doesNotMatch(t.v, /payout/i);
    }); }

  // ============================ 6. corrections invalidate dependent estimates ============================
  { const r = await run(SC.S6a);
    await check("S6a corrected person: switching the claim from Ethan to Chloe says the earlier estimate no longer applies and never repeats it", () => {
      need(r, 2); const t = r.turns[1];
      assert.doesNotMatch(t.v, /S\$900\b/, ctxOf(t));
      assert.match(t.v, /no longer applies|withdrawn|Updated/i, "the correction is silent: nothing tells the household the earlier figure is void" + ctxOf(t));
      assert.equal(t.loop?.claim?.subjectId, T.chloe.id);
      assert.equal((t.loop?.claim?.derived ?? []).filter((d: any) => /S\$900\b/.test(d.sentence)).length, 0);
    });
    await check("S6a' corrected person: the withdrawn estimate is not fed back to the model as conversation history", () => {
      need(r, 2);
      const lastReq = r.model.requests.at(-1)!;
      const hist = lastReq.messages.filter((m) => m.role === "assistant" && typeof m.content === "string").map((m) => (m as any).content).join(" ");
      if (!/S\$900\b/.test(r.turns[0].v)) throw new Error("precondition: turn 1 showed no S$900 estimate (see S7b)");
      assert.doesNotMatch(hist + " " + (lastReq.messages[0] as any).content, /S\$900\b/, "the model still sees the withdrawn S$900 in history");
    }); }
  { const r = await run(SC.S6b);
    await check("S6b.1 corrected discharge date: the hospital-cash estimate is withdrawn and recomputed (S$480), old S$240 / nights-based S$600 never shown", () => {
      need(r, 2); const t = r.turns[1];
      assert.doesNotMatch(t.v, /S\$240\b/, ctxOf(t)); assert.doesNotMatch(t.v, /S\$600\b/);
      assert.match(t.v, /no longer applies|Updated/i, ctxOf(t));
      assert.equal(t.loop?.claim?.facts?.discharged_at?.value, "8 October 11am");
      assert.equal(t.loop?.claim?.facts?.discharged_at?.previous?.[0]?.value, "6 October 10.15am");
    });
    await check("S6b.2 (positive, interface-dependent) first-full-day rule: S$240 before the correction, S$480 after", () => {
      need(r, 2);
      assert.match(r.turns[0].v, /Indicative estimate[^.]*S\$240\b/, "turn 1" + ctxOf(r.turns[0]));
      assert.match(r.turns[1].v, /Indicative estimate[^.]*S\$480\b/, "turn 2" + ctxOf(r.turns[1]));
      // Integration (r6): earlier use of the 90-day yearly limit is not known, so each estimate states its assumption
      // (the figures are unchanged).
      assert.match(r.turns[0].v, /S\$240, assuming at least 2 of the 90 [^.]*still available this (?:policy )?year\./, "turn 1 assumption" + ctxOf(r.turns[0]));
      assert.match(r.turns[1].v, /S\$480, assuming at least 4 of the 90 [^.]*still available this (?:policy )?year\./, "turn 2 assumption" + ctxOf(r.turns[1]));
    }); }

  // ============================ 8. missing conditions -> partial answer ============================
  { const r = await run(SC.S8);
    await check("S8 missing conditions: cited S$120/day + the specific missing admission/discharge information, no made-up estimate", () => {
      need(r, 1); const t = r.turns[0];
      assert.match(t.v, /S\$120 per day/, ctxOf(t)); assert.match(t.v, /admission/i);
      assert.doesNotMatch(t.v, /S\$360|Indicative estimate/i, "a made-up estimate was shown");
      assert.ok((t.a.figureBindings ?? []).some((b) => b.value === 120 && b.column === "Insured Child"));
      assert.ok(t.trace.dropped.some((d: any) => /3/.test(d.sentence) && /household|fact|nights|days|admission|dates/i.test(d.reason)), "dropped with a specific reason");
    }); }
  { const r = await run(SC.S8b);
    await check("S8b a dropped estimate is replaced by a specific unresolved requirement, not a silent/generic gap", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /S\$360/, "nights x daily rate shown although the wording counts from the first full day" + ctxOf(t));
      assert.match(t.v, /admi|discharg|payable days|first full day/i, "the reply does not say what is still needed" + ctxOf(t));
    }); }

  // ============================ 9. other household inaccessible ============================
  await check("T9 tools: household T cannot read, search, select or resolve household N's documents and people", async () => {
    const c = ctxT();
    const rp = await tools.runTool(c, "read_page", { policy_id: FF, page: 1 }, toolEnv); assert.equal(rp.ok, false);
    const st = await tools.runTool(c, "select_table_value", { policy_id: FF, benefit: "Daily hospital cash", subject_id: N.rohan.id }, toolEnv);
    assert.ok(!st.ok || (st.data as any).status !== "ok", "select_table_value returned household N's value");
    assert.equal(c.values.size, 0, "a value id was issued for another household's table");
    const se = await tools.runTool(c, "search_passages", { query: "daily hospital cash insured child", policy_ids: [FF] }, toolEnv); assert.equal(((se as any).data?.hits ?? []).length, 0);
    const se2 = await tools.runTool(c, "search_passages", { query: "Veridian FamilyFirst daily hospital cash step-child" }, toolEnv);
    assert.ok(((se2 as any).data?.hits ?? []).every((h: any) => h.policyId !== FF));
    const rs = await tools.runTool(c, "resolve_person", { mention: "Rohan" }, toolEnv); assert.notEqual((rs as any).data?.status, "ok");
    const pf = await tools.runTool(c, "policies_for", { subject_id: N.rohan.id }, toolEnv); assert.equal(((pf as any).data?.covering ?? []).length, 0);
  });
  { const nBefore = (await H.db.query("SELECT count(*)::int AS n FROM chat_messages WHERE account_id=$1", [ACCOUNT_N])).rows[0].n;
    const r = await run(SC.S9loop);
    await check("S9 loop: no figure, cover statement or fact about another household's member reaches the reply or the state", async () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /S\$120|FamilyFirst|Insured Child/, ctxOf(t));
      assert.equal(t.loop?.claim ?? null, null, "a claim fact was recorded for another household's member");
      assert.ok(!JSON.stringify(t.loop?.evidence ?? {}).includes(FF), "household N's evidence entered household T's state");
      assert.equal(t.a.personCandidates?.length ?? 0, 0);
      const nAfter = (await H.db.query("SELECT count(*)::int AS n FROM chat_messages WHERE account_id=$1", [ACCOUNT_N])).rows[0].n;
      assert.equal(nAfter, nBefore, "a message was written to household N");
    }); }
  await check("V9 verifier: a binding to household N's policy and member is rejected for household T", async () => {
    const sentence = "Rohan's FamilyFirst daily hospital cash is S$120 per day.";
    const answer: ChatAnswer = { mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [],
      figureBindings: [{ policyId: FF, subjectId: N.rohan.id, benefit: "Daily hospital cash (max 90 days per year)", documentHash: doc("FAMILYFIRST").hash, pageStart: 1, pageEnd: 1, passage: doc("FAMILYFIRST").pages[1].split("\n").find((l) => /Daily hospital cash/.test(l))!, column: "Insured Child", sentence, value: 120, currency: "SGD" }] } as ChatAnswer;
    const problems = await verifyAnswerFigures(answer, { accountId: ACCOUNT_T, userText: "What does Rohan get?", report: true });
    assert.ok(problems.length >= 1, "the gate accepted another household's figure");
  });

  // ============================ 10. deleted / superseded evidence ============================
  await check("T10 tools: the superseded KidSafe v1 supplies nothing (select, read, search)", async () => {
    const c = ctxT();
    const st = await tools.runTool(c, "select_table_value", { policy_id: KS1, benefit: "Hospital income", subject_id: T.ethan.id }, toolEnv);
    assert.ok(!st.ok || (st.data as any).status !== "ok");
    assert.equal((await tools.runTool(c, "read_page", { policy_id: KS1, page: 1 }, toolEnv)).ok, false);
    const se = await tools.runTool(c, "search_passages", { query: "hospital income each complete 24 hours child" }, toolEnv);
    assert.ok(((se as any).data?.hits ?? []).every((h: any) => h.policyId !== KS1)); assert.ok(((se as any).data?.hits ?? []).some((h: any) => h.policyId === KS));
  });
  for (const mode of ["soft_deleted", "superseded"] as const) {
    SC.S10_IDS.row = undefined;
    const r = await run(SC.S10, async (_i, convId) => {
      const prior = (await H.saved(ACCOUNT_T, convId)).state?.ragLoop;
      SC.S10_IDS.row = Object.values(prior?.evidence ?? {}).find((e: any) => /Hospital income/.test(e.table?.rowLabel ?? ""))?.["id" as never];
      if (mode === "soft_deleted") await H.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [KS]);
      else await H.db.query("UPDATE policies SET superseded_at=now() WHERE id=$1", [KS]);
    });
    await H.db.query("UPDATE policies SET lifecycle_state='active', superseded_at=NULL WHERE id=$1", [KS]);
    await check(`S10 ${mode}: evidence read before the document was ${mode === "soft_deleted" ? "deleted" : "superseded"} cannot support the next answer (figure or cover statement)`, () => {
      need(r, 2); const t0 = r.turns[0], t = r.turns[1];
      assert.match(t0.v, /S\$90/, "precondition (turn 1)" + ctxOf(t0));
      if (!SC.S10_IDS.row) throw new Error("precondition: could not find turn 1's evidence id");
      assert.doesNotMatch(t.v, /S\$90/, "a figure from a " + mode + " document was stated" + ctxOf(t));
      assert.doesNotMatch(t.v, /covered for fractures/i, "a cover statement resting on a " + mode + " document was stated" + ctxOf(t));
    });
  }

  // ============================ adversarial extras ============================
  { const r = await run(SC.X1);
    await check("X1 prompt injection in a document page: never 'pre-approved' / S$50,000 / 'you will receive'", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /pre-approved|50,000|will receive/i, ctxOf(t));
    }); }
  { const r = await run(SC.X2);
    await check("X2 forged evidence/value/result ids are refused or dropped; only the properly cited sentence survives", () => {
      need(r, 1); const t = r.turns[0];
      assert.ok(refusals(t).some((e: string) => /ask_user/.test(e)), "the forged ask_user was not refused" + ctxOf(t));
      assert.doesNotMatch(t.v, /1,200|1,100/, ctxOf(t)); assert.match(t.v, /KidSafe excess is S\$100 per accident/);
      assert.equal(t.trace.dropped.length, 3, "three forged sentences dropped" + ctxOf(t));
    }); }
  { const r = await run(SC.X3);
    await check("X3 an indicative estimate is never presented as reimbursed / received / claimable / owed", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /reimburse|gets? S\$|get back|can claim|owes? you/i, ctxOf(t));
    }); }
  { const r = await run(SC.X4);
    await check("X4 a sum of printed limits is never presented as a claimable total", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /1,800/, ctxOf(t));
    }); }
  await check("X5 tools: a household figure is refused as a POLICY operand (daily rate, cap, deductible)", async () => {
    const c = ctxT();
    const hh = (label: string, attribution: string, v: Record<string, unknown>) => ({ household: { label, attribution, ...v } });
    const rate = await tools.runTool(c, "compute", { operation: "per_day", operands: [hh("daily rate", "the ward said S$500 a day", { amount: 500, currency: "SGD" }), hh("days", "2 days", { count: 2 })] }, toolEnv);
    assert.equal(rate.ok, false, "per_day accepted a household daily rate: " + JSON.stringify((rate as any).data?.amount));
    const cap = await tools.runTool(c, "compute", { operation: "min_cap", operands: [hh("bill", "the bill was S$9,000", { amount: 9000, currency: "SGD" }), hh("limit", "I think the limit is S$8,000", { amount: 8000, currency: "SGD" })] }, toolEnv);
    assert.equal(cap.ok, false, "min_cap accepted a household cap");
    const ded = await tools.runTool(c, "compute", { operation: "deductible", operands: [hh("bill", "the bill was S$900", { amount: 900, currency: "SGD" }), hh("deductible", "my deductible is S$50", { amount: 50, currency: "SGD" })] }, toolEnv);
    assert.equal(ded.ok, false, "deductible accepted a household deductible");
  });
  await check("X5b tools: a household figure's attribution must be the household's own words (a model-invented quote is refused)", async () => {
    const c = ctxT();
    const v = await tools.runTool(c, "select_table_value", { policy_id: KS, benefit: "Hospital income", subject_id: T.ethan.id }, toolEnv);
    assert.ok(v.ok && (v.data as any).status === "ok", "precondition");
    const r = await tools.runTool(c, "compute", { operation: "per_day", operands: [{ value_id: (v.data as any).valueId }, { household: { label: "days", attribution: "", count: 4 } }] }, toolEnv);
    assert.equal(r.ok, false);
  });
  { const r = await run(SC.X6);
    await check("X6 two questions in one ask_user (one '?') are refused; exactly one simple question reaches the household", () => {
      need(r, 1); const t = r.turns[0];
      const asks = refusals(t).filter((e: string) => /^ask_user/.test(e));
      assert.equal(asks.length, 2, "both compound questions refused" + ctxOf(t));
      assert.equal(t.a.questions?.length, 1); assert.match(t.a.questions[0].text, /^On what date and at what time was Ethan admitted\?$/);
    }); }
  { const r = await run(SC.X7);
    await check("X7 a recorded fact is not re-asked under another key; a question its cited evidence does not make relevant is refused", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(t.a.questions?.length, 1, ctxOf(t)); assert.match(t.a.questions[0].text, /discharged/, "a re-asked or irrelevant question reached the household" + ctxOf(t));
    }); }
  // A fact must come from the household's own words in THIS conversation.
  { const r = await converse(ACCOUNT_T, [{ steps: [
      () => [call("note_facts", { subject_id: T.ethan.id, facts: [{ key: "bill_amount", value: "4000", currency: "SGD", words: "the bill was S$4,000" }] })],
      () => [call("final_answer", { subject_id: T.ethan.id, sentences: [{ text: "Thanks, I have noted that." }] })],
    ] }], ["Ethan hurt his knee."]);
    await check("X8 note_facts refuses 'words' the household never said (fabricated quote)", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(t.loop?.claim?.facts?.bill_amount, undefined, "a fabricated S$4,000 bill was recorded as the household's fact" + ctxOf(t));
    }); }

  { const r = await run(SC.X9);
    await check("X9 an estimate's household count must be the recorded fact it claims to be (not any fact with the same number)", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /S\$360/, ctxOf(t));
    }); }
  { const r = await run(SC.X10);
    await check("X10 next_steps cannot carry an unevidenced cover promise", () => {
      need(r, 1); const t = r.turns[0];
      assert.doesNotMatch(t.v, /fully covered|expect the money/i, ctxOf(t));
    }); }

  // ============================ usage limits ============================
  { await H.db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cost_usd,priced,ok) VALUES($1,'chat','openai','gpt-test',1,1,999,true,true)", [ACCOUNT_N]).catch(async () => {
      await H.db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cost_usd) VALUES($1,'chat','openai','gpt-test',1,1,999)", [ACCOUNT_N]); });
    const r = await converse(ACCOUNT_N, [{ steps: [() => [call("final_answer", { sentences: [{ text: "Hello." }] })]] }], ["What does FamilyFirst cover for Rohan?"], undefined, { metered: true });
    await H.db.query("DELETE FROM model_usage WHERE account_id=$1 AND model='gpt-test'", [ACCOUNT_N]);
    await check("U1 household over its monthly spend limit: the loop does not call the model and says so honestly", () => {
      need(r, 1); const t = r.turns[0];
      assert.equal(r.model.started, 0, "the loop called the model for a household past its spend limit" + ctxOf(t));
      assert.match(t.v, /limit/i, ctxOf(t));
    }); }
  { const before = Number((await H.db.query("SELECT coalesce(sum(input_tokens),0)::int AS n FROM model_usage WHERE account_id=$1", [ACCOUNT_T])).rows[0].n);
    const beforeExec = Number((await H.db.query("SELECT count(*)::int AS n FROM model_executions").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
    // Metered (hosted-kind) scripted model; the per-turn US$ cap is lifted for this run so the TOKEN limit is the one
    // that stops the turn (DEARPOLICY_RAG_LOOP_MAX_TOKENS default 80k: 45k + 45k > 80k).
    const savedUsd = process.env.DEARPOLICY_RAG_LOOP_MAX_TURN_USD; process.env.DEARPOLICY_RAG_LOOP_MAX_TURN_USD = "4";
    const r = await converse(ACCOUNT_T, [{ usage: { input: 45_000, output: 1_000 }, steps: [] }], ["Tell me everything about every policy."], undefined, { metered: true });
    if (savedUsd == null) delete process.env.DEARPOLICY_RAG_LOOP_MAX_TURN_USD; else process.env.DEARPOLICY_RAG_LOOP_MAX_TURN_USD = savedUsd;
    await check("U2 per-turn token budget: the loop stops at the token limit (45k + 45k > 80k) with an honest, figure-free reply that names the limit", () => {
      need(r, 1); const t = r.turns[0];
      assert.ok(["budget_exhausted", "limit_reached"].includes(t.trace.outcome), "outcome " + t.trace.outcome + ctxOf(t)); assert.ok(t.trace.steps <= 2, "steps " + t.trace.steps);
      assert.ok(t.trace.usage.input >= 45_000, "the model was called at least once");
      assert.doesNotMatch(t.v, MONEY); assert.match(t.v, /limit|budget|too long|usage/i, "the reply does not say the turn hit a limit" + ctxOf(t));
    });
    await check("U3 usage accounting: the loop's model tokens are recorded against the household", async () => {
      need(r, 1);
      const after = Number((await H.db.query("SELECT coalesce(sum(input_tokens),0)::int AS n FROM model_usage WHERE account_id=$1", [ACCOUNT_T])).rows[0].n);
      const afterExec = Number((await H.db.query("SELECT count(*)::int AS n FROM model_executions").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
      const seen = Number(r.turns[0]?.trace?.usage?.input ?? 0);
      assert.ok(seen >= 45_000 && (after - before >= seen && afterExec - beforeExec >= 1), `no usage recorded for the loop's calls (model_usage +${after - before} input tokens, model_executions +${afterExec - beforeExec} rows)`);
    }); }

  await check("Z no network call was attempted in the whole suite", () => { assert.deepEqual(H.networkCalls, []); });
  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:adversarial-test ${results.length - failed.length}/${results.length} passed`);
  console.log("RESULTS " + JSON.stringify(results.map((r) => ({ name: r.name.split(" ")[0], ok: r.ok }))));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
