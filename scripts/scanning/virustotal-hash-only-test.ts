/**
 * No file content leaves DearPolicy for malware scanning by default (lib/scanning/adapters/virustotal.ts). With
 * VirusTotal selected, only the file's SHA-256 is looked up; the whole file is uploaded only when
 * VIRUSTOTAL_UPLOAD_FILES=true. A file VirusTotal flags is rejected; any other file, including one it has never seen,
 * proceeds only when DearPolicy's local file check passes, so nothing is held forever. Made-up documents; every
 * request is captured by a fake fetch, nothing reaches the network.
 *   npm run scanning:virustotal-hash-only-test
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];

let passed = 0;
const failed: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); }
}

type Call = { url: string; method: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stats = (malicious = 0, suspicious = 0) => ({ malicious, suspicious, undetected: 60, harmless: 0, timeout: 0, "confirmed-timeout": 0, failure: 0, "type-unsupported": 4 });

async function main() {
  const { currentFileScanAdapter } = await import("@/lib/scanning/adapter");
  const KEYS = ["MALWARE_SCANNER_PROVIDER", "VIRUSTOTAL_API_KEY", "VIRUSTOTAL_UPLOAD_FILES", "VIRUSTOTAL_MAX_TRANSIENT_RETRIES", "VIRUSTOTAL_RETRY_BACKOFF_BASE_MS", "VIRUSTOTAL_POLL_INTERVAL_MS"];
  async function scan(bytes: Uint8Array, replies: Array<() => Response>, env: Record<string, string | undefined> = {}) {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    const calls: Call[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), method: init.method ?? "GET", body: init.body });
      const reply = replies[calls.length - 1];
      if (!reply) throw new Error("unexpected request " + (init.method ?? "GET") + " " + String(input));
      return reply();
    }) as typeof fetch;
    Object.assign(process.env, { MALWARE_SCANNER_PROVIDER: "virustotal", VIRUSTOTAL_API_KEY: "test-key-not-real", VIRUSTOTAL_MAX_TRANSIENT_RETRIES: "1", VIRUSTOTAL_RETRY_BACKOFF_BASE_MS: "1", VIRUSTOTAL_POLL_INTERVAL_MS: "1" });
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (!("VIRUSTOTAL_UPLOAD_FILES" in env)) delete process.env.VIRUSTOTAL_UPLOAD_FILES;
    try { return { result: await currentFileScanAdapter().scanFile(bytes), calls }; }
    finally {
      globalThis.fetch = realFetch;
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  }
  const doc = (text: string) => new TextEncoder().encode("%PDF-1.4\n" + text + "\n%%EOF");
  const medical = doc("Medical card schedule (fictitious). Insured: Siti Rahmah. Diagnosis history: asthma. Hospital limit RM150,000.");
  const sha = createHash("sha256").update(medical).digest("hex");
  /** True when any request carries file content: a request body, or words of the document in its URL. */
  const sentContent = (calls: Call[]) => calls.some((c) => c.body != null || c.url.includes("Siti") || c.url.includes("asthma"));

  await t("by default only the file's SHA-256 is looked up: one GET, no body, no file content in any request", async () => {
    const { result, calls } = await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: stats() } } })]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.ok(calls[0].url.endsWith("/files/" + sha), calls[0].url);
    assert.equal(sentContent(calls), false);
    assert.equal(result.status, "clean");
  });
  await t("a file VirusTotal knows as malicious or suspicious is infected", async () => {
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: stats(3, 0) } } })])).result.status, "infected");
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: stats(0, 1) } } })])).result.status, "infected");
  });
  await t("a file VirusTotal has never seen is NOT uploaded; the local check passes an ordinary document, which proceeds", async () => {
    const { result, calls } = await scan(medical, [() => json(404, { error: { code: "NotFoundError", message: "File not found" } })]);
    assert.equal(result.status, "clean");
    assert.match(result.detail ?? "", /no record of this file[\s\S]*Local file check passed/);
    assert.equal(calls.length, 1, "no upload follows the lookup");
    assert.equal(sentContent(calls), false);
  });
  await t("a never-seen file with active content is rejected, and a known-clean file still has to pass the local check", async () => {
    const withScript = doc("1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj Insured: Siti Rahmah.");
    const unseen = await scan(withScript, [() => json(404, { error: { code: "NotFoundError", message: "x" } })]);
    assert.equal(unseen.result.status, "infected"); assert.match(unseen.result.detail ?? "", /active_content/);
    const known = await scan(withScript, [() => json(200, { data: { attributes: { last_analysis_stats: stats() } } })]);
    assert.equal(known.result.status, "infected");
    const notAPdf = await scan(new TextEncoder().encode("%PDF-1.4 cut off before its end marker"), [() => json(404, { error: { code: "NotFoundError", message: "x" } })]);
    assert.equal(notAPdf.result.status, "infected");
  });
  await t("only an explicit VIRUSTOTAL_UPLOAD_FILES=true uploads; '1', 'yes', 'on' or a typo stay hash-only", async () => {
    for (const v of ["1", "yes", "on", "ture", "", "false"]) {
      const { calls } = await scan(medical, [() => json(404, { error: { code: "NotFoundError", message: "x" } })], { VIRUSTOTAL_UPLOAD_FILES: v });
      assert.equal(sentContent(calls), false, "value " + JSON.stringify(v));
      assert.equal(calls[0].method, "GET");
    }
    const { calls } = await scan(medical, [() => json(200, { data: { id: "a-1", type: "analysis" } }), () => json(200, { data: { attributes: { status: "completed", stats: stats() } } })], { VIRUSTOTAL_UPLOAD_FILES: "true" });
    assert.equal(calls[0].method, "POST"); assert.ok(calls[0].body instanceof FormData, "with the setting on, the existing upload flow runs");
  });
  await t("a rate limit is retried, then scan_unavailable with a retry hint (never clean)", async () => {
    const limited = () => json(429, { error: { code: "QuotaExceededError", message: "Quota exceeded" } });
    const { result, calls } = await scan(medical, [limited, limited]);
    assert.equal(result.status, "scan_unavailable"); assert.equal(result.retry?.reason, "rate_limited");
    assert.equal(calls.length, 2); assert.equal(sentContent(calls), false);
  });
  await t("a lookup reply with no analysis stats is an error, not a verdict", async () => {
    await assert.rejects(() => scan(medical, [() => json(200, { data: { attributes: {} } })]));
  });
  await t("other made-up documents (£ home schedule, S$ travel) are looked up by their own hash only", async () => {
    for (const d of [doc("Thames Home (fictitious). Policyholder: Oliver Grant. Buildings £350,000."), doc("Wanderlust Travel (fictitious). Traveller: Tan Wei Ming. Medical S$250,000.")]) {
      const { calls } = await scan(d, [() => json(404, { error: { code: "NotFoundError", message: "x" } })]);
      assert.ok(calls[0].url.endsWith("/files/" + createHash("sha256").update(d).digest("hex")));
      assert.equal(calls.length, 1); assert.equal(calls[0].body, undefined);
    }
  });
  console.log(`\nVirusTotal hash-only: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
