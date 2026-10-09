/**
 * Live ingestion test harness: upload -> actual extraction / OCR -> stored library -> retrieval -> real-model
 * conversation, on the REAL app (production `next build`, e2e/support/ingest-live-server.ts) in a real browser
 * (e2e/ingest-live/ingest-live.spec.ts), for ONE fresh synthetic account. Every model call the server makes goes through
 * the rag2 live guard (reserve, settle, refuse; one run ledger, cap <= US$0.50) and is listed per call in run.json.
 *
 *   node --import tsx scripts/ingest-live/run.ts --preflight   # no key, no model call (every request refused, US$0)
 *   node --import tsx scripts/ingest-live/run.ts --live        # CI only (RAG2_LIVE_MODE=direct + the test key)
 *   options: --run-id <id> --fixture scripts/ingest-live/fixture --expected <sealed EXPECTED.json> --port 3320
 *            --out docs/rag-migration/ingest-live --availability-status <code> [--availability-id <id>]
 * Steps: safety checks -> provision a fresh synthetic account the way sign-up does (accounts + owner membership; NO
 * members, documents or answers) -> start the server -> the browser journey (members are added on the family page) ->
 * after processing, a READ-ONLY database dump -> conversations -> final dump -> EXPECTED.json copied in -> deterministic
 * grade -> run.json + report.md. The key is passed to the server process only; this process and the browser never get it.
 * Output: <out>/RUN-<run-id>-<timestamp>[-PREFLIGHT]/.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { liveSafetyChecks, PREFLIGHT_REFUSAL } from "../../e2e/support/rag2-live-guard";
import { reconcile } from "../rag2-live/attribution";
import { dumpAccount } from "./dump";
import { annotateTranscript, grade } from "./check";
import { writeIngestReport } from "./report";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf("--" + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes("--" + n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (c: string) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return null; } };

async function main() {
  const preflight = flag("preflight"), live = flag("live");
  if (preflight === live) throw new Error("say which run this is: --preflight (no model call) or --live (CI, spends money)");
  if (preflight) process.env.RAG2_LIVE_PREFLIGHT = "1"; else delete process.env.RAG2_LIVE_PREFLIGHT;
  const runId = arg("run-id", preflight ? "preflight" : undefined);
  if (!runId || !/^[A-Za-z0-9._-]{1,40}$/.test(runId)) throw new Error("--run-id: 1-40 characters of A-Z a-z 0-9 . _ -");
  const safety = liveSafetyChecks(process.env);
  if (live && safety.mode !== "direct") throw new Error("--live runs only in CI direct mode (RAG2_LIVE_MODE=direct)");
  const fixture = path.resolve(arg("fixture", "scripts/ingest-live/fixture")!);
  const expectedPath = arg("expected", process.env.INGEST_LIVE_EXPECTED);
  // EXPECTED.json must not be where the app could read it while it runs: never inside the fixture the browser uploads from.
  if (expectedPath && path.resolve(expectedPath).startsWith(fixture + path.sep)) throw new Error("EXPECTED.json must be sealed outside the fixture folder");
  if (!fs.existsSync(".next/BUILD_ID")) throw new Error("no next build output (.next/BUILD_ID): the server serves the production build");
  const port = Number(arg("port", "3320"));
  const started = new Date();
  const outDir = path.resolve(arg("out", "docs/rag-migration/ingest-live")!, `RUN-${runId}-${started.toISOString().replace(/[:.]/g, "-").slice(0, 19)}${preflight ? "-PREFLIGHT" : ""}`);
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  const shaEnv = (k: string) => (process.env[k] && /^[0-9a-f]{7,40}$/.test(process.env[k]!) ? process.env[k]! : null);
  const availability = arg("availability-status") != null ? { status: arg("availability-status")!, id: arg("availability-id") ?? null } : null;
  const run: any = {
    testedCodeSha: shaEnv("RAG2_LIVE_TESTED_SHA") ?? git("git rev-parse HEAD"), requestSha: shaEnv("RAG2_LIVE_REQUEST_SHA"),
    modelsRequested: Object.fromEntries(["CHAT_MODEL", "JUDGEMENT_MODEL", "NARRATION_MODEL", "READING_MODEL"].map((k) => [k, process.env[k] ?? null])),
    label: preflight ? "PREFLIGHT -- every model request refused; US$0" : "LIVE MODEL RUN", runId, preflight, mode: safety.mode,
    keyNote: process.env.RAG2_LIVE_KEY_PRESENT === "false" ? "OPENAI_TEST_API_KEY not set" : null, availability,
    startedAt: started.toISOString(), commit: git("git rev-parse HEAD"), tree: git("git rev-parse HEAD^{tree}"), buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    fixture: path.relative(process.cwd(), fixture), sources: fs.readdirSync(path.join(fixture, "source")), runCapUsd: safety.capUsd,
  };
  const save = () => fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(run, null, 2));
  if (availability && !preflight && availability.status !== "200") {
    run.stoppedBeforeStart = `model availability check returned ${availability.status}: nothing run, US$0`;
    run.budgetUsed = { capUsd: safety.capUsd, spentUsd: 0, reservedUsd: 0, remainingUsd: safety.capUsd, calls: 0, refusals: 0, failed: 0 };
    save(); fs.writeFileSync(path.join(outDir, "report.md"), writeIngestReport(outDir)); await pool.end(); process.exitCode = 1; return;
  }
  // A fresh synthetic account, created the way sign-up creates one (no members, no documents).
  const userId = randomUUID();
  const householdId = await ensureDefaultHousehold(userId, `SYNTHETIC-DPTEST-ingest-${runId}`);
  run.account = { note: "fresh synthetic account (sign-up path: lib/household/repo.ts ensureDefaultHousehold)", householdRef: householdId.slice(0, 8) };
  const storage = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? "/tmp", "ingest-live-storage-"));
  const env = { ...process.env, INGEST_LIVE_USER_ID: userId, PORT: String(port), LOCAL_STORAGE_DIR: storage, NEXT_TELEMETRY_DISABLED: "1" };
  const log = fs.createWriteStream(path.join(outDir, "server.log"));
  const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", "e2e/support/ingest-live-server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  delete process.env.OPENAI_API_KEY; // the server makes every model call; nothing else holds the key
  const base = `http://localhost:${port}`;
  const budget = async () => (await fetch(base + "/__ingestlive/budget").then((r) => r.json())) as any;
  let pw: ChildProcess | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the server did not start within 180 s (server.log)")), 180_000);
      server.stdout!.on("data", (b: Buffer) => { log.write(b); if (/ingest live server on/.test(b.toString())) { clearTimeout(timer); resolve(); } });
      server.stderr!.on("data", (b: Buffer) => log.write(b));
      server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the server exited (${code}); see server.log`)); });
    });
    // The browser journey. Its environment carries no key and no database URL.
    const pwEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, CI: process.env.CI, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      NODE_OPTIONS: "--max-old-space-size=512", INGEST_LIVE_BASE: base, INGEST_LIVE_OUT: outDir, INGEST_LIVE_FIXTURE: fixture, INGEST_LIVE_PREFLIGHT: preflight ? "1" : "0",
      ...Object.fromEntries(["INGEST_LIVE_READY_TIMEOUT_MS", "INGEST_LIVE_THINK_MS", "INGEST_LIVE_TEST_TIMEOUT_MS"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
    const pwLog = fs.createWriteStream(path.join(outDir, "browser.log"));
    pw = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "-c", "e2e/playwright.ingest-live.config.ts"], { env: pwEnv, stdio: ["ignore", "pipe", "pipe"] });
    pw.stdout!.pipe(pwLog); pw.stderr!.pipe(pwLog);
    const pwDone = new Promise<number>((r) => pw!.on("exit", (c) => r(c ?? 1)));
    // After processing (the spec says so with a marker), dump the database read-only, then let the questions start.
    let dumpedAfterProcessing = false, pwCode: number | null = null;
    void pwDone.then((c) => { pwCode = c; });
    while (pwCode === null) {
      if (!dumpedAfterProcessing && fs.existsSync(path.join(outDir, ".processing-done"))) {
        await dumpAccount(pool, householdId, path.join(outDir, "dump-processing"));
        run.budgetAfterProcessing = (await budget()).ledger;
        fs.writeFileSync(path.join(outDir, ".dump-done"), new Date().toISOString());
        dumpedAfterProcessing = true;
      }
      await sleep(1000);
    }
    run.browserExitCode = pwCode;
    const b = await budget();
    run.budgetUsed = b.ledger; run.httpCalls = b.httpCalls; run.loopCalls = b.loopCalls;
    run.providerModels = [...new Set(b.httpCalls.map((c: any) => c.providerModel).filter(Boolean))];
    run.requestSettingsSent = [...new Set(b.httpCalls.filter((c: any) => c.settings).map((c: any) => JSON.stringify(c.settings)))].map((s) => JSON.parse(s as string));
    if (preflight) run.preflightNote = `${b.httpCalls.filter((c: any) => c.refused === PREFLIGHT_REFUSAL).length} model request(s) refused by the guard, none sent (US$0)`;
    const final = await dumpAccount(pool, householdId, path.join(outDir, "dump-final"));
    fs.cpSync(path.join(outDir, "dump-final", "extracted"), path.join(outDir, "extracted"), { recursive: true });
    // Provenance rows joined to the guard's calls (by provider request id, else identical tokens).
    const prov: any[] = ((final.tables as any).model_executions ?? []).map((r: any) => ({ ...r, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd) }));
    const rec = reconcile(b.httpCalls, prov);
    run.provenance = prov.map((r, i) => ({ operation: r.operation, attempt_index: r.attempt_index, requested_provider: r.requested_provider, requested_model: r.requested_model, resolved_provider: r.resolved_provider, resolved_model: r.resolved_model, provider_request_id: r.provider_request_id, status: r.status, error_category: r.error_category, input_tokens: r.input_tokens, cached_tokens: r.cached_tokens, output_tokens: r.output_tokens, cost_usd: r.cost_usd, latency_ms: r.latency_ms, guardSeq: rec.pairs.find((p) => p.rowIndex === i)?.seq ?? null }));
    run.reconciliation = { guardUsd: rec.guardUsd, appRowsUsd: rec.rowsUsd, rowsWithoutCall: rec.rowsWithoutCall.length, callsWithoutRow: rec.callsWithoutRow };
  } catch (e) {
    run.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    run.budgetUsed = run.budgetUsed ?? (await budget().then((x) => x.ledger).catch(() => null));
    run.httpCalls = run.httpCalls ?? (await budget().then((x) => x.httpCalls).catch(() => []));
  } finally {
    pw?.kill("SIGTERM");
    server.kill("SIGTERM");
    log.end();
  }
  // Only now, after every conversation: the expectations come into the run folder.
  if (expectedPath && fs.existsSync(expectedPath)) {
    fs.copyFileSync(expectedPath, path.join(outDir, "EXPECTED.json"));
    // The author's own expectations (prose, verbatim facts) travel with the machine checks derived from them.
    for (const f of ["EXPECTED.source.json", "EXPECTED.source.md"]) if (fs.existsSync(path.join(path.dirname(expectedPath), f))) fs.copyFileSync(path.join(path.dirname(expectedPath), f), path.join(outDir, f));
  }
  for (const f of [".processing-done", ".dump-done"]) fs.rmSync(path.join(outDir, f), { force: true });
  run.finishedAt = new Date().toISOString();
  save();
  annotateTranscript(outDir);
  const v = grade(outDir);
  fs.writeFileSync(path.join(outDir, "verdict.json"), JSON.stringify(v, null, 2));
  run.verdict = v.verdict; save();
  fs.writeFileSync(path.join(outDir, "report.md"), writeIngestReport(outDir));
  console.log(`${v.verdict}; ${run.budgetUsed ? `US$${Number(run.budgetUsed.spentUsd).toFixed(6)} spent, ${run.budgetUsed.calls} calls, ${run.budgetUsed.refusals} refused` : "no budget record"}; wrote ${path.relative(process.cwd(), outDir)}`);
  await pool.end().catch(() => undefined);
  const ok = preflight ? !run.error && run.browserExitCode != null : v.verdict === "PASS";
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
