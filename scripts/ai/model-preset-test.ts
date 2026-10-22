/** Offline test of modelFor / fallbackModelFor under MODEL_PRESET (lib/ai/providers.ts): with the anthropic preset, a
 * per-job setting left over from another provider is ignored, an Anthropic one still picks the model, and the other
 * presets keep "explicit settings win". No key is read or printed: placeholder values only.
 *   npm run ai:model-preset-test */
import assert from "node:assert/strict";
import { fallbackModelFor, modelFor } from "@/lib/ai/providers";
import { canaryConfigFor } from "@/lib/ai/rollout";
import { DEFAULT_SIMPLE_MODEL, simpleChatModel } from "@/lib/simple-chat/flag";

const NAMES = ["MODEL_PRESET", "READING_MODEL", "JUDGEMENT_MODEL", "NARRATION_MODEL", "CHAT_MODEL", "JUDGEMENT_FALLBACK_MODEL",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "READING_MODEL_PROVIDER"];
function withEnv(env: Record<string, string>, run: () => void) {
  const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  Object.assign(process.env, env);
  try { run(); } finally { for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
}
const keys = { ANTHROPIC_API_KEY: "placeholder", OPENAI_API_KEY: "placeholder", GEMINI_API_KEY: "placeholder" };
// Production on 22 Oct: the preset set, old OpenAI per-job settings and a Gemini fallback still present.
const leftovers = { READING_MODEL: "openai:gpt-6-luna", JUDGEMENT_MODEL: "openai:gpt-6-luna", NARRATION_MODEL: "openai:gpt-6-luna",
  JUDGEMENT_FALLBACK_MODEL: "gemini:flash-lite", CHAT_MODEL: "anthropic:claude-sonnet-5-5" };
const env = (vars: Record<string, string>) => ({ NODE_ENV: "test", ...vars }) as NodeJS.ProcessEnv;
let n = 0;
const t = (name: string, run: () => void) => { run(); n++; console.log("ok", name); };

t("anthropic preset ignores OpenAI and Google per-job settings", () => withEnv({ ...keys, ...leftovers, MODEL_PRESET: "anthropic" }, () => {
  assert.deepEqual(modelFor("reading"), { provider: "anthropic", model: "claude-haiku-4-5" });
  assert.deepEqual(modelFor("judgement"), { provider: "anthropic", model: "claude-sonnet-5" });
  assert.deepEqual(modelFor("narration"), { provider: "anthropic", model: "claude-haiku-4-5" });
  assert.equal(fallbackModelFor("judgement"), null);
}));
t("anthropic preset keeps an Anthropic per-job setting", () => withEnv({ ...keys, ...leftovers, MODEL_PRESET: "anthropic", READING_MODEL: "anthropic:claude-sonnet-5-5" }, () => {
  assert.deepEqual(modelFor("reading"), { provider: "anthropic", model: "claude-sonnet-5-5" });
  assert.deepEqual(modelFor("chat"), { provider: "anthropic", model: "claude-sonnet-5-5" });
}));
t("anthropic preset: an OpenAI chat setting falls to the preset's judgement model", () => withEnv({ ...keys, MODEL_PRESET: "anthropic", CHAT_MODEL: "openai:gpt-6-luna" }, () => {
  assert.deepEqual(modelFor("chat"), { provider: "anthropic", model: "claude-sonnet-5" });
}));
t("other presets: explicit settings still win", () => withEnv({ ...keys, ...leftovers, MODEL_PRESET: "gemini" }, () => {
  assert.deepEqual(modelFor("reading"), { provider: "openai", model: "gpt-6-luna" });
  assert.deepEqual(fallbackModelFor("judgement"), { provider: "gemini", model: "flash-lite" });
}));
t("no preset: explicit settings still win", () => withEnv({ ...keys, ...leftovers }, () => {
  assert.deepEqual(modelFor("judgement"), { provider: "openai", model: "gpt-6-luna" });
}));
t("anthropic preset: the alpha chat ignores an OpenAI DEARPOLICY_SIMPLE_CHAT_MODEL", () => {
  assert.deepEqual(simpleChatModel(env({ MODEL_PRESET: "anthropic", DEARPOLICY_SIMPLE_CHAT_MODEL: "openai:gpt-6-luna" })), DEFAULT_SIMPLE_MODEL);
  assert.deepEqual(simpleChatModel(env({ MODEL_PRESET: "anthropic", DEARPOLICY_SIMPLE_CHAT_MODEL: "anthropic:claude-opus-5-5" })), { provider: "anthropic", model: "claude-opus-5-5" });
  assert.deepEqual(simpleChatModel(env({ DEARPOLICY_SIMPLE_CHAT_MODEL: "openai:gpt-6-luna" })), { provider: "openai", model: "gpt-6-luna" });
});
t("anthropic preset: a canary naming another provider is off", () => {
  const canary = { CANARY_BENEFIT_EXTRACTION_MODEL: "openai:gpt-6-luna", CANARY_BENEFIT_EXTRACTION_PERCENTAGE: "100" };
  assert.equal(canaryConfigFor("benefit_extraction", env({ ...canary, MODEL_PRESET: "anthropic" })), null);
  assert.deepEqual(canaryConfigFor("benefit_extraction", env({ MODEL_PRESET: "anthropic", CANARY_BENEFIT_EXTRACTION_MODEL: "anthropic:claude-haiku-4-5" }))?.canary, { provider: "anthropic", model: "claude-haiku-4-5" });
  assert.deepEqual(canaryConfigFor("benefit_extraction", env({ ...canary, MODEL_PRESET: "gemini" }))?.canary, { provider: "openai", model: "gpt-6-luna" });
});
console.log(`model preset: ${n} passed, 0 failed`);
