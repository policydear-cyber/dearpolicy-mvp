import { request as httpRequest, Agent as HttpAgent } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";

import { isIP, type Socket } from "node:net";

/**
 * The HTTP transport for Baidu's PaddleOCR service, built on node:https instead of fetch (undici) because the
 * production calls failed in two ways that fetch cannot tell apart or tune (11 Nov 2026, model_executions):
 *   - about 10 s, "network": undici's FIXED 10 s connect timeout (DNS + TCP + TLS) fired. Baidu's own SDK
 *     (`paddleocr` 3.7.0, Python requests) waits up to 300 s to connect.
 *   - exactly 60 s, "timeout": the connection opened, then our 60 s cap on the WHOLE request (upload + Baidu's reply)
 *     fired. The SDK's 300 s is a per-read (no progress) limit, not a whole-request cap.
 * This transport:
 *   - waits `connectTimeoutMs` (default 30 s) for DNS + TCP + TLS;
 *   - after that, gives up only when NO bytes move for `idleTimeoutMs`, and always at `totalTimeoutMs`;
 *   - asks DNS for IPv4 only by default (`family`), as serverless functions generally have no IPv6 route out;
 *   - records how far each call got (DNS, connect, TLS, upload bytes, reply), so the next failure names the exact
 *     step that stalls instead of a bare "timeout". The record holds fixed words, numbers and Baidu's IP address only:
 *     never a header, the token, a URL path or page text.
 */

export type TransportPhase = "dns" | "connect" | "tls" | "upload" | "reply" | "body";

export type TransportTrace = {
  phase: TransportPhase;
  /** ms from the start of the call to each step that completed. */
  dnsMs?: number; connectMs?: number; tlsMs?: number; uploadedMs?: number; firstByteMs?: number;
  ip?: string; family?: number;
  /** The call went over a connection an earlier call of the same job had already opened (no DNS, TCP or TLS). */
  reused?: boolean;
  /** The connection went to the `via` host (Baidu's front door), not to the URL's own host. */
  via?: boolean;
  sentBytes: number; totalBytes: number;
  elapsedMs: number;
};

export class TransportError extends Error {
  kind: "timeout" | "network";
  code?: string;
  trace: TransportTrace;
  constructor(kind: "timeout" | "network", trace: TransportTrace, code?: string) {
    super(`transport ${kind} during ${trace.phase}`);
    this.name = "TransportError"; this.kind = kind; this.trace = trace; this.code = code;
  }
}

/** The part of a fetch Response the Baidu client uses. */
export type TransportResponse = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };

export type TransportRequest = {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  /** A multipart form (a file upload), or a JSON text (sent as application/json). */
  body?: FormData | string;
};

export type TransportOptions = {
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  /** 4 (default) or 6 to ask DNS for that address family only; 0 for either. */
  family?: 0 | 4 | 6;
  /** A keep-alive agent (baiduConnection) shared by the calls of one job, so they reuse one open connection, as Baidu's
   * own client does (paddleocr 3.7.0: one requests.Session). Without it each call opens and closes its own connection. */
  connection?: BaiduConnection;
  /** On a kept connection, the wait for the first reply byte (instead of idleTimeoutMs). A kept connection the path has
   * gone silent on answers nothing at all; a poll's small reply normally comes in well under a second. */
  reusedReplyMs?: number;
  /** Open the connection to this host instead of the URL's own (DNS, TCP and TLS, the certificate checked against THIS
   * name), and send the URL's host in the Host header. Baidu's front door (the address its other hosts, such as
   * aistudio.baidu.com, resolve to) passes the request to the service named in the Host header. */
  via?: string;
};
export type BaiduConnection = { https: HttpsAgent; http: HttpAgent; close: () => void };

/** One kept-open connection for the polls and result of one Baidu job (submit, each poll, the result), like Baidu's own client.
 * Each new connection to Baidu's Beijing host is another chance to meet the stretches where the path from Singapore
 * answers nothing (11 Nov 12:57Z: no TCP answer for 15.4 s, again 17 s later). An idle connection is closed after 20 s
 * (longer than the 15 s longest wait between polls), and `close()` ends it when the job is done. */
