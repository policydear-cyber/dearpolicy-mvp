/**
 * Claude as DearPolicy's model (MODEL_PRESET=anthropic): the request each job sends to the Messages API and how the
 * reply is read, for the current Claude models.
 *
 * Before: the Anthropic adapter sent temperature 0 and a forced tool_choice ("any") on every call and dropped the
 * provider's own content blocks between steps of a turn. Claude Sonnet 5.5 rejects both settings with a 400, and its
 * thinking blocks must be passed back unchanged; the preset named claude-sonnet-5 / claude-haiku-4-5.
 * Now each model's request rules live next to its price (lib/ai/providers.ts CAPABILITIES) and are applied at the one
 * provider boundary; the loop replays each step exactly as the provider returned it.
 *
 * Category 1 (scripted): a fake endpoint (globalThis.fetch / an injected fetch) stands in for the API; no key, no
 * network, no database. This shows the request shape only: it cannot show how the real Claude model answers.
 *   node --import tsx scripts/claude-provider-regressions.ts
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:9/none";
process.env.MODEL_RETRY_WINDOW_MS = "1000";
for (const k of ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL", "READING_MODEL", "JUDGEMENT_MODEL", "NARRATION_MODEL", "CHAT_MODEL", "ANTHROPIC_BASE_URL"]) delete process.env[k];
process.env.ANTHROPIC_API_KEY = "dummy-not-a-key";
process.env.MODEL_PRESET = "anthropic";

type Seen = { url: string; headers: Record<string, string>; body: any };
let seen: Seen[] = [];
let respond: (s: Seen) => { status: number; json: unknown } = () => ({ status: 500, json: {} });
const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const s = { url, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
  seen.push(s);
  const r = respond(s);
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;
globalThis.fetch = fake;

const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS", name); }
  catch (e) { results.push({ name, ok: false }); console.log("FAIL", name, "\n ", e instanceof Error ? e.message : e); }
}

const SONNET = { provider: "anthropic" as const, model: "claude-sonnet-5-5" };
const HAIKU = { provider: "anthropic" as const, model: "claude-haiku-5-5" };
const reply = (content: unknown[], extra: Record<string, unknown> = {}) => ({ id: "msg_fake", model: "claude-sonnet-5-5", stop_reason: "tool_use", content, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 }, ...extra });

async function main() {
  const P = await import("@/lib/ai/providers");
  const H = await import("@/lib/rag2/loop/hosted-model");
  const tools = [{ name: "final_answer", description: "d", parameters: { type: "object", properties: { sentences: { type: "array" } } } }];
  const input = { messages: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "What does my policy cover?" }], tools, maxOutputTokens: 2000 };

  await check("P1 MODEL_PRESET=anthropic: chat and judgement run on Claude Sonnet 5.5, reading and narration on Claude Haiku 5.5, each priced", () => {
    assert.deepEqual(P.modelFor("chat"), SONNET); assert.deepEqual(P.modelFor("judgement"), SONNET);
    assert.deepEqual(P.modelFor("reading"), HAIKU); assert.deepEqual(P.modelFor("narration"), HAIKU);
    assert.deepEqual(P.priceFor(SONNET), { input: 2, output: 10, cachedInput: 0.2 });
    assert.deepEqual(P.priceFor(HAIKU), { input: 0.1, output: 0.5, cachedInput: 0.01 });
  });
  await check("P2 the preset is only a default: CHAT_MODEL still wins, and without ANTHROPIC_API_KEY the preset is not used", () => {
    process.env.CHAT_MODEL = "anthropic:claude-opus-5-5";
    try { assert.deepEqual(P.modelFor("chat"), { provider: "anthropic", model: "claude-opus-5-5" }); } finally { delete process.env.CHAT_MODEL; }
    delete process.env.ANTHROPIC_API_KEY;
    try { assert.notEqual(P.modelFor("chat").provider, "anthropic"); } finally { process.env.ANTHROPIC_API_KEY = "dummy-not-a-key"; }
  });

  await check("L1 loop request on Claude Sonnet 5.5: no temperature, tool_choice auto, adaptive thinking at low effort with drop_block", () => {
    const req = H.anthropicRequest("claude-sonnet-5-5", input) as any;
    assert.ok(!("temperature" in req)); assert.deepEqual(req.tool_choice, { type: "auto" });
    assert.deepEqual(req.thinking, { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    assert.deepEqual(req.output_config, { effort: "low" }); assert.equal(req.max_tokens, 2000);
    assert.equal(req.system, "s"); assert.equal(req.tools[0].input_schema.type, "object");
    assert.doesNotMatch(JSON.stringify(req), /"disabled"|budget_tokens|top_p|top_k/);
  });
  await check("L2 negative control: a model with no rules on file keeps the earlier request (temperature 0, forced tool use)", () => {
    const req = H.anthropicRequest("claude-x", input) as any;
    assert.equal(req.temperature, 0); assert.deepEqual(req.tool_choice, { type: "any" }); assert.ok(!("thinking" in req));
  });
  await check("L3 the run record's settings say what is sent (loopRequestSettings)", () => {
    const s = H.loopRequestSettings("anthropic", "claude-sonnet-5-5", 2000);
    assert.ok(!("temperature" in s)); assert.deepEqual(s.tool_choice, { type: "auto" }); assert.equal(s.max_tokens, 2000);
    assert.ok(!("messages" in s) && !("tools" in s) && !("system" in s));
  });
  await check("L4 a refusal is an error for the turn, not an empty reply the loop would pay to re-prompt", () => {
    assert.throws(() => H.anthropicReply(reply([], { stop_reason: "refusal" })), /refusal/);
  });

  await check("L5 two steps of one turn: the beta header is sent, and step 2 replays step 1's thinking, text and tool_use blocks unchanged and in order", async () => {
    seen = [];
    const step1 = [{ type: "thinking", thinking: "", signature: "sig-1" }, { type: "text", text: "Looking it up." }, { type: "tool_use", id: "tu_1", name: "final_answer", input: { sentences: [] } }];
    respond = () => ({ status: 200, json: reply(step1) });
    const m = new H.HostedLoopModel(SONNET, fake);
    const out = await m.next(input);
    assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(seen[0].headers["anthropic-beta"], "thinking-binding-controls-2026-08-01");
    assert.equal(seen[0].headers["x-api-key"], "dummy-not-a-key");
    assert.deepEqual(out.toolCalls, [{ id: "tu_1", name: "final_answer", arguments: { sentences: [] } }]);
    assert.equal(out.modelId, "anthropic:claude-sonnet-5-5"); assert.deepEqual(out.usage, { input: 100, output: 20, cached: 0 });
    // the loop appends exactly what lib/rag2/loop/loop.ts appends
    const messages = [...input.messages, { role: "assistant" as const, content: out.text, toolCalls: out.toolCalls, ...(out.providerContent ? { providerContent: out.providerContent } : {}) },
      { role: "tool" as const, toolCallId: "tu_1", name: "final_answer", content: "{\"ok\":false}" }];
    respond = () => ({ status: 200, json: reply([{ type: "tool_use", id: "tu_2", name: "final_answer", input: { sentences: [] } }]) });
    await m.next({ ...input, messages });
    const sent = seen[1].body;
    assert.deepEqual(sent.messages[1], { role: "assistant", content: step1 });
    assert.deepEqual(sent.messages[2].content, [{ type: "tool_result", tool_use_id: "tu_1", content: "{\"ok\":false}" }]);
  });
  await check("L6 an assistant step with no provider blocks (an earlier turn's saved text) is still rebuilt from its text", () => {
    const req = H.anthropicRequest("claude-sonnet-5-5", { ...input, messages: [...input.messages, { role: "assistant" as const, content: "Earlier answer." }, { role: "user" as const, content: "And now?" }] }) as any;
    assert.deepEqual(req.messages[1], { role: "assistant", content: [{ type: "text", text: "Earlier answer." }] });
  });

  await check("S1 one JSON reply on Claude Sonnet 5.5 (judgement): no temperature, thinking between_tools, no beta header; thinking blocks are not read as the answer", async () => {
    seen = [];
    respond = () => ({ status: 200, json: reply([{ type: "thinking", thinking: "progress", signature: "s" }, { type: "text", text: "```json\n{\"ok\":true}\n```" }], { stop_reason: "end_turn" }) });
    const r = await P.hostedStructuredCompletion(SONNET, { system: "S", user: "U", jsonSchema: { type: "object" }, temperature: 0, maxOutputTokens: 1200 });
    const b = seen[0].body;
    assert.ok(!("temperature" in b)); assert.deepEqual(b.thinking, { type: "between_tools" }); assert.deepEqual(b.output_config, { effort: "medium" });
    assert.ok(!("anthropic-beta" in seen[0].headers)); assert.equal(r.content, "{\"ok\":true}"); assert.equal(r.truncated, false);
  });
  await check("S2 one JSON reply on Claude Haiku 5.5 (reading, narration): no temperature, thinking disabled", async () => {
    seen = [];
    respond = () => ({ status: 200, json: reply([{ type: "text", text: "{}" }], { model: "claude-haiku-5-5", stop_reason: "end_turn" }) });
    await P.hostedStructuredCompletion(HAIKU, { system: "S", user: "U", jsonSchema: { type: "object" }, temperature: 0.3, maxOutputTokens: 450 });
    assert.ok(!("temperature" in seen[0].body)); assert.deepEqual(seen[0].body.thinking, { type: "disabled" }); assert.equal(seen[0].body.max_tokens, 450);
  });
  await check("S3 a refused JSON call fails with a clear error instead of returning empty content", async () => {
    respond = () => ({ status: 200, json: reply([], { stop_reason: "refusal" }) });
    await assert.rejects(P.hostedStructuredCompletion(SONNET, { system: "S", user: "U", jsonSchema: {} }), /declined.*refusal/);
  });
  await check("S4 scanned pages read by Claude Haiku 5.5: a PDF document block, no temperature, thinking disabled", async () => {
    seen = [];
    respond = () => ({ status: 200, json: reply([{ type: "text", text: "Page text" }], { model: "claude-haiku-5-5", stop_reason: "end_turn" }) });
    const r = await P.hostedDocumentToText(HAIKU, { system: "S", user: "U", pdfBase64: "QUJD", maxOutputTokens: 100 });
    const b = seen[0].body;
    assert.equal(b.messages[0].content[0].type, "document"); assert.ok(!("temperature" in b)); assert.deepEqual(b.thinking, { type: "disabled" });
    assert.equal(r.text, "Page text"); assert.deepEqual(r.servedBy, HAIKU);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nclaude:provider-test ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
