/**
 * TEST-ONLY server for the browser spec e2e/tests/rag2-conversation.spec.ts: the real Next.js app (next dev,
 * in-process) with DEARPOLICY_RAG_LOOP=1, the development identity of the synthetic household Tan, the LOCAL
 * PostgreSQL database seeded by e2e/support/seed-rag2-conversation.ts -- and the adversarial suite's scripted model
 * (scripts/fixtures/rag2-adv) installed through the public installLoopModel() hook. The model is chosen per test by
 *   POST /__rag2adv/scenario {"id":"S3"}
 * and the persisted rows are read back by
 *   GET /__rag2adv/last            (latest assistant chat_message + conversation state of household Tan)
 * Every other request goes to Next.js unchanged (the real chat page and the real /api/chat route).
 * Refuses to start in a production build, on Vercel, without the loop flag, or against a non-local database.
 *
 *   DATABASE_URL=postgres://...@localhost/... DEARPOLICY_RAG_LOOP=1 PORT=3300 node --import tsx e2e/support/rag2-loop-server.ts
 * E2E_RAG2_NEXT=start serves the existing `next build` output (.next) in-process instead of next dev -- the same as
 * `next start` but keeping the two test routes above; much lighter on memory. NODE_ENV must still not be
 * "production" (run it with NODE_ENV=test), so the production refusal above is unchanged.
 *
 * E2E_RAG2_LIVE=1 (the live-model smoke, scripts/rag2-live): signs in as the synthetic household Lim
 * (scripts/fixtures/rag2-live), never installs a scripted model and never turns on the deterministic stand-in: the
 * loop calls the REAL configured chat model (lib/rag2/loop/hosted-model.ts) through OPENAI_BASE_URL, which must be
 * the loopback relay, behind the run-cap guard (e2e/support/rag2-live-guard.ts). The scripted-model routes answer
 * 404; GET /__rag2live/budget reports the guard's ledger and per-call records. RAG2_LIVE_MODE=direct (GitHub Actions
 * only) calls OpenAI directly with the repository secret; RAG2_LIVE_PREFLIGHT=1 refuses the first model call. Refuses to start unless every live
 * safety check passes (NODE_ENV=test, local database, Vercel unset, loopback base URL, dummy key, cap <= US$0.50,
 * priced model).
 */
import http from "node:http";
import next from "next";
import { ACCOUNT_T } from "../../scripts/fixtures/rag2-adv/household";
import { AdvModel } from "../../scripts/fixtures/rag2-adv/model";
import { ALL } from "../../scripts/fixtures/rag2-adv/scenarios";
import { ACCOUNT_L } from "../../scripts/fixtures/rag2-live/household";
import { ACCOUNT as ACCOUNT_R } from "../../scripts/fixtures/rag2-stress/report-household";
import { REPORT_SCENARIOS } from "../../scripts/fixtures/rag2-stress/report-conversations";
import { ACCOUNT as ACCOUNT_B } from "../../scripts/fixtures/rag2-binding/household";
import { BINDING_SCENARIOS } from "../../scripts/fixtures/rag2-binding/conversations";
import { recordedRun, recordedTurns, replayScript, runDir } from "../../scripts/fixtures/rag2-live-replay";
import { ACCOUNT as ACCOUNT_LL } from "../../scripts/fixtures/rag2-livelib/household";
import { LIVELIB_SCENARIOS } from "../../scripts/fixtures/rag2-livelib/conversations";
import { ACCOUNT as ACCOUNT_P50 } from "../../scripts/fixtures/rag2-pr50/household";
import { PR50_SCENARIOS } from "../../scripts/fixtures/rag2-pr50/conversations";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";
import { ACCOUNT as ACCOUNT_TAN } from "../../scripts/fixtures/reliable-chat/tan";
import { TAN_SCENARIOS } from "../../scripts/fixtures/reliable-chat/conversations";
import { ACCOUNT as ACCOUNT_BK } from "../../scripts/fixtures/reliable-chat/booklet";
import { BOOKLET_SCENARIOS } from "../../scripts/fixtures/reliable-chat/booklet-conversations";
import { ACCOUNT as ACCOUNT_AL } from "../../scripts/fixtures/reliable-chat/actual-lib";
import { ACTUAL_SCENARIOS } from "../../scripts/fixtures/reliable-chat/actual-lib-conversations";
import { ACCOUNT as ACCOUNT_FR } from "../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FRACTURE_SCENARIOS } from "../../scripts/fixtures/reliable-chat/fracture-scenarios";
import { GP_SCENARIOS } from "../../scripts/fixtures/reliable-chat/gp-bill";
import { FX_REPAIR_SCENARIOS } from "../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { DEATH_SCENARIOS } from "../../scripts/fixtures/reliable-chat/death-journey-conversations";
import { ACCOUNT as ACCOUNT_DV } from "../../scripts/fixtures/reliable-chat/death-journey-actual-values";
import { DIQ_SCENARIO } from "../../scripts/fixtures/reliable-chat/open-question-scenario";
import { MeteredScriptedModel } from "../../scripts/fixtures/reliable-chat/metered-model";
import { liveSafetyChecks, PREFLIGHT_REFUSAL, RunCapGuardModel } from "./rag2-live-guard";
import { installFetchGuard } from "./rag2-live-fetch-guard";
import { HostedLoopModel } from "@/lib/rag2/loop/hosted-model";
import { installSharedRunLedger, RunCostLedger } from "@/lib/rag2/loop/usage-meter";

