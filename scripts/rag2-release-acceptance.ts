/**
 * Release acceptance (node --import tsx scripts/rag2-release-acceptance.ts; npm run rag2:release-test).
 *
 * Complete visible conversations through the REAL chat route (app/api/chat/route.ts -> lib/chat/workflow.ts -> the
 * rag2 loop -> saveTurn's output guard and save-time gate), PGlite with the real schema, the hand-authored synthetic
 * household in scripts/fixtures/rag2-release, and the TEST-ONLY scripted model standing in for the hosted model. The
 * script plays a model's tool calls (ids come from the real tools); what is asserted is what the household SEES and
 * what the system did with the model's actions -- never the script's own text. Expected figures are read off the
 * fixture pages by hand.
 *
 * Every scenario's visible conversation is printed (RELEASE_TRANSCRIPT=1) so baseline and candidate can be compared.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-release/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 10).join("\n     ")); }
}
export const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pick = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error("script: " + name + " failed: " + JSON.stringify(o?.result).slice(0, 300)); return o.result.data; };
const hit = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(x.evidence?.excerpt ?? x.text ?? "")); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + text); };
/** Verifier wording and internal labels that must never reach the household. */
export const DIAGNOSTIC = /cited page|figure is not bound|one column per person|save-time|evidence id|\bvalue id\b|\b[evr]\d+\b|left out is for|POLICY NO\.|FIGURE|gate/;

async function main() {
  const h: Harness = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const transcripts: string[] = [];
  const run = async (label: string, script: ScriptTurn[], messages: string[]) => {
    const model = new ScriptedLoopModel(script); installLoopModel(model);
    let conv: { id?: string; rev?: number } = {};
    const turns: { user: string; answer: ChatAnswer; text: string; trace: any; loop: any }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const saved = await h.savedAnswer(conv.id!);
        turns.push({ user: m, answer: saved.answer, text: visible(saved.answer), loop: saved.state.ragLoop, trace: saved.state.ragLoop?.turns.at(-1) });
      }
    } finally { installLoopModel(null); }
    const t = [`### ${label}`, ...turns.flatMap((x) => [`USER: ${x.user}`, `APP:  ${x.text.replace(/\n/g, "\n      ")}`, `      (steps=${x.trace?.steps} gate=${JSON.stringify(x.trace?.gate ?? [])} tools=${(x.trace?.toolCalls ?? []).map((c: any) => c.name + (c.ok ? "" : "!")).join(",")})`, ...(process.env.RELEASE_TRANSCRIPT === "2" ? (x.trace?.dropped ?? []).map((d: any) => `      - dropped: ${d.sentence} -- ${d.reason}`) : []), ...(process.env.RELEASE_TRANSCRIPT === "2" ? (x.trace?.toolCalls ?? []).filter((c: any) => !c.ok).map((c: any) => `      ! ${c.name}: ${String(c.error ?? c.summary ?? "").slice(0, 600)}`) : [])])].join("\n");
    transcripts.push(t);
    if (process.env.RELEASE_TRANSCRIPT) console.log(t);
    return turns;
  };

  // ------------------------------------------------------------------------- A: the reproduced live failure
  // A household reports a death in a road accident. The model does what the live model did: resolves the person,
  // reads the certificate's roster row and the wording's death clause, and answers -- saying a date matters without
  // asking for it.
  const deathStatements = (v: ScriptView) => {
    const val = pick(v, "select_table_value");
    return [
      { text: "Alex's Certificate of Group Insurance lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [val.valueId], subject_id: M.alex.id },
      { text: "The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct result of an accident within 365 days of it.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.alex.id },
      { text: "It does not pay for death caused by competitive racing on wheels, except racing sanctioned by the Authority.", evidence_ids: [hit(v, /competitive racing/)], subject_id: M.alex.id },
    ];
  };
  const deathLookup = [
    () => [call("resolve_person", { mention: "Alex" })],
    (v: ScriptView) => [call("policies_for", { subject_id: pick(v, "resolve_person").person.id, topic: "accident death" })],
    (v: ScriptView) => [
      call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }),
      call("search_passages", { query: "death due to accident", subject_id: M.alex.id }),
      call("search_passages", { query: "exclusions racing", subject_id: M.alex.id }),
    ],
  ];
  const A1 = await run("A1 death in a road accident (model answers without asking)", [
    { steps: [...deathLookup,
      (v) => { if (process.env.RELEASE_TRANSCRIPT === "2") console.log("tool result sizes:", v.turn.map((o) => o.name + "=" + JSON.stringify(o.result).length).join(" ")); return [call("final_answer", { subject_id: M.alex.id, sentences: [...deathStatements(v), { text: "Whether this is payable depends on the dates of the accident and of death." }], next_steps: ["Contact Harbourline Life to confirm cover on the date of death and what they need for a claim."] })]; },
      // If the system sends the answer back (asking for the open fact), the model asks it, keeping what it said.
      (v) => [call("ask_user", { kind: "fact", subject_id: M.alex.id, fact_key: "accident_and_death_dates", question: "On what date did the accident happen?", because_evidence_ids: [hit(v, /Death due to Accident: if/)], statements: deathStatements(v) })],
    ] },
  ], ["alex died in a motorbike accident"]);
  await check("A1 the certificate's S$600,000 is shown as the certificate's dated amount, with the wording's condition, and nothing internal", () => {
    const t = A1[0];
    assert.match(t.text, /S\$600,000/, "the roster figure is kept");
    assert.match(t.text, /1 April 2024/, "dated as the certificate prints it");
    assert.match(t.text, /365 days/, "the wording's condition");
    assert.doesNotMatch(t.text, DIAGNOSTIC, "no verifier commentary");
    assert.deepEqual(t.trace.gate, [], "the gate accepts the person's own row");
  });
  await check("A2 the date that changes the answer is asked as a question (one), not left as a dead end", () => {
    const t = A1[0];
    assert.equal(t.answer.questions?.length, 1, "one question card: " + t.text);
    assert.match(t.answer.questions![0].text, /date/i);
  });

  console.log("\n" + transcripts.join("\n\n"));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nrelease acceptance ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
