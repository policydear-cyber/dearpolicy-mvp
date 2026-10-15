/**
 * Replay of recorded actual-model runs WITHOUT any model call (shared by scripts/rag2-scenario-replay.ts and
 * scripts/rag2-stress-regressions.ts): the recorded tool calls, grouped into the model calls the relay log recorded.
 */
import fs from "node:fs";
import path from "node:path";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

export const runDir = (prefix: string) => { const base = "docs/rag-migration/live"; const d = fs.readdirSync(base).filter((x) => x.startsWith(prefix)).sort()[0]; return path.join(base, d); };
/** The recorded model calls of each turn: the trace's tool calls (not the ones the product made itself, marked `by`),
 * grouped by the relay's per-call tool-call names. */
type RecCall = { name: string; arguments: Record<string, unknown>; rec?: { evidenceIds: string[]; valueId: string | null } };
export function recordedTurns(dir: string, scenario = "S47", relayOffset = 0): { user: string; steps: RecCall[][] }[] {
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const conv = run.conversations.find((c: any) => c.scenario === scenario);
  const relay = fs.readFileSync(path.join(dir, "relay.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l: any) => l.status === 200);
  const out: { user: string; steps: RecCall[][] }[] = [];
  let r = relayOffset;
  for (const t of conv.loaded.turns) {
    const calls: any[] = (t.trace?.toolCalls ?? []).filter((x: any) => x.name !== "model" && !x.args?.by);
    const steps: RecCall[][] = [];
    let i = 0;
    while (i < calls.length) {
      const names: string[] = relay[r++]?.tool_calls ?? [];
      if (!names.length) throw new Error(`relay log has no model call for turn ${t.index + 1} call ${i + 1}`);
      const step = names.map((n) => { const c = calls[i++]; if (!c || c.name !== n) throw new Error(`turn ${t.index + 1}: relay says ${n}, trace says ${c?.name}`); let valueId: string | null = null; try { valueId = c.summary ? JSON.parse(c.summary).valueId ?? null : null; } catch { valueId = null; } return { name: c.name, arguments: c.args, rec: { evidenceIds: c.evidenceIds ?? [], valueId } }; });
      steps.push(step);
    }
    out.push({ user: t.user, steps });
  }
  return out;
}

/** Every conversation of a multi-conversation run, in run order: the relay log is one sequence across conversations,
 * so each conversation's model calls start where the previous conversation's ended. */
export function recordedRun(dir: string): { scenario: string; turns: ReturnType<typeof recordedTurns> }[] {
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  let offset = 0;
  return run.conversations.map((c: any) => {
    const turns = recordedTurns(dir, c.scenario, offset);
    offset += turns.reduce((n, t) => n + t.steps.length, 0);
    return { scenario: c.scenario as string, turns };
  });
}

/**
 * The recorded calls as a script whose evidence / value ids are carried over to this run. Ids are issued in order, so a
 * product change that registers an extra passage (or keeps a sentence it used to drop) renumbers later ids; each
 * recorded id is mapped to the id THIS run gave the same tool result (the same call, the same position in its result),
 * so the recorded model output refers to the same evidence it did live. Unmapped ids are passed through unchanged.
 */
export function replayScript(turns: ReturnType<typeof recordedTurns>): ScriptTurn[] {
  const ev = new Map<string, string>(), val = new Map<string, string>();
  const idsIn = (x: unknown, out: string[] = []): string[] => { if (Array.isArray(x)) x.forEach((y) => idsIn(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "evidence_id" && typeof v === "string") { if (!out.includes(v)) out.push(v); } else idsIn(v, out); } return out; };
  const learn = (prev: RecCall[], last: ScriptView["last"]) => {
    prev.forEach((rc, i) => {
      const o = last[i]; if (!o || o.name !== rc.name || !rc.rec) return;
      const cur = idsIn(o.result); rc.rec.evidenceIds.forEach((r, j) => { if (cur[j]) ev.set(r, cur[j]); });
      const cv = (o.result as any)?.data?.valueId; if (rc.rec.valueId && typeof cv === "string") val.set(rc.rec.valueId, cv);
    });
  };
  const remap = (x: unknown): unknown => typeof x === "string" ? (/^e\d+$/.test(x) ? ev.get(x) ?? x : /^v\d+$/.test(x) ? val.get(x) ?? x : x)
    : Array.isArray(x) ? x.map(remap) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, remap(v)])) : x;
  return turns.map((t) => ({ user: t.user, steps: t.steps.map((step, si) => (v: ScriptView) => { if (si > 0) learn(t.steps[si - 1], v.last); return step.map((c) => ({ name: c.name, arguments: remap(c.arguments) as Record<string, unknown> })); }) }));
}

