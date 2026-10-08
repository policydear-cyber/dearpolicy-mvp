/**
 * The adversarial suite's TEST-ONLY scripted model. It implements the public LoopModel interface
 * (lib/rag2/loop/types.ts) and is installed with installLoopModel() (lib/rag2/loop/model.ts) -- no product code is
 * involved in choosing its moves. Unlike the product's ScriptedLoopModel it also:
 *  - shows each step the tool list the loop offered (so a script can discover an operation by name),
 *  - reports token usage per step (to exercise the loop's budget and usage accounting),
 *  - records every request it was given (to assert what evidence the model actually received).
 * Each scripted turn is a list of steps; a step sees the previous results (as a model would) and returns tool calls.
 * Ids (evidence, values, results, candidates) always come from what the tools returned, or are deliberately forged
 * by an adversarial script.
 */
import type { LoopMessage, LoopModel, LoopToolSpec, ModelTurnInput, ModelTurnOutput, ToolCall } from "@/lib/rag2/loop/types";

export type Obs = { name: string; args: Record<string, unknown>; ok: boolean; result: Record<string, any> };
export type View = { user: string; last: Obs[]; turn: Obs[]; system: string; tools: LoopToolSpec[]; find: (name: string, where?: (o: Obs) => boolean) => Obs | undefined; data: (name: string, where?: (o: Obs) => boolean) => any };
export type Call = { name: string; arguments: Record<string, unknown> };
export type Step = (v: View) => Call[];
export type Turn = { user?: string | RegExp; steps: Step[]; usage?: { input: number; output: number } };
export const call = (name: string, args: Record<string, unknown>): Call => ({ name, arguments: args });

export class AdvModel implements LoopModel {
  readonly id = "dearpolicy-adversarial-scripted-test-v1";
  readonly kind = "scripted" as const;
  turnIndex = -1;
  private lastKey = "";
  readonly requests: ModelTurnInput[] = [];
  constructor(private readonly turns: Turn[]) {
    if (process.env.NODE_ENV === "production" || (process.env.VERCEL ?? "").trim() || (process.env.VERCEL_ENV ?? "").trim()) throw new Error("test-only model refused in a production build");
  }
  get started() { return this.turnIndex + 1; }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    this.requests.push(structuredClone(input));
    const msgs = input.messages;
    const lastUser = msgs.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    // The loop appends a "Use the tools" nudge as a user message; the household's message is the last user message
    // that follows the system prompt and history and is not that nudge.
    const userIdx = [...msgs.keys()].filter((i) => msgs[i].role === "user" && !/^Use the tools\./.test((msgs[i] as { content: string }).content)).pop() ?? lastUser;
    const user = userIdx >= 0 ? (msgs[userIdx] as Extract<LoopMessage, { role: "user" }>).content : "";
    const after = msgs.slice(userIdx + 1);
    const step = after.filter((m) => m.role === "assistant").length;
    const key = userIdx + "|" + user;
    if (step === 0 && key !== this.lastKey) { this.turnIndex++; this.lastKey = key; }
    const turn = this.turns[this.turnIndex];
    if (!turn) throw new Error(`the adversarial script has no turn ${this.turnIndex + 1} (message: ${user})`);
    if (turn.user && !(typeof turn.user === "string" ? user.includes(turn.user) : turn.user.test(user))) throw new Error(`script turn ${this.turnIndex + 1} expected ${String(turn.user)}, got: ${user}`);
    const toolMsgs = after.filter((m): m is Extract<LoopMessage, { role: "tool" }> => m.role === "tool");
    const calls = new Map<string, ToolCall>();
    for (const m of after) if (m.role === "assistant") for (const c of m.toolCalls ?? []) calls.set(c.id, c);
    const obs = toolMsgs.map((m) => { let r: any; try { r = JSON.parse(m.content); } catch { r = { ok: false, error: m.content }; } return { name: m.name, args: calls.get(m.toolCallId)?.arguments ?? {}, ok: r.ok !== false, result: r } as Obs; });
    const lastA = after.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const lastIds = new Set(lastA >= 0 ? ((after[lastA] as Extract<LoopMessage, { role: "assistant" }>).toolCalls ?? []).map((c) => c.id) : []);
    const last = toolMsgs.filter((m) => lastIds.has(m.toolCallId)).map((m) => obs[toolMsgs.indexOf(m)]);
    const system = (msgs.find((m) => m.role === "system") as { content: string } | undefined)?.content ?? "";
    const find = (name: string, where?: (o: Obs) => boolean) => [...obs].reverse().find((o) => o.name === name && (!where || where(o)));
    const data = (name: string, where?: (o: Obs) => boolean) => { const o = find(name, where); if (!o || !o.ok) throw new Error(`script: ${name} has no successful result this turn (${o ? JSON.stringify(o.result).slice(0, 200) : "never called"})`); return o.result.data; };
    const view: View = { user, last, turn: obs, system, tools: input.tools, find, data };
    // Past the scripted steps the model keeps "thinking" (calls a harmless tool) -- the loop's own budget must stop it.
    const fn = turn.steps[step] ?? (() => [call("resolve_person", { mention: "me" })]);
    const out = fn(view).map((c, i) => ({ id: `adv_${this.turnIndex + 1}_${step + 1}_${i + 1}`, name: c.name, arguments: c.arguments }));
    return { toolCalls: out, text: null, usage: turn.usage ?? { input: 0, output: 0 }, modelId: this.id, latencyMs: 1 };
  }
}
