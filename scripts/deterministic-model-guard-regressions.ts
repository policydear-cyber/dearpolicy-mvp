/**
 * The deterministic model stand-in (lib/ai/deterministic-model.ts) can run
 * only in a synthetic, non-production, non-Vercel test process -- and a
 * production server refuses to start if its flag is present at all.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { deterministicModelEnabled, deterministicStructuredCompletion, deterministicInterpretation, DeterministicModelUnavailableError } from "@/lib/ai/deterministic-model";
import { checkDeterministicModelNotInProduction } from "@/lib/launch/guards";

let cases = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }
const dev = { NODE_ENV: "development", DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "123" } as unknown as NodeJS.ProcessEnv;

async function main() {
  await t("positive control: enabled only for a synthetic, non-production test process", () => {
    assert.equal(deterministicModelEnabled(dev), true);
  });
  await t("every exact blocker disables it", () => {
    for (const [label, env] of [
      ["flag absent", { ...dev, DEARPOLICY_DETERMINISTIC_MODEL: undefined }],
      ["wrong flag value", { ...dev, DEARPOLICY_DETERMINISTIC_MODEL: "true" }],
      ["NODE_ENV=production", { ...dev, NODE_ENV: "production" }],
      ["on Vercel", { ...dev, VERCEL: "1" }],
      ["a Vercel environment", { ...dev, VERCEL_ENV: "preview" }],
      ["no synthetic run id", { ...dev, E2E_RUN_ID: "" }],
    ] as const) assert.equal(deterministicModelEnabled(env as unknown as NodeJS.ProcessEnv), false, label);
  });
  await t("a production or Vercel server refuses to start with the flag present; without it (control) it passes", () => {
    assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "production", DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e" } as unknown as NodeJS.ProcessEnv).ok, false);
    assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "production", DEARPOLICY_DETERMINISTIC_MODEL: "anything" } as unknown as NodeJS.ProcessEnv).ok, false);
    assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "development", VERCEL_ENV: "preview", DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e" } as unknown as NodeJS.ProcessEnv).ok, false);
    assert.equal(checkDeterministicModelNotInProduction({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).ok, true);
    assert.equal(checkDeterministicModelNotInProduction(dev).ok, true);
  });
  await t("interpretation is deterministic and extracts facts, never figures", () => {
    const input = { currentMessage: "I was diagnosed with stage 2 breast cancer. How much can I claim? The bill was S$4,000.", subjects: [{ id: "s1" }] };
    const a = deterministicInterpretation(input), b = deterministicInterpretation(input);
    assert.deepEqual(a, b);
    assert.equal(a.intent, "claim");
    assert.ok(a.facts.some((f) => f.key === "diagnosis"));
    assert.ok(!a.facts.some((f) => typeof f.value === "number"), "no amount becomes a fact value");
  });
  await t("narration hands back the given summary; reading returns nothing; anything else is unavailable", async () => {
    const schema = z.object({ summary: z.string(), details: z.array(z.string()) });
    const out = await deterministicStructuredCompletion({ system: "Explain", user: JSON.stringify({ summary: "Preliminary claim assessment." }), schema, operation: "chat_reply" });
    assert.deepEqual(out, { summary: "Preliminary claim assessment.", details: [] });
    await assert.rejects(deterministicStructuredCompletion({ system: "x", user: "{}", schema, operation: "policy_extraction" }), DeterministicModelUnavailableError);
  });
  await t("the stand-in is reachable from exactly one call site, behind the guard", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
    const users = [...walk("lib"), ...walk("app")].filter((f) => !f.endsWith("deterministic-model.ts") && /from ["'][^"']*deterministic-model["']/.test(readFileSync(f, "utf8")));
    assert.deepEqual(users.map((f) => f.split(path.sep).join("/")), ["lib/ai/llm.ts"]);
    assert.match(readFileSync("lib/ai/llm.ts", "utf8"), /if \(deterministicModelEnabled\(\)\) return deterministicStructuredCompletion\(/);
  });
  console.log(`deterministic-model guard regressions passed: ${cases} cases`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