export function baiduConnection(): BaiduConnection {
  const options = { keepAlive: true, maxSockets: 1, maxFreeSockets: 1, timeout: 20_000 };
  const https = new HttpsAgent(options), http = new HttpAgent(options);
  return { https, http, close: () => { https.destroy(); http.destroy(); } };
}

const CHUNK = 64 * 1024;
const MAX_REPLY_BYTES = 64 * 1024 * 1024;

/** A short, fixed-words summary of a trace for the processing history, e.g.
 * "at=upload sent=1.2/3.4MB dns=40ms connect=180ms tls=420ms ip=4:1.2.3.4 t=60.0s". */
export function traceSummary(t: TransportTrace): string {
  const mb = (n: number) => (n / 1_048_576).toFixed(n < 104_858 ? 2 : 1);
  return [
    `at=${t.phase}`,
    t.totalBytes ? `sent=${mb(t.sentBytes)}/${mb(t.totalBytes)}MB` : undefined,
    t.dnsMs !== undefined ? `dns=${t.dnsMs}ms` : undefined,
    t.connectMs !== undefined ? `connect=${t.connectMs}ms` : undefined,
    t.tlsMs !== undefined ? `tls=${t.tlsMs}ms` : undefined,
    t.uploadedMs !== undefined ? `uploaded=${t.uploadedMs}ms` : undefined,
    t.firstByteMs !== undefined ? `reply=${t.firstByteMs}ms` : undefined,
    t.reused ? "reused" : undefined,
    t.via ? "via=edge" : undefined,
    t.ip && /^[0-9a-fA-F:.]{2,45}$/.test(t.ip) ? `ip=${t.family ?? "?"}:${t.ip}` : undefined,
    `t=${(t.elapsedMs / 1000).toFixed(1)}s`,
  ].filter(Boolean).join(" ");
}

/** The system error code on an error, when it is a plain code (ETIMEDOUT, ECONNRESET, ENOTFOUND...). */
function plainCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : undefined;
}

