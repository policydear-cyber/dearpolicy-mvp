/**
 * Actual-library findings (latency): application time, tool calls and model steps per turn of the reported
 * conversations, replayed through the real chat route with the scripted model (model time ~0, so the turn's time is the
 * application's own: retrieval, record resolution, evaluation, composition, verification and saving).
 *   node --import tsx scripts/reliable-chat-latency.ts      prints one JSON line per turn and a summary
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import { bk1Turns, bk2Turns, bk3Turns, BK2_U, BK3_U } from "./fixtures/reliable-chat/booklet-conversations";
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const rows: any[] = [];
  for (const [label, turns, users] of [["BK1", bk1Turns("recorded"), [bk1Turns()[0].user, bk1Turns()[1].user]], ["BK2", bk2Turns(), [BK2_U]], ["BK3", bk3Turns(), [BK3_U]]] as any[]) {
    for (let rep = 0; rep < 3; rep++) {
      installLoopModel(new ScriptedLoopModel(turns));
      let c: any = {};
      for (const [i, u] of users.entries()) {
        const t0 = Date.now();
        const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision };
        const wall = Date.now() - t0;
        const s = await h.savedAnswer(c.id);
        const tr = s.state.ragLoop.turns.at(-1);
        rows.push({ conv: label, turn: i + 1, rep, wallMs: wall, loopMs: tr.latencyMs, steps: tr.steps, toolCalls: (tr.toolCalls ?? []).length, refused: (tr.toolCalls ?? []).filter((x: any) => !x.ok).length, limit: tr.limit?.kind ?? null });
      }
    }
  }
  installLoopModel(null); await h.db.close();
  for (const r of rows) console.log(JSON.stringify(r));
  const by = new Map<string, any[]>(); for (const r of rows) by.set(`${r.conv}.${r.turn}`, [...(by.get(`${r.conv}.${r.turn}`) ?? []), r]);
  for (const [k, v] of by) { const w = v.map((x) => x.wallMs).sort((a, b) => a - b); console.log(`SUMMARY ${k}: median wall ${w[1]} ms, model steps ${v[0].steps}, tool calls ${v[0].toolCalls}, refused ${v[0].refused}${v[0].limit ? `, stopped by ${v[0].limit}` : ""}`); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
