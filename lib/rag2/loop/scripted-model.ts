/**
 * Conversational RAG (Prompt 2): a TEST-ONLY model stand-in that drives the loop by following a script of tool calls
 * supplied by the test (scripts/rag2-loop-*.ts). The script lives in the test, never in product code: this class only
 * plays it back. Each scripted step sees what the previous step's tool calls returned (as a model would) and chooses
 * the next calls -- so value ids, evidence ids and candidate ids come from the real tools, not from the script.
 *
 * Refused in a production build (NODE_ENV=production or any Vercel deployment), whatever else is set.
 */
import { isProduction } from "@/lib/launch/guards";
import type { LoopModel, LoopMessage, ModelTurnInput, ModelTurnOutput, ToolCall } from "./types";

export type ScriptObservation = { name: string; args: Record<string, unknown>; ok: boolean; result: Record<string, any> };
export type ScriptView = {
  /** The household's message this turn. */
  user: string;
  /** Tool results of the previous step (empty on the first step of a turn). */
  last: ScriptObservation[];
  /** Every tool result so far this turn. */
  turn: ScriptObservation[];
  /** The state note the system prompt carries this turn. */
  system: string;
  /** Finds this turn's latest result of a tool (optionally matching its args). */
  find: (name: string, where?: (o: ScriptObservation) => boolean) => ScriptObservation | undefined;
};
export type ScriptCall = { name: string; arguments: Record<string, unknown> };
export type ScriptStep = (view: ScriptView) => ScriptCall[];
export type ScriptTurn = { user?: string | RegExp; steps: ScriptStep[] };

export const SCRIPTED_MODEL_ID = "dearpolicy-scripted-loop-test-v1";

export function scriptedModelAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !(isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "");
}

export class ScriptedLoopModel implements LoopModel {
  readonly id = SCRIPTED_MODEL_ID;
  readonly kind = "scripted" as const;
  private turnIndex = -1;
  private lastUserKey = "";
  constructor(private readonly turns: ScriptTurn[], env: NodeJS.ProcessEnv = process.env) {
    if (!scriptedModelAllowed(env)) throw new Error("the scripted loop model is test-only and is refused in a production build");
  }
  /** How many scripted turns have been started. */
  get started() { return this.turnIndex + 1; }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    const t0 = Date.now();
    const msgs = input.messages;
    const lastUser = msgs.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const user = lastUser >= 0 ? (msgs[lastUser] as Extract<LoopMessage, { role: "user" }>).content : "";
    const after = msgs.slice(lastUser + 1);
    const step = after.filter((m) => m.role === "assistant").length;
    const key = lastUser + "|" + user;
    // (a new household message starts the next scripted turn -- also when the server already made the turn's first call itself, so the
    // first model call of the turn is its second step)
    if (key !== this.lastUserKey) { this.turnIndex++; this.lastUserKey = key; }
    const turn = this.turns[this.turnIndex];
    if (!turn) throw new Error(`the script has no turn ${this.turnIndex + 1} (message: ${user})`);
    if (turn.user && !(typeof turn.user === "string" ? user.includes(turn.user) : turn.user.test(user))) throw new Error(`script turn ${this.turnIndex + 1} expected a message like ${String(turn.user)}, got: ${user}`);
    const fn = turn.steps[step];
    if (!fn) throw new Error(`script turn ${this.turnIndex + 1} has no step ${step + 1}`);
    const toolMsgs = after.filter((m): m is Extract<LoopMessage, { role: "tool" }> => m.role === "tool");
    const calls = new Map<string, ToolCall>();
    for (const m of after) if (m.role === "assistant") for (const c of m.toolCalls ?? []) calls.set(c.id, c);
    const obs = toolMsgs.map((m) => { const r = JSON.parse(m.content); return { name: m.name, args: calls.get(m.toolCallId)?.arguments ?? {}, ok: r.ok !== false, result: r } as ScriptObservation; });
    const lastAssistant = after.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const lastIds = new Set(lastAssistant >= 0 ? ((after[lastAssistant] as Extract<LoopMessage, { role: "assistant" }>).toolCalls ?? []).map((c) => c.id) : []);
    const last = toolMsgs.filter((m) => lastIds.has(m.toolCallId)).map((m) => obs[toolMsgs.indexOf(m)]);
    const system = (msgs.find((m) => m.role === "system") as { content: string } | undefined)?.content ?? "";
    const view: ScriptView = { user, last, turn: obs, system, find: (name, where) => [...obs].reverse().find((o) => o.name === name && (!where || where(o))) };
    const out = fn(view).map((c, i) => ({ id: `call_${this.turnIndex + 1}_${step + 1}_${i + 1}`, name: c.name, arguments: c.arguments }));
    return { toolCalls: out, text: null, usage: { input: 0, output: 0 }, modelId: this.id, latencyMs: Date.now() - t0 };
  }
}
