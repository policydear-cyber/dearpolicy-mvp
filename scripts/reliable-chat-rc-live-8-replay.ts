/**
 * PR #54 (after rc-live-8): rc-live-8's recorded model moves replayed through the real chat route (scripted model, no
 * model call) over the booklet household with the recorded passage (BOOKLET_CDA=recorded), checking the COMPLETE
 * answer -- summary, details, questions and every next step -- as saved and as the conversation reopens:
 *   BOOKLET_CDA=recorded node --import tsx scripts/reliable-chat-rc-live-8-replay.ts      (SHOW=1 prints every answer)
 *  A. exact replay: the model's own calls and statements (its benefit_terms for the summary's record, its two
 *     uncertainty sentences, its next step). The summary row is now offered by its full name, so its terms survive the
 *     save-time gate (rc-live-8: "prints : S$2,000", gated).
 *  B. the same moves, the model selecting the booklet's own allowance (now offered): name, its own conditions, and an
 *     honest currency status survive retrieval -> statement validation -> saving -> reopening; graded by v6 (FL4b).
 *  C. the model writes the allowance in its own words and gets it wrong (S$ for the bare $, plus an unprinted
 *     condition): that statement is omitted whole and the record's validated terms are kept by the same renderer.
 *  D. controls: a failing statement naming no offered benefit retains nothing; another person's record is never used.
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import { hitOf, idsOf, offeredId, rc8Booklet, rc8Turns, RC8_STEP, RC8_U, RC8_UNC1, RC8_UNC2 } from "./fixtures/reliable-chat/booklet-conversations";
import type { ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { gradeFL4b, gradeFL5 } from "./rag2-live/reliable-chat-check";

if (B.CDA !== "recorded") { console.error("run with BOOKLET_CDA=recorded"); process.exit(2); }
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const D = B.M.daniel.id;
const UNC1 = RC8_UNC1, UNC2 = RC8_UNC2, STEP = RC8_STEP, rc8 = rc8Turns;
async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
  const run = async (label: string, t: ScriptTurn[]) => {
    installLoopModel(new ScriptedLoopModel(t));
    try {
      const a = await h.send(RC8_U, {});
      const s = await h.savedAnswer(a.conversationId!);
      const trace = s.state.ragLoop.turns.at(-1);
      const shown = visibleOf(a); // what the route returned to the household
      const saved = visibleOf(s.answer);       // what reopening the conversation shows
      if (process.env.SHOW) console.log(`--- ${label}\n${saved}\n  dropped: ${JSON.stringify(trace.dropped ?? [])}\n  gate: ${JSON.stringify(trace.gate ?? [])}\n  adjusted: ${JSON.stringify(trace.adjusted ?? [])}`);
      return { v: saved, shown, answer: s.answer, state: s.state, trace };
    } finally { installLoopModel(null); }
  };
  const asConv = (x: { answer: any; state: any; trace: any }) => ({ turns: [{}], loaded: { turns: [{ answer: x.answer }], state: x.state }, saved: { traces: [x.trace] } } as any);
  const booklet = B.doc("BOOKLET").id, summary = B.doc("SUMMARY").id;
  const SUM = /^Compassionate Death Allowance Benefit$/;

  // ---- A. exact replay
  const a = await run("A exact replay", rc8((v) => [
    { kind: "benefit_terms", text: "The Insurance Benefits Summary (page 12) prints : S$2,000.", benefit: "", value_ids: [], benefit_id: offeredId(v, SUM, summary), subject_id: D, evidence_ids: [hitOf(v, /prescribed form/)] },
    { kind: "uncertainty", text: UNC1, subject_id: D, evidence_ids: [hitOf(v, /prescribed form/)] },
    { kind: "uncertainty", text: UNC2, subject_id: D, evidence_ids: [hitOf(v, /prescribed form/), ...idsOf(v, "policies_for")] }]));
  check("A: the summary's terms are shown under the benefit's full name, with its footnote condition", /Insurance Benefits Summary \(page 12\) prints the Compassionate Death Allowance Benefit, up to S\$2,000/.test(a.v) && /Core Scheme or Voluntary Scheme/.test(a.v), a.v);
  check("A: no figure without its benefit (no \"prints : \"), nothing gated, no \"couldn't confirm\" line", !/prints\s*:/.test(a.v) && !(a.trace.gate ?? []).length && !/couldn['’]t confirm|haven['’]t stated the amount/i.test(a.v), a.v + "\n" + JSON.stringify(a.trace.gate));
  check("A: the next step is shown (saved and reopened)", a.v.includes(STEP), a.v);
  check("A: what the route returned equals what reopening shows (summary, details, questions, next steps)", a.shown === a.v, `${a.shown}\n---\n${a.v}`);

  // ---- B. the model selects the booklet's allowance
  const b = await run("B booklet allowance", rc8Booklet());
  const bl = b.v.split("\n");
  const bk = bl.find((l) => /Group Insurance Benefits Booklet/.test(l) && /Compassionate Death Allowance Benefit/.test(l)) ?? "";
  check("B: the booklet's allowance is shown by name, under its section, with its own conditions (accident, funeral expenses, proof of death, prescribed form, Core / Voluntary)", /Section 5 - Compassionate Death Allowance Benefit/.test(bk) && /dies as a result of an Accident/.test(bk) && /funeral expenses/.test(bk) && /proof of death/.test(bk) && /prescribed form/.test(bk) && /Core Scheme or the Voluntary Scheme/.test(bk), b.v);
  check("B: its amount is 2,000 with the currency honestly unstated, never S$", /up to 2,000 \(printed with a bare “\$” sign; the Group Insurance Benefits Booklet does not say which currency\)/.test(bk) && !/S\$/.test(bk), bk);
  check("B: Repatriation's terms are not in the allowance's line", !/5,000|overseas|body home/.test(bk), bk);
  check("B: the summary's S$2,000 is a separate line attributed to the summary only", bl.filter((l) => /S\$2,000/.test(l)).every((l) => /Insurance Benefits Summary/.test(l) && !/Booklet/.test(l)), b.v);
  check("B: nothing gated or dropped from the rendered terms; the next step is shown", !(b.trace.gate ?? []).length && !(b.trace.dropped ?? []).some((x: any) => /prints the Compassionate Death Allowance Benefit/.test(x.sentence)) && b.v.includes(STEP), JSON.stringify([b.trace.gate, b.trace.dropped]));
  check("B: no promise of payment (the quoted wording is marked as not a claim decision)", bl.every((l) => !/\bwill pay\b/.test(l) || /not a decision about any claim/.test(l)), b.v);
  check("B: the citations include the booklet's paying paragraph and the summary's footnote", (b.answer.citations ?? []).some((c: any) => c.policyId === booklet && /funeral expenses/.test(c.excerpt ?? "")) && (b.answer.citations ?? []).some((c: any) => c.policyId === summary && /^\*This Benefit/m.test(c.excerpt ?? "")), JSON.stringify((b.answer.citations ?? []).map((c: any) => [c.policyName, c.excerpt])));
  check("B: what the route returned equals what reopening shows", b.shown === b.v, `${b.shown}\n---\n${b.v}`);
  const gb = gradeFL4b("FL4b", asConv(b));
  check("B: the pre-registered v6 grader (FL4b) passes the complete answer", gb.verdict === "PASS", JSON.stringify(gb.checks.filter((c: any) => !c.ok)));

  // grader v7 (FL5a / FL5b, pre-registered for rc-live-9) and its controls, on this complete answer
  { const g = gradeFL5("FL5a", asConv(b)); check("v7 (FL5): the complete replayed answer passes, next step included", g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok))); }
  { const g = gradeFL5("FL5a", asConv({ ...b, answer: { ...b.answer, nextSteps: [] } })); check("v7 control: no next step fails N1", g.verdict === "FAIL" && g.checks.some((c: any) => c.id === "N1" && !c.ok), JSON.stringify(g.checks.filter((c: any) => !c.ok).map((c: any) => c.id))); }
  { const g = gradeFL5("FL5a", asConv({ ...b, answer: { ...b.answer, nextSteps: ["Contact Lumen General Insurance about the claim."] } })); check("v7 control: a next step naming another insurer fails N1", g.checks.some((c: any) => c.id === "N1" && !c.ok), JSON.stringify(g.checks.filter((c: any) => !c.ok).map((c: any) => c.id))); }
  { const g = gradeFL5("FL5a", asConv({ ...b, answer: { ...b.answer, summary: String(b.answer.summary).replace(/up to 2,000 \(printed with a bare “\$” sign; the Group Insurance Benefits Booklet does not say which currency\)/, "up to S$2,000") } })); check("v7 control: the booklet's amount as S$2,000 fails A2C", g.checks.some((c: any) => c.id === "A2C" && !c.ok), JSON.stringify(g.checks.filter((c: any) => !c.ok).map((c: any) => c.id))); }
  { const g = gradeFL5("FL5b", asConv(a)); check("v7 control: rc-live-8's own moves (summary only, no booklet allowance) still fail A2K", g.verdict === "FAIL" && g.checks.some((c: any) => c.id === "A2K" && !c.ok), JSON.stringify(g.checks.filter((c: any) => !c.ok).map((c: any) => c.id))); }

  // ---- C. the model's own (wrong) wording for the allowance: omitted whole, its record's terms kept
  const WRONG = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays funeral expenses up to S$2,000 if Daniel dies within 365 days of an Accident, on receipt of the original receipts.";
  const c = await run("C failed statement", rc8((v) => [
    { kind: "fact", text: WRONG, benefit: "Compassionate Death Allowance Benefit", subject_id: D, evidence_ids: [hitOf(v, /prescribed form/)] },
    { kind: "uncertainty", text: UNC1, subject_id: D, evidence_ids: [hitOf(v, /prescribed form/), ...idsOf(v, "policies_for")] }]));
  check("C: the failed statement is not shown (no S$ for the booklet, no 365 days, no original receipts)", !/365|original receipts/.test(c.v) && !c.v.split("\n").some((l) => /Booklet/.test(l) && /S\$/.test(l)), c.v);
  check("C: the allowance's validated terms are kept through the same renderer (name, conditions, honest currency)", /Group Insurance Benefits Booklet \(page 9, under “Section 5 - Compassionate Death Allowance Benefit”\) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 \(printed with a bare “\$” sign/.test(c.v) && /prescribed form/.test(c.v) && /Core Scheme/.test(c.v), c.v);
  check("C: the retention is recorded in the trace", (c.trace.adjusted ?? []).some((x: string) => /kept the validated terms of Compassionate Death Allowance Benefit/.test(x)), JSON.stringify(c.trace.adjusted));
  check("C: nothing gated; the next step is shown; returned equals reopened", !(c.trace.gate ?? []).length && c.v.includes(STEP) && c.shown === c.v, JSON.stringify(c.trace.gate) + "\n" + c.v);
  const gc = gradeFL4b("FL4b", asConv(c));
  check("C: the v6 grader passes on the retained terms (allowance, conditions, honest currency)", gc.checks.filter((x: any) => ["A2K", "A2S", "A2C", "A2X"].includes(x.id)).every((x: any) => x.ok), JSON.stringify(gc.checks.filter((x: any) => !x.ok)));

  // ---- D. controls
  const d1 = await run("D unrelated failure", rc8((v) => [
    { kind: "fact", text: "Daniel's employer will pay S$9,999 towards the funeral within 7 days.", subject_id: D, evidence_ids: [hitOf(v, /prescribed form/)] },
    { kind: "uncertainty", text: UNC1, subject_id: D, evidence_ids: [hitOf(v, /prescribed form/), ...idsOf(v, "policies_for")] }]));
  check("D: the next step is shown", d1.v.includes(STEP), d1.v);
  check("D: a failing statement naming no offered benefit retains nothing (no benefit terms appear from nowhere)", !/prints the Compassionate Death Allowance Benefit/.test(d1.v) && !(d1.trace.adjusted ?? []).some((x: string) => /kept the validated terms/.test(x)) && !/9,999/.test(d1.v), d1.v);
  const G = B.M.grace.id;
  let graceId = "none";
  await run("D Grace's own turn", rc8((v) => { graceId = offeredId(v, SUM, booklet); return [{ kind: "uncertainty", text: UNC1, subject_id: G, evidence_ids: [hitOf(v, /prescribed form/)] }]; }, G));
  const d2 = await run("D Grace's record in Daniel's answer", rc8(() => [{ kind: "benefit_terms", benefit_id: graceId, subject_id: D, evidence_ids: [] }, { kind: "uncertainty", text: UNC1, subject_id: D, evidence_ids: [] }]));
  check("D: a benefit_id resolved for Grace is refused in Daniel's turn (never rendered as his)", graceId !== "none" && !/prints the Compassionate Death Allowance Benefit/.test(d2.v) && (d2.trace.toolCalls ?? []).some((x: any) => x.name === "final_answer" && !x.ok && /benefit_id that person_benefits returned this turn/.test(x.error ?? "")), d2.v + "\n" + JSON.stringify((d2.trace.toolCalls ?? []).filter((x: any) => x.name === "final_answer").map((x: any) => x.error)));

  console.log(`\nreliable-chat rc-live-8 replay (complete answer, saved and reopened): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
