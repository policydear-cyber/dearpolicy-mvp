#!/usr/bin/env node
/**
 * Local fake of the two VirusTotal v3 endpoints DearPolicy's REAL adapter
 * (lib/scanning/adapters/virustotal.ts) calls: POST /files and
 * GET /analyses/{id}. Verdicts are decided by synthetic text markers only:
 *   SYNTHETIC-DPTEST-MALICIOUS-VERDICT-MARKER    -> completed, malicious=3
 *   SYNTHETIC-DPTEST-SCAN-NEVER-COMPLETES-MARKER -> stays "queued" forever
 *   SYNTHETIC-DPTEST-SCAN-PROVIDER-ERROR-MARKER  -> the submission fails (HTTP 500)
 *   anything else                                -> completed, clean
 * Requires the synthetic API key; records every call so the browser suite
 * can prove the adapter was actually exercised (GET /__stats).
 */
import http from "node:http";

const PORT = Number(process.env.FAKE_SERVICES_PORT ?? 4010);
const KEY = process.env.FAKE_VIRUSTOTAL_KEY ?? "synthetic-e2e-virustotal-key";
const analyses = new Map();
const stats = { submissions: 0, analysisPolls: 0, rejectedAuth: 0, providerErrors: 0, verdicts: { clean: 0, malicious: 0, pending: 0 } };
let seq = 0;

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/__stats") return send(res, 200, stats);
    if (url.pathname === "/__health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/vt/")) {
      if (req.headers["x-apikey"] !== KEY) { stats.rejectedAuth++; return send(res, 401, { error: { code: "WrongCredentialsError", message: "Wrong API key" } }); }
      if (req.method === "POST" && url.pathname === "/vt/files") {
        stats.submissions++;
        const body = Buffer.concat(chunks).toString("latin1");
        if (body.includes("SYNTHETIC-DPTEST-SCAN-PROVIDER-ERROR-MARKER")) {
          stats.providerErrors++;
          return send(res, 500, { error: { code: "InternalError", message: "synthetic provider failure" } });
        }
        const verdict = body.includes("SYNTHETIC-DPTEST-MALICIOUS-VERDICT-MARKER") ? "malicious"
          : body.includes("SYNTHETIC-DPTEST-SCAN-NEVER-COMPLETES-MARKER") ? "pending" : "clean";
        const id = `syn-${verdict}-${++seq}`;
        analyses.set(id, verdict);
        stats.verdicts[verdict]++;
        return send(res, 200, { data: { type: "analysis", id } });
      }
      const m = /^\/vt\/analyses\/(.+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        stats.analysisPolls++;
        const verdict = analyses.get(decodeURIComponent(m[1]));
        if (!verdict) return send(res, 404, { error: { code: "NotFoundError", message: "not found" } });
        if (verdict === "pending") return send(res, 200, { data: { attributes: { status: "queued" } } });
        const s = verdict === "malicious"
          ? { malicious: 3, suspicious: 1, harmless: 0, undetected: 60, timeout: 0 }
          : { malicious: 0, suspicious: 0, harmless: 0, undetected: 64, timeout: 0 };
        return send(res, 200, { data: { attributes: { status: "completed", stats: s } } });
      }
    }
    send(res, 404, { error: { code: "NotFoundError", message: "unknown fake endpoint" } });
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake-services: listening on 127.0.0.1:${PORT}`));
