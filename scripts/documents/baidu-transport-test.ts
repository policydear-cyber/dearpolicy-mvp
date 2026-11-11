/**
 * The node:https transport for Baidu PaddleOCR (lib/documents/baidu-transport.ts), against LOCAL test servers on
 * 127.0.0.1 (plain http). No Baidu, no token, no paid call. It checks the limits and the trace each failure records:
 * a reply that never comes, an upload the server stops reading, a refused connection, a reply that trickles past the
 * total limit, and a normal multipart submit. TLS (https) is not exercised here: it needs a real certificate.
 *   node --import tsx scripts/documents/baidu-transport-test.ts
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { TransportError, traceSummary, transportRequest } from "@/lib/documents/baidu-transport";

const sockets = new Set<Socket>();
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function close(server: Server) {
  for (const s of sockets) s.destroy();
  await new Promise<void>((r) => server.close(() => r()));
}
async function failure(p: Promise<unknown>): Promise<TransportError> {
  try { await p; } catch (error) { assert.ok(error instanceof TransportError, `expected TransportError, got ${String(error)}`); return error; }
  assert.fail("expected the call to fail");
}
const limits = { connectTimeoutMs: 2_000, idleTimeoutMs: 400, totalTimeoutMs: 5_000 };
const TOKEN = "test-token-NOT-REAL-7f3c";

async function main() {
  // 1. A normal multipart submit: the fields, the file, a known length, the auth header; the JSON reply comes back.
  {
    let got: { auth?: string; type?: string; length?: string; body?: string } = {};
    const { server, url } = await serve((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        got = { auth: req.headers.authorization, type: req.headers["content-type"], length: req.headers["content-length"], body: Buffer.concat(parts).toString("latin1") };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, data: { jobId: "job-1" } }));
      });
    });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([37, 80, 68, 70, 1, 2, 3])], { type: "application/pdf" }), "pages.pdf");
    form.append("model", "PaddleOCR-VL-1.6");
    const res = await transportRequest(`${url}/api/v2/ocr/jobs`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: form }, limits);
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { code: 0, data: { jobId: "job-1" } });
    assert.equal(got.auth, `Bearer ${TOKEN}`);
    assert.match(got.type ?? "", /^multipart\/form-data; boundary=/);
    assert.equal(Number(got.length), Buffer.byteLength(got.body ?? "", "latin1"), "a known Content-Length, not chunked");
    assert.match(got.body ?? "", /name="model"\r\n\r\nPaddleOCR-VL-1\.6/);
    assert.match(got.body ?? "", /filename="pages\.pdf"/);
    await close(server);
  }

  // 2. The server reads the whole upload and never replies: a timeout AT "reply", with everything sent.
  {
    const { server, url } = await serve((req) => { req.resume(); });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(200_000)]), "pages.pdf");
    const e = await failure(transportRequest(`${url}/x`, { method: "POST", body: form }, limits));
    assert.equal(e.kind, "timeout");
    assert.equal(e.trace.phase, "reply");
    assert.equal(e.trace.sentBytes, e.trace.totalBytes);
    assert.ok(e.trace.uploadedMs !== undefined && e.trace.connectMs !== undefined);
    assert.ok(e.trace.elapsedMs >= 350 && e.trace.elapsedMs < 2_000, `idle limit, not the total (${e.trace.elapsedMs} ms)`);
    await close(server);
  }

  // 3. The server stops reading the upload: a timeout AT "upload", part-way, and the summary says how far.
  {
    const { server, url } = await serve((req) => { req.pause(); req.socket.pause(); });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(48 * 1024 * 1024)]), "pages.pdf");
    const e = await failure(transportRequest(`${url}/x`, { method: "POST", body: form }, { ...limits, idleTimeoutMs: 600 }));
    assert.equal(e.kind, "timeout");
    assert.equal(e.trace.phase, "upload");
    assert.ok(e.trace.sentBytes < e.trace.totalBytes, "stalled part-way");
    assert.match(traceSummary(e.trace), /^at=upload sent=[\d.]+\/48\.\dMB .*ip=4:127\.0\.0\.1 t=\d+\.\ds$/);
    await close(server);
  }

  // 4. A refused connection: a network failure AT "connect", with the system code.
  {
    const { server, url } = await serve(() => undefined);
    await close(server);
    const e = await failure(transportRequest(`${url}/x`, { method: "GET" }, limits));
    assert.equal(e.kind, "network");
    assert.equal(e.trace.phase, "connect");
    assert.equal(e.code, "ECONNREFUSED");
  }

  // 5. A reply that keeps trickling (never idle) still ends at the total limit, AT "body".
  {
    const { server, url } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const t = setInterval(() => res.write(" "), 100);
      res.on("close", () => clearInterval(t));
    });
    const e = await failure(transportRequest(`${url}/x`, { method: "GET" }, { ...limits, totalTimeoutMs: 900 }));
    assert.equal(e.kind, "timeout");
    assert.equal(e.trace.phase, "body");
    assert.ok(e.trace.firstByteMs !== undefined);
    assert.ok(e.trace.elapsedMs >= 850 && e.trace.elapsedMs < 2_000);
    await close(server);
  }

  // 6. A host name is looked up (IPv4 only by default) and the lookup is timed; the summary never holds a path or token.
  {
    const { server, url } = await serve((_req, res) => { res.end("{}"); });
    const port = new URL(url).port;
    const res = await transportRequest(`http://localhost:${port}/secret/path?token=${TOKEN}`, { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }, limits);
    assert.equal(res.status, 200);
    const { server: s2, url: u2 } = await serve((req) => { req.resume(); });
    const e = await failure(transportRequest(`http://localhost:${new URL(u2).port}/secret/path?token=${TOKEN}`, { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }, limits));
    assert.equal(e.trace.family, 4);
    assert.ok(e.trace.dnsMs !== undefined);
    const summary = traceSummary(e.trace);
    assert.ok(!summary.includes("secret") && !summary.includes(TOKEN) && !summary.includes("localhost"), summary);
    await close(server); await close(s2);
  }

  console.log("DearPolicy Baidu transport (local servers): multipart submit, idle limit at reply, stalled upload, refused connection, total limit while trickling, IPv4 lookup, no path or token in the trace -- passed. TLS and Baidu's live service are NOT covered.");
}

main().catch((error) => { console.error(error); process.exit(1); });
