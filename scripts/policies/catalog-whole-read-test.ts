/** A catalogue reading cut at its output bound (catalog_building replies stopped at 700 and 900 tokens, and the JSON repair
 * kept only the benefits before the cut) is read again with more room; a reading still cut is used for what it holds, the
 * page is treated as not fully read (earlier rows kept), and it is never cached. The cache key names the whole-reading
 * rule, so a cut reply cached before is not reused. The condition reading (condition_catalog_extraction) follows the same
 * rule. Pure logic: no database, network or model.
 *   npm run -s policies:catalog-whole-read-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { readWhole, CutReading, CATALOG_BUDGETS, boundedCall, quoteKey } = await import("@/lib/policies/catalog-builder");
  const { TruncatedModelOutput } = await import("@/lib/ai/llm");
  await test("W1 a reply not cut is read once, at the first budget", async () => {
    const asked: number[] = [];
    const v = await readWhole(async (b) => { asked.push(b); return { value: "all", cut: false }; });
    assert.equal(v, "all"); assert.deepEqual(asked, [CATALOG_BUDGETS[0]]);
  });
  await test("W2 a reply cut at the first budget is read again with more room", async () => {
    const asked: number[] = [];
    const v = await readWhole(async (b) => { asked.push(b); return { value: b === CATALOG_BUDGETS[0] ? "half" : "all", cut: b === CATALOG_BUDGETS[0] }; });
    assert.equal(v, "all"); assert.deepEqual(asked, CATALOG_BUDGETS);
  });
  await test("W3 a reply cut at every budget is thrown as CutReading holding the last reading", async () => {
    await assert.rejects(readWhole(async (b) => ({ value: `part@${b}`, cut: true })), (e: unknown) => e instanceof CutReading && (e as InstanceType<typeof CutReading>).partial === `part@${CATALOG_BUDGETS.at(-1)}`);
  });
  await test("W4 the budgets give more room than the old bounds (700 page, 900 categorise), and grow", () => {
    assert.ok(CATALOG_BUDGETS[0] > 900); assert.ok(CATALOG_BUDGETS.every((b, i) => i === 0 || b > CATALOG_BUDGETS[i - 1]));
  });
  await test("W5 an error from the model is not swallowed", async () => {
    await assert.rejects(readWhole(async () => { throw new Error("provider 500"); }), /provider 500/);
  });
  // G1: the cut comes from the reply itself, never from provenance being stored; a reply never reported counts as cut.
  await test("B1 a reply reported whole is not cut", async () => {
    assert.deepEqual(await boundedCall(async (onReply) => { onReply({ truncated: false, finishReason: "end_turn" }); return "v"; }, "e"), { value: "v", cut: false });
  });
  await test("B2 a reply reported cut (flag or finish reason) is cut", async () => {
    assert.equal((await boundedCall(async (onReply) => { onReply({ truncated: true, finishReason: null }); return "v"; }, "e")).cut, true);
    for (const r of ["max_tokens", "length", "MAX_TOKENS"]) assert.equal((await boundedCall(async (onReply) => { onReply({ truncated: false, finishReason: r }); return "v"; }, "e")).cut, true, r);
  });
  await test("B3 a reply never reported (no provenance, no callback) is taken as cut (Critic #419 G1)", async () => {
    assert.deepEqual(await boundedCall(async () => "v", "e"), { value: "v", cut: true });
  });
  await test("B4 a cut reply that could not be repaired is an empty cut reading, so the larger bound is tried (G2)", async () => {
    assert.deepEqual(await boundedCall(async () => { throw new TruncatedModelOutput("cut", "{\"benefits\":[{\"na", true); }, "e"), { value: "e", cut: true });
    const asked: number[] = [];
    const v = await readWhole((b) => { asked.push(b); return boundedCall(async (onReply) => { if (b === CATALOG_BUDGETS[0]) throw new TruncatedModelOutput("cut", "", true); onReply({ truncated: false, finishReason: "end_turn" }); return "all"; }, "none"); });
    assert.equal(v, "all"); assert.deepEqual(asked, CATALOG_BUDGETS);
  });
  await test("B5 a reply that is not cut but does not match the structure still fails as before", async () => {
    await assert.rejects(boundedCall(async () => { throw new TruncatedModelOutput("shape", "{}", false); }, "e"), TruncatedModelOutput);
    await assert.rejects(boundedCall(async () => { throw new Error("provider 500"); }, "e"), /provider 500/);
  });
  // G3: an earlier row of the same printed quote on the same page is the same benefit under another name.
  await test("Q1 one printed row read under two names shares its quote key; another page or quote does not", () => {
    assert.equal(quoteKey("Outpatient  benefit\tS$1,000", 3), quoteKey("outpatient benefit S$1,000", 3));
    assert.notEqual(quoteKey("Outpatient benefit S$1,000", 3), quoteKey("Outpatient benefit S$1,000", 4));
    assert.equal(quoteKey("", 3), null); assert.equal(quoteKey("x", null), null);
  });
  // The call sites: both catalogue readings go through readWhole with the bound per attempt, report the finish reason, and
  // cache under a key that names the whole-reading rule; a CutReading is used for its partial result.
  const src = readFileSync("lib/policies/catalog-builder.ts", "utf8");
  await test("S1 no catalogue call keeps a fixed 700 or 900 output bound", () => {
    assert.ok(!/maxOutputTokens:\s*(?:700|900)\b/.test(src));
    assert.equal((src.match(/maxOutputTokens:budget/g) ?? []).length, 2);
  });
  await test("S2 both caches name the whole-reading rule", () => {
    assert.match(src, /"catalog_page",\{modelPayload,prompt:SYSTEM,whole:true\}/);
    assert.match(src, /"catalog_categorise",\{payload,prompt:CATEGORISE_SYSTEM,whole:true\}/);
  });
  await test("S3 a page still cut keeps its partial benefits and is treated as not fully read", () => {
    assert.match(src, /error instanceof CutReading\)\{extraction=error\.partial[^}]*failedPages\.add\(page\.page_number\)/);
  });
  await test("S4 the cut is read from the call's own finish reason", () => {
    assert.match(readFileSync("lib/ai/whole-reading.ts", "utf8"), /OUTPUT_CUT=\/\^\(\?:max_tokens\|length\|MAX_TOKENS\)\$\//);
    assert.equal((src.match(/boundedCall\(\(onReply\)=>structuredCompletion\(\{onReply,/g) ?? []).length, 2);
    assert.ok(!/onExecutionRecord/.test(src), "the cut must not depend on provenance");
    assert.match(src, /!quoted\.has\(quoteKey\(b\.quote,b\.sourcePage\)/);
  });

  const cond = readFileSync("lib/policies/condition-catalog.ts", "utf8");
  await test("C1 the condition reading is read whole too: per-attempt bound, reply-reported cut, whole-rule cache key, partial kept when still cut", () => {
    assert.ok(!/maxOutputTokens:\s*900\b/.test(cond));
    assert.match(cond, /readWhole\(\(budget\)=>boundedCall\(\(onReply\)=>structuredCompletion\(\{onReply,/);
    assert.match(cond, /maxOutputTokens:budget/);
    assert.match(cond, /"condition_page",\{payload,prompt:SYSTEM,whole:true\}/);
    assert.match(cond, /error instanceof CutReading\)extraction=error\.partial/);
  });
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`catalog-whole-read: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
