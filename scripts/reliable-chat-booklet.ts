/**
 * Reliable chat (actual-library findings after d549a27): the reported failures replayed through the REAL chat route
 * over the anonymised booklet household (scripts/fixtures/reliable-chat/booklet.ts), with their controls. No model
 * call; the moves are scripts/fixtures/reliable-chat/booklet-conversations.ts.
 *   node --import tsx scripts/reliable-chat-booklet.ts            assertions (exit 1 on a failure)
 *   SHOW=1 node --import tsx scripts/reliable-chat-booklet.ts     also print every visible answer and tool trace
 *   BOOKLET_CURRENCY=related|unrelated                             the booklet's currency variants (see booklet.ts)
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import { bk1Controls, bk1Stale, bk1Turns, bk2Turns, bk3Turns, bk4Turns, BK2G_U, BK3_ADJACENT, BK3_SGD, BK3_U, D, G } from "./fixtures/reliable-chat/booklet-conversations";
import { uniqueSteps } from "@/components/next-steps";
import { gradeBKL1, gradeBKL2, gradeBKL3 } from "./rag2-live/reliable-chat-check";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };

async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const run = async (label: string, turns: any[], users: string[]) => {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: any[] = []; let c: { id?: string; rev?: number } = {};
    try {
      for (const u of users) {
        const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision };
        const s = await h.savedAnswer(c.id!);
        const v = [s.answer.summary, ...(s.answer.details ?? []), ...(s.answer.questions ?? []).map((q: any) => q.text), ...uniqueSteps(s.answer.nextSteps)].filter(Boolean).join("\n");
        const trace = s.state.ragLoop.turns.at(-1);
        out.push({ v, answer: s.answer, state: s.state, trace, returned: a });
        if (process.env.SHOW) console.log(`--- ${label} | ${u}\n${v}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((t: any) => [t.name, t.ok, (t.error ?? t.summary ?? "").slice(0, 160)]))}\n  limit: ${JSON.stringify(trace.limit ?? null)} adjusted: ${JSON.stringify(trace.adjusted ?? [])}${trace.dropped?.length ? `\n  dropped: ${JSON.stringify(trace.dropped)}` : ""}${trace.gate?.length ? `\n  gate: ${JSON.stringify(trace.gate)}` : ""}`);
      }
    } finally { installLoopModel(null); }
    return out;
  };
  const asConv = (out: any[]) => ({ turns: out.map(() => ({})), loaded: { turns: out.map((x) => ({ answer: x.answer })), state: out.at(-1).state }, saved: { traces: out.map((x) => x.trace) } });
  const graded = (name: string, g: any) => check(`${name}: the pre-registered grader v3 passes the replayed conversation`, g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok)));
  const amounts = (v: string) => v.match(/S\$[\d,]+/g) ?? [];
  const unfinished = (v: string) => v.split("\n").filter((l) => /[“"][^”"]*\b(?:which|and|or|of|the|to|that|if|an?|by|with|for)\s*[”"]/i.test(l) || /,\s*(?:which|and|or|that)\s*[”"]/i.test(l));

  // BK1: the uncertain hip / tibia case (recorded calls: ask_user without fact_key / subject_id, round and round)
  {
    const b = await run("BK1 recorded", bk1Turns("recorded"), [bk1Turns()[0].user as string, bk1Turns()[1].user as string]);
    const q1 = b[0].answer.questions ?? [];
    check("BK1 turn 1 (recorded calls): one useful question about the case, no amount, no generic budget message", q1.length === 1 && /hip|tibia/i.test(q1[0]?.text ?? "") && !/illustration is S\$/.test(b[0].v) && !/model-use limit|couldn.t finish|reached its/i.test(b[0].v), b[0].v);
    check("BK1 turn 1: the benefit's printed terms are shown with the question", /Simple Fracture/.test(b[0].v) && /Hip 75%/.test(b[0].v), b[0].v);
    check("BK1 turn 1: no calculation saved", !(b[0].answer.calculations ?? []).length);
    check("BK1 turn 2: the clarified case is calculated (75% of S$5,000 = S$3,750) and the question cleared", /S\$3,750/.test(b[1].v) && !(b[1].answer.questions ?? []).length && !b[1].state.ragLoop.pending, b[1].v + " | pending: " + JSON.stringify(b[1].state.ragLoop.pending));
    const calc = b[1].answer.calculations?.[0]; const re = calc ? recomputeCalculation(calc) : null;
    check("BK1 turn 2: the saved calculation recomputes to S$3,750", !!re && re.ok && re.resultMinor === 375000, JSON.stringify(re));
    graded("BK1 recorded calls", gradeBKL1("BKL1a", asConv(b)));
    const r = await run("BK1 requirement", bk1Turns("requirement"), [bk1Turns()[0].user as string]);
    check("BK1 (requirement_id): the question is accepted at once -- no refused ask_user", (r[0].trace.toolCalls ?? []).filter((t: any) => t.name === "ask_user" && !t.ok).length === 0 && (r[0].answer.questions ?? []).length === 1, JSON.stringify((r[0].trace.toolCalls ?? []).map((t: any) => [t.name, t.ok, t.error])));
    const st = await run("BK1 stall", bk1Turns("stall"), [bk1Turns()[0].user as string]);
    check("BK1 (model use blocked): the verified terms and the outstanding question are shown", (st[0].answer.questions ?? []).length === 1 && /Hip 75%/.test(st[0].v), st[0].v);
  }
  // BK2: Other Fracture, % of Sum Insured, in a generic booklet holding Term Life and Personal Accident
  if (B.SECTIONS === "none") {
    const b = await run("BK2 no sections", bk2Turns(D), [bk2Turns(D)[0].user as string]);
    const ev = (b[0].trace.toolCalls ?? []).find((t: any) => t.name === "evaluate_benefit");
    check("BK2 (no product headings): no amount is chosen; the terms are said with the base as printed", !/S\$\d/.test(b[0].v.replace(/Contact[^\n]*/, "")) || !/illustration is/.test(b[0].v), b[0].v);
    check("BK2 (no product headings): the evaluation is unresolved and the answer names the specific missing link", /unresolved_evidence/.test(ev?.summary ?? "") && /does not print this table under one of Daniel's certificate products \(Group Term Life, Group Personal Accident\)/.test(b[0].v), b[0].v);
  } else {
    const b = await run("BK2", bk2Turns(D), [bk2Turns(D)[0].user as string]);
    check("BK2: Other Fracture uses Daniel's Group Personal Accident sum insured -> 75% of S$300,000 = S$225,000", /S\$225,000/.test(b[0].v) && !/S\$375,000/.test(b[0].v), b[0].v);
    check("BK2: no contradictory base (never 'could not be established' beside an amount)", !/could not be established|unresolved|not established/i.test(b[0].v) || !/S\$225,000/.test(b[0].v), b[0].v);
    const calc = b[0].answer.calculations?.[0]; const re = calc ? recomputeCalculation(calc) : null;
    check("BK2: the saved calculation recomputes to S$225,000", !!re && re.ok && re.resultMinor === 22500000, JSON.stringify(re));
    graded("BK2", gradeBKL2("BKL2", asConv(b)));
    const g = await run("BK2 Grace", bk2Turns(G), [BK2G_U]);
    check("BK2 (another person, identical amounts): Grace's own Group Personal Accident row is the base", /S\$225,000/.test(g[0].v) && /Grace/.test(g[0].v), g[0].v);
    check("BK2 (version): the superseded 2022 certificate (S$200,000) is never the base", !/S\$200,000|S\$150,000/.test(b[0].v + g[0].v), b[0].v);
  }
  // BK3: the Compassionate Death Allowance Benefit (heading above a wrapped paragraph; bare $)
  {
    const b = await run("BK3", bk3Turns(), [BK3_U]);
    check("BK3: the supported Compassionate Death Allowance Benefit is retained", /Compassionate Death Allowance/.test(b[0].v) && /funeral/i.test(b[0].v), b[0].v);
    if (B.CURRENCY === "related") check("BK3 (the booklet's own table prints the same benefit in S$): said as S$2,000, citing that line", /S\$2,000/.test(b[0].v), b[0].v);
    else check(`BK3 (${B.CURRENCY === "none" ? "no currency stated" : "an S$ figure for another benefit only"}): a bare $ is never shown as S$, and the amount's currency is said to be unknown`, !/S\$2,000/.test(b[0].v) && /does not say which currency/.test(b[0].v), b[0].v);
    check("BK3: no unfinished quotation", unfinished(b[0].v).length === 0, unfinished(b[0].v).join("\n"));
    if (B.CURRENCY !== "related") graded("BK3", gradeBKL3("BKL3", asConv(b)));
  }
  // Requirement controls: another person, an unknown id, another fact, a stale id -- refused, never accepted
  {
    for (const [k, re] of [["person", /is for Daniel/], ["unknown", /not open this turn/], ["fact", /records its answer as/]] as const) {
      const r = await run(`BK1 control ${k}`, bk1Controls(k), [bk1Turns()[0].user as string]);
      const asks = (r[0].trace.toolCalls ?? []).filter((t: any) => t.name === "ask_user");
      check(`BK1 control (${k}): the mismatched requirement is refused; the real one is then asked`, asks.length === 2 && !asks[0].ok && re.test(asks[0].error ?? "") && asks[1].ok && (r[0].answer.questions ?? []).length === 1, JSON.stringify(asks.map((t: any) => [t.ok, t.error])));
    }
    const st = await run("BK1 stale", bk1Stale(), [bk1Turns()[0].user as string, "I'm not sure yet."]);
    const a2 = (st[1].trace.toolCalls ?? []).find((t: any) => t.name === "ask_user");
    check("BK1 control (stale): a requirement from an earlier turn is refused", !!a2 && !a2.ok && /not open this turn/.test(a2.error ?? ""), JSON.stringify(a2));
    const g = B.SECTIONS === "none" ? null : await run("BK2 Grace evidence", bk2Turns(G), [BK2G_U]);
    const ops = (g?.[0].answer.calculations?.[0]?.operands ?? []) as any[];
    const baseOp = ops.find((o) => o.unit === "money");
    if (g) check("BK2 (identical amounts): Grace's base is HER certificate row (its source names her), not Daniel's", !!baseOp && /Grace/.test(JSON.stringify(baseOp)) && !/Daniel/.test(JSON.stringify(baseOp)), JSON.stringify(baseOp));
  }
  // Section binding controls (BK3): an adjacent section's amount, an S$ the booklet does not print for this benefit
  {
    const adj = await run("BK3 adjacent", bk3Turns(BK3_ADJACENT), [BK3_U]);
    check("BK3 control (adjacent section): Repatriation's $5,000 is never stated for the Compassionate Death Allowance", !/5,000/.test(adj[0].v), adj[0].v);
    const sgd = await run("BK3 sgd", bk3Turns(BK3_SGD), [BK3_U]);
    if (B.CURRENCY !== "related") check("BK3 control (unsupported currency): S$2,000 is never shown from a bare $", !/S\$2,000/.test(sgd[0].v), sgd[0].v);
    const q = await run("BK4", bk4Turns(), [BK3_U]);
    check("BK4: the reason a question quotes is a complete sentence (never \"..., which\")", unfinished(q[0].v).length === 0 && !/Accident, which[”"]/.test(q[0].v), q[0].v);
  }
  if (h.networkCalls.length) check("no network calls", false, h.networkCalls.join(", "));
  console.log(`\nreliable-chat booklet [currency ${B.CURRENCY}, sections ${B.SECTIONS}]: ${passed} passed, ${failed} failed`);
  await h.db.close();
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
