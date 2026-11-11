/** A catalogue reading cut at its output bound (catalog_building replies stopped at 700 and 900 tokens, and the JSON repair
 * kept only the benefits before the cut) is read again with more room; a reading still cut is used for what it holds, the
 * page is treated as not fully read (earlier rows kept), and it is never cached. The cache key names the whole-reading
 * rule, so a cut reply cached before is not reused. Pure logic: no database, network or model.
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
  const { readWhole, CutReading, CATALOG_BUDGETS } = await import("@/lib/policies/catalog-builder");
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
    assert.match(src, /OUTPUT_CUT=\/\^\(\?:max_tokens\|length\|MAX_TOKENS\)\$\//);
    assert.equal((src.match(/boundedCall\(\(onExecutionRecord\)=>structuredCompletion\(\{onExecutionRecord,/g) ?? []).length, 2);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`catalog-whole-read: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
