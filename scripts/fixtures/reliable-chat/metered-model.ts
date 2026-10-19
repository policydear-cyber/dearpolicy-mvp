/**
 * Test-only: a ScriptedLoopModel that REPORTS token usage the way a hosted model does (input = the whole request it was
 * sent, output = its calls), so the turn's token budget (maxTokensPerTurn) is exercised exactly as in a live turn. The
 * estimate the meter uses before a call (estimateTokens) is reused for the report: the scripted model has no tokenizer.
 */
import { ScriptedLoopModel, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { estimateTokens } from "@/lib/rag2/loop/usage-meter";
import type { ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";

export class MeteredScriptedModel extends ScriptedLoopModel {
  /** Per call: the request's estimated input tokens (what the meter will count as used). */
  readonly requests: { input: number; step: number }[] = [];
  /** The messages of each request (for measuring what each tool result costs). */
  readonly sent: ModelTurnInput["messages"][] = [];
  /** Tokens of the system prompt + tool specs alone (the fixed cost of every call). */
  fixed = 0;
  constructor(turns: ScriptTurn[], private readonly scale = 1) { super(turns); }
  override async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    if (!this.fixed) this.fixed = estimateTokens({ messages: input.messages.filter((m) => m.role === "system"), tools: input.tools });
    this.sent.push(input.messages.slice());
    const out = await super.next(input);
    const inTok = Math.round(estimateTokens(input) * this.scale);
    this.requests.push({ input: inTok, step: this.requests.length + 1 });
    return { ...out, usage: { input: inTok, output: 120 + 60 * out.toolCalls.length } };
  }
}
