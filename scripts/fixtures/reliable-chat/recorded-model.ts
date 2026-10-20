/**
 * fx-live-1 recorded model behaviour as a queue for the test-only ScriptedLoopModel.
 *
 * scripts/fixtures/reliable-chat/fx-live-1-model-calls.json holds, per conversation (A/K1 ... A/K6b), the tool calls the real model
 * made in the fx-live-1 run (arguments verbatim, in order). This file turns them into ScriptTurns: each recorded step plays back
 * the recorded calls unchanged (evidence ids, benefit ids and statements as the model wrote them -- the tools return the same
 * ids because the library and the retrieval are unchanged); a turn ends at its first final_answer or ask_user. After the
 * recorded steps a test may append continuation steps: what a model that follows a repair message would do next.
 *
 * LABEL: this is a recorded-tool-calls replay (request hashes are NOT compared, unlike the exact-request replay of the original
 * run). It shows what the repaired pipeline does with the model's recorded statements; it does not show what a model chooses
 * after a changed prompt or tool schema. That needs the proposed live confirmation.
 */
import fs from "node:fs";
import path from "node:path";
import type { ScriptStep, ScriptTurn } from "@/lib/rag2/loop/scripted-model";

type Rec = { calls: { id?: string; name: string; arguments: Record<string, unknown> }[]; text: string | null };
const FILE = path.join(process.cwd(), "scripts/fixtures/reliable-chat/fx-live-1-model-calls.json");

export function recorded(tag: string): Rec[] {
  const all = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Rec[]>;
  if (!all[tag]) throw new Error(`no recorded conversation ${tag}`);
  return all[tag];
}

/** The recorded steps of `tag`, split into turns at each final_answer / ask_user. */
export function recordedTurns(tag: string): ScriptTurn[] {
  const turns: ScriptTurn[] = [];
  let cur: ScriptStep[] = [];
  for (const r of recorded(tag)) {
    const calls = r.calls.map((c) => ({ name: c.name, arguments: c.arguments }));
    cur.push(() => calls);
    if (calls.some((c) => c.name === "final_answer" || c.name === "ask_user")) { turns.push({ steps: cur }); cur = []; }
  }
  if (cur.length) turns.push({ steps: cur });
  return turns;
}

/** The recorded final_answer / ask_user call of turn `turn` (0-based). */
export function recordedTerminal(tag: string, turn = 0) {
  let t = -1;
  for (const r of recorded(tag)) {
    const c = r.calls.find((x) => x.name === "final_answer" || x.name === "ask_user");
    if (c) { t++; if (t === turn) return c; }
  }
  throw new Error(`no terminal call in turn ${turn} of ${tag}`);
}
