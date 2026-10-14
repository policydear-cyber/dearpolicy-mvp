/**
 * Live-model smoke harness: six synthetic conversations (scripts/rag2-live/scenarios.ts) with the ACTUAL configured
 * chat model through the REAL application path:
 *   this script --HTTP--> e2e/support/rag2-loop-server.ts (E2E_RAG2_LIVE=1: the production `next build` served
 *   in-process, the real /api/chat route and chat job runner, the conversation loop, its tools, usage meter, ledger,
 *   persistence in local PostgreSQL and the save-time gate) --> lib/rag2/loop/hosted-model.ts (chat completions with
 *   tools, non-streaming) --> OPENAI_BASE_URL = the loopback relay (scripts/rag2-live/relay.py, in the workbench
 *   kernel) --> proxy_execute --> OpenAI with the Composio-held test key.
 * The user turns are fixed; the model picks its own tools and writes its own answers. Nothing is scripted or routed per
 * question. Conversations run one after another; the run stops when the run cap (<= US$0.50) is used up.
 *
 * Refuses to start unless: NODE_ENV=test, DATABASE_URL is local, VERCEL unset, OPENAI_BASE_URL is 127.0.0.1, a dummy
 * OPENAI_API_KEY, run cap <= US$0.50, a priced model, the relay is up and its mode matches --live / --plumbing.
 *
 *   node --import tsx scripts/rag2-live/run.ts --plumbing        # PLUMBING TEST against the local fake endpoint
 *   node --import tsx scripts/rag2-live/run.ts --live            # the real model (needs the Composio connection)
 *   options: --scenarios L1,L4  --port 3310  --relay http://127.0.0.1:8787  --out docs/rag-migration/live
 * Output: <out>/RUN-[<run-id>-]<timestamp>[-PLUMBING]/run.json, conv-<id>.json, relay.jsonl, report.md (report.ts).
 *
 * CI (.github/workflows/rag2-live-smoke.yml): RAG2_LIVE_MODE=direct -- no relay; the server calls OpenAI with the
 * OPENAI_TEST_API_KEY repository secret (allowed only when GITHUB_ACTIONS=true and CI=true; see rag2-live-guard.ts).
 *   --preflight   run everything (seed, server, the /api/chat path) but the guard refuses the FIRST model call:
 *                 US$0, and the report says exactly where it stopped. Combines with --live (or stands alone).
 *   --run-id <id> names the output directory RUN-<id>-<timestamp>.
 *   --availability-status <code> [--availability-id <id>]  the workflow's free GET /v1/models/<model> result; a live
 *                 run stops before any model call (US$0) unless it is 200.
 * RAG2_LIVE_TESTED_SHA / RAG2_LIVE_REQUEST_SHA (CI): the code commit tested and the run-request commit.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { LOOP_PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/rag2/loop/prompt";
import { loopToolSpecs } from "@/lib/rag2/loop/loop";
import { loopRequestSettings } from "@/lib/rag2/loop/hosted-model";
import { loopLimits } from "@/lib/ai/usage";
import { liveSafetyChecks, PREFLIGHT_REFUSAL } from "../../e2e/support/rag2-live-guard";
import { seedLive } from "../../e2e/support/seed-rag2-live";
import { ACCOUNT_L } from "../fixtures/rag2-live/household";
import { SCENARIOS, type Scenario } from "./scenarios";
import { grade, loadConversation, type Verdict } from "./check";
import { writeReport } from "./report";
import { reconcile, turnExecutions } from "./attribution";

const arg = (name: string, d?: string) => { const i = process.argv.indexOf("--" + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const flag = (name: string) => process.argv.includes("--" + name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
/** Sorted-key JSON (the relay hashes the tool schema it forwards the same way). */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v);
}

type RelayLine = Record<string, any> & { t: number };
function relayLines(file: string, from: number, to: number): RelayLine[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x): x is RelayLine => !!x && x.t * 1000 >= from - 1000 && x.t * 1000 <= to + 1000);
}

