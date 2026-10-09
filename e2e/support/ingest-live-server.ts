/**
 * TEST-ONLY server for the live ingestion test (scripts/ingest-live): the REAL app -- the production `next build`
 * served in-process (the same as `next start`) -- with
 *   STORAGE_DRIVER=local, prototype malware mode (MALWARE_SCANNING_INTENTIONALLY_DISABLED=true, no scanner),
 *   the development identity of ONE fresh synthetic account (INGEST_LIVE_USER_ID, provisioned by the harness the way
 *   sign-up does), the conversational loop on (DEARPOLICY_RAG_LOOP=1), and NO jobs worker: uploads advance through
 *   the bounded request drain that status polling triggers (lib/jobs/request-drain.ts), as on the Vercel prototype.
 * Every model call the process makes -- OCR, extraction, catalogue, conditions, ledger reading, relevance judging,
 * the conversation loop, retries -- goes through the SAME live guard as the rag2 live smoke: the process-wide fetch
 * guard (reserve worst case on the shared run ledger, settle from usage, refuse unbounded / unpriced / other-provider
 * requests) and the loop's run-cap guard. Safety checks: e2e/support/rag2-live-guard.ts liveSafetyChecks (NODE_ENV=test,
 * local database, Vercel unset, OpenAI only, cap <= US$0.50, every configured role resolving to the expected model).
 * RAG2_LIVE_PREFLIGHT=1 refuses every model request (US$0): upload, storage, jobs and pages run; extraction stops at the
 * first model call.
 *   GET /__ingestlive/budget   the ledger and every guarded call (no content, no headers, no key)
 */
import http from "node:http";
import next from "next";
import { liveSafetyChecks, PREFLIGHT_REFUSAL, RunCapGuardModel } from "./rag2-live-guard";
import { installFetchGuard } from "./rag2-live-fetch-guard";
import { HostedLoopModel } from "@/lib/rag2/loop/hosted-model";
import { installSharedRunLedger, RunCostLedger } from "@/lib/rag2/loop/usage-meter";

const KEY = Symbol.for("dearpolicy.rag2.loop.model");
if (process.env.NODE_ENV === "production" || (process.env.VERCEL ?? "") || (process.env.VERCEL_ENV ?? "")) throw new Error("test-only server refused in a production build");
const userId = process.env.INGEST_LIVE_USER_ID ?? "";
if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("INGEST_LIVE_USER_ID (the fresh synthetic account) is required");
const live = liveSafetyChecks();
const ledger = new RunCostLedger(live.capUsd);
installSharedRunLedger(ledger);
const fetchGuard = installFetchGuard({ ledger, preflightRefusal: live.preflight ? PREFLIGHT_REFUSAL : null });
Object.assign(process.env, {
  DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: userId, DEARPOLICY_RAG_LOOP: "1",
  STORAGE_DRIVER: "local", MALWARE_SCANNING_INTENTIONALLY_DISABLED: "true",
});
for (const k of ["VIRUSTOTAL_API_KEY", "PINECONE_API_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEARPOLICY_DETERMINISTIC_MODEL"]) delete process.env[k];
const port = Number(process.env.PORT ?? 3320);

async function main() {
  const app = next({ dev: false, dir: process.cwd(), port, hostname: "localhost" });
  await app.prepare();
  const handle = app.getRequestHandler();
  const guard = new RunCapGuardModel(new HostedLoopModel(live.choice), ledger, live.price, live.preflight, { reserve: false });
  (globalThis as Record<symbol, unknown>)[KEY] = guard;
  http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/__ingestlive/budget") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: guard.id, price: guard.price, mode: live.mode, preflight: live.preflight,
        ledger: { ...ledger.snapshot(), failed: fetchGuard.calls.filter((c) => !c.refused && !c.ok).length }, loopCalls: guard.calls, httpCalls: fetchGuard.calls }));
      return;
    }
    if (url.pathname.startsWith("/__")) { res.writeHead(404).end(); return; }
    void handle(req, res);
  }).listen(port, () => console.log(`ingest live server on http://localhost:${port} (model ${guard.id}, ${live.mode} mode${live.preflight ? ", PREFLIGHT" : ""}, run cap US$${ledger.capUsd})`));
}
main().catch((e) => { console.error(e); process.exit(1); });
