/** Where the path from this server to Baidu's OCR host breaks (DC, 11 Nov: "find out exactly what's the issue, I don't want
 * you to assume or guess"). Run once when a submit to Baidu could not be completed (no connection, or no answer in time),
 * it checks each step on its own, with its own time limit, and says which one fails:
 *   region  the Vercel region this function ran in (VERCEL_REGION), or "local";
 *   dns     the host's addresses (public server addresses only) and how long the lookup took;
 *   tcp     a connection to port 443 of the first address;
 *   tls     the secure handshake on that connection (the host's own name as SNI);
 *   http    the first reply to a plain GET of the jobs path, WITHOUT any token: a reachable Baidu answers 401 (or another
 *           status) at once; no reply within the limit is "timeout".
 * The token is never read, sent or recorded here. Never throws: a step that fails ends the probe and names the failure. */
import { lookup } from "node:dns/promises";
import { connect as tcpConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type ProbeResult = { region: string; host: string; via?: string; dns: string; tcp: string; tls: string; http: string };
type Steps = { lookup?: typeof lookup; tcp?: typeof tcpConnect; tls?: typeof tlsConnect; now?: () => number; port?: number; tlsOptions?: { ca?: string } };

const errName = (error: unknown) => {
  const e = error as { code?: unknown; name?: unknown } | null;
  const code = typeof e?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(e.code) ? e.code : null;
  return code ?? (typeof e?.name === "string" ? e.name.slice(0, 40) : "error");
};

function within<T>(ms: number, run: (done: (v: T) => void, fail: (e: unknown) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let cleanup: () => void = () => undefined;
    const timer = setTimeout(() => { cleanup(); reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })); }, ms);
    cleanup = run((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); cleanup(); reject(e); });
  });
}

/** `via`: check the path the calls take, to Baidu's front door (DNS, TCP and TLS to that host), asking it for `host`. */
export async function probeBaiduPath(baseUrl: string, opts: { stepMs?: number; env?: NodeJS.ProcessEnv; via?: string } & Steps = {}): Promise<ProbeResult> {
  const env = opts.env ?? process.env, stepMs = opts.stepMs ?? 6_000, now = opts.now ?? Date.now;
  const region = (env.VERCEL_REGION ?? "").trim().replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "local";
  let host = "", path = "/api/v2/ocr/jobs";
  try { const u = new URL(baseUrl); host = u.hostname; path = (u.pathname.replace(/\/+$/, "") || "") + path; } catch { /* below */ }
  const out: ProbeResult = { region, host, dns: "-", tcp: "-", tls: "-", http: "-" };
  if (!host) { out.dns = "bad base url"; return out; }
  const peer = opts.via || host;
  if (opts.via) out.via = opts.via;

  let t = now(), address = "";
  try {
    const found = await within<{ address: string }[]>(stepMs, (done, fail) => { (opts.lookup ?? lookup)(peer, { all: true }).then(done, fail); return () => undefined; });
    address = found[0]?.address ?? "";
    out.dns = `${now() - t}ms ${found.map((a) => a.address).slice(0, 4).join(",")}`.trim();
    if (!address) { out.dns += " (no address)"; return out; }
  } catch (error) { out.dns = `${errName(error)} after ${now() - t}ms`; return out; }

  let socket: Socket | null = null, secure: TLSSocket | null = null;
  try {
    t = now();
    socket = await within<Socket>(stepMs, (done, fail) => {
      const s = (opts.tcp ?? tcpConnect)({ host: address, port: opts.port ?? 443 });
      s.once("connect", () => done(s)); s.once("error", fail);
      return () => s.destroy();
    });
    out.tcp = `${now() - t}ms`;
  } catch (error) { out.tcp = `${errName(error)} after ${now() - t}ms`; return out; }

  try {
    t = now();
    secure = await within<TLSSocket>(stepMs, (done, fail) => {
      const s = (opts.tls ?? tlsConnect)({ socket: socket!, servername: peer, ...(opts.tlsOptions ?? {}) });
      s.once("secureConnect", () => done(s)); s.once("error", fail);
      return () => s.destroy();
    });
    out.tls = `${now() - t}ms ${secure.getProtocol?.() ?? ""}`.trim();
  } catch (error) { out.tls = `${errName(error)} after ${now() - t}ms`; socket.destroy(); return out; }

  try {
    t = now();
    const status = await within<string>(stepMs, (done, fail) => {
      let head = "";
      secure!.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        const line = head.split("\r\n")[0];
        if (head.includes("\r\n") || head.length > 200) done((line.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1]) ?? "unreadable");
      });
      secure!.once("error", fail);
      secure!.once("end", () => done(head ? (head.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1] ?? "unreadable") : "closed with no reply"));
      secure!.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: dearpolicy-path-probe\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
      return () => undefined;
    });
    out.http = `${status} after ${now() - t}ms`;
  } catch (error) { out.http = `${errName(error)} after ${now() - t}ms`; } finally { secure.destroy(); }
  return out;
}

export const probeSummary = (p: ProbeResult) => `region=${p.region} host=${p.host}${p.via ? ` via=${p.via}` : ""} dns=${p.dns} tcp=${p.tcp} tls=${p.tls} http=${p.http}`;
