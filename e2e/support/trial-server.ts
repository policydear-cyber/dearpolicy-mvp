/**
 * The owner's hands-on TRIAL server (GitHub Codespace; scripts/trial/start.sh starts it): the real app -- the production
 * `next build` served in-process, as `next start` -- on 0.0.0.0:3000 with
 *   local PostgreSQL, STORAGE_DRIVER=local (.trial/storage), prototype malware mode (no scanner), the development identity
 *   of ONE synthetic household created the way sign-up creates one (lib/household/repo.ts ensureDefaultHousehold; kept
 *   in .trial/account.json so a restart keeps the household), the conversational loop on, uploads advanced by the
 *   request drain, and every model role openai:gpt-6-luna.
 * Every model request goes through the live tests' process-wide fetch guard (reserve the worst case before sending,
 * bounded output, priced model, other providers / Pinecone / VirusTotal refused) on a ledger PERSISTED in
 * .trial/ledger.json with the trial cap (TRIAL_CAP_USD = the open trial allocation in docs/rag-migration/live/LEDGER.json). Safety checks: e2e/support/trial-guard.ts.
 *   GET /__trial/usage   cap, spent, remaining, calls, refusals, preflight (no content, no headers, no key)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import next from "next";
import { RunCapGuardModel } from "./rag2-live-guard";
import { installFetchGuard } from "./rag2-live-fetch-guard";
import { codespacesSameOrigin, PersistentTrialLedger, TRIAL_PREFLIGHT_REFUSAL, trialSafetyChecks } from "./trial-guard";
import { HostedLoopModel } from "@/lib/rag2/loop/hosted-model";
import { installSharedRunLedger } from "@/lib/rag2/loop/usage-meter";

const KEY = Symbol.for("dearpolicy.rag2.loop.model");
const trial = (() => { try { return trialSafetyChecks(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); } })();
const dir = path.resolve(".trial");
fs.mkdirSync(dir, { recursive: true });
const ledger = (() => { try { return new PersistentTrialLedger(path.join(dir, "ledger.json"), trial.capUsd, { allocationId: process.env.TRIAL_ALLOCATION_ID!, codespace: process.env.CODESPACE_NAME! }); } catch (e) { console.error("trial mode refused: " + (e instanceof Error ? e.message : String(e))); process.exit(1); } })();
installSharedRunLedger(ledger);
const fetchGuard = installFetchGuard({ ledger, preflightRefusal: trial.preflight ? TRIAL_PREFLIGHT_REFUSAL : null });
const port = Number(process.env.PORT ?? 3000);

async function account(): Promise<{ userId: string; householdId: string }> {
  const file = path.join(dir, "account.json");
  try { const a = JSON.parse(fs.readFileSync(file, "utf8")); if (a.userId && a.householdId) return a; } catch { /* first start */ }
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const userId = randomUUID();
  const householdId = await ensureDefaultHousehold(userId, "SYNTHETIC-DPTEST-trial");
  const a = { userId, householdId, createdAt: new Date().toISOString(), note: "synthetic trial household (sign-up path: ensureDefaultHousehold)" };
  fs.writeFileSync(file, JSON.stringify(a, null, 2) + "\n");
  return a;
}

async function main() {
  const acct = await account();
  Object.assign(process.env, {
    DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: acct.userId, DEARPOLICY_RAG_LOOP: "1",
    STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(dir, "storage"), MALWARE_SCANNING_INTENTIONALLY_DISABLED: "true",
    // A production build compiles NODE_ENV checks as "production": the upload intent needs a server secret.
    UPLOAD_INTENT_SECRET: process.env.UPLOAD_INTENT_SECRET || randomBytes(32).toString("hex"),
  });
  for (const k of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_TEST_API_KEY"]) delete process.env[k];
  // hostname "localhost": the app's own origin (middleware's nextUrl) is http://localhost:<port>; the HTTP server below
  // still listens on 0.0.0.0 so Codespaces can forward the port.
  const app = next({ dev: false, dir: process.cwd(), port, hostname: "localhost" });
  await app.prepare();
  const handle = app.getRequestHandler();
  const guard = new RunCapGuardModel(new HostedLoopModel(trial.choice), ledger, trial.price, trial.preflight, { reserve: false });
  (globalThis as Record<symbol, unknown>)[KEY] = guard;
  http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/__trial/usage") {
      const s = ledger.state();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({
        mode: trial.preflight ? "preflight (no OPENAI_TEST_API_KEY: every model call is refused)" : "live", model: guard.id, pricePerMillion: trial.price,
        capUsd: s.capUsd, spentUsd: s.spentUsd, inflightUsd: s.inflightUsd, remainingUsd: Math.round(ledger.remainingUsd * 1e6) / 1e6,
        calls: s.calls, refusals: s.refusals, restarts: s.restarts, since: s.startedAt, ledgerFile: ".trial/ledger.json",
        thisProcess: { requests: fetchGuard.calls.length, refused: fetchGuard.calls.filter((c) => c.refused).length },
      }, null, 2));
      return;
    }
    if (url.pathname.startsWith("/__")) { res.writeHead(404).end(); return; }
    const same = codespacesSameOrigin(req.headers, process.env, port);
    if (same?.origin) req.headers.origin = same.origin;
    if (same?.referer) req.headers.referer = same.referer;
    void handle(req, res);
  }).listen(port, "0.0.0.0", () => console.log(`trial server on http://0.0.0.0:${port} (model ${guard.id}${trial.preflight ? ", PREFLIGHT: no OPENAI_TEST_API_KEY" : ""}; trial cap US$${trial.capUsd}, spent US$${ledger.state().spentUsd.toFixed(4)}, remaining US$${ledger.remainingUsd.toFixed(4)})`));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
