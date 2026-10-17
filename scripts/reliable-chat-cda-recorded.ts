/**
 * PR #54 (after rc-live-6): the Compassionate Death Allowance over a booklet page faithful to the RECORDED actual-library
 * passage (scripts/fixtures/reliable-chat/booklet.ts, BOOKLET_CDA=recorded): accidental death, proof of death and the
 * relevant documents in the insurer's prescribed form, funeral expenses up to a bare $2,000, and the Core / Voluntary
 * Scheme restriction -- plus a SEPARATE benefit summary printing "Up to S$2,000" that no policy number links to the
 * booklet. Replayed through the real chat route with scripted moves; no model call.
 *   BOOKLET_CDA=recorded node --import tsx scripts/reliable-chat-cda-recorded.ts      (SHOW=1 prints every answer)
 * Checks: the benefit and its supported conditions are kept; none of the synthetic fixture's additions (365 days,
 * original receipts, illness exclusion) is ever shown; the bare $ is never SGD from the booklet; the summary's S$2,000
 * is only ever attributed to the summary; the certificate's dated listing is kept without claiming current cover.
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import { D, hitOf } from "./fixtures/reliable-chat/booklet-conversations";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { gradeFL3, gradeFL4 } from "./rag2-live/reliable-chat-check";

if (B.CDA !== "recorded") { console.error("run with BOOKLET_CDA=recorded"); process.exit(2); }
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });

export const CDA_U = "If Daniel were killed in a road accident, would our booklet help with his funeral costs, and what would we need to send in?";
const FAITHFUL = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to $2,000, if Daniel dies as a result of an Accident, on receipt of proof of death and the relevant documents in the insurer's prescribed form; it can only be claimed under either the Core Scheme or the Voluntary Scheme.";
const SYNTHETIC = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to $2,000, if Daniel dies as a result of an Accident within 365 days, on receipt of proof of death and the original receipts.";
const ILLNESS = "The Compassionate Death Allowance Benefit is not payable for death caused by an illness.";
const BOOKLET_SGD = "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to S$2,000, if Daniel dies as a result of an Accident.";
const SUMMARY_SGD = "The Insurance Benefits Summary lists the Compassionate Death Allowance Benefit as up to S$2,000.";
const FALSE_CAVEAT = "The uploaded documents do not confirm Daniel's enrolment in the group scheme.";
const CURRENT = "Daniel is currently covered under the Civil Service Group Insurance Scheme.";

/** One turn: look the benefit up in the booklet (and the summary), then answer with the given sentences. */
function turns(sentences: { text: string; from: "booklet" | "summary" | "cert" }[]): ScriptTurn[] {
  return [{ user: /funeral|died|killed|death/i, steps: [
    () => [call("person_benefits", { subject_id: D, topic: "death accident funeral" }),
      call("search_passages", { subject_id: D, query: "Compassionate Death Allowance funeral expenses proof of death prescribed form", policy_ids: [B.doc("BOOKLET").id], k: 4 }),
      call("search_passages", { subject_id: D, query: "Compassionate Death Allowance Up to S$2,000", policy_ids: [B.doc("SUMMARY").id], k: 4 }),
      call("search_passages", { subject_id: D, query: "Civil Service Group Insurance Scheme certificate Lee Wei Ming Daniel", policy_ids: [B.doc("CERT").id], k: 4 })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: sentences.map((s) => ({ kind: "fact", text: s.text, benefit: s.from === "cert" ? undefined : "Compassionate Death Allowance Benefit",
      evidence_ids: [hitOf(v, s.from === "booklet" ? /prescribed form/ : s.from === "summary" ? /Up to S\$2,000/ : /Lee Wei Ming, Daniel/)] })), next_steps: ["contact:" + B.doc("CERT").id] })],
  ] }];
}

