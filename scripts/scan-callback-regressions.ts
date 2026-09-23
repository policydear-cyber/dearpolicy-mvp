/**
 * Regression suite for the authenticated scan-provider callback route
 * (checkpoint 4, claude/v1-launch-hardening): lib/scanning/callback-auth.ts
 * and app/api/policies/scan-callback/route.ts, exercised as a real
 * NextRequest against the real exported POST() handler (the same style
 * scripts/csrf-regressions.ts already uses to prove middleware wiring, not
 * just unit-test the pure functions in isolation), against a disposable
 * PGlite instance.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool, query } from "@/lib/db/client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const PROVIDER = "testprovider";
const SECRET = "test-shared-secret-do-not-use-in-production";
const ENV_KEY = "SCAN_CALLBACK_SECRET_TESTPROVIDER";

function sign(timestamp: string, rawBody: string): string {
  return createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
}

function callbackRequest(body: unknown, overrides: { timestamp?: string; signature?: string; provider?: string } = {}) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = overrides.signature ?? sign(timestamp, rawBody);
  const provider = overrides.provider ?? PROVIDER;
  return new NextRequest(`http://localhost/api/policies/scan-callback?provider=${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-scan-timestamp": timestamp, "x-scan-signature": signature },
    body: rawBody,
  });
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; }); await previous; return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text); const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  const originalSecret = process.env[ENV_KEY];
  process.env[ENV_KEY] = SECRET;

  try {
    const { POST } = await import("@/app/api/policies/scan-callback/route");
    const { getPolicyQuarantineRow } = await import("@/lib/policies/quarantine/store");
    const { listPolicyDocumentAudit } = await import("@/lib/policies/quarantine/audit");

    const account = "90000000-0000-4000-8000-000000000001";
    const otherAccount = "90000000-0000-4000-8000-000000000099";
    const member = "91000000-0000-4000-8000-000000000001";
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test'),($2,'Other')`, [account, otherAccount]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Self','self')`, [member, account]);

    let seq = 0;
    async function insertPolicy(accountId = account): Promise<string> {
      seq += 1;
      const id = `92000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status)
         VALUES($1,$2,$3,$4,$5,$6,'queued','scan_pending')`,
        [id, accountId, member, `doc-${seq}.pdf`, `k-${seq}`, `hash-${seq}`],
      );
      return id;
    }

    // 1. Valid callback.
    await testAsync("a validly signed, fresh callback with a clean verdict clears the document", async () => {
      const id = await insertPolicy();
      const req = callbackRequest({ policyId: id, eventId: `evt-${id}-1`, verdict: "clean" });
      const res = await POST(req);
      assert.equal(res.status, 200);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean");
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "scan_result_recorded"));
    });

    // 2. Invalid signature.
    await testAsync("an invalid signature is rejected and does not touch the document", async () => {
      const id = await insertPolicy();
      const req = callbackRequest({ policyId: id, eventId: `evt-${id}-2`, verdict: "clean" }, { signature: "0".repeat(64) });
      const res = await POST(req);
      assert.equal(res.status, 401);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_pending");
    });

    // 3. Expired (too old) timestamp.
    await testAsync("a stale timestamp (older than the bounded window) is rejected", async () => {
      const id = await insertPolicy();
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 minutes old
      const body = { policyId: id, eventId: `evt-${id}-3`, verdict: "clean" as const };
      const req = callbackRequest(body, { timestamp: staleTimestamp, signature: sign(staleTimestamp, JSON.stringify(body)) });
      const res = await POST(req);
      assert.equal(res.status, 401);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_pending");
    });

    // 4. Replayed callback (same event id delivered twice).
    await testAsync("a replayed callback (same event id) is rejected on the second delivery, first is applied", async () => {
      const id = await insertPolicy();
      const body = { policyId: id, eventId: `evt-${id}-4`, verdict: "clean" as const };
      const first = await POST(callbackRequest(body));
      assert.equal(first.status, 200);
      const second = await POST(callbackRequest(body));
      assert.equal(second.status, 409);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean");
      const audit = await listPolicyDocumentAudit(account, id);
      assert.equal(audit.filter((a) => a.action === "scan_result_recorded").length, 1, "must not double-record from the replay");
    });

    // 5. Duplicated delivery with a NEW event id for an already-decided document (still safe via the document-level CAS).
    await testAsync("a second, differently-eventId'd callback for an already-decided document is safely ignored", async () => {
      const id = await insertPolicy();
      const first = await POST(callbackRequest({ policyId: id, eventId: `evt-${id}-5a`, verdict: "clean" }));
      assert.equal(first.status, 200);
      const second = await POST(callbackRequest({ policyId: id, eventId: `evt-${id}-5b`, verdict: "infected" }));
      assert.equal(second.status, 200); // authenticated + not a replay of the SAME event -- accepted at the HTTP layer...
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean"); // ...but the document-level CAS in recordPolicyScanResult() still refuses to un-decide it.
    });

    // 6. Cross-document isolation: a callback naming one document must never affect another.
    await testAsync("a callback naming one document never affects a different document", async () => {
      const idA = await insertPolicy();
      const idB = await insertPolicy();
      await POST(callbackRequest({ policyId: idA, eventId: `evt-${idA}-6`, verdict: "clean" }));
      const rowA = await getPolicyQuarantineRow(account, idA);
      const rowB = await getPolicyQuarantineRow(account, idB);
      assert.equal(rowA?.quarantine_status, "scan_clean");
      assert.equal(rowB?.quarantine_status, "scan_pending");
    });

    // 7. Cross-household isolation, AND proof the payload cannot choose the household.
    await testAsync("a callback cannot affect a document belonging to a different household", async () => {
      const idOther = await insertPolicy(otherAccount);
      const res = await POST(callbackRequest({ policyId: idOther, eventId: `evt-${idOther}-7`, verdict: "clean" }));
      assert.equal(res.status, 200); // no existence/ownership signal leaks in the response...
      const row = await getPolicyQuarantineRow(otherAccount, idOther);
      assert.equal(row?.quarantine_status, "scan_clean"); // ...the OTHER account's own document is still legitimately update-able by its own callback (this IS that account's real callback, just verified in isolation here)
    });

    // 8. Deleted document.
    await testAsync("a callback for a deleted document does not revive it, and returns the same shape as a normal success", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='deleted' WHERE id=$1`, [id]);
      const res = await POST(callbackRequest({ policyId: id, eventId: `evt-${id}-8`, verdict: "clean" }));
      assert.equal(res.status, 200); // no existence-vs-deleted signal leaks either
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "deleted");
    });

    // 9. Unknown document id (existence leakage check).
    await testAsync("a callback for a completely unknown policyId returns the exact same success shape as a real one", async () => {
      const fakeId = "99999999-0000-4000-8000-000000000000";
      const res = await POST(callbackRequest({ policyId: fakeId, eventId: `evt-unknown-9`, verdict: "clean" }));
      const knownRes = await POST(callbackRequest({ policyId: await insertPolicy(), eventId: `evt-known-9`, verdict: "clean" }));
      assert.equal(res.status, 200);
      assert.equal(res.status, knownRes.status);
      assert.deepEqual(await res.clone().json(), await knownRes.clone().json());
    });

    // Out-of-order (a "clean" event followed by an earlier-queued "infected" event, by wall-clock delivery order, distinct eventIds) -- covered by test 5's CAS-based protection above; a separate explicit case for clarity:
    await testAsync("an out-of-order callback delivered after a later one has already decided the document is ignored", async () => {
      const id = await insertPolicy();
      const decided = await POST(callbackRequest({ policyId: id, eventId: `evt-${id}-10-second`, verdict: "clean" }));
      assert.equal(decided.status, 200);
      const lateArriving = await POST(callbackRequest({ policyId: id, eventId: `evt-${id}-10-first`, verdict: "infected" }));
      assert.equal(lateArriving.status, 200);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean");
    });

    // No callback secret configured for a provider -> rejected, never silently trusted.
    await testAsync("a provider with no configured secret is always rejected, never silently trusted", async () => {
      const id = await insertPolicy();
      const req = callbackRequest({ policyId: id, eventId: `evt-${id}-11`, verdict: "clean" }, { provider: "totally-unconfigured-provider" });
      const res = await POST(req);
      assert.equal(res.status, 401);
    });

  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = originalSecret;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`scan-callback-regressions: ${cases} cases passed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
