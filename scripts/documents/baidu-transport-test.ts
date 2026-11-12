/**
 * The node:https transport for Baidu PaddleOCR (lib/documents/baidu-transport.ts), against LOCAL test servers on
 * 127.0.0.1 (plain http). No Baidu, no token, no paid call. It checks the limits and the trace each failure records:
 * a reply that never comes, an upload the server stops reading, a refused connection, a reply that trickles past the
 * total limit, and a normal multipart submit. TLS (https) is not exercised here: it needs a real certificate.
 *   node --import tsx scripts/documents/baidu-transport-test.ts
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo, Socket } from "node:net";
import { TransportError, baiduConnection, traceSummary, transportRequest } from "@/lib/documents/baidu-transport";
import { BAIDU_DEFAULT_VIA, baiduOcrSettings, baiduVia, readPdfWithBaidu, setBaiduTransportForTests, staleKeptConnection, viaHostFor } from "@/lib/documents/ocr-baidu";

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

  // 1b. A JSON submit (Baidu downloads the file from a link): sent as application/json once, with a known length.
  {
    let got: { type?: string | string[]; raw?: string[]; length?: string; body?: string } = {};
    const { server, url } = await serve((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        got = { type: req.headers["content-type"], raw: req.rawHeaders.filter((_, i) => i % 2 === 0).map((h) => h.toLowerCase()), length: req.headers["content-length"], body: Buffer.concat(parts).toString("utf8") };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, data: { jobId: "job-2" } }));
      });
    });
    const body = JSON.stringify({ fileUrl: "https://storage.example/f.pdf?token=x", model: "PaddleOCR-VL-1.6", optionalPayload: { useDocOrientationClassify: true } });
    const res = await transportRequest(`${url}/api/v2/ocr/jobs`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body }, limits);
    assert.deepEqual(await res.json(), { code: 0, data: { jobId: "job-2" } });
    assert.match(String(got.type), /^application\/json/);
    assert.equal(got.raw?.filter((h) => h === "content-type").length, 1, "content-type sent once");
    assert.equal(Number(got.length), Buffer.byteLength(body), "a known Content-Length");
    assert.deepEqual(JSON.parse(got.body ?? "{}"), JSON.parse(body));
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

  // 7. Kept-open connection (as Baidu's own client): polls and the result share ONE TCP connection; the later calls are
  //    marked reused and do no DNS/TCP/TLS of their own. The submit (POST) always opens its own connection. Without a
  //    kept connection each call opens its own.
  {
    let connections = 0;
    const { server, url } = await serve((req, res) => { req.resume(); req.on("end", () => res.end(JSON.stringify({ ok: req.method }))); });
    server.on("connection", () => { connections++; });
    const conn = baiduConnection();
    const first = await transportRequest(`${url}/api/v2/ocr/jobs`, { method: "POST", body: JSON.stringify({ a: 1 }) }, { ...limits, connection: conn });
    assert.equal(first.status, 200);
    for (let i = 0; i < 3; i++) {
      const got = await transportRequest(`${url}/api/v2/ocr/jobs/j${i}`, { method: "GET" }, { ...limits, connection: conn });
      assert.equal(got.status, 200);
    }
    assert.equal(connections, 2, "the POST on its own connection; three GETs on one kept connection");
    conn.close();
    connections = 0;
    for (let i = 0; i < 2; i++) await transportRequest(`${url}/x`, { method: "GET" }, limits);
    assert.equal(connections, 2, "without a kept connection each call opens its own");
    await close(server);
  }

  // 8. A kept-open connection the far end has dropped: the call fails as "network", marked reused, with no reply --
  //    exactly what staleKeptConnection recognises (the Baidu client then sends a GET once more on a new connection).
  {
    let n = 0;
    const { server, url } = await serve((req, res) => { req.resume(); n++; if (n === 2) { req.socket.destroy(); return; } res.end("{}"); });
    const conn = baiduConnection();
    await transportRequest(`${url}/a`, { method: "GET" }, { ...limits, connection: conn });
    const e = await failure(transportRequest(`${url}/b`, { method: "GET" }, { ...limits, connection: conn }));
    assert.equal(e.trace.reused, true);
    assert.equal(e.kind, "network");
    assert.ok(staleKeptConnection(e));
    assert.match(traceSummary(e.trace), /\breused\b/);
    // The agent drops the broken connection: the next call opens a new one and succeeds.
    assert.equal((await transportRequest(`${url}/c`, { method: "GET" }, { ...limits, connection: conn })).status, 200);
    conn.close();
    await close(server);
  }

  // 8b. A kept connection the path has gone SILENT on (the request is written, nothing ever comes back): it is given up
  //     after reusedReplyMs, not the full idle limit, as a "timeout" marked reused -- also recognised by staleKeptConnection.
  {
    let n = 0;
    const { server, url } = await serve((req, res) => { req.resume(); n++; if (n === 2) return; res.end("{}"); });
    const conn = baiduConnection();
    await transportRequest(`${url}/a`, { method: "GET" }, { ...limits, idleTimeoutMs: 4_000, connection: conn, reusedReplyMs: 300 });
    const t0 = Date.now();
    const e = await failure(transportRequest(`${url}/b`, { method: "GET" }, { ...limits, idleTimeoutMs: 4_000, connection: conn, reusedReplyMs: 300 }));
    assert.ok(Date.now() - t0 < 2_000, "given up after reusedReplyMs, not the 4 s idle limit");
    assert.equal(e.kind, "timeout"); assert.equal(e.trace.reused, true); assert.equal(e.trace.phase, "reply");
    assert.ok(staleKeptConnection(e));
    conn.close();
    await close(server);
  }

  // 9. The real Baidu client (readPdfWithBaidu, node transport) against a local stand-in: the submit on its own
  //    connection; polls (running, then done) and the result on one kept connection; a poll the path went silent on is
  //    sent again once on a new connection (after REUSED_REPLY_MS).
  {
    let connections = 0, polls = 0, dropped = false;
    const { server, url } = await serve((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.method === "POST") { res.end(JSON.stringify({ code: 0, data: { jobId: "job-ka-1" } })); return; }
        if (req.url?.startsWith("/api/v2/ocr/jobs/job-ka-1")) {
          polls++;
          if (polls === 2 && !dropped) { dropped = true; return; } // silent: no reply on the kept connection
          const done = polls >= 3;
          res.end(JSON.stringify({ code: 0, data: done ? { state: "done", resultUrl: { jsonUrl: `${url}/result.jsonl` } } : { state: "running" } }));
          return;
        }
        if (req.url === "/result.jsonl") { res.end(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "Kept connection page text" } }] } }) + "\n"); return; }
        res.statusCode = 404; res.end("{}");
      });
    });
    server.on("connection", () => { connections++; });
    setBaiduTransportForTests("https");
    const env = { BAIDU_AISTUDIO_TOKEN: TOKEN, BAIDU_OCR_BASE_URL: url, BAIDU_OCR_POLL_INTERVAL_MS: "1", BAIDU_PADDLEOCR_MODEL: "PaddleOCR-VL-1.5" } as unknown as NodeJS.ProcessEnv;
    const got = await readPdfWithBaidu(new Uint8Array([37, 80, 68, 70]), env, Date.now() + 30_000);
    assert.deepEqual(got.pages, ["Kept connection page text"]);
    assert.equal(polls, 3, "running, silent (sent again), done");
    assert.equal(connections, 3, "the submit's own, the kept one for polls, and one replacing the silent one");
    await close(server);
  }

  // 10. `via`: the connection goes to the front door (here 127.0.0.1), the service's own name (which does not even
  //     resolve here) is sent as the Host header, a caller's own Host header is replaced, and the trace says via=edge.
  {
    let host: string | undefined, hosts = 0;
    const { server, url } = await serve((req, res) => { host = req.headers.host; hosts = req.rawHeaders.filter((h, i) => i % 2 === 0 && /^host$/i.test(h)).length; req.resume(); res.statusCode = 401; res.end("{}"); });
    const port = new URL(url).port;
    const r = await transportRequest(`http://ocr-service.invalid:${port}/api/v2/ocr/jobs`, { method: "POST", body: "{}", headers: { Host: "elsewhere.example" } }, { ...limits, via: "127.0.0.1" });
    assert.equal(r.status, 401);
    assert.equal(host, `ocr-service.invalid:${port}`); assert.equal(hosts, 1, "one Host header");
    // A failure's trace names the front door.
    await close(server);
    const e = await failure(transportRequest(`http://ocr-service.invalid:${port}/x`, { method: "GET" }, { ...limits, via: "127.0.0.1" }));
    assert.equal(e.trace.via, true); assert.match(traceSummary(e.trace), /\bvia=edge\b/);
    // Without via, the trace carries no via mark at all.
    const plain = await failure(transportRequest(`http://127.0.0.1:${port}/x`, { method: "GET" }, limits));
    assert.equal(plain.trace.via, undefined); assert.doesNotMatch(traceSummary(plain.trace), /via=/);
  }

  // 11. Which calls use the front door. Default: Baidu's own service host goes through aistudio.baidu.com; another base
  //     URL (a test server, a proxy someone configured) does not; BAIDU_OCR_VIA=off connects directly; a front door must
  //     be a valid name under one of Baidu's own domains (the token travels to it), never a look-alike or an address.
  {
    const E = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    const base = "https://paddleocr.aistudio-app.com";
    assert.equal(BAIDU_DEFAULT_VIA, "aistudio.baidu.com");
    assert.equal(baiduOcrSettings(E({})).via, "aistudio.baidu.com");
    assert.equal(baiduVia(E({}), "http://127.0.0.1:9999"), undefined);
    for (const off of ["off", "OFF", "direct", "0", "false", "none"]) assert.equal(baiduVia(E({ BAIDU_OCR_VIA: off }), base), undefined, off);
    assert.equal(baiduVia(E({ BAIDU_OCR_VIA: "edge.baidu.com" }), base), "edge.baidu.com");
    assert.equal(baiduVia(E({ BAIDU_OCR_VIA: "Aistudio.Baidu.com" }), "http://127.0.0.1:1"), "aistudio.baidu.com");
    for (const bad of ["evil.com", "baidu.com.evil.com", "evilbaidu.com", "45.113.194.117", "aistudio.baidu.com:8443", "aistudio.baidu.com/x", "paddleocr.aistudio-app.com"])
      assert.equal(baiduVia(E({ BAIDU_OCR_VIA: bad }), base), undefined, bad);
    const v = { host: "aistudio.baidu.com", for: "paddleocr.aistudio-app.com" };
    assert.equal(viaHostFor(`${base}/api/v2/ocr/jobs`, v), "aistudio.baidu.com");
    assert.equal(viaHostFor("https://PaddleOCR.aistudio-app.com/api/v2/ocr/jobs/1", v), "aistudio.baidu.com");
    assert.equal(viaHostFor("https://bj.bcebos.com/result.jsonl?sig=x", v), undefined, "a result link on storage connects itself");
    assert.equal(viaHostFor(`${base}/x`, undefined), undefined);
    assert.equal(viaHostFor("not a url", v), undefined);
  }

  // 12. TLS through the front door (https, throwaway self-signed certificates). The TLS name (SNI) is the front door's
  //     name and the certificate is checked against it, NOT against the service's name in the Host header: a
  //     certificate for the front door passes; a certificate only for the service's name fails at TLS, before the
  //     request (and its token) is ever sent.
  {
    const dir = mkdtempSync(join(tmpdir(), "via-tls-"));
    const make = (name: string) => {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.pem`), "-days", "1",
        "-subj", `/CN=${name}`, "-addext", `subjectAltName=DNS:${name}`], { stdio: "ignore" });
      return { key: readFileSync(join(dir, `${name}.key`), "utf8"), cert: readFileSync(join(dir, `${name}.pem`), "utf8") };
    };
    const door = make("localhost"), service = make("service.invalid");
    rmSync(dir, { recursive: true, force: true });
    for (const [label, pair, expectOk] of [["front door certificate", door, true], ["service-name-only certificate", service, false]] as const) {
      let sni: string | false | undefined, host: string | undefined, auth: string | undefined, requests = 0;
      // The name the client asked for, seen during the handshake (before the client checks the certificate).
      const server = createHttpsServer({ key: pair.key, cert: pair.cert, SNICallback: (name, cb) => { sni = name; cb(null, undefined); } }, (req, res) => { requests++; host = req.headers.host; auth = req.headers.authorization; req.resume(); res.statusCode = 401; res.end("{}"); });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as AddressInfo).port;
      const call = transportRequest(`https://service.invalid:${port}/api/v2/ocr/jobs`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${TOKEN}` } },
        { ...limits, family: 4, via: "localhost", ca: pair.cert });
      if (expectOk) {
        assert.equal((await call).status, 401, label);
        assert.equal(sni, "localhost", "the TLS name is the front door's");
        assert.equal(host, `service.invalid:${port}`); assert.equal(auth, `Bearer ${TOKEN}`);
      } else {
        const e = await failure(call);
        assert.equal(e.kind, "network", label); assert.equal(e.trace.phase, "tls");
        assert.equal(requests, 0, "nothing (and no token) is sent when the certificate does not match the front door");
        assert.equal(sni, "localhost");
      }
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  console.log("DearPolicy Baidu transport (local servers): multipart submit, JSON submit, idle limit at reply, stalled upload, refused connection, total limit while trickling, IPv4 lookup, no path or token in the trace, polls on one kept-open connection per job, the submit on its own, a dropped or silent kept connection replaced, Baidu's front door (via) for the service host only, TLS name and certificate check on the front door's name -- passed. Baidu's live service is NOT covered.");
}

main().catch((error) => { console.error(error); process.exit(1); });