async function main() {
  const preflight = flag("preflight");
  const plumbing = flag("plumbing"), live = flag("live") || (preflight && !plumbing);
  if (live === plumbing) throw new Error("say which run this is: --live (the real model, spends money), --preflight (no model call) or --plumbing (local fake endpoint)");
  if (preflight) process.env.RAG2_LIVE_PREFLIGHT = "1";
  else delete process.env.RAG2_LIVE_PREFLIGHT;
  const runId = arg("run-id");
  if (runId != null && !/^[A-Za-z0-9._-]{1,40}$/.test(runId)) throw new Error("--run-id: 1-40 characters of A-Z a-z 0-9 . _ -");
  const safety = liveSafetyChecks(process.env);
  const port = Number(arg("port", "3310"));
  const relayUrl = arg("relay", "http://127.0.0.1:8787")!;
  type RelayHealth = { mode: string; log: string; allowed_models: string[] };
  let health = null as RelayHealth | null;
  if (safety.mode === "direct") {
    // CI: no relay. The server calls OpenAI directly; the guard records what the relay recorded before.
    if (plumbing) throw new Error("--plumbing needs the relay; direct mode is for the real model (or --preflight) only");
  } else {
    if (new URL(relayUrl).hostname !== "127.0.0.1") throw new Error("the relay must be on 127.0.0.1");
    health = await fetch(relayUrl + "/__relay/health").then((r) => r.json()).catch(() => null) as RelayHealth | null;
    if (!health) throw new Error(`the relay is not running at ${relayUrl} (start it in the workbench kernel: see docs/rag-migration/live/README.md)`);
    if (live && health.mode !== "live") throw new Error(`--live, but the relay is in "${health.mode}" mode`);
    if (plumbing && health.mode === "live") throw new Error("--plumbing, but the relay is in live mode (it would call the real model): refusing");
    if (!health.allowed_models.includes(safety.choice.model)) throw new Error(`the relay does not allow ${safety.choice.model}`);
  }
  const relayPlumbing = !!health && health.mode !== "live";
  const relayLog = health?.log ?? "";
  if (!fs.existsSync(".next/BUILD_ID")) throw new Error("no next build output (.next/BUILD_ID) in this directory: the server serves the production build");
  const scenarioHousehold = ["scenario", "stress", "binding", "binding-cells"].includes(process.env.RAG2_LIVE_HOUSEHOLD ?? "");
  const stressHousehold = process.env.RAG2_LIVE_HOUSEHOLD === "stress";
  const cellsHousehold = process.env.RAG2_LIVE_HOUSEHOLD === "binding-cells";
  const bindingHousehold = process.env.RAG2_LIVE_HOUSEHOLD === "binding" || cellsHousehold;
  const { S47, S48, S49, S49B, S50, seedScenario, STRESS_ACCOUNT, SCENARIO_ACCOUNT, BINDING_ACCOUNT } = await import("./scenario-household");
  const scenarios: Scenario[] = scenarioHousehold ? (cellsHousehold ? [S50] : bindingHousehold ? [S49, S49B] : [stressHousehold ? S48 : S47]) : (arg("scenarios") ? arg("scenarios")!.split(",").map((id) => SCENARIOS.find((s) => s.id === id.trim()) ?? (() => { throw new Error("unknown scenario " + id); })()) : SCENARIOS);

  const started = new Date();
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(arg("out", "docs/rag-migration/live")!, `RUN-${runId ? runId + "-" : ""}${stamp}${relayPlumbing ? "-PLUMBING" : ""}`);
  fs.mkdirSync(outDir, { recursive: true });
  const git = (c: string) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return null; } };
  const tools = loopToolSpecs().map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const limits = loopLimits();
  const availability = arg("availability-status") != null ? { status: arg("availability-status")!, id: arg("availability-id") ?? null } : null;
  const shaEnv = (k: string) => (process.env[k] && /^[0-9a-f]{7,40}$/.test(process.env[k]!) ? process.env[k]! : null);
  const meta = {
    testedCodeSha: shaEnv("RAG2_LIVE_TESTED_SHA") ?? git("git rev-parse HEAD"),
    requestSha: shaEnv("RAG2_LIVE_REQUEST_SHA"),
    modelsRequested: Object.fromEntries((["CHAT_MODEL", "JUDGEMENT_MODEL", "NARRATION_MODEL", "READING_MODEL"] as const).map((k) => [k, process.env[k] ?? null])),
    availability,
    label: preflight ? "PREFLIGHT -- no model call made; US$0" : relayPlumbing ? "PLUMBING TEST -- local fake endpoint, NOT a model; no figure here is a model result" : "LIVE MODEL RUN",
    runId: runId ?? null, mode: safety.mode, preflight,
    keyNote: process.env.RAG2_LIVE_KEY_PRESENT === "false" ? "OPENAI_TEST_API_KEY not set" : null,
    startedAt: started.toISOString(), commit: git("git rev-parse HEAD"), tree: git("git rev-parse HEAD^{tree}"), dirty: !!git("git status --porcelain --untracked-files=no"),
    buildId: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
    model: { requested: `${safety.choice.provider}:${safety.choice.model}`, pricePerMillion: safety.price, settings: loopRequestSettings(safety.choice.provider, safety.choice.model, limits.maxOutputTokens) },
    prompt: { version: LOOP_PROMPT_VERSION, systemPromptSha256: sha(SYSTEM_PROMPT), toolSchemaSha256: sha(canon(tools)), tools: tools.length },
    budget: { runCapUsd: safety.capUsd, meterRunMaxUsd: limits.runMaxUsd, turnMaxUsd: limits.maxTurnUsd, maxCallsPerTurn: limits.maxCallsPerTurn, maxTokensPerTurn: limits.maxTokensPerTurn, maxOutputTokensPerCall: limits.maxOutputTokens, retries: limits.retries },
    relay: health ? { url: relayUrl, mode: health.mode, log: health.log } : null,
  };

  if (availability && !preflight && availability.status !== "200") {
    // The free availability check (GET /v1/models/<model>) did not return 200: stop before any model call, US$0.
    const stopped: any = { ...meta, stoppedBeforeStart: `model availability check returned ${availability.status}${availability.id ? ` (${availability.id})` : ""}: no conversation run, US$0`, budgetUsed: { capUsd: safety.capUsd, spentUsd: 0, reservedUsd: 0, remainingUsd: safety.capUsd, calls: 0, refusals: 0, failed: 0 }, conversations: scenarios.map((s) => ({ scenario: s.id, title: s.title, notRun: "model availability check failed" })), httpCalls: [] };
    fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(stopped, null, 2));
    fs.writeFileSync(path.join(outDir, "report.md"), writeReport(stopped));
    console.log(`stopped: ${stopped.stoppedBeforeStart}; wrote ${outDir}`);
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
    return;
  }
  if (scenarioHousehold) await seedScenario(cellsHousehold ? "binding-cells" : bindingHousehold ? "binding" : stressHousehold ? "stress" : "scenario"); else await seedLive();
  const env = { ...process.env, E2E_RAG2_LIVE: "1", PORT: String(port), DEARPOLICY_RAG_LOOP: "1", E2E_RAG2_NEXT: "start", NEXT_TELEMETRY_DISABLED: "1" };
  const log = fs.createWriteStream(path.join(outDir, "server.log"));
  const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", "e2e/support/rag2-loop-server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  // The server process makes the model calls; this process never needs the key again.
  delete process.env.OPENAI_API_KEY;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the test server did not start within 180 s (see server.log)")), 180_000);
    server.stdout!.on("data", (b: Buffer) => { log.write(b); if (/rag2 loop test server on/.test(b.toString())) { clearTimeout(timer); resolve(); } });
    server.stderr!.on("data", (b: Buffer) => log.write(b));
    server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the test server exited (${code}); see server.log`)); });
  });
  const base = `http://localhost:${port}`;
  const headers = { "content-type": "application/json", origin: base };
  const budget = async () => (await fetch(base + "/__rag2live/budget").then((r) => r.json())) as { ledger: { remainingUsd: number; spentUsd: number; reservedUsd: number; capUsd: number; calls: number; refusals: number; failed: number }; calls: any[]; httpCalls: any[] };
  let written = false;
  const seenExecutions = new Set<string>();
  const runRecord: any = { ...meta, conversations: [] as any[] };
  try {
    await ready;
    let stop: string | null = null;
    for (const s of scenarios) {
      if (stop) { runRecord.conversations.push({ scenario: s.id, title: s.title, notRun: stop }); continue; }
      const b0 = await budget();
      // The smallest call the loop can make still needs about one prompt's worth of input reserved.
      if (b0.ledger.remainingUsd < 0.0005) { stop = `run cap used up (US$${b0.ledger.spentUsd.toFixed(4)} of US$${b0.ledger.capUsd})`; runRecord.conversations.push({ scenario: s.id, title: s.title, notRun: stop }); continue; }
      const conv: any = { scenario: s.id, title: s.title, conversationId: null, turns: [] as any[] };
      let conversationId: string | null = null, revision = 0;
      const convStart = Date.now();
      for (const [i, turn] of s.turns.entries()) {
        const gb = await budget();
        const g0 = gb.calls.length, h0 = gb.httpCalls.length;
        const t0 = Date.now();
        const r: Response = await fetch(base + "/api/chat", { method: "POST", headers, body: JSON.stringify({ familyMemberId: null, scope: "family", question: turn.user, conversationId, conversationRevision: conversationId ? revision : undefined, asynchronous: true, timeZone: "Asia/Singapore" }) });
        const acceptedMs = Date.now() - t0;
        const accepted: any = await r.json().catch(() => ({}));
        if (!r.ok) { conv.turns.push({ turn: i + 1, user: turn.user, error: `POST /api/chat ${r.status}: ${accepted.error ?? ""}` }); break; }
        conversationId = accepted.conversationId; conv.conversationId = conversationId;
        let job: any = null, result: any = null;
        for (const until = Date.now() + 300_000; Date.now() < until;) {
          const jr = await fetch(`${base}/api/chat/jobs/${accepted.jobId}`, { headers: { origin: base }, cache: "no-store" });
          const jd = await jr.json().catch(() => ({}));
          job = jd.job; result = jd.result;
          if (!jr.ok || ["complete", "failed", "cancelled"].includes(job?.status)) break;
          await sleep(250);
        }
        const answerSeenMs = Date.now() - t0;
        const answer = result?.answer ?? null;
        if (answer?.conversationRevision != null) revision = answer.conversationRevision;
        const persisted = (await pool.query("SELECT created_at FROM chat_messages WHERE conversation_id=$1 AND role='assistant' AND created_at >= $2 ORDER BY created_at LIMIT 1", [conversationId, new Date(t0)])).rows[0];
        const g = await budget();
        const calls = g.calls.slice(g0);
        // Every provider request of the turn, as the process-wide fetch guard reserved and settled it.
        const httpCalls = g.httpCalls.slice(h0).map((c: any) => ({ ...c, scenario: s.id, turn: i + 1 }));
        // From the POST onwards only, each row once (scripts/rag2-live/attribution.ts: the old 1 s look-back counted the
        // previous turn's last call again).
        const execs = turnExecutions((await pool.query("SELECT id::text AS id, operation, attempt_index, status, error_category, requested_model, resolved_model, provider_request_id, input_tokens, output_tokens, cached_tokens, cost_usd::float AS cost_usd, latency_ms, prompt_version, created_at FROM model_executions WHERE household_ref=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at", [pseudonymizeId(ACCOUNT_L), new Date(t0), new Date(Date.now() + 1000)])).rows, t0, seenExecutions);
        const relay = relayLog ? relayLines(relayLog, t0, Date.now()) : [];
        conv.turns.push({
          turn: i + 1, user: turn.user, jobStatus: job?.status ?? null, jobError: job?.error ?? null,
          visible: answer ? [answer.summary, ...(answer.details ?? []), ...(answer.questions ?? []).map((q: any) => q.text)].filter(Boolean).join("\n") : null,
          timings: { acceptedMs, firstAssistantPersistedMs: persisted ? new Date(persisted.created_at).getTime() - t0 : null, answerSeenMs, modelMs: calls.reduce((n: number, c: any) => n + (c.latencyMs ?? 0), 0), upstreamMs: relay.length ? relay.reduce((n, l) => n + (l.upstream_ms ?? 0), 0) : httpCalls.reduce((n: number, c: any) => n + (c.upstreamMs ?? 0), 0), relayMs: relay.reduce((n, l) => n + (l.relay_ms ?? 0), 0) },
          calls, httpCalls, modelExecutions: execs, relay,
          tokens: { input: httpCalls.reduce((n: number, c: any) => n + (c.usage?.input ?? 0), 0), output: httpCalls.reduce((n: number, c: any) => n + (c.usage?.output ?? 0), 0) },
          costUsd: { charged: httpCalls.reduce((n: number, c: any) => n + (c.chargedUsd ?? 0), 0), reserved: httpCalls.reduce((n: number, c: any) => n + (c.reservedUsd ?? 0), 0), ledger: execs.reduce((n: number, e: any) => n + (e.cost_usd ?? 0), 0) },
          reconciliation: reconcile(httpCalls, execs),
        });
        if (calls.some((c: any) => c.refused === PREFLIGHT_REFUSAL)) {
          stop = `${PREFLIGHT_REFUSAL}: stopped at the first model call -- scenario ${s.id} turn ${i + 1}: POST /api/chat ${r.status} accepted in ${acceptedMs} ms, chat job ${job?.status ?? "unknown"}, the conversation loop's first model call refused by the run-cap guard before any request was sent`;
          runRecord.preflightStop = { scenario: s.id, turn: i + 1, postStatus: r.status, acceptedMs, jobStatus: job?.status ?? null, answerSeenMs, detail: stop };
          break;
        }
        if (calls.some((c: any) => c.refused) || httpCalls.some((c: any) => c.refused)) { stop = `model call refused during ${s.id} turn ${i + 1}: ${[...calls, ...httpCalls].find((c: any) => c.refused)?.refused}`; break; }
        // No credential behind the relay: stop at once rather than send every scenario into the same error.
        const blocked = relay.find((l) => l.status === 401 || l.status === 403);
        if (blocked) { stop = `the relay could not reach the model (${blocked.status}: ${String(blocked.error ?? "").slice(0, 120)})`; break; }
        if (job?.status !== "complete") break;
      }
      conv.totalMs = Date.now() - convStart;
      conv.firstUsefulResponseMs = conv.turns[0]?.timings?.firstAssistantPersistedMs ?? null;
      conv.tokens = { input: conv.turns.reduce((n: number, t: any) => n + (t.tokens?.input ?? 0), 0), output: conv.turns.reduce((n: number, t: any) => n + (t.tokens?.output ?? 0), 0) };
      conv.costUsd = conv.turns.reduce((n: number, t: any) => n + (t.costUsd?.charged ?? 0), 0);
      conv.calls = conv.turns.reduce((n: number, t: any) => n + (t.httpCalls?.filter((c: any) => !c.refused).length ?? 0), 0);
      if (conversationId) {
        const loaded = await loadConversation(conversationId, scenarioHousehold ? (bindingHousehold ? BINDING_ACCOUNT : stressHousehold ? STRESS_ACCOUNT : SCENARIO_ACCOUNT) : undefined);
        // The scenario household is graded separately (scripts/rag2-live/scenario-check.ts, written before the run).
        const verdict: Verdict = scenarioHousehold ? { scenario: s.id, verdict: "INCOMPLETE", failureStage: null, incomplete: "graded by scenario-check.ts", checks: [] } as unknown as Verdict : grade(s, loaded);
        if (scenarioHousehold) conv.loaded = { conversationId: loaded.conversationId, state: loaded.state, turns: loaded.turns };
        conv.verdict = verdict;
        const st = loaded.state?.ragLoop ?? {};
        conv.saved = {
          subjectId: st.subjectId ?? null, speakerId: st.speakerId ?? null, pending: st.pending ?? null, claim: st.claim ?? null,
          traces: (st.turns ?? []).map((t: any) => ({ turn: t.turn, modelId: t.modelId, outcome: t.outcome, steps: t.steps, usage: t.usage, latencyMs: t.latencyMs, limit: t.limit, toolCalls: t.toolCalls, evidenceChosen: t.evidenceChosen, dropped: t.dropped, gate: t.gate, reasked: t.reasked ?? null, corrections: t.corrections ?? null })),
          evidence: st.evidence ?? {},
          answers: loaded.turns.map((t) => ({ turn: t.index + 1, resolvedFamilyMemberId: t.answer.resolvedFamilyMemberId ?? null, citations: t.answer.citations ?? [], figureBindings: (t.answer as any).figureBindings ?? [], calculations: (t.answer as any).calculations ?? [], computations: (t.answer as any).computations ?? [], questions: t.answer.questions ?? [] })),
        };
      }
      fs.writeFileSync(path.join(outDir, `conv-${s.id}.json`), JSON.stringify(conv, null, 2));
      runRecord.conversations.push(conv);
      console.log(`${s.id} ${conv.verdict?.verdict ?? "NO ANSWER"}${conv.verdict?.failureStage ? " (" + conv.verdict.failureStage + ")" : ""} -- ${conv.calls} calls, US$${conv.costUsd.toFixed(5)}, ${conv.totalMs} ms`);
    }
    const fin = await budget();
    runRecord.finishedAt = new Date().toISOString();
    runRecord.budgetUsed = fin.ledger;
    runRecord.httpCalls = runRecord.conversations.flatMap((c: any) => (c.turns ?? []).flatMap((t: any) => t.httpCalls ?? []));
    const allRelay = relayLog ? relayLines(relayLog, started.getTime(), Date.now()) : [];
    // Direct mode (no relay): the same facts come from the guard's per-call records.
    const sent = fin.httpCalls.filter((c: any) => !c.refused);
    const seen = allRelay.length ? allRelay.map((l) => ({ model: l.provider_model, sys: l.system_prompt_sha256, tools: l.tools_sha256, settings: l.settings }))
      : fin.calls.filter((c: any) => !c.refused).map((c: any, k: number) => ({ model: c.resolvedModel ?? sent[k]?.providerModel, sys: c.systemPromptSha256, tools: c.toolsSha256, settings: sent[k]?.settings ?? c.settings }));
    for (const c of sent) if (c.providerModel) seen.push({ model: c.providerModel, sys: null, tools: null, settings: c.settings });
    runRecord.providerModels = [...new Set(seen.map((l: any) => l.model).filter(Boolean))];
    runRecord.promptObserved = { systemPromptSha256: [...new Set(seen.map((l: any) => l.sys).filter(Boolean))], toolSchemaSha256: [...new Set(seen.map((l: any) => l.tools).filter(Boolean))], settings: [...new Set(seen.filter((l: any) => l.settings).map((l: any) => JSON.stringify(l.settings)))].map((x) => JSON.parse(x as string)) };
    runRecord.promptMatchesSource = runRecord.promptObserved.systemPromptSha256.every((h: string) => h === meta.prompt.systemPromptSha256) && runRecord.promptObserved.toolSchemaSha256.every((h: string) => h === meta.prompt.toolSchemaSha256);
    fs.writeFileSync(path.join(outDir, "relay.jsonl"), allRelay.map((l) => JSON.stringify(l)).join("\n") + "\n");
    fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(topFirst(runRecord), null, 2));
    fs.writeFileSync(path.join(outDir, "report.md"), writeReport(runRecord));
    written = true;
    console.log(`wrote ${outDir}`);
  } catch (error) {
    runRecord.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    throw error;
  } finally {
    if (!written) {
      // A crashed run still leaves its spend on record (the cumulative ledger reads budgetUsed from run.json).
      runRecord.budgetUsed = await budget().then((b) => b.ledger).catch(() => null);
      runRecord.httpCalls = await budget().then((b) => b.httpCalls).catch(() => []);
      try { fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify(topFirst(runRecord), null, 2)); fs.writeFileSync(path.join(outDir, "report.md"), writeReport(runRecord)); } catch { /* keep the original error */ }
    }
    server.kill("SIGTERM");
    log.end();
    await pool.end().catch(() => undefined);
  }
}
/** run.json opens with what a reader needs first: the shas, the models, the settings sent and the per-call table. */
function topFirst(r: any) {
  const { testedCodeSha, requestSha, modelsRequested, providerModels, promptObserved, httpCalls, budgetUsed, ...rest } = r;
  return { testedCodeSha, requestSha, modelsRequested, providerModels, requestSettingsSent: promptObserved?.settings ?? [], budgetUsed,
    perCall: (httpCalls ?? []).map((c: any) => ({ seq: c.seq, scenario: c.scenario, turn: c.turn, model: c.model, providerModel: c.providerModel ?? null, status: c.status ?? null, refused: c.refused ?? null, input: c.usage?.input ?? 0, output: c.usage?.output ?? 0, cached: c.usage?.cached ?? 0, reasoning: c.usage?.reasoning ?? null, reservedUsd: c.reservedUsd, chargedUsd: c.chargedUsd, upstreamMs: c.upstreamMs ?? null })),
    promptObserved, ...rest, httpCalls };
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
