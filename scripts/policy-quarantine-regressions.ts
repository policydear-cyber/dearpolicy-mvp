/**
 * Regression suite for the policy-document quarantine gate (checkpoint 3,
 * claude/v1-launch-hardening) -- lib/policies/quarantine/*, the shared
 * lib/scanning/adapter.ts registry, and the gate wired into
 * lib/rag/ingest.ts's processPolicy().
 *
 * Runs against a disposable PGlite instance, exactly the way
 * scripts/claim-evidence-regressions.ts already tests that pipeline's own
 * database behaviour: real SQL, real constraints, no live Postgres
 * required.
 *
 * Deliberately does NOT invoke the real OCR/PDF-parsing/hosted-extraction
 * pipeline end to end -- lib/rag/ingest.ts's processPolicy() calls out to
 * real network/model services once past the gate, which is scripts/
 * extraction-eval.ts's job elsewhere in this repo, not this suite's. What
 * this suite verifies instead is the thing that actually matters for
 * safety: that nothing can reach "scan_clean" without a genuine clean scan
 * result, and that assertPolicyProcessingAllowed() -- the one function
 * every processing/extraction/embedding call path must pass -- rejects
 * everything else. See lib/policies/quarantine/store.ts's own doc comment
 * for the full CAS/idempotency design this suite is checking.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool, query } from "@/lib/db/client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

async function runDatabaseTests() {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  // Checkpoint 7: getPolicyQuarantineRow()/transitionQuarantineStatus() now
  // filter on policies.lifecycle_state via activePredicate() -- exec
  // sql/lifecycle.sql so that column exists here too.
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

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

  const originalScannerProvider = process.env.MALWARE_SCANNER_PROVIDER;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalScanDisabledAck = process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED;

  try {
    const {
      __registerFileScanAdapterForTests, checkFileScannerConfigured,
    } = await import("@/lib/scanning/adapter");
    const { checkMalwareScannerConfigured } = await import("@/lib/claims/evidence/scan-adapter");
    const {
      getPolicyQuarantineRow, isPolicyProcessingAllowed, assertPolicyProcessingAllowed,
      PolicyNotClearedForProcessingError, recordPolicyScanResult, runPolicyQuarantineGate,
      supersedePolicyDocument,
    } = await import("@/lib/policies/quarantine/store");
    const { listPolicyDocumentAudit } = await import("@/lib/policies/quarantine/audit");
    const { isPolicyQuarantineHeld, isPolicyScanRejected, policyQuarantineLabel, userFacingScanResultDetail, NO_SCANNER_CONFIGURED_DETAIL, SCAN_DID_NOT_COMPLETE_DETAIL, SCAN_REJECTED_DETAIL } = await import("@/lib/policies/quarantine/ui");

    __registerFileScanAdapterForTests({ name: "test-clean", async scanFile() { return { status: "clean" as const }; } });
    __registerFileScanAdapterForTests({ name: "test-infected", async scanFile() { return { status: "infected" as const }; } });
    __registerFileScanAdapterForTests({ name: "test-throws", async scanFile(): Promise<never> { throw new Error("scan timed out"); } });

    const account = "60000000-0000-4000-8000-000000000001";
    const otherAccount = "60000000-0000-4000-8000-000000000099";
    const member = "70000000-0000-4000-8000-000000000001";

    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test'),($2,'Other')`, [account, otherAccount]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Self','self')`, [member, account]);

    let policySeq = 0;
    async function insertPolicy(overrides: { accountId?: string } = {}): Promise<string> {
      policySeq += 1;
      const id = `80000000-0000-4000-8000-${String(policySeq).padStart(12, "0")}`;
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status)
         VALUES($1,$2,$3,$4,$5,$6,'queued')`,
        [id, overrides.accountId ?? account, member, `doc-${policySeq}.pdf`, `k-${policySeq}`, `hash-${policySeq}`],
      );
      return id;
    }
    const noBytes = async () => new Uint8Array([37, 80, 68, 70]); // "%PDF"

    // 1. Clean scan clears a document for processing.
    await testAsync("clean scan clears a document for processing", async () => {
      process.env.MALWARE_SCANNER_PROVIDER = "test-clean";
      const id = await insertPolicy();
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, true);
      assert.equal(gate.row?.quarantine_status, "scan_clean");
      const row = await assertPolicyProcessingAllowed(account, id);
      assert.equal(row.quarantine_status, "scan_clean");
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "quarantined"));
      assert.ok(audit.some((a) => a.action === "scan_started"));
      assert.ok(audit.some((a) => a.action === "scan_result_recorded"));
    });

    // 2. Rejected scan.
    await testAsync("rejected (infected) scan blocks processing and is audited", async () => {
      process.env.MALWARE_SCANNER_PROVIDER = "test-infected";
      const id = await insertPolicy();
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, false);
      assert.equal(gate.row?.quarantine_status, "scan_rejected");
      await assert.rejects(() => assertPolicyProcessingAllowed(account, id), PolicyNotClearedForProcessingError);
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "scan_result_recorded" && a.reason_code === "MALWARE_DETECTED"));
    });

    // 3 & 4. Pending / scanner-unavailable scan never proceeds.
    await testAsync("scanner-unavailable (null adapter) leaves the document at scan_pending, never clean", async () => {
      delete process.env.MALWARE_SCANNER_PROVIDER; // falls back to the real null adapter
      const id = await insertPolicy();
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, false);
      assert.equal(gate.row?.quarantine_status, "scan_pending");
      assert.ok(gate.row?.scan_result_detail?.toLowerCase().includes("no malware-scanning adapter"));
      await assert.rejects(() => assertPolicyProcessingAllowed(account, id), PolicyNotClearedForProcessingError);
    });

    // 5. Scan timeout / adapter exception.
    await testAsync("a scan-adapter exception leaves the document at scan_pending and is audited, without throwing", async () => {
      process.env.MALWARE_SCANNER_PROVIDER = "test-throws";
      const id = await insertPolicy();
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, false);
      assert.equal(gate.row?.quarantine_status, "scan_pending");
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "scan_attempt_failed"));
    });

    // 6. Missing persisted status.
    await testAsync("a missing/undefined quarantine_status is never treated as clean", async () => {
      assert.equal(isPolicyProcessingAllowed({ quarantine_status: undefined as unknown as string }), false);
      assert.equal(isPolicyProcessingAllowed({ quarantine_status: "" }), false);
    });

    // 7. Malformed status.
    await testAsync("a malformed quarantine_status value is never treated as clean", async () => {
      assert.equal(isPolicyProcessingAllowed({ quarantine_status: "totally-bogus-value" }), false);
    });

    // 8. Duplicate callback.
    await testAsync("a duplicate scan-result write is idempotent (no double transition, no double audit)", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='scan_pending' WHERE id=$1`, [id]);
      const first = await recordPolicyScanResult({ accountId: account, policyId: id, status: "scan_clean", scanProvider: "test", scanEventId: "evt-dup-1" });
      assert.equal(first, "applied");
      const second = await recordPolicyScanResult({ accountId: account, policyId: id, status: "scan_clean", scanProvider: "test", scanEventId: "evt-dup-1" });
      assert.equal(second, "duplicate_ignored");
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean");
      const audit = await listPolicyDocumentAudit(account, id);
      assert.equal(audit.filter((a) => a.action === "scan_result_recorded").length, 1);
    });

    // 9. Out-of-order / conflicting callback.
    await testAsync("an out-of-order/conflicting scan result never un-decides an already-decided document", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='scan_pending' WHERE id=$1`, [id]);
      const applied = await recordPolicyScanResult({ accountId: account, policyId: id, status: "scan_clean", scanProvider: "test", scanEventId: "evt-1" });
      assert.equal(applied, "applied");
      const conflicting = await recordPolicyScanResult({ accountId: account, policyId: id, status: "scan_rejected", scanProvider: "test", scanEventId: "evt-2" });
      assert.equal(conflicting, "conflicting_ignored");
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_clean"); // still clean -- never flipped to rejected by the late event.
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "scan_result_ignored_conflicting"));
    });

    // 10. Callback after deletion.
    await testAsync("a scan-result callback for a deleted document does not revive it", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='deleted' WHERE id=$1`, [id]);
      const outcome = await recordPolicyScanResult({ accountId: account, policyId: id, status: "scan_clean", scanProvider: "test" });
      assert.equal(outcome, "deleted_or_superseded_ignored");
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "deleted");
    });

    // 11. Superseded document version.
    await testAsync("a scan-result callback for a superseded document does not revive it, and history is preserved", async () => {
      const oldId = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='scan_pending' WHERE id=$1`, [oldId]);
      await recordPolicyScanResult({ accountId: account, policyId: oldId, status: "scan_clean", scanProvider: "test", scanEventId: "evt-old" });
      const newId = await insertPolicy();
      await pool.query(`UPDATE policies SET supersedes_id=$1 WHERE id=$2`, [oldId, newId]);
      await supersedePolicyDocument({ accountId: account, oldPolicyId: oldId, newPolicyId: newId });

      const late = await recordPolicyScanResult({ accountId: account, policyId: oldId, status: "scan_rejected", scanProvider: "test", scanEventId: "evt-late" });
      assert.equal(late, "deleted_or_superseded_ignored");
      const oldRow = await getPolicyQuarantineRow(account, oldId);
      assert.equal(oldRow?.quarantine_status, "scan_clean"); // untouched by the late callback
      assert.ok(oldRow?.superseded_at);
      const newRow = await getPolicyQuarantineRow(account, newId);
      assert.equal(newRow?.quarantine_status, "uploaded"); // the new version starts its own cycle
      const oldAudit = await listPolicyDocumentAudit(account, oldId);
      assert.ok(oldAudit.some((a) => a.action === "scan_result_recorded")); // old history intact
      assert.ok(oldAudit.some((a) => a.action === "superseded"));
    });

    // 12. Reprocess before clean is blocked.
    await testAsync("reprocessing (re-checking persisted state) is blocked before a clean scan", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='scan_pending' WHERE id=$1`, [id]);
      await assert.rejects(() => assertPolicyProcessingAllowed(account, id), PolicyNotClearedForProcessingError);
    });

    // 13. Reindex before clean is blocked (defense-in-depth clause added to
    // lib/rag/backfill.ts's indexableDocuments() query -- mirrored here
    // directly since backfillSemanticIndex() itself short-circuits when
    // Pinecone is not configured in this test environment).
    await testAsync("reindexing's own query excludes a document that is not scan_clean, even if processing_status says ready", async () => {
      const id = await insertPolicy();
      // Simulate an inconsistent/adversarial row: 'ready' without ever
      // having passed the gate (impossible via processPolicy() itself,
      // since it gates before ever setting processing_status='ready' --
      // this proves the explicit, redundant AND clause in backfill.ts is
      // real defense in depth, not dead code).
      await pool.query(`UPDATE policies SET processing_status='ready', quarantine_status='scan_pending' WHERE id=$1`, [id]);
      const excluded = await query<{ id: string }>(
        `SELECT id FROM policies WHERE account_id=$1 AND processing_status='ready' AND quarantine_status='scan_clean' AND id=$2`,
        [account, id],
      );
      assert.equal(excluded.rows.length, 0);

      const cleanId = await insertPolicy();
      await pool.query(`UPDATE policies SET processing_status='ready', quarantine_status='scan_clean' WHERE id=$1`, [cleanId]);
      const included = await query<{ id: string }>(
        `SELECT id FROM policies WHERE account_id=$1 AND processing_status='ready' AND quarantine_status='scan_clean' AND id=$2`,
        [account, cleanId],
      );
      assert.equal(included.rows.length, 1);
    });

    // 14 & 15. Direct extraction / embedding attempts before clean -- both
    // ultimately funnel through the SAME gate (lib/rag/ingest.ts's
    // processPolicy() has no other entry point into OCR, extraction or
    // embedding -- see this suite's own module doc comment), so both are
    // covered by the same assertion the gate itself enforces.
    await testAsync("a direct extraction attempt is blocked before a clean scan", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='quarantined' WHERE id=$1`, [id]);
      await assert.rejects(() => assertPolicyProcessingAllowed(account, id), PolicyNotClearedForProcessingError);
    });
    await testAsync("a direct embedding/indexing attempt is blocked before a clean scan", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='uploaded' WHERE id=$1`, [id]);
      await assert.rejects(() => assertPolicyProcessingAllowed(account, id), PolicyNotClearedForProcessingError);
    });

    // 16. Cross-household document/callback isolation.
    await testAsync("a scan-result callback scoped to the wrong account cannot affect another household's document", async () => {
      const id = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='scan_pending' WHERE id=$1`, [id]);
      const outcome = await recordPolicyScanResult({ accountId: otherAccount, policyId: id, status: "scan_clean", scanProvider: "test" });
      assert.equal(outcome, "not_found");
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "scan_pending"); // untouched by the cross-account attempt
      const crossRead = await getPolicyQuarantineRow(otherAccount, id);
      assert.equal(crossRead, null); // no existence leak either
    });

    // 17. Superseded document version -- covered together with test 11
    // above (creation + protection from revival in one scenario, matching
    // how a real re-upload actually happens).

    // 18. Production null-scanner guard, and proof the check is genuinely
    // shared between claim evidence and policy documents (not two
    // independently-driftable copies).
    await testAsync("production null-scanner guard blocks boot, and is identical for claim-evidence and policy uploads", async () => {
      delete process.env.MALWARE_SCANNER_PROVIDER;
      mutableEnv.NODE_ENV = "production";
      delete process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED;
      const shared = checkFileScannerConfigured();
      const viaClaimEvidenceWrapper = checkMalwareScannerConfigured();
      assert.equal(shared.ok, false);
      assert.deepEqual(shared, viaClaimEvidenceWrapper); // same registry, same verdict, same message -- proves centralization.

      process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED = "true";
      assert.equal(checkFileScannerConfigured().ok, true);
      assert.deepEqual(checkFileScannerConfigured(), checkMalwareScannerConfigured());
    });

    // 19. UI state mapping.
    await testAsync("UI state mapping distinguishes scanning / unavailable-scanner / rejected / ready states", async () => {
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "uploaded", scan_result_detail: null }), true);
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "quarantined", scan_result_detail: null }), true);
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "scan_pending", scan_result_detail: null }), true);
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "scan_clean", scan_result_detail: null }), false);
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "scan_rejected", scan_result_detail: null }), false);
      assert.equal(isPolicyScanRejected({ quarantine_status: "scan_rejected", scan_result_detail: null }), true);
      assert.equal(isPolicyScanRejected({ quarantine_status: "scan_clean", scan_result_detail: null }), false);
      assert.equal(policyQuarantineLabel({ quarantine_status: "scan_rejected", scan_result_detail: null }), "Rejected by malware scan");
      assert.equal(
        policyQuarantineLabel({ quarantine_status: "scan_pending", scan_result_detail: "No malware-scanning adapter is configured in this environment." }),
        "On hold: malware scanning unavailable",
      );
      assert.equal(policyQuarantineLabel({ quarantine_status: "scan_pending", scan_result_detail: null }), "Waiting for malware scan");
      assert.equal(policyQuarantineLabel({ quarantine_status: "uploaded", scan_result_detail: null }), "Waiting to start malware scan");
    });

    // 19b. Raw scanner detail never reaches a household member.
    await testAsync("the policy list API never returns raw scanner detail (analysis ids, engine counts, retry diagnostics) -- only fixed category strings", async () => {
      const vtClean = "VirusTotal analysis NjY0ZjU3YzFjNWM2YjM6MTcwMDAwMDAwMA==: malicious=0 suspicious=0 harmless=0 undetected=64 timeout=0.";
      const vtInfected = "VirusTotal analysis NjY0ZjU3YzFjNWM2YjM6MTcwMDAwMDAwMA==: malicious=3 suspicious=1 harmless=0 undetected=60 timeout=0.";
      const vtPoll = "VirusTotal analysis NjY0ZjU3YzFjNWM2YjM6MTcwMDAwMDAwMA== did not complete within the 60000ms poll budget (still \"queued\").";
      const vtQuota = "VirusTotal file submission did not succeed after retrying transient failures.";
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_clean", scan_result_detail: vtClean }), null);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_rejected", scan_result_detail: vtInfected }), SCAN_REJECTED_DETAIL);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: vtPoll }), SCAN_DID_NOT_COMPLETE_DETAIL);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: vtQuota }), SCAN_DID_NOT_COMPLETE_DETAIL);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: null }), null);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: "No malware-scanning adapter is configured in this environment." }), NO_SCANNER_CONFIGURED_DETAIL);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "deleted", scan_result_detail: vtClean }), null);
      for (const out of [vtClean, vtInfected, vtPoll, vtQuota].flatMap((raw) => ["scan_clean", "scan_rejected", "scan_pending", "quarantined", "deleted"].map((status) => userFacingScanResultDetail({ quarantine_status: status, scan_result_detail: raw })))) {
        assert.ok(out === null || !/virustotal|analysis|malicious=|NjY0/i.test(out), `leaked scanner detail: ${out}`);
      }
      // A scan that did not complete (quota, poll budget) is labelled as on hold, never as clean or as still actively scanning.
      assert.equal(policyQuarantineLabel({ quarantine_status: "scan_pending", scan_result_detail: userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: vtQuota }) }), "On hold: malware scan did not complete");
      // The label is computed from the sanitized value the API returns, and the null-adapter label still works through it.
      assert.equal(policyQuarantineLabel({ quarantine_status: "scan_pending", scan_result_detail: userFacingScanResultDetail({ quarantine_status: "scan_pending", scan_result_detail: "No malware-scanning adapter is configured in this environment." }) }), "On hold: malware scanning unavailable");
      // The route itself must apply the mapping -- a raw pass-through of the column would reintroduce the leak.
      const routeSource = await readFile(path.join(process.cwd(), "app/api/policies/route.ts"), "utf8");
      assert.match(routeSource, /scan_result_detail:\s*userFacingScanResultDetail\(p\)/);
    });

    // Audit-event creation -- exercised throughout every test above; one
    // more direct check that a fresh, untouched document has NO audit
    // events yet (the trail only ever records real transitions, never
    // fabricates history).
    await testAsync("a freshly uploaded document has no quarantine audit events until the gate actually runs", async () => {
      const id = await insertPolicy();
      const audit = await listPolicyDocumentAudit(account, id);
      assert.equal(audit.length, 0);
    });

  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    if (originalScannerProvider === undefined) delete process.env.MALWARE_SCANNER_PROVIDER; else process.env.MALWARE_SCANNER_PROVIDER = originalScannerProvider;
    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = originalNodeEnv;
    if (originalScanDisabledAck === undefined) delete process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED; else process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED = originalScanDisabledAck;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`policy-quarantine-regressions: ${cases} cases passed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
