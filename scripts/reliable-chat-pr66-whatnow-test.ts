/**
 * PR #66 ("what do i do now"): the follow-up journeys, scripted (ScriptedLoopModel through the real /api/chat route; PGlite; network
 * refused; no model call, no spend). Anonymised fracture household; turns follow the Developer's reconstruction
 * (docs/rag-migration/pr57-roles/developer/what-now-repro.ts) plus a withdrawn answer (Critic R17-3) and the fracture conversation.
 * Each journey checks returned = saved = reopened (the history route) for every turn.
 *
 *   node --import tsx scripts/reliable-chat-pr66-whatnow-test.ts [--show]
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { CERT, PS, MSG1, MSG2, T1, T2, call } from "./fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
type Cls = "AC" | "GUARD";
const tally: Record<Cls, { pass: number; fail: number }> = { AC: { pass: 0, fail: 0 }, GUARD: { pass: 0, fail: 0 } };
const check = (cls: Cls, name: string, ok: boolean, detail = "") => {
  tally[cls][ok ? "pass" : "fail"]++;
  console.log(`${ok ? "PASS" : "FAIL"} [${cls}] ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`);
};
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => "Q: " + (q.text ?? "")), ...uniqueSteps(a?.nextSteps).map((s: string) => "STEP: " + s)].filter(Boolean).join("\n");
const show = process.argv.includes("--show");

const DAN = FX.M.daniel.id, GRACE = FX.M.grace.id;
const rep = (f: () => ScriptCall[]) => Array.from({ length: 6 }, () => f);
const final = (subject: string, text: string, steps: string[]) => rep(() => [call("final_answer", { subject_id: subject, sentences: [{ kind: "fact", text, subject_id: subject }], next_steps: steps })]);
// An answer whose raw steps include a figure and a stated requirement, which the composer leaves out (Critic R14-1).
const gp = (who: string, subject: string): ScriptTurn => ({ steps: [
  () => [call("resolve_person", { mention: who })],
  () => [call("note_facts", { subject_id: subject, facts: [{ key: "how_it_happened", value: "tripped on the kerb", words: "tripped on the kerb" }, { key: "bill_amount", value: "$800 GP bill", words: "GP bill is $800" }] })],
  () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses", subject_id: subject })],
  ...final(subject, `${who}'s documents do not include a benefit that pays for a GP bill after a fall.`, ["contact:" + CERT, "Claim S$2,500 from the insurer.", "You must submit the claim form with receipts."]),
] });
const plain = (who: string, subject: string): ScriptTurn => ({ steps: [() => [call("resolve_person", { mention: who })], ...final(subject, `${who}'s documents do not include a benefit for this.`, [])] });
// "what do i do now": general advice the composer cannot keep.
const whatNow = (subject: string): ScriptTurn => ({ steps: final(subject, "You need to submit a claim form with the GP bill and receipts to the insurer.", ["You must submit the original receipts within 30 days."]) });

type Step = { msg: string; turn: ScriptTurn; before?: (db: any) => Promise<void> };
type Out = { v: string; shown: string; reopened: string };
async function journey(steps: Step[]): Promise<Out[]> {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  installLoopModel(new ScriptedLoopModel(steps.map((s) => s.turn)));
  try {
    const outs: Out[] = [];
    let conv: { id?: string; rev?: number } = {};
    for (const s of steps) {
      if (s.before) await s.before(h.db);
      const a = await h.send(s.msg, conv);
      const sv = await h.savedAnswer(a.conversationId!);
      const r = await history(new NextRequest(`http://localhost/api/chat/history/${a.conversationId}`), { params: Promise.resolve({ id: a.conversationId! }) });
      const re = ((await r.json()).messages ?? []).filter((m: any) => m.role === "assistant").at(-1)?.answer_json;
      outs.push({ v: visible(sv.answer), shown: visible(a), reopened: visible(re) });
      if (show) console.log(`--- ${s.msg}\n${visible(sv.answer)}`);
      conv = { id: a.conversationId!, rev: sv.state?.rev ?? a.conversationRevision! };
    }
    return outs;
  } finally { installLoopModel(null); }
}

const REPEAT = /Here (?:is the next step|are the next steps) from my last answer/;
const CONTACT = /^STEP: .*(?:Contact|contact)/m;
const NOT_CONFIRM = /couldn.t confirm|could not confirm|returned an error/i;
const DROPPED = /S\$2,500|You must submit|within 30 days/;
const consistent = (k: string, outs: Out[]) => check("GUARD", `${k}: every turn returned = saved = reopened`, outs.every((o) => o.shown === o.v && o.reopened === o.v), outs.map((o, i) => `turn ${i + 1}\n${o.shown}\n--saved--\n${o.v}\n--reopened--\n${o.reopened}`).filter((_, i) => !(outs[i].shown === outs[i].v && outs[i].reopened === outs[i].v)).join("\n"));

async function main() {
  // 1. GP bill, then "what do i do now": the step the answer showed comes back; nothing the composer had removed.
  const a = await journey([{ msg: "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?", turn: gp("daniel", DAN) }, { msg: "what do i do now", turn: whatNow(DAN) }]);
  check("AC", "1 GP bill -> \"what do i do now\": not \"couldn't confirm\"; says these are the steps from the last answer; the contact step is shown", !NOT_CONFIRM.test(a[1].v) && REPEAT.test(a[1].v) && CONTACT.test(a[1].v), a[1].v);
  check("GUARD", "1 the repeat carries only what the first answer showed (no S$2,500, no stated requirement, no 30 days)", !DROPPED.test(a[1].v) && a[1].v.split("\n").filter((l) => l.startsWith("STEP:")).every((l) => a[0].v.includes(l)), `${a[0].v}\n===\n${a[1].v}`);
  consistent("1", a);

  // 2. Grace, then "it was Daniel", then "what do i do now": nothing from Grace's answer.
  const b = await journey([{ msg: "grace tripped on the kerb and fell, her GP bill is $800, can she claim?", turn: gp("grace", GRACE) }, { msg: "sorry, it was daniel not grace", turn: plain("daniel", DAN) }, { msg: "what do i do now", turn: whatNow(DAN) }]);
  check("GUARD", "2 Grace -> \"it was Daniel\" -> \"what do i do now\": nothing repeated from Grace's answer", !REPEAT.test(b[2].v) && !/Grace/.test(b[2].v) && !b[0].v.split("\n").filter((l) => l.startsWith("STEP:")).some((l) => b[2].v.includes(l)), `${b[0].v}\n===\n${b[2].v}`);
  consistent("2", b);

  // 3. A death, then a turn that ends with a question card, then "what do i do now" (Critic R17-1): nothing from the death answer.
  const c = await journey([{ msg: "grace died in an accident, what does the policy pay?", turn: gp("grace", GRACE) }, { msg: "she broke her arm too", turn: { steps: rep(() => [call("ask_user", { kind: "person", question: "Who broke their arm: Grace or Daniel?", options: [GRACE, DAN], mention: "she" })]) } }, { msg: "what do i do now", turn: whatNow(GRACE) }]);
  check("AC", "3 death -> fracture ask card -> \"what do i do now\": nothing repeated from the death answer", !REPEAT.test(c[2].v) && !c[0].v.split("\n").filter((l) => l.startsWith("STEP:")).some((l) => c[2].v.includes(l)), `${c[0].v}\n===\n${c[1].v}\n===\n${c[2].v}`);
  check("GUARD", "3 the middle turn ends with a question card (who broke their arm)", /^Q: Who broke their arm/m.test(c[1].v), c[1].v);
  consistent("3", c);
  // 3c. Control: the same death answer, then "what do i do now" straight away, repeats its step (so 3 can fail).
  const c2 = await journey([{ msg: "grace died in an accident, what does the policy pay?", turn: gp("grace", GRACE) }, { msg: "what do i do now", turn: whatNow(GRACE) }]);
  check("AC", "3c control: death answer -> \"what do i do now\" repeats its step", REPEAT.test(c2[1].v) && CONTACT.test(c2[1].v), c2[1].v);
  consistent("3c", c2);

  // 4. A withdrawn answer (Critic R17-3): the fracture estimate with its contact step, then its Product Summary is deleted,
  // then "what do i do now": the estimate is said to no longer apply and its steps are not repeated. Control 4c: no deletion.
  const del = async (db: any) => { await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [PS]); };
  const d = await journey([{ msg: MSG1, turn: T1 }, { msg: MSG2, turn: T2 }, { msg: "what do i do now", turn: whatNow(GRACE), before: del }]);
  check("GUARD", "4 the fracture answer before the deletion shows its contact step (setup)", CONTACT.test(d[1].v), d[1].v);
  check("AC", "4 withdrawn answer -> \"what do i do now\": says the earlier estimate no longer applies; its steps are not repeated", /no longer applies/.test(d[2].v) && !REPEAT.test(d[2].v), d[2].v);
  check("GUARD", "4 no figure from the withdrawn estimate is shown again (S$1,250, S$120,000)", !/S\$1,250|S\$120,000/.test(d[2].v), d[2].v);
  consistent("4", d);
  const d2 = await journey([{ msg: MSG1, turn: T1 }, { msg: MSG2, turn: T2 }, { msg: "what do i do now", turn: whatNow(GRACE) }]);
  check("AC", "4c control: the same answer, not withdrawn -> \"what do i do now\" repeats its step", REPEAT.test(d2[2].v) && CONTACT.test(d2[2].v), d2[2].v);
  consistent("4c", d2);

  console.log(`\nAC ${tally.AC.pass} passed, ${tally.AC.fail} failed | GUARD ${tally.GUARD.pass} passed, ${tally.GUARD.fail} failed`);
  process.exit(tally.AC.fail || tally.GUARD.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
