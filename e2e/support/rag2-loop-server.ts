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
 */
import http from "node:http";
import next from "next";
import { ACCOUNT_T } from "../../scripts/fixtures/rag2-adv/household";
import { AdvModel } from "../../scripts/fixtures/rag2-adv/model";
import { ALL } from "../../scripts/fixtures/rag2-adv/scenarios";

const KEY = Symbol.for("dearpolicy.rag2.loop.model");
if (process.env.NODE_ENV === "production" || (process.env.VERCEL ?? "") || (process.env.VERCEL_ENV ?? "")) throw new Error("test-only server refused in a production build");
if (process.env.DEARPOLICY_RAG_LOOP !== "1") throw new Error("set DEARPOLICY_RAG_LOOP=1");
const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`refusing non-local database host "${host}"`);
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_ACCOUNT_ID = ACCOUNT_T;
process.env.DEARPOLICY_DETERMINISTIC_MODEL = process.env.DEARPOLICY_DETERMINISTIC_MODEL || "synthetic-e2e";
const port = Number(process.env.PORT ?? 3300);

async function main() {
  const app = next({ dev: process.env.E2E_RAG2_NEXT !== "start", dir: process.cwd(), port, hostname: "localhost" });
  await app.prepare();
  const handle = app.getRequestHandler();
  const { pool } = await import("@/lib/db/client");
  http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
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
  }).listen(port, () => console.log(`rag2 loop test server on http://localhost:${port}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
