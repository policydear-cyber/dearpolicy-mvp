/**
 * PR #54 (after rc-live-9): the two saved FL5 answers replayed through the final route with the model's RECORDED calls
 * and statements (scripted model, no model call), recorded fixture (BOOKLET_CDA=recorded):
 *   BOOKLET_CDA=recorded node --import tsx scripts/reliable-chat-rc-live-9-replay.ts      (SHOW=1 prints every answer)
 * Two narrow statement checks, each with positive and negative controls:
 *  1. a restriction restated with a limit its cited wording does not print ("but not both") is omitted whole -- the
 *     benefit's own server-written terms already say the restriction as printed; a printed qualifier is kept;
 *  2. "these documents do not establish that this funeral benefit applies to him" is said as separate source-backed
 *     terms: the person's DATED certificate listing (with its later-date limit), and that whether the documented
 *     benefit applies for this event is not established -- never "covered", never "not listed".
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { BOOKLET, call, cdaEv, cdaId, D, FL5A_U, FL5B_U, fl5aTurns, fl5bTurns, STEP, terms } from "./fixtures/reliable-chat/rc-live-9-recorded";
import { uniqueSteps } from "@/components/next-steps";
import { gradeFL5 } from "./rag2-live/reliable-chat-check";

if (B.CDA !== "recorded") { console.error("run with BOOKLET_CDA=recorded"); process.exit(2); }
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
/** One person's turn: their benefits, then the allowance's terms and one statement about whether it applies to them. */
function personTurn(subject: string, unc: string): ScriptTurn[] {
  return [{ user: /funeral/i, steps: [
    () => [call("person_benefits", { subject_id: subject, topic: "death after an accident; funeral expenses" })],
    (v: ScriptView) => [call("final_answer", { subject_id: subject, sentences: [{ ...terms(v, []), subject_id: subject, benefit_id: cdaIdFor(v) }, { kind: "uncertainty", text: unc, subject_id: subject, evidence_ids: [cdaEv(v)] }] })],
    (v: ScriptView) => [call("final_answer", { subject_id: subject, sentences: [{ ...terms(v, []), subject_id: subject, benefit_id: cdaIdFor(v) }] })],
  ] }];
}
const cdaIdFor = (v: ScriptView) => cdaId(v);
async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
  const run = async (label: string, u: string, t: ScriptTurn[]) => {
    installLoopModel(new ScriptedLoopModel(t));
    try {
      const a = await h.send(u, {});
      const s = await h.savedAnswer(a.conversationId!);
      const trace = s.state.ragLoop.turns.at(-1);
      const v = visibleOf(s.answer);
      if (process.env.SHOW) console.log(`--- ${label}\n${v}\n  dropped: ${JSON.stringify(trace.dropped ?? [])}\n  gate: ${JSON.stringify(trace.gate ?? [])}`);
      return { v, shown: visibleOf(a), answer: s.answer, state: s.state, trace, ev: s.state.ragLoop.evidence ?? {} };
    } finally { installLoopModel(null); }
  };
  const asConv = (x: { answer: any; state: any; trace: any }) => ({ turns: [{}], loaded: { turns: [{ answer: x.answer }], state: x.state }, saved: { traces: [x.trace] } } as any);
  const lines = (v: string) => v.split("\n");
  const CDA_LINE = /^The Group Insurance Benefits Booklet \(page 9, under “Section 5 - Compassionate Death Allowance Benefit”\) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 \(printed with a bare “\$” sign; the Group Insurance Benefits Booklet does not say which currency\), with the printed conditions .*“This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme\.”\.$/;

  // ---- FL5a as recorded
  const a = await run("FL5a replay", FL5A_U, fl5aTurns());
  check("FL5a: the recorded evidence ids are the same passages (e4 the allowance's section, e10 its paragraph)", /Section 5 - Compassionate Death Allowance Benefit/.test(a.ev.e4?.passage?.text ?? "") && /prescribed form/.test(a.ev.e10?.passage?.text ?? ""), JSON.stringify([a.ev.e4?.passage?.text, a.ev.e10?.passage?.text]));
  check("FL5a check 1: \"but not both\" (not printed) is omitted whole, with its reason", !/not both/.test(a.v) && (a.trace.dropped ?? []).some((d: any) => /adds “but not both”, which its cited wording does not print/.test(d.reason)), a.v + "\n" + JSON.stringify(a.trace.dropped));
  check("FL5a: the restriction is still said as printed, in the server-written terms", lines(a.v).some((l) => CDA_LINE.test(l)), a.v);
  check("FL5a: every other saved line is unchanged, next step included; returned = saved", a.v === [lines(a.v).find((l) => CDA_LINE.test(l)), "The booklet does not list the specific documents or forms required beyond proof of death and relevant documents in the prescribed form.", STEP].join("\n") && a.shown === a.v, a.v);
  { const g = gradeFL5("FL5a", asConv(a)); check("FL5a: grader v7 still passes", g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok))); }

  // ---- FL5b as recorded
  const b = await run("FL5b replay", FL5B_U, fl5bTurns());
  check("FL5b: the recorded evidence ids are the same passages (e1 Daniel's certificate row, e14 the booklet)", /Lee Wei Ming, Daniel/.test(b.ev.e1?.passage?.text ?? "") && b.ev.e14?.policyId === BOOKLET, JSON.stringify([b.ev.e1?.passage?.text, b.ev.e14?.policyId]));
  check("FL5b: as recorded, the first answer is sent back by the save-time check (the summary's S$2,000 sentence) and the second is saved", (b.trace.toolCalls ?? []).filter((x: any) => x.name === "final_answer").map((x: any) => x.ok).join() === "false,true" && !/S\$2,000/.test(b.v), JSON.stringify((b.trace.toolCalls ?? []).filter((x: any) => x.name === "final_answer").map((x: any) => [x.ok, x.error?.slice(0, 120)])));
  const listing = "Daniel's certificate lists Daniel under Group Personal Accident as of 01/04/2024; whether the Compassionate Death Allowance Benefit applies to Daniel for this event is not established by the documents.";
  check("FL5b check 2: the applicability sentence is said as separate terms -- the dated certificate listing, then that eligibility for this event is not established", lines(b.v).includes(listing), b.v);
  check("FL5b check 2: the dated listing carries its later-date limit", /does not by itself establish cover on a later date/.test(b.v), b.v);
  check("FL5b check 2: the accurate Core / Voluntary uncertainty is kept as said", lines(b.v).includes("The uploaded certificate does not show whether Daniel is enrolled in the Core or Voluntary Scheme."), b.v);
  check("FL5b check 2: no 'covered' / 'not listed' claim either way", !/\b(?:is|are) (?:currently )?(?:covered|insured|enrolled)\b|not (?:listed|named)/i.test(b.v.replace(/\bwhether\b[^.;]*/gi, "")), b.v);
  check("FL5b: the allowance, the paperwork sentence and the next step are unchanged; returned = saved", lines(b.v).some((l) => CDA_LINE.test(l)) && lines(b.v).includes("The booklet specifies proof of death and relevant documents in the insurer’s prescribed form, but does not list the particular documents required.") && b.v.includes(STEP) && b.shown === b.v, b.v);
  { const g = gradeFL5("FL5b", asConv(b)); check("FL5b: grader v7 still passes", g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok))); }

  // ---- controls, check 1
  const q1 = await run("qualifier: other unprinted limit", FL5A_U, fl5aTurns("The Compassionate Death Allowance Benefit can only be claimed once."));
  check("check 1 negative control: another unprinted limit (\"only once\") is omitted whole", !/only be claimed once/.test(q1.v) && (q1.trace.dropped ?? []).some((d: any) => /adds “only be claimed once”/.test(d.reason)), q1.v);
  const q2 = await run("qualifier: the restriction as printed", FL5A_U, fl5aTurns("The benefit can only be claimed either under the Core Scheme or the Voluntary Scheme."));
  check("check 1 positive control: the restriction restated as printed is kept", lines(q2.v).includes("The benefit can only be claimed either under the Core Scheme or the Voluntary Scheme."), q2.v);
  const p9 = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=9", [BOOKLET])).rows[0].text as string;
  try {
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [BOOKLET, p9.replace("either under the Core Scheme or the Voluntary Scheme.", "either under the Core Scheme or the Voluntary Scheme, but not both.")]);
    const q3 = await run("qualifier: printed by the wording", FL5A_U, fl5aTurns());
    check("check 1 positive control: when the wording itself prints \"but not both\", the sentence is kept", lines(q3.v).includes("The benefit can be claimed under either the Core Scheme or the Voluntary Scheme, but not both."), q3.v);
  } finally { await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [BOOKLET, p9]); }

  // ---- controls, check 2
  const n1 = await run("applicability: now", FL5B_U, fl5bTurns("These documents do not establish that this funeral benefit applies to him now."));
  check("check 2 control: a statement already limited to now is kept as said (a date-limited uncertainty)", lines(n1.v).includes("These documents do not establish that this funeral benefit applies to him now."), n1.v);
  const E = B.M.ethan.id;
  const n2 = await run("applicability: no certificate", "If Ethan died in an accident, would the booklet help with his funeral?", personTurn(E, "These documents do not establish that this funeral benefit applies to him."));
  check("check 2 control: for a person no certificate lists (Ethan), no listing is invented -- the statement stays as said", lines(n2.v).includes("These documents do not establish that this funeral benefit applies to him.") && !/certificate lists/.test(n2.v), n2.v);
  const G = B.M.grace.id;
  const n3 = await run("applicability: Grace", "If Grace died in an accident, would the booklet help with her funeral?", personTurn(G, "These documents do not establish that this funeral benefit applies to her."));
  check("check 2 control: for Grace, her own dated listing is used, never Daniel's", /Grace's certificate lists Grace under Group Personal Accident as of 01\/04\/2024/.test(n3.v) && !/certificate lists Daniel/.test(n3.v), n3.v);
  const n4 = await run("applicability: covered claim", FL5B_U, fl5bTurns("Daniel is covered by this funeral benefit."));
  check("check 2 control: an assertion of cover is not turned into a listing (left to the existing checks)", !/Daniel's certificate lists Daniel under Group Personal Accident as of 01\/04\/2024; whether/.test(n4.v), n4.v);

  console.log(`\nreliable-chat rc-live-9 replay (saved FL5 moves, statement checks): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
