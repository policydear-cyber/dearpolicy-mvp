/**
 * PR #57 follow-up, C4 acceptance checks on households other than the fracture library (Test engineer). Scripted model moves through the
 * real /api/chat route (PGlite, network refused, no model call, no spend). Each household runs in its own process (one harness per process).
 *   D  livelib (synthetic): "Adrian died in a car accident in Japan" (L2's moves, the `benefits` contract production runs). The travel
 *      schedule prints Accidental Death S$100,000 for Adrian, Period of Insurance 10/03/2025 to 17/03/2025, Destination Indonesia.
 *   T  tan (synthetic): an annual Personal Accident schedule that prints only "Period of Insurance: 01/03/2026 to 28/02/2027" is not a trip
 *      (Critic R8-1 on C5): its terms carry no "whether that trip fits this event" sentence.
 *   F  actuallib (real-anonymised pages that define neither fracture type): closed tibia, then the correction to the hip (SA1, SA2).
 *
 *   node --import tsx scripts/reliable-chat-pr57-c4-test.ts            (both households; exit 1 if any AC or GUARD fails)
 *   node --import tsx scripts/reliable-chat-pr57-c4-test.ts --hh=livelib --show
 */
import { spawnSync } from "node:child_process";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import { ScriptedLoopModel, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
type Cls = "AC" | "GUARD";
const tally: Record<Cls, { pass: number; fail: number }> = { AC: { pass: 0, fail: 0 }, GUARD: { pass: 0, fail: 0 } };
const check = (cls: Cls, name: string, ok: boolean, detail = "") => {
  tally[cls][ok ? "pass" : "fail"]++;
  console.log(`${ok ? "PASS" : "FAIL"} [${cls}] ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`);
};
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const hh = process.argv.find((a) => a.startsWith("--hh="))?.slice(5);
const show = process.argv.includes("--show");

async function conversation(fx: any, turns: ScriptTurn[], messages: string[]): Promise<{ v: string; shown: string }[]> {
  setEnv(fx);
  const h = await startHarness(fx);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  installLoopModel(new ScriptedLoopModel(turns));
  try {
    const out: { v: string; shown: string }[] = [];
    let conv: { id?: string; rev?: number } = {};
    for (const m of messages) {
      const a = await h.send(m, conv);
      const s = await h.savedAnswer(a.conversationId!);
      out.push({ v: visible(s.answer), shown: visible(a) });
      if (show) console.log(`--- ${m}\n${visible(s.answer)}`);
      conv = { id: a.conversationId!, rev: a.conversationRevision! };
    }
    return out;
  } finally { installLoopModel(null); }
}

async function livelib() {
  const LL = await import("./fixtures/rag2-livelib/household");
  const { LIVELIB_SCENARIOS } = await import("./fixtures/rag2-livelib/conversations");
  const sc = LIVELIB_SCENARIOS.find((s) => s.id === "L2")!;
  const [a] = await conversation(LL, sc.turns, sc.messages);
  const lines = a.v.split("\n").filter((l) => /S\$\s?100,000/.test(l));
  check("AC", "D1 (death abroad, C4 item 3) the travel Accidental Death S$100,000 never appears without its insured person, period of insurance and destination (Adrian; 10/03/2025 to 17/03/2025; Indonesia)", lines.every((l) => /Adrian/.test(l) && /Indonesia/.test(l) && /(?:10\/03\/2025|10 March 2025)/.test(l) && /(?:17\/03\/2025|17 March 2025)/.test(l)), lines.join("\n") || a.v);
  check("GUARD", "D2 the death answer still shows the Group Personal Accident S$600,000 and the S$2,000 repatriation with its 'outside Singapore' condition", /S\$600,000/.test(a.v) && /S\$2,000[^\n]*outside Singapore/.test(a.v), a.v);
  check("GUARD", "D3 returned = saved", a.v === a.shown);
}

async function tan() {
  const T = await import("./fixtures/reliable-chat/tan");
  const who = T.M.jun.id;
  const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
  const [a] = await conversation(T, [{ steps: [
    () => [call("person_benefits", { subject_id: who, topic: "accident cover" })],
    (v: any) => { const pb = [...v.turn].reverse().find((o: any) => o.name === "person_benefits"); const bs = (pb?.result?.data?.documents ?? []).flatMap((d: any) => d.benefits ?? []).filter((b: any) => b.benefit_id); return [call("final_answer", { subject_id: who, sentences: bs.slice(0, 3).map((b: any) => ({ kind: "benefit_terms", text: "-", benefit_id: b.benefit_id })) })]; },
  ] }], ["What does Jun's accident cover pay?"]);
  check("AC", "T1 (Critic R8-1) the annual FamilyGuard PA schedule (Period of Insurance 01/03/2026 to 28/02/2027, no destination) is not described as a trip: no 'whether that trip fits this event'", /S\$100,000/.test(a.v) && !/trip/i.test(a.v), a.v);
  check("GUARD", "T2 returned = saved", a.v === a.shown);
}

async function actuallib() {
  const A = await import("./fixtures/reliable-chat/actual-lib");
  const { ACTUAL_SCENARIOS } = await import("./fixtures/reliable-chat/actual-lib-conversations");
  const sc = ACTUAL_SCENARIOS().find((s) => s.id === "SA2")!;
  const out = await conversation(A, sc.turns, sc.messages);
  // A sentence that gives an illustration from the "Other Fracture" table (the PA Benefit Summary's Simple Fracture or Other Fracture benefit).
  const other = (v: string) => v.split("\n").filter((l) => /Other Fracture/.test(l) && /conditional illustration is S\$[\d,]+/.test(l));
  for (const [i, o] of out.entries()) {
    const ls = other(o.v);
    check("AC", `F1 (closed fracture, C4 item 4; SA2 turn ${i + 1}: ${i ? "corrected to the hip" : "closed tibia"}) every Other Fracture illustration says, in its own sentence, that these documents do not define which fractures that row covers`, ls.length > 0 && ls.every((l) => /print no definition|do(?:es)? not define/i.test(l)), ls.join("\n") || o.v);
    check("GUARD", `F2 (SA2 turn ${i + 1}) returned = saved`, o.v === o.shown);
  }
}

async function main() {
  if (hh === "livelib") await livelib();
  else if (hh === "actuallib") await actuallib();
  else if (hh === "tan") await tan();
  else {
    let failed = false;
    for (const x of ["livelib", "tan", "actuallib"]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", process.argv[1], `--hh=${x}`, ...(show ? ["--show"] : [])], { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
      const text = (r.stdout ?? "") + (r.stderr ?? "");
      console.log(`=== ${x}\n${text.split("\n").filter((l) => !l.startsWith("[telemetry]")).join("\n")}`);
      for (const m of text.matchAll(/^(PASS|FAIL) \[(AC|GUARD)\]/gm)) tally[m[2] as Cls][m[1] === "PASS" ? "pass" : "fail"]++;
      if (r.status !== 0 && !/^(?:PASS|FAIL) /m.test(text)) failed = true;
    }
    console.log(`\nAC ${tally.AC.pass} passed, ${tally.AC.fail} failed | GUARD ${tally.GUARD.pass} passed, ${tally.GUARD.fail} failed`);
    process.exit(failed || tally.AC.fail || tally.GUARD.fail ? 1 : 0);
  }
  process.exit(tally.AC.fail || tally.GUARD.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
