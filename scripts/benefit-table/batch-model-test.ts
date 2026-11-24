/** Scripted tests for the offline batch path (lib/benefit-table/batch-model.ts): fake Anthropic batch client, no network,
 * no paid call. Also guards that the app never imports the batch path (live chat, upload and Read again stay live).
 *   npm run benefit-table:batch-test */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { batchedTableModel, replyFromBatchItem, scriptTableModel, type BatchClient, type BatchItem } from "@/lib/benefit-table/batch-model";
import { anthropicTableModel, tableRequest, type TableCall } from "@/lib/benefit-table/model";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
const choice = { provider: "anthropic", model: "claude-sonnet-5-5" } as never;
const call = (user: string): TableCall => ({ system: "Read the table.", user, schema: { type: "object" }, maxTokens: 100 });
const ok = (text: string, stop = "end_turn"): BatchItem["result"] => ({ type: "succeeded", message: { content: [{ type: "text", text }], stop_reason: stop, model: "claude-sonnet-5-5",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } } });

function fakeClient(answer: (params: any, i: number) => BatchItem["result"], pollsUntilEnded = 2) {
  const created: any[] = []; let polls = 0;
  const client: BatchClient = { messages: { batches: {
    create: async (p) => { created.push(p); return { id: "b" + created.length }; },
    retrieve: async (id) => ({ id, processing_status: ++polls > pollsUntilEnded ? "ended" : "in_progress" }),
    results: async (id) => { const p = created[Number(id.slice(1)) - 1]; return (async function* () { for (const [i, r] of (p.requests as any[]).entries()) yield { custom_id: r.custom_id, result: answer(r.params, i) } as BatchItem; })(); },
  } } };
  return { client, created, polls: () => polls };
}
const quick = { windowMs: 5, pollMs: 1, sleep: async () => {} };

async function main() {
await test("calls made together go in one batch, each gets its own answer, after polling until ended", async () => {
  const f = fakeClient((params) => ok(JSON.stringify({ echo: params.messages[0].content })));
  const m = batchedTableModel(choice, { ...quick, client: f.client });
  const [a, b] = await Promise.all([m.call(call("page 1")), m.call(call("page 2"))]);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].requests.length, 2);
  assert.deepEqual(a.json, { echo: "page 1" });
  assert.deepEqual(b.json, { echo: "page 2" });
  assert.ok(f.polls() >= 3, "waits for the batch to end");
  assert.deepEqual([a.input, a.output, a.cacheRead, a.cacheWrite], [10, 5, 7, 3]);
});
await test("the batched request is the live request (same prompt, schema, settings); only the cache time differs", () => {
  const f = fakeClient(() => ok("{}"));
  void batchedTableModel(choice, { ...quick, client: f.client }).call(call("x"));
  return new Promise<void>((resolve, reject) => setTimeout(() => { try {
    const sent = f.created[0].requests[0].params, live = tableRequest(choice, call("x"));
    assert.deepEqual({ ...sent, system: undefined }, { ...live, system: undefined });
    assert.equal(sent.system[0].text, live.system[0].text);
    assert.equal(sent.system[0].cache_control.ttl, "1h");
    assert.equal(live.system[0].cache_control.ttl, "5m");
    resolve();
  } catch (e) { reject(e); } }, 50));
});
await test("the live call still sends the request tableRequest builds", async () => {
  let sent: unknown;
  const client = { messages: { stream: (p: unknown) => { sent = p; return { finalMessage: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", model: "m", usage: {} }) }; } } };
  await anthropicTableModel(choice, client as never).call(call("x"));
  assert.deepEqual(sent, tableRequest(choice, call("x")));
});
await test("a failed item rejects only that call", async () => {
  const f = fakeClient((p, i) => (i === 1 ? { type: "errored", error: { type: "overloaded" } } : ok("{}")));
  const m = batchedTableModel(choice, { ...quick, client: f.client });
  const results = await Promise.allSettled([m.call(call("a")), m.call(call("b")), m.call(call("c"))]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});
await test("expired and canceled items throw; a cut-off answer has no json", () => {
  assert.throws(() => replyFromBatchItem({ custom_id: "r0", result: { type: "expired" } }, choice, 1), /expired/);
  assert.throws(() => replyFromBatchItem({ custom_id: "r0", result: { type: "canceled" } }, choice, 1), /canceled/);
  const r = replyFromBatchItem({ custom_id: "r0", result: ok('{"a":1}', "max_tokens") }, choice, 1);
  assert.equal(r.json, null); assert.equal(r.stopReason, "max_tokens");
});
await test("a missing result rejects instead of hanging; a batch that never ends rejects", async () => {
  const f = fakeClient(() => ok("{}"));
  f.client.messages.batches.results = async () => (async function* () {})();
  await assert.rejects(batchedTableModel(choice, { ...quick, client: f.client }).call(call("a")), /no result/);
  const g = fakeClient(() => ok("{}"), 1e9);
  await assert.rejects(batchedTableModel(choice, { ...quick, maxWaitMs: -1, client: g.client }).call(call("a")), /did not end/);
});
await test("large groups are split into several batches", async () => {
  const f = fakeClient(() => ok("{}"));
  const m = batchedTableModel(choice, { ...quick, maxPerBatch: 2, client: f.client });
  await Promise.all([1, 2, 3, 4, 5].map((n) => m.call(call("p" + n))));
  assert.deepEqual(f.created.map((c) => c.requests.length), [2, 2, 1]);
});
await test("scriptTableModel is live unless DEARPOLICY_SCRIPT_BATCH=1", () => {
  const live = scriptTableModel(choice, undefined, {}, {}), batched = scriptTableModel(choice, undefined, {}, { DEARPOLICY_SCRIPT_BATCH: "1" });
  assert.notEqual(live.call.toString(), batched.call.toString());
  assert.equal(scriptTableModel(choice, undefined, {}, { DEARPOLICY_SCRIPT_BATCH: "0" }).call.toString(), live.call.toString());
});
await test("no app code imports the batch path (live chat, upload and Read again stay live)", () => {
  const hits: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(name) && /batch-model["']/.test(readFileSync(p, "utf8"))) hits.push(p);
  } };
  for (const d of ["app", "lib", "components", "middleware.ts", "instrumentation.ts"]) { try { statSync(d).isDirectory() ? walk(d) : hits.push(...(/batch-model["']/.test(readFileSync(d, "utf8")) ? [d] : [])); } catch { /* absent */ } }
  assert.deepEqual(hits, []);
});

}
main().then(() => {
if (failures.length) { console.error(failures.join("\n\n")); console.error(`\n${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`${passed} passed`);
}, (e) => { console.error(e); process.exit(1); });
