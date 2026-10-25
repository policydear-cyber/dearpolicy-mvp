/** Offline checks for the simple baseline and its comparison runner. Synthetic households and a stubbed model
 * only: no network, no database, no spend.  node --import tsx scripts/simple-answer/offline-test.ts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerSimply, apiKeyFromEnv, buildRequest, costUsd, renderLibrary, type ModelClient, type SimpleRequest } from "./answer";
import { readHousehold, type Household, type ReadOnlyQuery } from "./household";
import { estimateRun, loadQuestions, recordedCurrent, runComparison, sideBySide } from "./compare";
import { buildSnapshot, pagesDigest } from "./build-snapshot";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-0000-4000-8000-000000000001", P2 = "aaaaaaaa-0000-4000-8000-000000000002", P3 = "bbbbbbbb-0000-4000-8000-000000000003";
const tables = {
  family_members: [
    { account_id: A, id: "fa1", display_name: "Grace Lim", relationship: "self" },
    { account_id: A, id: "fa2", display_name: "Daniel Lim", relationship: "child" },
    { account_id: B, id: "fb1", display_name: "Other Person", relationship: "self" },
  ],
  policies: [
    { account_id: A, id: P1, original_filename: "travel-cert-2024.pdf", insurer: "Acme", product_name: "TravelSafe", policy_number: "T-1", policy_type: "travel", document_role: "certificate", effective_date: new Date("2024-03-01"), renewal_or_expiry_date: new Date("2024-03-10"), created_at: new Date("2026-10-01"), superseded_at: null, uploaded_for: "Grace Lim" },
    { account_id: A, id: P2, original_filename: "health-schedule.pdf", insurer: "Beta Life", product_name: "HealthPlus", policy_number: "H-9", policy_type: "health", document_role: "schedule", effective_date: null, renewal_or_expiry_date: null, created_at: new Date("2026-10-02"), superseded_at: null, uploaded_for: "Daniel Lim" },
    { account_id: B, id: P3, original_filename: "secret.pdf", insurer: "Other", product_name: "OtherPlan", policy_number: "O-1", policy_type: "life", document_role: "policy", effective_date: null, renewal_or_expiry_date: null, created_at: new Date("2026-10-03"), superseded_at: null, uploaded_for: "Other Person" },
  ],
  policy_members: [
    { account_id: A, policy_id: P1, display_name: "Grace Lim" },
    { account_id: A, policy_id: P2, display_name: "Daniel Lim" },
    { account_id: B, policy_id: P3, display_name: "Other Person" },
  ],
  policy_pages: [
    { account_id: A, policy_id: P1, page_number: 1, text: "Overseas medical expenses up to S$100,000 per trip. Period of insurance 1-10 March 2024." },
    { account_id: A, policy_id: P2, page_number: 1, text: "Outpatient GP: 80% of bill, max $500 per year." },
    { account_id: B, policy_id: P3, page_number: 1, text: "OTHER HOUSEHOLD SECRET TEXT" },
  ],
};
const tableOf = (sql: string) => (["policy_pages", "policy_members", "family_members", "policies"] as const).find((t) => new RegExp(`FROM ${t}\\b`).test(sql))!;
const fakeDb = (leaky = false): ReadOnlyQuery => async (sql, params) =>
  (tables[tableOf(sql)] as Record<string, unknown>[]).filter((r) => leaky || r.account_id === params[0]);

function stub(reply: (req: SimpleRequest, n: number) => string, opts: { refuse?: boolean } = {}) {
  const seen: SimpleRequest[] = [];
  const client: ModelClient = { beta: { messages: { stream(req) {
    seen.push(req);
    const n = seen.length;
    return { finalMessage: async () => ({
      id: `m${n}`, type: "message", role: "assistant", model: req.model, container: null, context_management: null,
      stop_reason: opts.refuse ? "refusal" : "end_turn", stop_sequence: null, stop_details: null,
      content: [{ type: "text", text: reply(req, n), citations: null }],
      usage: { input_tokens: 50, cache_creation_input_tokens: n === 1 ? 10000 : 0, cache_read_input_tokens: n === 1 ? 0 : 10000, output_tokens: 300 },
    }) as never };
  } } } };
  return { client, seen };
}

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log("ok -", name); }

async function main() {
const household: Household = await readHousehold(A, fakeDb());

await check("household read is limited to its own account", () => {
  const lib = renderLibrary(household);
  assert.equal(household.documents.length, 2);
  assert.ok(lib.includes("S$100,000") && lib.includes("max $500"));
  assert.ok(!lib.includes("SECRET") && !lib.includes("Other Person") && !lib.includes("secret.pdf"));
});
await check("a row from another household stops the read", async () => {
  await assert.rejects(readHousehold(A, fakeDb(true)), /another household/);
});
await check("documents carry name, person links, type, role and dates", () => {
  const lib = renderLibrary(household);
  assert.match(lib, /name="travel-cert-2024\.pdf"[^>]*type="travel" role="certificate" effective="2024-03-01" expiry_or_renewal="2024-03-10"[^>]*linked_people="Grace Lim"/);
  assert.match(lib, /name="health-schedule\.pdf"[^>]*uploaded_for="Daniel Lim" linked_people="Daniel Lim"/);
  assert.match(lib, /<page n="1">\nOutpatient GP/);
});
await check("request: library is one cached system block, history passed in order", () => {
  const req = buildRequest(household, [{ role: "user", text: "first" }, { role: "assistant", text: "reply" }], "second");
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.system.length, 2);
  assert.deepEqual(req.system[1].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.ok(req.system[1].text.includes("<documents>"));
  assert.deepEqual(req.messages.map((m) => [m.role, m.content]), [["user", "first"], ["assistant", "reply"], ["user", "second"]]);
});
await check("answer: text, usage and cost come from the model reply", async () => {
  const { client } = stub(() => "Daniel's HealthPlus pays 80% up to $500 a year (health-schedule.pdf p1).");
  const a = await answerSimply(client, household, [], "Can Daniel claim his GP bill?");
  assert.match(a.text, /80% up to \$500/);
  assert.deepEqual(a.usage, { input: 50, cacheWrite: 10000, cacheRead: 0, output: 300 });
  assert.equal(a.costUsd, costUsd("claude-opus-5-5", a.usage));
  assert.ok(Math.abs(a.costUsd - (50 * 4 + 10000 * 8 + 300 * 20) / 1e6) < 1e-12);
});
await check("key: DEARPOLICY_ANTHROPIC_KEY first, then ANTHROPIC_API_KEY; the error names variables, never values", () => {
  assert.deepEqual(apiKeyFromEnv({ DEARPOLICY_ANTHROPIC_KEY: "k1", ANTHROPIC_API_KEY: "k2" }), { name: "DEARPOLICY_ANTHROPIC_KEY", key: "k1" });
  assert.deepEqual(apiKeyFromEnv({ DEARPOLICY_ANTHROPIC_KEY: " ", ANTHROPIC_API_KEY: "k2" }), { name: "ANTHROPIC_API_KEY", key: "k2" });
  assert.throws(() => apiKeyFromEnv({}), /^Error: No API key: set DEARPOLICY_ANTHROPIC_KEY or ANTHROPIC_API_KEY$/);
});
await check("a refusal is shown as declined, not as an answer", async () => {
  const { client } = stub(() => "", { refuse: true });
  assert.match((await answerSimply(client, household, [], "x")).text, /^\[declined/);
});

const dir = mkdtempSync(join(tmpdir(), "simple-answer-"));
const qPath = join(dir, "questions.json");
writeFileSync(qPath, JSON.stringify({ questions: [
  { id: "gp", person: "Daniel", turns: ["Daniel's GP bill was $800, can he claim?", "Actually it was Grace, not Daniel."] },
  { id: "travel", question: "Is Grace covered for travel now?" },
] }));
const curPath = join(dir, "current.json");
writeFileSync(curPath, JSON.stringify({ gp: { turns: [{ answer: "current gp 1", ms: 22000 }, { answer: "current gp 2", ms: 18000 }] }, travel: "current travel" }));
const questions = loadQuestions(qPath);

await check("question set: turns or a single question, ids kept", () => {
  assert.deepEqual(questions.map((q) => [q.id, q.turns.length]), [["gp", 2], ["travel", 1]]);
});
await check("release-set format: chat <id> continues that conversation, chat new starts one", () => {
  const p = join(dir, "release.json");
  writeFileSync(p, JSON.stringify([
    { id: "B1", chat: "new", message: "wife broke her wrist", category: "scenario" },
    { id: "A1", chat: "new", message: "what is josephine covered for" },
    { id: "C1", chat: "B1", message: "how much could she get" },
    { id: "C2", chat: "C1", message: "what do i do now" },
  ]));
  const qs = loadQuestions(p);
  assert.deepEqual(qs.map((q) => [q.id, q.turns, q.turnIds]), [
    ["B1", ["wife broke her wrist", "how much could she get", "what do i do now"], ["B1", "C1", "C2"]],
    ["A1", ["what is josephine covered for"], ["A1"]],
  ]);
  writeFileSync(p, JSON.stringify([{ id: "C1", chat: "B9", message: "x" }]));
  assert.throws(() => loadQuestions(p), /not an earlier question/);
});
await check("snapshot builds only when every document matches its database digest", () => {
  const snap = join(dir, "snap");
  mkdirSync(snap, { recursive: true });
  const docs = household.documents.map(({ pages, ...d }) => ({ ...d, pages: pages.length, digest: pagesDigest(pages) }));
  writeFileSync(join(snap, "meta.json"), JSON.stringify({ accountId: household.accountId, members: household.members, documents: docs }));
  for (const d of household.documents) writeFileSync(join(snap, `pages-${d.policyId}.json`), JSON.stringify(d.pages));
  assert.deepEqual(buildSnapshot(snap), household);
  // Postgres: md5(string_agg(md5(text), '' ORDER BY page_number)); md5(md5('a')||md5('b')) = this value.
  assert.equal(pagesDigest([{ page: 2, text: "b" }, { page: 1, text: "a" }]), "3bc22fb7aaebe9c8c5d7de312b876bb8");
  const changed = household.documents[1].pages.map((p) => ({ ...p, text: p.text.replace("80%", "60%") }));
  writeFileSync(join(snap, `pages-${household.documents[1].policyId}.json`), JSON.stringify(changed));
  assert.throws(() => buildSnapshot(snap), /does not match the database digest/);
});
await check("comparison: both answers side by side, follow-up sees the earlier turn", async () => {
  const { client, seen } = stub((req, n) => `baseline answer ${n} to: ${String(req.messages.at(-1)!.content)}`);
  const result = await runComparison({ household, questions, client, current: recordedCurrent(curPath), maxUsd: 1 });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[1].messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(String(seen[1].messages[1].content), /baseline answer 1/);
  assert.equal(seen[2].messages.length, 1, "a new question starts a new conversation");
  assert.equal(result.rows[0].turns[1].current?.answer, "current gp 2");
  assert.equal(result.rows[1].turns[0].current?.answer, "current travel");
  assert.ok(result.spentUsd > 0 && !result.stoppedEarly);
  const md = sideBySide(result.rows, { runId: "offline" });
  assert.ok(md.includes("**Simple baseline**") && md.includes("**Current pipeline** · 22.0 s") && md.includes("Actually it was Grace"));
});
await check("spend cap admits a call only if its worst case still fits", async () => {
  const one = estimateRun(household, [questions[1]]).worstCaseUsd;
  const { client, seen } = stub(() => "x");
  const none = await runComparison({ household, questions, client, current: recordedCurrent(curPath), maxUsd: one * 0.99 });
  assert.equal(none.stoppedEarly, true);
  assert.equal(seen.length, 0, "no call when even one worst-case call would exceed the cap");
  const some = await runComparison({ household, questions, client, current: recordedCurrent(curPath), maxUsd: one * 1.5 });
  assert.equal(some.stoppedEarly, true);
  assert.equal(seen.length, 1, "the follow-up turn is not admitted once the cap could be crossed");
  assert.equal(some.rows[0].turns.length, 1);
  assert.equal(some.rows[0].turns[0].current?.answer, "current gp 1");
  assert.ok(some.spentUsd <= one * 1.5);
});
await check("estimate: cached expected cost is far below the no-cache worst case", () => {
  const e = estimateRun(household, questions);
  assert.equal(e.calls, 3);
  assert.ok(e.expectedUsd > 0 && e.worstCaseUsd > e.expectedUsd);
});
await check("CLI without --paid only estimates and never calls a model", () => {
  const hhPath = join(dir, "household.json");
  writeFileSync(hhPath, JSON.stringify(household));
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/simple-answer/compare.ts", "--questions", qPath, "--household-file", hhPath],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" } });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Estimate only\. Nothing was sent to a model\./);
  assert.match(run.stdout, /"worstCaseUsd"/);
});
await check("CLI refuses to write real output inside the git checkout", () => {
  const hhPath = join(dir, "household.json");
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/simple-answer/compare.ts", "--questions", qPath, "--household-file", hhPath, "--snapshot-out", "scripts/simple-answer/leak.json"],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /inside the git checkout/);
});
await check("CLI refuses a cap above the authorised US$10", () => {
  const hhPath = join(dir, "household.json");
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/simple-answer/compare.ts", "--questions", qPath, "--household-file", hhPath, "--paid", "--run-id", "t", "--max-usd", "10.01", "--out", join(dir, "out")],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /above the authorised US\$10/);
});
await check("CLI --paid with no key stops before any call", () => {
  const hhPath = join(dir, "household.json");
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/simple-answer/compare.ts", "--questions", qPath, "--household-file", hhPath, "--paid", "--run-id", "nokey", "--max-usd", "1", "--out", join(dir, "out-nokey")],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", DEARPOLICY_ANTHROPIC_KEY: "" } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /No API key: set DEARPOLICY_ANTHROPIC_KEY or ANTHROPIC_API_KEY/);
});
console.log(`${passed} checks passed`);
}
main().catch((error) => { console.error(error); process.exit(1); });
