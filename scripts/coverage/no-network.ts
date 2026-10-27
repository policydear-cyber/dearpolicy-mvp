/** Preload for scripted tests that run app routes (`node --import tsx --import ./scripts/coverage/no-network.ts …`):
 * nothing they do can reach a model or any other service, so no test run can spend. Removes every model key from the
 * environment, and refuses any fetch, HTTP(S) request or socket connection that is not to this machine (the local
 * database). Refused requests are listed on globalThis.__refusedRequests for a test to assert on. */
import http from "node:http";
import https from "node:https";
import net from "node:net";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|_PROXY$/i.test(k)) delete process.env[k];

const refused: string[] = [];
(globalThis as { __refusedRequests?: string[] }).__refusedRequests = refused;
const LOCAL = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i;
const refuse = (where: string) => { refused.push(where); return new Error(`test run: request to ${where} refused (no network in tests)`); };

const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!LOCAL.test(u.hostname)) throw refuse(u.origin);
  return localFetch(input, init);
}) as typeof fetch;

for (const mod of [http, https] as const) {
  for (const name of ["request", "get"] as const) {
    const original = mod[name] as (...a: unknown[]) => http.ClientRequest;
    (mod as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const first = args[0];
      const host = typeof first === "string" || first instanceof URL ? new URL(String(first)).hostname
        : (first as { hostname?: string; host?: string } | undefined)?.hostname ?? (first as { host?: string } | undefined)?.host ?? "localhost";
      if (!LOCAL.test(String(host).replace(/:\d+$/, ""))) throw refuse(String(host));
      return original(...args);
    };
  }
}

const connect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0] as { host?: string; path?: string; port?: number } | number | string | unknown[];
  const opts = Array.isArray(first) ? (first[0] as { host?: string; path?: string }) : first;
  // A Unix socket (the local database) or a host on this machine is allowed; anything else is refused.
  const host = typeof opts === "object" && opts ? (opts.path ? "localhost" : opts.host ?? "localhost") : typeof args[1] === "string" ? args[1] : "localhost";
  if (!LOCAL.test(host)) { this.destroy(refuse(host)); return this; }
  return connect.apply(this, args);
} as typeof net.Socket.prototype.connect;
