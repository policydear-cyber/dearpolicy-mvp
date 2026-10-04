/**
 * Round 9: builds one fixture household (R9_SUITE=r6|r7) through the REAL
 * ingestion pipeline -- under the ingestion chaos stand-in when
 * R9_INGEST_SEED is set -- and writes its stored-fact snapshot to R9_OUT.
 * With R9_PRISTINE=<snapshot of the same household read by the well-behaved
 * stand-in> it also audits every stored fact (scripts/r9/audit.ts) and writes
 * the violations. Run as a child process by scripts/r9-ingest-chaos-regressions.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r9ingest";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

async function main() {
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const quiet = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; quiet(...args); };
  const suite = process.env.R9_SUITE === "r7" ? "r7" : "r6";
  const F = suite === "r7" ? await import("../r7/fixture") : await import("../r6/fixture");
  const t0 = Date.now();
  const h = await F.buildHousehold();
  const { snapshot, audit } = await import("./audit");
  let snap = await snapshot(h.db, F.ACCOUNT);
  // R9_REREAD=1: every document is read AGAIN while the reader fails on every
  // call (an outage during a retry or a re-analysis). Nothing the first read
  // established may be lost, and nothing may be duplicated.
  if (process.env.R9_REREAD) {
    const first = snap;
    const { processPolicy } = await import("@/lib/rag/ingest");
    Object.assign(process.env as Record<string, string | undefined>, { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-1" });
    (globalThis as { __dpIngestChaosFailAll?: boolean }).__dpIngestChaosFailAll = true;
    // A re-read that cannot use the cached readings (a new reading model, a changed prompt).
    // R9_REREAD=cached keeps them (a plain retry).
    if (process.env.R9_REREAD !== "cached") await h.db.query("UPDATE policies SET reading_cache=NULL WHERE account_id=$1", [F.ACCOUNT]);
    const docs = (await h.db.query<{ id: string; family_member_id: string; storage_key: string }>("SELECT id::text AS id,family_member_id::text AS family_member_id,storage_key FROM policies WHERE account_id=$1 AND scan_provider IS NOT NULL AND processing_status='ready' ORDER BY id", [F.ACCOUNT])).rows;
    for (const d of docs) await processPolicy({ accountId: F.ACCOUNT, familyMemberId: d.family_member_id, policyId: d.id, storageKey: d.storage_key, linkUploadMember: true }).catch(() => undefined);
    (globalThis as { __dpIngestChaosFailAll?: boolean }).__dpIngestChaosFailAll = false;
    process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
    snap = await snapshot(h.db, F.ACCOUNT);
    const lost = lostFacts(first, snap);
    const violations = (await import("./audit")).audit(snap, first);
    if (process.env.R9_OUT) writeFileSync(process.env.R9_OUT, JSON.stringify({ suite, reread: docs.length, lost, violations }));
    quiet(`${suite} re-read of ${docs.length} documents with a failing reader: ${lost.length} fact(s) lost, ${violations.length} violation(s)`);
    for (const x of [...lost, ...violations.map((v) => v.kind + " [" + v.file + "] " + v.detail)].slice(0, 30)) quiet("  ✗ " + x);
    await h.db.close();
    return;
  }
  const log = ((globalThis as { __dpIngestChaosLog?: { op: string; mode: string }[] }).__dpIngestChaosLog ?? []).map((x) => x.op + ":" + x.mode);
  const pristine = process.env.R9_PRISTINE ? JSON.parse(readFileSync(process.env.R9_PRISTINE, "utf8")) : null;
  const violations = pristine ? audit(snap, pristine) : [];
  const failed = (await h.db.query<{ f: string }>("SELECT original_filename AS f FROM policies WHERE account_id=$1 AND processing_status<>'ready'", [F.ACCOUNT])).rows.map((r) => r.f);
  if (process.env.R9_OUT) writeFileSync(process.env.R9_OUT, JSON.stringify(pristine ? { suite, seed: process.env.R9_INGEST_SEED ?? "", violations, modes: log, notReady: failed, ms: Date.now() - t0 } : snap));
  quiet(`${suite} seed ${process.env.R9_INGEST_SEED || "pristine"}: built in ${Date.now() - t0} ms; ${log.length} ingestion model calls; ${violations.length} violation(s); not ready: ${failed.join(", ") || "none"}`);
  for (const x of violations.slice(0, Number(process.env.R9_SHOW ?? 30))) quiet(`  ✗ ${x.kind} [${x.file}] ${x.detail}`);
  await h.db.close();
}
/** Facts the first read stored that the second no longer has. */
function lostFacts(first: import("./audit").Snapshot, after: import("./audit").Snapshot): string[] {
  const k = (r: Record<string, unknown>, fields: string[]) => fields.map((f) => JSON.stringify(r[f] ?? null)).join("|");
  const out: string[] = [];
  const tables: [string, (s: import("./audit").Snapshot) => Record<string, unknown>[], string[]][] = [
    ["link", (s) => s.links, ["policy", "member"]],
    ["verified cover", (s) => s.coverages.filter((c) => c.confirmed && c.verified), ["policy", "member", "category", "amount", "currency"]],
    ["benefit", (s) => s.benefits, ["policy", "name", "kind", "value", "page", "tier"]],
    ["ledger rule", (s) => s.rules, ["policy", "member", "event_type", "pays_kind", "amount", "page"]],
    ["premium", (s) => s.premiums, ["policy", "member", "amount"]],
    ["condition", (s) => s.conditions, ["policy", "kind", "quote"]],
  ];
  for (const [name, rows, fields] of tables) {
    const have = new Set(rows(after).map((r) => k(r, fields)));
    for (const r of rows(first)) if (!have.has(k(r, fields))) out.push("lost " + name + ": " + (first.files[String(r.policy)] ?? r.policy) + " " + k(r, fields.slice(1)));
  }
  for (const p of first.policies) {
    const q = after.policies.find((x) => x.id === p.id);
    for (const f of ["insurer", "product_name", "policy_number", "start", "expiry", "document_role", "personal"]) if (q && p[f] != null && q[f] !== p[f]) out.push("lost " + f + ": " + first.files[String(p.id)] + " " + String(p[f]) + " -> " + String(q[f]));
  }
  return out;
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(2); });
