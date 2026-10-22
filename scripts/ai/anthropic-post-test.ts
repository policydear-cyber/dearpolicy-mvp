/** Offline test of anthropicPost (lib/ai/providers.ts): a model that rejects `temperature` with a 400 naming it is asked
 * once more without it, and is then never sent it again; any other 400 is returned as it is.
 *   npm run ai:anthropic-post-test */
import assert from "node:assert/strict";
import { anthropicPost } from "@/lib/ai/providers";

async function main() {
  const sent: Record<string, unknown>[] = [];
  const api = (reject: RegExp | null) => async (json: string) => {
    const body = JSON.parse(json) as Record<string, unknown>; sent.push(body);
    if (reject && "temperature" in body) return new Response(JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }), { status: 400 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  let r = await anthropicPost("claude-sonnet-5", { model: "claude-sonnet-5", temperature: 0 }, api(/temperature/));
  assert.equal(r.status, 200);
  assert.deepEqual(sent.map((b) => "temperature" in b), [true, false], "asked again once, without temperature");
  sent.length = 0;
  r = await anthropicPost("claude-sonnet-5", { model: "claude-sonnet-5", temperature: 0 }, api(/temperature/));
  assert.deepEqual(sent.map((b) => "temperature" in b), [false], "remembered for that model");
  sent.length = 0;
  r = await anthropicPost("claude-haiku-4-5", { model: "claude-haiku-4-5", temperature: 0 }, api(null));
  assert.deepEqual(sent.map((b) => b.temperature), [0], "a model that takes temperature still gets it");
  sent.length = 0;
  r = await anthropicPost("claude-x", { model: "claude-x", temperature: 0 }, async (json) => { sent.push(JSON.parse(json)); return new Response("max_tokens too large", { status: 400 }); });
  assert.equal(r.status, 400); assert.equal(sent.length, 1, "another 400 is not retried");
  assert.equal(await r.text(), "max_tokens too large", "its body can still be read");
  console.log("anthropic post: 4 passed, 0 failed");
}
main().catch((e) => { console.error(e); process.exit(1); });
