/**
 * Tests of the courier (scripts/rag2-live/courier.ts + courier_workbench.py) with a FAKE proxy_execute: no model, no credential, no spend.
 *   - the delta rebuilds the exact body (TS hunks applied in Python, UTF-16 offsets, non-ASCII text)
 *   - a corrupted payload or response is refused by checksum
 *   - the cap refuses a call whose worst case would pass it
 *   - a model other than the allowed one, streaming and an over-large output ceiling are refused
 *   - replay: a recorded response is replayed, an unrecorded request is recorded and fails at once (401), a changed request is a divergence
 *   node --import tsx scripts/rag2-live/courier-regressions.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CourierStore, appendJsonl, applyHunks, diffHunks, preparePayload, replayFetch, reserveUsd, sha256, tokenize } from "./courier";

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? "\n     " + detail.slice(0, 600) : ""}`); };

const sys = (state: string) => `You are the assistant.\nRules: answer from the documents.\nSecond rule “quoted” – S$600,000.\n\nConversation state:${state}`;
const body = (state: string, msgs: unknown[], model = "gpt-6-luna", extra: Record<string, unknown> = {}) => JSON.stringify({ model, temperature: 0, max_completion_tokens: 1200, tool_choice: "required", parallel_tool_calls: true, ...extra, messages: [{ role: "system", content: sys(state) }, ...msgs], tools: [{ type: "function", function: { name: "final_answer", description: "x\ny", parameters: { type: "object" } } }] });

// ---- delta
const b1 = body("\nnone", [{ role: "user", content: "grace fell down and broke her arm" }]);
const b2 = body("\nsubject: Grace", [{ role: "user", content: "grace fell down and broke her arm" }, { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "resolve_person", arguments: "{\"mention\":\"grace\"}" } }] }, { role: "tool", tool_call_id: "call_1", content: "{\"ok\":true,\"names\":[\"Tan Hui Min Grace\"]}" }]);
const h = diffHunks(b1, b2);
ok("tokenize is a partition", tokenize(b2).join("") === b2);
ok("diffHunks rebuilds the next body exactly", applyHunks(b1, h) === b2);
ok("the delta is smaller than the body", JSON.stringify(h).length < b2.length * 0.8, `${JSON.stringify(h).length} vs ${b2.length}`);

// ---- replay
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "courier-"));
let store = new CourierStore(dir);
let tag = "A/K1";
const r1 = replayFetch(store, () => tag, () => "A");
(async () => {
  const res0 = await r1.fetch("http://x/chat/completions", { method: "POST", body: b1 });
  ok("an unrecorded request fails at once with 401 and is recorded", res0.status === 401 && store.pending().length === 1 && r1.stats.pending[0] === "A/K1#0");
  tag = "A/K1"; const res1 = await r1.fetch("http://x/chat/completions", { method: "POST", body: b2 });
  ok("the second request of the conversation is recorded under the next ordinal", res1.status === 401 && store.requests.has("A/K1#1"));

  // ---- the payload, the python side, the apply
  const payload = preparePayload(store, 0.25);
  ok("payload has both items; the second is a delta against the first", payload.items.length === 2 && !!payload.items[1].hunks && payload.items[1].base === sha256(b1), JSON.stringify(payload.items.map((i) => [i.key, !!i.full, !!i.hunks])));
  for (const it of payload.items) appendJsonl(store.sentFile, { sha: it.sha });
  const work = path.join(dir, "py"); fs.mkdirSync(work);
  const runPy = (payloadObj: unknown, extra = "") => {
    fs.writeFileSync(path.join(work, "payload.json"), JSON.stringify(payloadObj));
    fs.writeFileSync(path.join(work, "run.py"), `
import json
CALLS = []
def proxy_execute(method, endpoint, toolkit, body=None, **kw):
    CALLS.append((method, endpoint, toolkit, body.get("model")))
    return ({"data": {"id": "chatcmpl-test", "model": "gpt-6-luna-2026", "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": [{"id": "call_a", "type": "function", "function": {"name": "final_answer", "arguments": "{\\"sentences\\":[]}"}}]}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 1000, "completion_tokens": 50}}}, "")
exec(open(${JSON.stringify(path.resolve("scripts/rag2-live/courier_workbench.py"))}).read())
COURIER_LOG = ${JSON.stringify(path.join(work, "log.jsonl"))}
${extra}
courier_run(open(${JSON.stringify(path.join(work, "payload.json"))}).read(), workers=1)
print("# calls", len(CALLS), CALLS)
`);
    return execFileSync("python3", ["-I", path.join(work, "run.py")], { encoding: "utf8" });
  };
  const out = runPy(payload);
  const lines = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  ok("python rebuilt both bodies, called the model twice and returned status 200 with matching req_sha", lines.length === 2 && lines.every((l) => l.status === 200) && lines[0].req_sha === sha256(b1) && lines[1].req_sha === sha256(b2), out.slice(0, 600));
  ok("the response line's checksum is the checksum of its text", lines.every((l) => sha256(l.response) === l.resp_sha));

  const apply = (ls: unknown[]) => { try { return { code: 0, out: execFileSync("node", ["--import", "tsx", "scripts/rag2-live/courier.ts", "apply", dir], { input: ls.map((l) => JSON.stringify(l)).join("\n"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) }; } catch (e: any) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
  const bad = { ...lines[0], response: lines[0].response.replace("final_answer", "final_answer ") };
  const a0 = apply([bad]);
  ok("a response transcribed wrongly is refused by checksum", a0.code === 1 && /CHECKSUM MISMATCH/.test(a0.out), a0.out);
  const a1 = apply(lines);
  store.reload();
  ok("verified responses are recorded and nothing is pending", a1.code === 0 && store.pending().length === 0 && store.responses.size === 2, a1.out);
  ok("spend is computed from the usage the response reports (1000 in, 50 out, twice)", Math.abs(store.spentUsd() - 2 * (1000 * 0.10 + 50 * 0.50) / 1e6) < 1e-12, String(store.spentUsd()));

  // ---- replay of a recorded response, and divergence
  const r2 = replayFetch(store, () => "A/K1", () => "A");
  const p0 = await r2.fetch("http://x", { method: "POST", body: b1 });
  const j0 = await p0.json();
  ok("a recorded response is replayed as recorded", p0.status === 200 && j0.choices[0].message.tool_calls[0].function.name === "final_answer" && r2.stats.replayed === 1);
  const p1 = await r2.fetch("http://x", { method: "POST", body: b2 + " " });
  ok("a request that differs from the recorded one is a divergence (409), never a silent re-ask", p1.status === 409 && r2.stats.diverged.length === 1);

  // ---- guards in python
  const corrupt = { ...payload, items: [{ ...payload.items[0], sha: "0".repeat(64) }] };
  ok("a corrupted request is refused by checksum before any call", /checksum mismatch/.test(runPy(corrupt)) && /# calls 0/.test(runPy(corrupt)));
  const mk = (x: string) => ({ cap: 0.25, items: [{ key: "K#0", sha: sha256(x), full: x }] });
  ok("another model is refused", /not allowed/.test(runPy(mk(body("\n", [{ role: "user", content: "x" }], "gpt-5")))));
  ok("streaming is refused", /streaming/.test(runPy(mk(body("\n", [{ role: "user", content: "x" }], "gpt-6-luna", { stream: true })))));
  ok("an output ceiling above 2000 is refused", /output ceiling/.test(runPy(mk(body("\n", [{ role: "user", content: "x" }], "gpt-6-luna", { max_completion_tokens: 5000 })))));
  const capOut = runPy({ cap: 0.0001, items: [{ key: "K#0", sha: sha256(b1), full: b1 }] });
  ok("a call whose worst case would pass the cap is refused (429) and not made", /run cap/.test(capOut) && /# calls 0/.test(capOut), capOut);
  ok("the sandbox and workbench reserve alike (about 2.5 characters a token)", Math.abs(reserveUsd(b1) - (Math.ceil(b1.length / 2.5) * 0.10 + 1200 * 0.50) / 1e6) < 1e-12);

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
