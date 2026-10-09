/**
 * The owner's Codespaces trial: its safety checks, the persisted trial cap and the Codespaces host handling.
 * No network, no key, no database.   node --import tsx scripts/trial/trial-guard-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codespacesSameOrigin, PersistentTrialLedger, trialInternalOrigin, TRIAL_PREFLIGHT_REFUSAL, trialSafetyChecks } from "../../e2e/support/trial-guard";
import { installFetchGuard } from "../../e2e/support/rag2-live-fetch-guard";
import { checkRequestOrigin } from "@/lib/http/csrf";

const GOOD: Record<string, string> = {
  CODESPACES: "true", TRIAL_MODE: "1", NODE_ENV: "test", DATABASE_URL: "postgres://postgres:postgres@localhost:5432/dearpolicy_trial",
  OPENAI_API_KEY: "test-value-not-a-key", CHAT_MODEL: "openai:gpt-6-luna", JUDGEMENT_MODEL: "openai:gpt-6-luna", NARRATION_MODEL: "openai:gpt-6-luna", READING_MODEL: "openai:gpt-6-luna",
};
const CLEAR = ["VERCEL", "VERCEL_ENV", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "PINECONE_API_KEY", "VIRUSTOTAL_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL", "TRIAL_CAP_USD", "MODEL_PRESET"];
/** modelFor() reads process.env, so each case runs with process.env set to exactly that environment. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const k of CLEAR) delete process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
}
const refused = (env: Record<string, string | undefined>, why: RegExp) => assert.throws(() => withEnv(env, () => trialSafetyChecks(process.env)), why);

let n = 0;
async function t(name: string, fn: () => void | Promise<void>) { await fn(); n++; console.log("PASS " + name); }

async function main() {
  await t("T1 a Codespace in trial mode with a local database passes (live; cap 0.25 by default)", () => {
    const r = withEnv(GOOD, () => trialSafetyChecks(process.env));
    assert.equal(r.preflight, false); assert.equal(r.capUsd, 0.25); assert.equal(`${r.choice.provider}:${r.choice.model}`, "openai:gpt-6-luna");
  });
  await t("T2 no secret: preflight (the placeholder key), still allowed", () => assert.equal(withEnv({ ...GOOD, OPENAI_API_KEY: "preflight-no-key-set" }, () => trialSafetyChecks(process.env)).preflight, true));
  await t("T3 refused outside a Codespace (CODESPACES unset)", () => refused({ ...GOOD, CODESPACES: undefined }, /GitHub Codespace/));
  await t("T4 refused without TRIAL_MODE=1", () => refused({ ...GOOD, TRIAL_MODE: undefined }, /TRIAL_MODE/));
  await t("T5 refused with a non-local database", () => { refused({ ...GOOD, DATABASE_URL: "postgres://u:p@db.abcdefgh.supabase.co:5432/postgres" }, /local database/); refused({ ...GOOD, DATABASE_URL: undefined }, /local database/); });
  await t("T6 refused on Vercel", () => { refused({ ...GOOD, VERCEL: "1" }, /VERCEL/); refused({ ...GOOD, VERCEL_ENV: "preview" }, /VERCEL/); });
  await t("T7 refused with another base URL, another provider's key, Pinecone or the deterministic stand-in", () => {
    refused({ ...GOOD, OPENAI_BASE_URL: "https://proxy.example.com/v1" }, /OPENAI_BASE_URL/);
    for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "PINECONE_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL"]) refused({ ...GOOD, [k]: "x" }, new RegExp(k));
  });
  await t("T8 refused unless every role is openai:gpt-6-luna", () => { refused({ ...GOOD, READING_MODEL: "openai:gpt-5-mini" }, /READING_MODEL/); refused({ ...GOOD, CHAT_MODEL: undefined }, /CHAT_MODEL/); });
  await t("T9 the cap: > 0 and <= 1.00", () => { refused({ ...GOOD, TRIAL_CAP_USD: "5" }, /TRIAL_CAP_USD/); refused({ ...GOOD, TRIAL_CAP_USD: "0" }, /TRIAL_CAP_USD/); assert.equal(withEnv({ ...GOOD, TRIAL_CAP_USD: "0.10" }, () => trialSafetyChecks(process.env)).capUsd, 0.1); });
  await t("T10 refused without a key at all, or with NODE_ENV=production", () => { refused({ ...GOOD, OPENAI_API_KEY: undefined }, /OPENAI_API_KEY/); refused({ ...GOOD, NODE_ENV: "production" }, /NODE_ENV/); });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trial-ledger-"));
  const file = path.join(dir, "ledger.json");
  await t("T11 the trial ledger is persisted after every reservation and settlement, and survives a restart", () => {
    const a = new PersistentTrialLedger(file, 0.25);
    const r = a.reserve(0.01, 1000, 100); assert.ok(!("refused" in r));
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).inflightUsd, 0.01, "an open reservation is on disk");
    a.settle(r as any, 0.004);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(onDisk.spentUsd, 0.004); assert.equal(onDisk.inflightUsd, 0); assert.equal(onDisk.calls, 1);
    const b = new PersistentTrialLedger(file, 0.25);
    assert.equal(b.spentUsd, 0.004, "a restart keeps the spend"); assert.equal(b.state().restarts, 1);
    assert.ok(Math.abs(b.remainingUsd - 0.246) < 1e-9);
  });
  await t("T12 a reservation never settled (the process died mid-call) is counted as spent at the next start", () => {
    const a = new PersistentTrialLedger(file, 0.25);
    a.reserve(0.02, 1000, 100);
    const b = new PersistentTrialLedger(file, 0.25);
    assert.ok(Math.abs(b.spentUsd - 0.024) < 1e-9, String(b.spentUsd));
  });
  await t("T13 at the cap every model request is refused before it is sent (spend carried over from earlier runs)", async () => {
    fs.writeFileSync(file, JSON.stringify({ capUsd: 0.25, spentUsd: 0.2495, inflightUsd: 0, calls: 40, refusals: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), restarts: 3 }));
    const ledger = new PersistentTrialLedger(file, 0.25);
    let sent = 0;
    const target = { fetch: (async () => { sent++; return new Response("{}", { status: 200 }); }) as typeof fetch };
    const g = installFetchGuard({ ledger, env: {} as unknown as NodeJS.ProcessEnv, target });
    await assert.rejects(() => target.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-6-luna", max_completion_tokens: 2000, messages: [{ role: "user", content: "x".repeat(4000) }] }) }), /run cap/);
    assert.equal(sent, 0); assert.equal(g.calls[0].refused?.startsWith("run cap"), true);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).refusals, 1, "the refusal is persisted too");
  });
  await t("T14 preflight refuses every model request; other providers and Pinecone are refused in any mode", async () => {
    const ledger = new PersistentTrialLedger(path.join(dir, "l2.json"), 0.25);
    let sent = 0;
    const target = { fetch: (async () => { sent++; return new Response("{}", { status: 200 }); }) as typeof fetch };
    installFetchGuard({ ledger, env: {} as unknown as NodeJS.ProcessEnv, preflightRefusal: TRIAL_PREFLIGHT_REFUSAL, target });
    await assert.rejects(() => target.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-6-luna", max_completion_tokens: 100, messages: [] }) }), /OPENAI_TEST_API_KEY is not set/);
    await assert.rejects(() => target.fetch("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent", { method: "POST", body: "{}" }), /refused/);
    await assert.rejects(() => target.fetch("https://idx-abc.svc.pinecone.io/records/namespaces/x/upsert", { method: "POST", body: "{}" }), /refused/);
    assert.equal(sent, 0);
  });
  await t("T15 Codespaces forwarding: this Codespace's own public origin is same-origin; any other Origin stays refused by the app's unchanged CSRF check", () => {
    const env = { CODESPACES: "true", CODESPACE_NAME: "silver-train-x7", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" } as unknown as NodeJS.ProcessEnv;
    const pub = "silver-train-x7-3000.app.github.dev";
    const csrf = (origin: string | null) => checkRequestOrigin({ method: "POST", headers: { get: (h: string) => (h === "origin" ? origin : null) } }, trialInternalOrigin(3000)).allowed;
    const same = codespacesSameOrigin({ host: "localhost:3000", "x-forwarded-host": pub, origin: `https://${pub}` }, env, 3000);
    assert.deepEqual(same, { origin: "http://localhost:3000" });
    assert.equal(csrf(same!.origin!), true, "the owner's own page can POST");
    assert.equal(csrf(`https://${pub}`), false, "without the trial's handling the owner's POST would be refused");
    assert.equal(codespacesSameOrigin({ "x-forwarded-host": pub, origin: "https://evil.example.com" }, env, 3000), null, "another site's Origin is left as it is");
    assert.equal(csrf("https://evil.example.com"), false);
    assert.equal(codespacesSameOrigin({ "x-forwarded-host": "other-codespace-3000.app.github.dev", origin: "https://other-codespace-3000.app.github.dev" }, env, 3000), null, "another Codespace");
    assert.equal(codespacesSameOrigin({ "x-forwarded-host": pub, origin: `https://${pub}` }, { ...env, CODESPACES: undefined } as NodeJS.ProcessEnv, 3000), null, "outside a Codespace");
    assert.equal(codespacesSameOrigin({ "x-forwarded-host": pub, origin: `http://${pub}` }, env, 3000), null, "plain http is not the forwarded origin");
    assert.deepEqual(codespacesSameOrigin({ "x-forwarded-host": pub, referer: `https://${pub}/policies?x=1` }, env, 3000), { referer: "http://localhost:3000/policies?x=1" }, "Referer fallback");
  });
  console.log(`trial guard regressions ${n}/${n} passed`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
