/**
 * No file content leaves DearPolicy for malware scanning by default (lib/scanning/adapters/virustotal.ts). With
 * VirusTotal selected, only the file's SHA-256 is looked up; the whole file is uploaded only when
 * VIRUSTOTAL_UPLOAD_FILES=true. A file VirusTotal flags is rejected; a file it knows as harmless is clean; a file it
 * has never seen is "not_scanned" (never "clean"), and proceeds exactly like today's not-scanned path, so nothing is
 * held. Made-up documents; every
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
  const { currentScanAdapter } = await import("@/lib/claims/evidence/scan-adapter");
  async function scan(bytes: Uint8Array, replies: Array<() => Response>, env: Record<string, string | undefined> = {}, via: "policy" | "claim_evidence" = "policy") {
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
    try { return { result: await (via === "policy" ? currentFileScanAdapter() : currentScanAdapter()).scanFile(bytes), calls }; }
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
  await t("a file VirusTotal has never seen is NOT uploaded and is not_scanned, never clean", async () => {
    const { result, calls } = await scan(medical, [() => json(404, { error: { code: "NotFoundError", message: "File not found" } })]);
    assert.equal(result.status, "not_scanned");
    assert.doesNotMatch(result.detail ?? "", /\bclean\b|passed/i);
    assert.match(result.detail ?? "", /not malware-scanned/);
    assert.equal(calls.length, 1, "no upload follows the lookup");
    assert.equal(sentContent(calls), false);
  });
  await t("an unknown hash is labelled 'Not malware-scanned' and goes ahead like the not-scanned path (policy and claim evidence)", async () => {
    const { NOT_MALWARE_SCANNED_DETAIL, PROTOTYPE_NOT_SCANNED_DETAIL, persistableScanResultDetail, userFacingScanResultDetail } = await import("@/lib/policies/quarantine/ui");
    const { isPolicyProcessingAllowed } = await import("@/lib/policies/quarantine/store");
    const stored = persistableScanResultDetail("not_scanned", "VirusTotal has no record of this file");
    assert.equal(stored, NOT_MALWARE_SCANNED_DETAIL);
    const shown = userFacingScanResultDetail({ quarantine_status: "not_scanned_prototype", scan_result_detail: stored } as never) ?? "";
    assert.match(shown, /^Not malware-scanned/); assert.doesNotMatch(shown, /\bclean\b/i);
    // Scanning switched off still shows its own wording.
    assert.equal(userFacingScanResultDetail({ quarantine_status: "not_scanned_prototype", scan_result_detail: PROTOTYPE_NOT_SCANNED_DETAIL } as never), PROTOTYPE_NOT_SCANNED_DETAIL);
    // The policy row is recorded as not_scanned_prototype, which processing already allows (never held).
    assert.equal(isPolicyProcessingAllowed({ quarantine_status: "not_scanned_prototype" }), true);
    assert.equal(isPolicyProcessingAllowed({ quarantine_status: "scan_pending" }), false);
    const evidence = await scan(medical, [() => json(404, { error: { code: "NotFoundError", message: "x" } })], {}, "claim_evidence");
    assert.equal(evidence.result.status, "not_scanned_prototype", "claim evidence records the not-scanned state, never clean");
    assert.equal(sentContent(evidence.calls), false);
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
  await t("a lookup reply with no verdict, or one no engine actually judged, is not_scanned (never clean, never held)", async () => {
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: {} } })])).result.status, "not_scanned");
    const unjudged = { malicious: 0, suspicious: 0, undetected: 0, harmless: 0, timeout: 3, "confirmed-timeout": 0, failure: 1, "type-unsupported": 60 };
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: unjudged } } })])).result.status, "not_scanned");
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: { ...unjudged, harmless: 1 } } } })])).result.status, "clean");
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: { ...unjudged, malicious: 1 } } } })])).result.status, "infected");
    // A flag counts even when the reply is missing the other count.
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: { malicious: 2 } } } })])).result.status, "infected");
    assert.equal((await scan(medical, [() => json(200, { data: { attributes: { last_analysis_stats: { suspicious: 1 } } } })])).result.status, "infected");
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