const KEY = Symbol.for("dearpolicy.rag2.loop.model");
if (process.env.NODE_ENV === "production" || (process.env.VERCEL ?? "") || (process.env.VERCEL_ENV ?? "")) throw new Error("test-only server refused in a production build");
if (process.env.DEARPOLICY_RAG_LOOP !== "1") throw new Error("set DEARPOLICY_RAG_LOOP=1");
const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`refusing non-local database host "${host}"`);
const LIVE = process.env.E2E_RAG2_LIVE === "1";
const live = LIVE ? liveSafetyChecks() : null;
// ONE run ledger for the whole process, and a guard on globalThis.fetch installed BEFORE Next.js exists: every model
// request the server makes (the loop, lib/ai judgement / narration / reading, retries, verification) is reserved and
// settled on it, or refused (e2e/support/rag2-live-fetch-guard.ts).
const runLedger = live ? new RunCostLedger(live.capUsd) : null;
if (runLedger) installSharedRunLedger(runLedger);
const fetchGuard = live && runLedger ? installFetchGuard({ ledger: runLedger, preflightRefusal: live.preflight ? PREFLIGHT_REFUSAL : null }) : null;
process.env.DEV_AUTH_ENABLED = "1";
// PR #47 reproduction: RAG2_LIVE_HOUSEHOLD=scenario signs in as the scenario-completion suite's synthetic household.
// V1.3: RAG2_LIVE_HOUSEHOLD=stress signs in as the stress-test structures' synthetic household.
// V1.5: E2E_RAG2_HOUSEHOLD=pr50 serves P50D/P50C/P50A (the live failures after PR #50; PR50_NAMES picks the file names).
// V1.3: E2E_RAG2_HOUSEHOLD=report (scripted, never live) signs in as the report-layout household
// (scripts/fixtures/rag2-stress/report-household.ts, seeded by e2e/support/seed-rag2-stress-report.ts); its scripted
// conversations are chosen per test by POST /__rag2stress/scenario {"id":"R1"} and read back by GET /__rag2stress/last.
// V1.4: E2E_RAG2_HOUSEHOLD=binding does the same for the binding household (scripts/fixtures/rag2-binding).
// E2E_RAG2_HOUSEHOLD=binding-cells: the binding household with the certificate one cell per line, and scenario R50 --
// the recorded model output of the actual-model run s50-live-2, replayed verbatim (no model call).
// E2E_RAG2_HOUSEHOLD=livelib also serves R52A-R52D: the recorded model output of the actual-model run s52-live-1, one
// scenario per recorded conversation, replayed verbatim (no model call).
const S52_REPLAY = () => recordedRun(runDir("RUN-s52-live-1-")).map((c) => ({ id: "R" + c.scenario.slice(1), title: `replay of s52-live-1 ${c.scenario}`, messages: c.turns.map((t) => t.user), turns: replayScript(c.turns) }));
const S50_REPLAY = () => { const turns = recordedTurns(runDir("RUN-s50-live-2-"), "S50"); return [{ id: "R50", title: "replay of s50-live-2", messages: turns.map((t) => t.user), turns: replayScript(turns) }]; };
// dj-live-3 (answer completeness): E2E_RAG2_HOUSEHOLD=deathvalues serves the recorded DI turn of the live run, replayed verbatim (no model call).
const DJI3_REPLAY = () => { const turns = recordedTurns(runDir("RUN-dj-live-3-2"), "DI"); return [{ id: "DI3", title: "replay of dj-live-3 DI", messages: turns.map((t) => t.user), turns: replayScript(turns) }]; };
const SCRIPTED_HH = LIVE ? null : process.env.E2E_RAG2_HOUSEHOLD === "deathvalues" ? { account: ACCOUNT_DV, scenarios: [...DJI3_REPLAY(), DIQ_SCENARIO()] } : process.env.E2E_RAG2_HOUSEHOLD === "report" ? { account: ACCOUNT_R, scenarios: REPORT_SCENARIOS } : process.env.E2E_RAG2_HOUSEHOLD === "binding" ? { account: ACCOUNT_B, scenarios: BINDING_SCENARIOS } : process.env.E2E_RAG2_HOUSEHOLD === "binding-cells" ? { account: ACCOUNT_B, scenarios: S50_REPLAY() } : process.env.E2E_RAG2_HOUSEHOLD === "livelib" ? { account: ACCOUNT_LL, scenarios: [...LIVELIB_SCENARIOS, ...S52_REPLAY()] } : process.env.E2E_RAG2_HOUSEHOLD === "pr50" ? { account: ACCOUNT_P50, scenarios: PR50_SCENARIOS } : process.env.E2E_RAG2_HOUSEHOLD === "tan" ? { account: ACCOUNT_TAN, scenarios: TAN_SCENARIOS() } : process.env.E2E_RAG2_HOUSEHOLD === "booklet" ? { account: ACCOUNT_BK, scenarios: BOOKLET_SCENARIOS() } : process.env.E2E_RAG2_HOUSEHOLD === "actuallib" ? { account: ACCOUNT_AL, scenarios: ACTUAL_SCENARIOS() } : process.env.E2E_RAG2_HOUSEHOLD === "deathjourney" ? { account: ACCOUNT_AL, scenarios: DEATH_SCENARIOS() } : process.env.E2E_RAG2_HOUSEHOLD === "gpbill" ? { account: ACCOUNT_FR, scenarios: GP_SCENARIOS() } : process.env.E2E_RAG2_HOUSEHOLD === "fracture" ? { account: ACCOUNT_FR, scenarios: [...FRACTURE_SCENARIOS(), ...FX_REPAIR_SCENARIOS()] } : null;
// Reliable chat: E2E_RAG2_HOUSEHOLD=tan (and RAG2_LIVE_HOUSEHOLD=tan) is the migrated contract's second household
// (scripts/fixtures/reliable-chat/tan.ts). Every other scripted household replays moves recorded for the earlier operand
// contract, so it keeps that contract until ported (scripts/fixtures/legacy-contract.ts; never in production).
if (!LIVE && process.env.E2E_RAG2_HOUSEHOLD !== "tan" && process.env.E2E_RAG2_HOUSEHOLD !== "booklet" && process.env.E2E_RAG2_HOUSEHOLD !== "actuallib" && process.env.E2E_RAG2_HOUSEHOLD !== "fracture" && process.env.E2E_RAG2_HOUSEHOLD !== "gpbill" && process.env.E2E_RAG2_HOUSEHOLD !== "deathjourney" && process.env.E2E_RAG2_HOUSEHOLD !== "deathvalues") process.env.DEARPOLICY_CHAT_CONTRACT ??= "legacy-operands";
const REPORT = !!SCRIPTED_HH;
process.env.DEV_ACCOUNT_ID = LIVE ? (process.env.RAG2_LIVE_HOUSEHOLD === "scenario" ? "00000000-0000-0000-0000-00000000c301" : process.env.RAG2_LIVE_HOUSEHOLD === "stress" ? "00000000-0000-0000-0000-00000000d401" : process.env.RAG2_LIVE_HOUSEHOLD === "livelib" ? ACCOUNT_LL : process.env.RAG2_LIVE_HOUSEHOLD === "pr50" ? ACCOUNT_P50 : process.env.RAG2_LIVE_HOUSEHOLD === "tan" ? ACCOUNT_TAN : process.env.RAG2_LIVE_HOUSEHOLD === "booklet" ? ACCOUNT_BK : (process.env.RAG2_LIVE_HOUSEHOLD === "actuallib" || process.env.RAG2_LIVE_HOUSEHOLD === "deathjourney") ? ACCOUNT_AL : process.env.RAG2_LIVE_HOUSEHOLD?.startsWith("binding") ? ACCOUNT_B : ACCOUNT_L) : SCRIPTED_HH ? SCRIPTED_HH.account : ACCOUNT_T;
if (!LIVE) process.env.DEARPOLICY_DETERMINISTIC_MODEL = process.env.DEARPOLICY_DETERMINISTIC_MODEL || "synthetic-e2e";
const port = Number(process.env.PORT ?? 3300);

