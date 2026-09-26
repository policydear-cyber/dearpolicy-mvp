#!/usr/bin/env node
/**
 * Local fake of the two VirusTotal v3 endpoints the REAL adapter
 * (lib/scanning/adapters/virustotal.ts) calls, for the production-topology
 * proof only. Verdict by synthetic marker; records the sha256 of every
 * submitted file so the proof can show which documents were (not) scanned.
 * Never sees a real document: the proof seeds synthetic PDFs only.
 */
import http from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.FAKE_SERVICES_PORT ?? 4010);
const KEY = process.env.FAKE_VIRUSTOTAL_KEY ?? "synthetic-topology-virustotal-key";
const analyses = new Map();
const stats = { submissions: 0, analysisPolls: 0, rejectedAuth: 0, submittedSha256: [] };
let seq = 0;
const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/__stats") return send(res, 200, stats);
    if (url.pathname === "/__health") return send(res, 200, { ok: true });
    if (!url.pathname.startsWith("/vt/")) return send(res, 404, { error: { code: "NotFoundError" } });
    if (req.headers["x-apikey"] !== KEY) { stats.rejectedAuth++; return send(res, 401, { error: { code: "WrongCredentialsError" } }); }
    if (req.method === "POST" && url.pathname === "/vt/files") {
      const raw = Buffer.concat(chunks);
      // Multipart body: hash the PDF part (from %PDF to %%EOF) so it matches
      // the sha256 of the stored synthetic file.
      const text = raw.toString("latin1");
      const start = text.indexOf("%PDF"), end = text.lastIndexOf("%%EOF");
      const pdf = start >= 0 && end > start ? raw.subarray(start, end + 5) : raw;
      stats.submissions++;
      stats.submittedSha256.push(createHash("sha256").update(pdf).digest("hex"));
      const verdict = text.includes("SYNTHETIC-DPTEST-MALICIOUS-VERDICT-MARKER") ? "malicious" : "clean";
      const id = `syn-${verdict}-${++seq}`;
      analyses.set(id, verdict);
      return send(res, 200, { data: { type: "analysis", id } });
    }
    const m = /^\/vt\/analyses\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      stats.analysisPolls++;
      const verdict = analyses.get(decodeURIComponent(m[1]));
      if (!verdict) return send(res, 404, { error: { code: "NotFoundError" } });
      const s = verdict === "malicious"
        ? { malicious: 3, suspicious: 1, harmless: 0, undetected: 60, timeout: 0 }
        : { malicious: 0, suspicious: 0, harmless: 0, undetected: 64, timeout: 0 };
      return send(res, 200, { data: { attributes: { status: "completed", stats: s } } });
    }
    send(res, 404, { error: { code: "NotFoundError" } });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`fake-virustotal: listening on 127.0.0.1:${PORT}`));
