/**
 * Accounting checks for the cumulative US$1.00 exercise ledger (docs/rag-migration/live/LEDGER.json). No network, no model
 * call, no database: pure functions, the live guard's admission and the ledger CLI on temporary copies.
 *   NODE_ENV=test node --import tsx scripts/rag2-live/ledger-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { foundRuns, planRun, reconcileRuns, remainingUsd, validateLedger, type Ledger, type LedgerRun } from "./ledger";
import { liveSafetyChecks } from "../../e2e/support/rag2-live-guard";

let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e as Error).message ?? e).split("\n").join("\n     ")); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-reg-"));
const entry = (run_id: string, spent: number, extra: Partial<LedgerRun> = {}): LedgerRun => ({ run_id, tested_code_sha: "abc1234", request_sha: "abc1234", at: "2026-10-18T00:00:00.000Z", preflight: false, run_cap_usd: 0.05, spent_usd: spent, reserved_unsettled_usd: 0, calls: 3, refused: 0, failed: 0, ...extra });
const trial = (status: "open" | "closed", spent = 0): LedgerRun => entry("trial-codespace-1", spent, status === "open"
  ? { kind: "trial_allocation", status, run_cap_usd: 0.15, reserved_unsettled_usd: 0.15, calls: 0 } : { kind: "trial_allocation", status, run_cap_usd: 0.15, reserved_unsettled_usd: 0, calls: 0 });
const write = (name: string, runs: LedgerRun[]) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify({ exercise_cap_usd: 1, runs }, null, 2) + "\n"); return p; };
const BASE: Record<string, string> = { NODE_ENV: "test", DATABASE_URL: "postgres://u:p@localhost:5432/x", CHAT_MODEL: "openai:gpt-6-luna", RAG2_LIVE_EXPECT_MODEL: "openai:gpt-6-luna",
  RAG2_LIVE_RUN_CAP_USD: "0.50", DEARPOLICY_RAG_LOOP_RUN_MAX_USD: "0.50", DEARPOLICY_RAG_LOOP_REQUIRE_PRICE: "1", OPENAI_API_KEY: "test-value-not-a-key", OPENAI_BASE_URL: "http://127.0.0.1:8787/v1" };
/** liveSafetyChecks reads an explicit env object (no process.env mutation). */
const admit = (extra: Record<string, string | undefined>) => {
  const env: Record<string, string | undefined> = { ...BASE, ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return liveSafetyChecks(env as NodeJS.ProcessEnv);
};
const REAL = "docs/rag-migration/live/LEDGER.json";

(async () => {
  await t("L1 earlier spending reduces what a new run may use (cap = min(request, exercise cap - spent - unsettled))", () => {
    const p = write("l1.json", [entry("earlier-1", 0.4), entry("earlier-2", 0.3)]);
    assert.equal(admit({ RAG2_LIVE_LEDGER: p, RAG2_LIVE_RUN_ID: "new-run" }).capUsd, 0.3, "1.00 - 0.70 leaves 0.30, below the 0.50 request");
    const p2 = write("l1b.json", [entry("earlier-1", 0.1)]);
    assert.equal(admit({ RAG2_LIVE_LEDGER: p2, RAG2_LIVE_RUN_ID: "new-run" }).capUsd, 0.5, "plenty left: the request cap stands");
    const p3 = write("l1c.json", [entry("earlier-1", 0.4), entry("pending", 0, { reserved_unsettled_usd: 0.2 })]);
    assert.equal(admit({ RAG2_LIVE_LEDGER: p3, RAG2_LIVE_RUN_ID: "new-run" }).capUsd, 0.4, "unsettled reservations count as used");
    const p4 = write("l1d.json", [entry("earlier-1", 1)]);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: p4, RAG2_LIVE_RUN_ID: "new-run" }), /used up/);
  });
  await t("L2 the real ledger limits a run: remaining = 1.00 - every spend - the open trial reservation", () => {
    const l = validateLedger(JSON.parse(fs.readFileSync(REAL, "utf8")));
    const spent = l.runs.reduce((n, r) => n + r.spent_usd, 0), reserved = l.runs.reduce((n, r) => n + r.reserved_unsettled_usd, 0);
    assert.ok(Math.abs(remainingUsd(l) - (1 - spent - reserved)) < 1e-6);
    const a = admit({ RAG2_LIVE_LEDGER: REAL, RAG2_LIVE_RUN_ID: "never-used-run" });
    assert.equal(a.capUsd, Math.min(0.5, remainingUsd(l)));
    assert.ok(a.capUsd < 0.5 && a.capUsd > 0, "earlier spending already lowers the cap below the US$0.50 request");
    assert.ok(l.runs.filter((r) => r.run_id.startsWith("sa-live-")).length >= 6, "every sa-live run is recorded");
  });
  await t("L3 a run_id already in the ledger is refused (live and preflight); a first use is admitted", () => {
    const p = write("l3.json", [entry("used-1", 0.01)]);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: p, RAG2_LIVE_RUN_ID: "used-1" }), /already used|latest ledger entry/);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: p, RAG2_LIVE_RUN_ID: "used-1", RAG2_LIVE_PREFLIGHT: "1" }), /already used|latest ledger entry/);
    const p2 = write("l3b.json", [entry("used-1", 0.01), entry("used-2", 0.01)]);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: p2, RAG2_LIVE_RUN_ID: "used-1" }), /already used/);
    assert.equal(admit({ RAG2_LIVE_LEDGER: p2, RAG2_LIVE_RUN_ID: "used-3" }).runId, "used-3");
  });
  await t("L4 a duplicate run_id cannot be written: validateLedger and the append command both refuse; the file is left unchanged", () => {
    assert.throws(() => validateLedger({ exercise_cap_usd: 1, runs: [entry("dup", 0.01), entry("dup", 0.02)] }), /appears twice/);
    const p = write("l4.json", [entry("only", 0.01)]);
    const dir = path.join(tmp, "RUN-l4-run-2026-10-18T00-00-00"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: "l4-run", budgetUsed: { spentUsd: 0.02, reservedUsd: 0, calls: 5, refusals: 0, failed: 0 } }));
    const cli = (id: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/rag2-live/ledger.ts", "append", "--ledger", p, "--run-id", id, "--tested-sha", "abc1234", "--request-sha", "abc1234", "--cap", "0.05", "--preflight", "false", "--run-dir", dir], { encoding: "utf8" });
    assert.equal(cli("l4-run").status, 0);
    const once = fs.readFileSync(p, "utf8");
    const again = cli("l4-run"); assert.notEqual(again.status, 0); assert.match(again.stderr, /already in the ledger/);
    assert.equal(fs.readFileSync(p, "utf8"), once, "a refused append writes nothing");
    assert.equal(JSON.parse(once).runs.filter((r: LedgerRun) => r.run_id === "l4-run").length, 1);
    assert.equal(cli("only").status === 0, false, "an earlier run_id cannot be appended again either");
  });
  await t("L5 the open trial reservation stays excluded from automated spend, and is released only when the entry is closed", () => {
    const open = write("l5a.json", [entry("earlier", 0.85), trial("open")]);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: open, RAG2_LIVE_RUN_ID: "new-run" }), /used up/, "0.85 spent + 0.15 reserved leaves nothing");
    const some = write("l5b.json", [entry("earlier", 0.8), trial("open")]);
    assert.equal(admit({ RAG2_LIVE_LEDGER: some, RAG2_LIVE_RUN_ID: "new-run" }).capUsd, 0.05, "0.80 + 0.15 reserved leaves 0.05");
    const closed = write("l5c.json", [entry("earlier", 0.8), trial("closed", 0.02)]);
    assert.equal(admit({ RAG2_LIVE_LEDGER: closed, RAG2_LIVE_RUN_ID: "new-run" }).capUsd, 0.18, "a closed allocation counts only its actual spend");
    const real = validateLedger(JSON.parse(fs.readFileSync(REAL, "utf8")));
    const tr = real.runs.find((r) => r.kind === "trial_allocation");
    assert.ok(tr && tr.status === "open" && tr.reserved_unsettled_usd === 0.15 && tr.spent_usd === 0, "the real ledger still holds the US$0.15 allowance, open and unspent");
  });
  await t("L6 fail closed: no run id, no ledger, an invalid ledger or a wrong exercise cap refuses the run", () => {
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: REAL }), /RAG2_LIVE_RUN_ID/);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: path.join(tmp, "absent.json"), RAG2_LIVE_RUN_ID: "x" }), /missing or invalid/);
    const bad = path.join(tmp, "bad.json"); fs.writeFileSync(bad, "{ not json");
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: bad, RAG2_LIVE_RUN_ID: "x" }), /missing or invalid/);
    const cap = path.join(tmp, "cap.json"); fs.writeFileSync(cap, JSON.stringify({ exercise_cap_usd: 5, runs: [] }));
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: cap, RAG2_LIVE_RUN_ID: "x" }), /must be 1\.00/);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: REAL, RAG2_LIVE_RUN_ID: "bad id!" }), /RAG2_LIVE_RUN_ID/);
  });
  await t("L7 a preflight spends nothing, so it is admitted when the budget is used up, but never past an unreadable ledger", () => {
    const p = write("l7.json", [entry("earlier", 0.85), trial("open")]);
    const a = admit({ RAG2_LIVE_LEDGER: p, RAG2_LIVE_RUN_ID: "pre-1", RAG2_LIVE_PREFLIGHT: "1" });
    assert.equal(a.preflight, true); assert.equal(a.remainingUsd, 0);
    assert.throws(() => admit({ RAG2_LIVE_LEDGER: path.join(tmp, "absent.json"), RAG2_LIVE_RUN_ID: "pre-1", RAG2_LIVE_PREFLIGHT: "1" }), /missing or invalid/);
  });
  await t("L8 every test entry point reaches the guard, and the runners name their run before it admits", () => {
    const has = (f: string, re: RegExp) => assert.match(fs.readFileSync(f, "utf8"), re, f);
    has("scripts/rag2-live/run.ts", /process\.env\.RAG2_LIVE_RUN_ID = runId;[\s\S]{0,200}liveSafetyChecks\(process\.env\)/);
    has("scripts/ingest-live/run.ts", /process\.env\.RAG2_LIVE_RUN_ID = runId;[\s\S]{0,200}liveSafetyChecks\(process\.env\)/);
    has("e2e/support/rag2-loop-server.ts", /LIVE \? liveSafetyChecks\(\)/);
    has("e2e/support/ingest-live-server.ts", /const live = liveSafetyChecks\(\)/);
    has("e2e/support/rag2-loop-server.ts", /new RunCostLedger\(live\.capUsd\)/);
    has("e2e/support/ingest-live-server.ts", /new RunCostLedger\(live\.capUsd\)/);
    // The only code that builds a run cap from the environment is liveSafetyChecks; nothing else reads RAG2_LIVE_RUN_CAP_USD.
    const offenders: string[] = [];
    for (const dir of ["scripts", "e2e", "lib"]) for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
      if (!/\.(ts|tsx|mjs|py)$/.test(f) || /node_modules|ledger-regressions|budget-regressions/.test(f)) continue;
      if (/RAG2_LIVE_RUN_CAP_USD/.test(fs.readFileSync(path.join(dir, f), "utf8")) && !/rag2-live-guard\.ts$/.test(f)) offenders.push(path.join(dir, f));
    }
    assert.deepEqual(offenders, [], "no other file derives a run cap from the environment");
  });
  await t("L9 reconcile: a recorded run without a ledger entry, a disagreeing entry, plumbing and a free preflight are told apart", () => {
    const root = path.join(tmp, "runs"); fs.mkdirSync(root);
    const mk = (name: string, rec: object) => { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, "run.json"), JSON.stringify(rec)); };
    const b = (spent: number, calls: number) => ({ budgetUsed: { spentUsd: spent, reservedUsd: 0, calls, refusals: 0, failed: 0 } });
    mk("RUN-a-live-1-2026-10-17T00-00-00", { runId: "a-live-1", ...b(0.01, 4) });
    mk("RUN-a-live-2-2026-10-17T01-00-00", { runId: "a-live-2", ...b(0.02, 6) });
    mk("RUN-a-live-3-2026-10-17T02-00-00", { runId: "a-live-3", ...b(0.03, 9) });
    mk("RUN-a-pre-2026-10-17T03-00-00-PREFLIGHT", { runId: "a-pre", preflight: true, ...b(0, 0) });
    mk("RUN-a-plumb-2026-10-17T04-00-00-PLUMBING", { runId: "a-plumb", ...b(0.01, 3) });
    fs.mkdirSync(path.join(root, "RUN-a-broken-2026-10-17T05-00-00"));
    const l: Ledger = { exercise_cap_usd: 1, runs: [entry("a-live-1", 0.01, { calls: 4 }), entry("a-live-2", 0.5, { calls: 6 })] };
    assert.deepEqual(reconcileRuns(l, foundRuns([root])), { missing: ["a-live-3"], mismatched: ["a-live-2"], unreadable: ["a-broken"], plumbing: ["a-plumb"], unchargedPreflight: ["a-pre"] });
  });
  await t("L10 reconcile on the repository: no recorded run is missing from, or disagrees with, LEDGER.json", () => {
    const l = validateLedger(JSON.parse(fs.readFileSync(REAL, "utf8")));
    const found = foundRuns(["docs/rag-migration/live", "docs/rag-migration/ingest-live"]);
    const r = reconcileRuns(l, found);
    assert.deepEqual({ missing: r.missing, mismatched: r.mismatched, unreadable: r.unreadable }, { missing: [], mismatched: [], unreadable: [] });
    console.log(`     (${found.length} run folder(s) found in this checkout; ${r.plumbing.length} plumbing, ${r.unchargedPreflight.length} uncharged preflight)`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nledger regressions ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