/** One HTTP request with the limits above. Resolves once the whole reply body has arrived. */
export async function transportRequest(url: string, req: TransportRequest, opts: TransportOptions): Promise<TransportResponse> {
  const target = new URL(url);
  let payload: Uint8Array | undefined;
  // Only GETs (polls, the result) ride the kept connection. A POST (the submit) always opens its own: if a kept
  // connection had gone stale or silent, a submit on it could not be tried again (it may have reached Baidu), whereas a
  // fresh connection that fails to open is retried safely (failedBeforeSending).
  const agent = opts.connection && req.method === "GET" ? (target.protocol === "https:" ? opts.connection.https : opts.connection.http) : undefined;
  const headers: Record<string, string> = { ...(req.headers ?? {}), connection: agent ? "keep-alive" : "close" };
  const via = opts.via?.trim().toLowerCase() || undefined;
  if (via) {
    for (const name of Object.keys(headers)) if (/^host$/i.test(name)) delete headers[name];
    headers.host = target.host;
  }
  if (req.body) {
    // The body sets these two itself; a caller's own spelling ("Content-Type") would otherwise be sent twice.
    for (const name of Object.keys(headers)) if (/^content-(type|length)$/i.test(name)) delete headers[name];
    // The standard encoding (the same bytes fetch would send), with a known length. A string is JSON.
    const encoded = new Response(req.body, typeof req.body === "string" ? { headers: { "content-type": "application/json" } } : undefined);
    payload = new Uint8Array(await encoded.arrayBuffer());
    headers["content-type"] = encoded.headers.get("content-type") ?? (typeof req.body === "string" ? "application/json" : "multipart/form-data");
    headers["content-length"] = String(payload.byteLength);
  }
  const started = Date.now();
  // An IP-literal host does no DNS lookup, so its first step is the connection.
  const trace: TransportTrace = { phase: isIP((via ?? target.hostname).replace(/^\[|\]$/g, "")) ? "connect" : "dns", ...(via ? { via: true } : {}), sentBytes: 0, totalBytes: payload?.byteLength ?? 0, elapsedMs: 0 };
  const since = () => Date.now() - started;
  const secure = target.protocol === "https:";
  const family = opts.family ?? 4;

  return new Promise<TransportResponse>((resolve, reject) => {
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const finish = (error?: TransportError, response?: TransportResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer); clearTimeout(totalTimer); clearTimeout(idleTimer);
      trace.elapsedMs = since();
      if (error) { error.trace.elapsedMs = trace.elapsedMs; request.destroy(); reject(error); }
      else resolve(response!);
    };
    const fail = (kind: "timeout" | "network", code?: string) => finish(new TransportError(kind, trace, code));
    const progress = () => {
      clearTimeout(idleTimer);
      const waitingOnKept = trace.reused && trace.firstByteMs === undefined && opts.reusedReplyMs !== undefined;
      idleTimer = setTimeout(() => fail("timeout"), waitingOnKept ? Math.min(opts.reusedReplyMs!, opts.idleTimeoutMs) : opts.idleTimeoutMs);
    };

    const request = (secure ? httpsRequest : httpRequest)({
      // With `via`, node connects to that host and checks the certificate against it (servername defaults to hostname).
      protocol: target.protocol, hostname: via ?? target.hostname, port: target.port || undefined,
      path: `${target.pathname}${target.search}`, method: req.method, headers,
      family: family || undefined, agent: agent ?? false,
    });
    const connectTimer = setTimeout(() => fail("timeout"), opts.connectTimeoutMs);
    const totalTimer = setTimeout(() => fail("timeout"), opts.totalTimeoutMs);

    const connected = () => {
      clearTimeout(connectTimer);
      progress();
      trace.phase = payload ? "upload" : "reply";
      if (!payload) { request.end(); return; }
      let offset = 0;
      const writeNext = () => {
        if (settled) return;
        if (offset >= payload!.byteLength) {
          request.end(() => { trace.uploadedMs = since(); if (trace.phase === "upload") trace.phase = "reply"; progress(); });
          return;
        }
        const piece = payload!.subarray(offset, offset + CHUNK);
        offset += piece.byteLength;
        // Count bytes as they are handed to the network (the write callback), so a stalled upload shows how far it got.
        // The kernel's send buffer means this can run ahead of what Baidu has received by up to a few MB.
        request.write(piece, () => { trace.sentBytes += piece.byteLength; progress(); writeNext(); });
      };
      writeNext();
    };

    request.on("socket", (socket: Socket) => {
      // A kept-open connection from the agent is already connected (and secured): no lookup/connect events follow.
      // (A free agent socket has always finished its TLS handshake; `connecting` is what tells a kept socket apart.)
      if (agent && !socket.connecting) {
        trace.reused = true; trace.dnsMs = trace.connectMs = since(); if (secure) trace.tlsMs = trace.connectMs;
        if (socket.remoteAddress) { trace.ip = socket.remoteAddress; trace.family = socket.remoteFamily === "IPv6" ? 6 : 4; }
        connected();
        return;
      }
      socket.on("lookup", (error, address, addrFamily) => {
        if (error) return;
        trace.dnsMs = since(); trace.ip = typeof address === "string" ? address : undefined;
        trace.family = typeof addrFamily === "number" ? addrFamily : undefined;
        trace.phase = "connect";
      });
      socket.on("connect", () => {
        trace.connectMs = since();
        if (trace.dnsMs === undefined) trace.dnsMs = trace.connectMs; // an IP-literal host does no lookup
        if (!trace.ip && socket.remoteAddress) { trace.ip = socket.remoteAddress; trace.family = socket.remoteFamily === "IPv6" ? 6 : 4; }
        if (secure) trace.phase = "tls"; else connected();
      });
      if (secure) socket.on("secureConnect", () => { trace.tlsMs = since(); connected(); });
    });

    request.on("response", (res) => {
      trace.firstByteMs = since();
      trace.phase = "body";
      progress();
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_REPLY_BYTES) { fail("network", "REPLY_TOO_LARGE"); return; }
        chunks.push(chunk); progress();
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        finish(undefined, {
          ok: status >= 200 && status < 300, status,
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
      res.on("error", (error) => fail("network", plainCode(error)));
    });
    request.on("error", (error) => fail("network", plainCode(error)));
  });
}