async function main() {
  const app = next({ dev: process.env.E2E_RAG2_NEXT !== "start", dir: process.cwd(), port, hostname: "localhost" });
  await app.prepare();
  const handle = app.getRequestHandler();
  const { pool } = await import("@/lib/db/client");
  const guard = live ? new RunCapGuardModel(new HostedLoopModel(live.choice), runLedger!, live.price, live.preflight, { reserve: false }) : null;
  if (guard) (globalThis as Record<symbol, unknown>)[KEY] = guard;
  http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (LIVE && url.pathname.startsWith("/__rag2adv/")) { res.writeHead(404).end(JSON.stringify({ error: "scripted-model routes are off in the live server" })); return; }
    if (guard && url.pathname === "/__rag2live/budget") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: guard.id, price: guard.price, mode: live!.mode, preflight: guard.preflight, ledger: { ...guard.ledger.snapshot(), failed: fetchGuard?.calls.filter((c) => !c.refused && !c.ok).length ?? 0 }, calls: guard.calls, httpCalls: fetchGuard?.calls ?? [] }));
      return;
    }
    if (url.pathname.startsWith("/__rag2stress/")) {
      if (!REPORT) { res.writeHead(404).end(JSON.stringify({ error: "start the server with E2E_RAG2_HOUSEHOLD=report or binding" })); return; }
      if (url.pathname === "/__rag2stress/scenario" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const s = SCRIPTED_HH!.scenarios.find((x) => x.id === (JSON.parse(body || "{}") as { id?: string }).id);
        if (!s) { res.writeHead(404).end(JSON.stringify({ error: "unknown scenario" })); return; }
        (globalThis as Record<symbol, unknown>)[KEY] = "metered" in s && typeof s.metered === "number" ? new MeteredScriptedModel(s.turns, s.metered) : new ScriptedLoopModel(s.turns);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, id: s.id, messages: s.messages }));
        return;
      }
      if (url.pathname === "/__rag2stress/last") {
        const m = (await pool.query("SELECT conversation_id::text AS conversation_id, content, answer_json FROM chat_messages WHERE account_id=$1 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [SCRIPTED_HH!.account])).rows[0];
        const c = m ? (await pool.query("SELECT state FROM chat_conversations WHERE id=$1 AND account_id=$2", [m.conversation_id, SCRIPTED_HH!.account])).rows[0] : null;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: m ?? null, state: c?.state ?? null }));
        return;
      }
    }
    if (REPORT && url.pathname.startsWith("/__rag2adv/")) { res.writeHead(404).end(JSON.stringify({ error: "the report-layout server runs the /__rag2stress/ routes only" })); return; }
    if (url.pathname === "/__rag2adv/scenario" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const id = (JSON.parse(body || "{}") as { id?: string }).id;
      const s = ALL.find((x) => x.id === id);
      if (!s) { res.writeHead(404).end(JSON.stringify({ error: "unknown scenario " + id })); return; }
      if (s.account !== "T") { res.writeHead(400).end(JSON.stringify({ error: "the browser server runs as household Tan only" })); return; }
      (globalThis as Record<symbol, unknown>)[KEY] = new AdvModel(s.turns);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, id, messages: s.messages }));
      return;
    }
    if (url.pathname === "/__rag2adv/last") {
      const m = (await pool.query("SELECT conversation_id::text AS conversation_id, content, answer_json FROM chat_messages WHERE account_id=$1 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [ACCOUNT_T])).rows[0];
      const c = m ? (await pool.query("SELECT state FROM chat_conversations WHERE id=$1 AND account_id=$2", [m.conversation_id, ACCOUNT_T])).rows[0] : null;
      const other = (await pool.query("SELECT count(*)::int AS n FROM chat_messages WHERE account_id<>$1 AND account_id IN (SELECT id FROM accounts WHERE name LIKE 'SYNTHETIC-DPTEST-rag2adv%')", [ACCOUNT_T])).rows[0];
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: m ?? null, state: c?.state ?? null, otherHouseholdMessages: other?.n ?? 0 }));
      return;
    }
    handle(req, res);
  }).listen(port, () => console.log(`rag2 loop test server on http://localhost:${port}${guard ? ` (LIVE model ${guard.id}, ${live!.mode} mode${guard.preflight ? ", PREFLIGHT" : ""}, run cap US$${guard.ledger.capUsd})` : ""}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