async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const run = async (label: string, t: ScriptTurn[]) => {
    installLoopModel(new ScriptedLoopModel(t));
    try {
      const a = await h.send(CDA_U, {});
      const s = await h.savedAnswer(a.conversationId!);
      const v = [s.answer.summary, ...(s.answer.details ?? []), ...(s.answer.questions ?? []).map((q: any) => q.text), ...uniqueSteps(s.answer.nextSteps)].filter(Boolean).join("\n");
      const trace = s.state.ragLoop.turns.at(-1);
      if (process.env.SHOW) console.log(`--- ${label}\n${v}\n  dropped: ${JSON.stringify(trace.dropped ?? [])}\n  gate: ${JSON.stringify(trace.gate ?? [])}`);
      return { v, answer: s.answer, state: s.state, trace };
    } finally { installLoopModel(null); }
  };
  const SYNTH = /365 days|original receipts|illness/i;

  const f = await run("faithful", turns([{ text: FAITHFUL, from: "booklet" }]));
  check("recorded: the Compassionate Death Allowance Benefit is retained with funeral expenses and accidental death", /Compassionate Death Allowance/.test(f.v) && /funeral/i.test(f.v) && /Accident/i.test(f.v), f.v);
  check("recorded: the printed proof / prescribed-form requirement is kept", /proof of death/i.test(f.v) && /prescribed form/i.test(f.v), f.v);
  check("recorded: the Core / Voluntary Scheme restriction is kept", /Core Scheme/.test(f.v) && /Voluntary Scheme/.test(f.v), f.v);
  check("recorded: the bare $2,000 is said with its currency unknown, never S$", /does not say which currency/.test(f.v) && !/S\$2,000/.test(f.v), f.v);
  check("recorded: none of the synthetic additions (365 days, original receipts, illness exclusion)", !SYNTH.test(f.v), f.v);
  check("recorded: no false enrolment caveat and no current-cover claim", !/do not confirm|not confirm\w* Daniel/i.test(f.v) && !/\b(?:is|remains|currently) (?:covered|insured|enrolled)\b/i.test(f.v), f.v);
  const g = gradeFL3("FL3", { turns: [{}], loaded: { turns: [{ answer: f.answer }], state: f.state }, saved: { traces: [f.trace] } } as any);
  check("recorded: the pre-registered grader v4 (FL3 checks) passes the replayed answer", g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok)));

  const asConv = (x: { answer: any; state: any; trace: any }) => ({ turns: [{}], loaded: { turns: [{ answer: x.answer }], state: x.state }, saved: { traces: [x.trace] } } as any);
  const g4 = gradeFL4("FL4", asConv(f));
  check("recorded: the pre-registered rc-live-7 grader (FL4) passes the replayed answer", g4.verdict === "PASS", JSON.stringify(g4.checks.filter((c: any) => !c.ok)));
  // FL4 grader controls: rc-live-6's actual FL3 answer (synthetic page) must fail A2X; an S$ booklet line must fail A2C;
  // a current-cover line must fail A2L.
  const withText = (v: string) => ({ ...f, answer: { ...f.answer, summary: v, details: [], nextSteps: [] } });
  const fl3Live = "The booklet’s “Compassionate Death Allowance Benefit” says funeral expenses incurred are payable up to 2,000 (printed with a “$” sign; the document does not say which currency) if bodily injury from an accident independently results in death within 365 days of the accident; it requires proof of death and the original receipts, and does not apply to death caused by illness.";
  const ctl = (name: string, v: string, idWanted: string) => { const gg = gradeFL4("FL4", asConv(withText(v))); check(`FL4 grader control (${name}): fails on ${idWanted}`, gg.verdict === "FAIL" && gg.checks.some((c: any) => c.id === idWanted && !c.ok), JSON.stringify(gg.checks.filter((c: any) => !c.ok).map((c: any) => c.id))); };
  ctl("rc-live-6 FL3 answer, synthetic additions", fl3Live, "A2X");
  ctl("booklet amount as S$", f.v.replace("up to 2,000 (printed with a “$” sign; the document does not say which currency)", "up to S$2,000"), "A2C");
  ctl("current cover", f.v + "\nDaniel is currently covered under the scheme.", "A2L");
  ctl("Core / Voluntary restriction dropped", f.v.replace(/; it can only be claimed[^.]*\./, "."), "A2S");

  const s = await run("synthetic additions", turns([{ text: FAITHFUL, from: "booklet" }, { text: SYNTHETIC, from: "booklet" }, { text: ILLNESS, from: "booklet" }]));
  check("control (synthetic additions offered by the model): 365 days, original receipts and the illness exclusion are never shown", !SYNTH.test(s.v), s.v);
  check("control (synthetic additions): the supported sentence is kept beside them, with its prescribed-form and Core / Voluntary terms", /Compassionate Death Allowance/.test(s.v) && /prescribed form/.test(s.v) && /Core Scheme/.test(s.v), s.v);

  const c = await run("currency", turns([{ text: BOOKLET_SGD, from: "booklet" }, { text: SUMMARY_SGD, from: "summary" }]));
  const sgdLines = c.v.split("\n").filter((l) => /S\$2,000/.test(l));
  check("control (S$ for the booklet's bare $): never shown as the booklet's amount", !sgdLines.some((l) => /Booklet/i.test(l) && !/Summary/i.test(l)), c.v);
  check("control (S$ for the booklet's bare $): the booklet statement is kept, its amount said as printed", /Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to 2,000 \(printed with a “\$” sign/.test(c.v), c.v);
  check("control (the summary's S$2,000): if shown, it is attributed to the separate summary only", sgdLines.every((l) => /Insurance Benefits Summary/.test(l)), c.v);

  // rc-live-7 (live, FAIL): the model wrote "up to S$2,000" for the booklet's bare "$2,000" and the whole supported
  // statement was dropped. Replayed with the live wording: the benefit and its terms are kept, the amount said as printed.
  const LIVE7 = "The Group Insurance Benefits Booklet says its Compassionate Death Allowance Benefit pays funeral expenses incurred up to S$2,000 if Daniel dies as a result of an accident, on receipt of proof of death and the relevant documents in the insurer’s prescribed form; it can be claimed only under either the Core Scheme or the Voluntary Scheme.";
  const l7 = await run("rc-live-7 wording", turns([{ text: LIVE7, from: "booklet" }]));
  check("rc-live-7 replay (S$ written for the bare $): the benefit, proof / prescribed form and Core / Voluntary terms are kept", /Compassionate Death Allowance/.test(l7.v) && /prescribed form/.test(l7.v) && /Core Scheme/.test(l7.v), l7.v);
  check("rc-live-7 replay: the amount is said as printed (currency unknown), never S$2,000", /2,000 \(printed with a “\$” sign; the document does not say which currency\)/.test(l7.v) && !/S\$2,000/.test(l7.v), l7.v);
  check("rc-live-7 replay: the unsupported S$ is recorded as taken out", (l7.trace.dropped ?? []).some((d: any) => /bare \$ and does not state its currency; said as printed instead/.test(d.reason)), JSON.stringify(l7.trace.dropped));
  const g7 = gradeFL4("FL4", asConv(l7));
  check("rc-live-7 replay: the FL4 grader passes", g7.verdict === "PASS", JSON.stringify(g7.checks.filter((c: any) => !c.ok)));

  const e = await run("enrolment", turns([{ text: FAITHFUL, from: "booklet" }, { text: FALSE_CAVEAT, from: "cert" }, { text: CURRENT, from: "cert" }]));
  check("enrolment: the false caveat is replaced by the certificate's dated listing (as of 01/04/2024) with the later-date limit", !/do not confirm|not confirm\w* Daniel/i.test(e.v) && /certificate lists Daniel/.test(e.v) && /01\/04\/2024/.test(e.v) && /later date/.test(e.v), e.v);
  check("enrolment: no current-cover claim", !/\b(?:is|remains|currently) (?:covered|insured|enrolled)\b/i.test(e.v), e.v);
  check("enrolment: still none of the synthetic additions", !SYNTH.test(e.v), e.v);

  console.log(`\nreliable-chat CDA (recorded passage): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
