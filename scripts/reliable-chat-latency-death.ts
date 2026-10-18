/**
 * Death-journey release (item 4): where the APPLICATION's time goes in the broad death turn, not the model's. The scripted
 * model answers instantly, so every millisecond is the application's: retrieval, benefit-record resolution, evaluation,
 * composition, verification and saving. Counts SQL statements by kind and the page text they load, and the time of each tool.
 *   FILLER=12 PAGES=30 node --import tsx scripts/reliable-chat-latency-death.ts
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJ from "./fixtures/reliable-chat/death-journey";
import { fillerDocs } from "./fixtures/reliable-chat/filler-library";
import { MeteredScriptedModel } from "./fixtures/reliable-chat/metered-model";
import { deathTurn, DEATH_Q } from "./fixtures/reliable-chat/death-journey-conversations";
const nFill = Number(process.env.FILLER ?? 0), nPages = Number(process.env.PAGES ?? 20);
const H = { ...DJ, DOCS: [...DJ.DOCS, ...fillerDocs(nFill, nPages)] };
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(H as any);
async function main() {
  const h = await startHarness(H as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { pool } = await import("@/lib/db/client");
  const stats = new Map<string, { n: number; ms: number; rows: number; chars: number }>();
  const orig = pool.query.bind(pool);
  const kindOf = (t: string) => { const m = /(?:FROM|INTO|UPDATE)\s+([a-z_.]+)/i.exec(t); return (/^\s*(\w+)/.exec(t)?.[1] ?? "?").toUpperCase() + " " + (m?.[1] ?? ""); };
  pool.query = (async (text: string, params?: unknown[]) => {
    const t0 = Date.now(); const r: any = await (orig as any)(text, params);
    const k = kindOf(String(text)), s = stats.get(k) ?? { n: 0, ms: 0, rows: 0, chars: 0 };
    s.n++; s.ms += Date.now() - t0; s.rows += r?.rows?.length ?? 0; s.chars += (r?.rows ?? []).reduce((a: number, x: any) => a + (typeof x?.text === "string" ? x.text.length : 0), 0); stats.set(k, s); return r;
  }) as typeof pool.query;
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const m = new MeteredScriptedModel([deathTurn()], Number(process.env.SCALE ?? 1));
  installLoopModel(m);
  stats.clear();
  const t0 = Date.now();
  const a = await h.send(DEATH_Q, {});
  const wall = Date.now() - t0;
  const s = await h.savedAnswer(a.conversationId!);
  const tr = s.state.ragLoop.turns.at(-1);
  if (process.env.ANSWER) console.log("ANSWER\n" + [a.summary, ...(a.details ?? [])].join("\n"), "\nNEXT", JSON.stringify(a.nextSteps), "\nREQ", JSON.stringify(m.requests.map((r: any) => r.input)));
  console.log("PHASES", JSON.stringify(tr.phases));
  console.log("loopMs", tr.latencyMs, "wallMs", wall, "outsideLoopMs", wall - tr.latencyMs);
  console.log(JSON.stringify({ library: { docs: H.DOCS.length, pages: H.DOCS.reduce((n, d) => n + Object.keys(d.pages).length, 0) }, wallMs: wall, steps: tr.steps, outcome: tr.outcome, timings: tr.timings, limit: tr.limit ?? null }));
  const rows = [...stats].sort((x, y) => y[1].ms - x[1].ms);
  console.log("SQL total statements", rows.reduce((n, [, v]) => n + v.n, 0), "pageTextLoadedChars", rows.reduce((n, [, v]) => n + v.chars, 0));
  for (const [k, v] of rows.slice(0, 14)) console.log(`  ${String(v.n).padStart(4)}x ${String(v.ms).padStart(6)}ms rows=${v.rows} chars=${v.chars}  ${k}`);
  installLoopModel(null); await h.db.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
