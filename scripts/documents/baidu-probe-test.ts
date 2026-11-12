/** The Baidu path probe (lib/documents/baidu-probe.ts) names the step that fails: DNS, TCP, TLS or the first reply.
 * Local servers only (a throwaway self-signed certificate made with openssl for "probe.test"); no network, no token.
 *   npm run -s documents:baidu-probe-test */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as tcpServer, type AddressInfo } from "node:net";
import { createServer as tlsServer } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeBaiduPath, probeSummary } from "@/lib/documents/baidu-probe";

const dir = mkdtempSync(join(tmpdir(), "probe-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1",
  "-subj", "/CN=probe.test", "-addext", "subjectAltName=DNS:probe.test"], { stdio: "ignore" });
const key = readFileSync(join(dir, "k.pem"), "utf8"), cert = readFileSync(join(dir, "c.pem"), "utf8");
rmSync(dir, { recursive: true, force: true });
const local = (async () => [{ address: "127.0.0.1", family: 4 }]) as never;
const listen = (server: { listen: (p: number, h: string, cb: () => void) => void; address: () => unknown }) =>
  new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));

async function main() {
  const env = { VERCEL_REGION: "sin1" } as unknown as NodeJS.ProcessEnv;
  // 1. DNS fails: named, nothing further tried.
  let p = await probeBaiduPath("https://probe.test", { env, stepMs: 500, lookup: (async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); }) as never });
  assert.match(p.dns, /^ENOTFOUND after \d+ms$/); assert.equal(p.tcp, "-"); assert.equal(p.region, "sin1");

  // 2. Reachable and answering: every step timed, the first reply's status read (a plain GET, no token).
  let seenRequest = "";
  const ok = tlsServer({ key, cert }, (s) => { s.once("data", (d) => { seenRequest = d.toString(); s.end("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n"); }); });
  const okPort = await listen(ok);
  p = await probeBaiduPath("https://probe.test", { env, stepMs: 2000, lookup: local, port: okPort, tlsOptions: { ca: cert } });
  assert.match(p.dns, /^\d+ms 127\.0\.0\.1$/); assert.match(p.tcp, /^\d+ms$/); assert.match(p.tls, /^\d+ms TLSv1\.[23]$/); assert.match(p.http, /^401 after \d+ms$/);
  assert.match(seenRequest, /^GET \/api\/v2\/ocr\/jobs HTTP\/1\.1\r\nHost: probe\.test\r\n/);
  assert.ok(!/authorization|bearer/i.test(seenRequest), "no token is ever sent");
  assert.match(probeSummary(p), /^region=sin1 host=probe\.test dns=\d+ms 127\.0\.0\.1 tcp=\d+ms tls=\d+ms TLSv1\.[23] http=401 after \d+ms$/);
  ok.close();

  // 3. Connects, handshakes, then never answers: the first-reply step times out (the 11 Nov "timeout submit" shape).
  const silent = tlsServer({ key, cert }, () => undefined);
  const silentPort = await listen(silent);
  p = await probeBaiduPath("https://probe.test", { env, stepMs: 400, lookup: local, port: silentPort, tlsOptions: { ca: cert } });
  assert.match(p.tls, /^\d+ms/); assert.match(p.http, /^TIMEOUT after \d+ms$/);
  silent.close();

  // 4. TCP accepts but TLS never completes: the handshake step is named.
  const raw = tcpServer(() => undefined);
  const rawPort = await listen(raw);
  p = await probeBaiduPath("https://probe.test", { env, stepMs: 400, lookup: local, port: rawPort, tlsOptions: { ca: cert } });
  assert.match(p.tcp, /^\d+ms$/); assert.match(p.tls, /^TIMEOUT after \d+ms$/); assert.equal(p.http, "-");
  raw.close();

  // 5. Nothing listens: the connection step is named (refused).
  p = await probeBaiduPath("https://probe.test", { env, stepMs: 400, lookup: local, port: rawPort });
  assert.match(p.tcp, /^ECONNREFUSED after \d+ms$/); assert.equal(p.tls, "-");

  // 6. A certificate the client does not trust (an interception or a wrong host) is named at the TLS step.
  const other = tlsServer({ key, cert }, () => undefined);
  const otherPort = await listen(other);
  p = await probeBaiduPath("https://probe.test", { env, stepMs: 1000, lookup: local, port: otherPort });
  assert.match(p.tls, /^(DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE) after \d+ms$/);
  other.close();

  // 7. Off Vercel the region says so; a bad base URL never throws.
  p = await probeBaiduPath("not a url", { env: {} as NodeJS.ProcessEnv });
  assert.equal(p.region, "local"); assert.equal(p.dns, "bad base url");

  // 8. Through a front door (via): DNS, TCP and TLS go to the front door (its certificate checked against ITS name), the
  //    service's own name is sent as the Host header, and the summary names the front door.
  {
    let asked = "", seen = "";
    const door = tlsServer({ key, cert }, (s) => { s.once("data", (d) => { seen = d.toString(); s.end("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n"); }); });
    const doorPort = await listen(door);
    const lookupVia = (async (name: string) => { asked = name; return [{ address: "127.0.0.1", family: 4 }]; }) as never;
    p = await probeBaiduPath("https://service.test", { env, stepMs: 2000, lookup: lookupVia, port: doorPort, tlsOptions: { ca: cert }, via: "probe.test" });
    assert.equal(asked, "probe.test"); assert.match(p.tls, /^\d+ms TLSv1\.[23]$/); assert.match(p.http, /^401 after \d+ms$/);
    assert.match(seen, /^GET \/api\/v2\/ocr\/jobs HTTP\/1\.1\r\nHost: service\.test\r\n/);
    assert.match(probeSummary(p), /^region=sin1 host=service\.test via=probe\.test dns=/);
    door.close();
  }

  console.log("baidu-probe: DNS, TCP, TLS and first-reply steps each named and timed; through a front door when set; no token sent -- passed");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
