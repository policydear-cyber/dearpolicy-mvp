/**
 * Prototype document-safety mode (MALWARE_SCANNING_INTENTIONALLY_DISABLED)
 * regressions, run against a disposable PGlite instance with the repository
 * schema, exactly like scripts/policy-quarantine-regressions.ts.
 *
 * Proves, against the real gate/state machine/UI mapping:
 *  1. Exactly one document-safety mode may be active: a real scanner AND the
 *     flag together are refused; neither, in production, is refused; each
 *     one alone is accepted. A selected real scanner always wins at runtime.
 *  2. In prototype mode a NEW upload proceeds to processing recorded as
 *     not_scanned_prototype -- never scan_clean, never "clean", scanned_at
 *     stays NULL -- with an audited scan_skipped_prototype entry and the
 *     fixed household-readable detail.
 *  3. Documents already held (scan_pending with a recorded unavailable
 *     verdict, scan_rejected) are NOT silently relabelled when prototype
 *     mode is enabled.
 *  4. Re-enabling a real scanner scans NEW uploads normally and rewrites
 *     nothing about documents ingested while scanning was off.
 *  5. The UI mapping never claims a scan happened: prototype-mode labels are
 *     the fixed received/reading wording, and no mapping output ever says
 *     "scan passed", "malware-free" or "safe".
 *  6. The claim-evidence pipeline's scan_status accepts the distinct
 *     not_scanned_prototype value (database CHECK constraint) and its status
 *     display uses the same fixed wording.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

async function main() {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-evidence.sql"), "utf8"));

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
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  const saved = {
    provider: process.env.MALWARE_SCANNER_PROVIDER,
    flag: process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED,
    nodeEnv: process.env.NODE_ENV,
  };

  try {
    const {
      __registerFileScanAdapterForTests, checkFileScannerConfigured, malwareScanningIntentionallyDisabled,
      MALWARE_SCANNING_DISABLED_FLAG, PROTOTYPE_SCANNING_DISABLED_WARNING,
    } = await import("@/lib/scanning/adapter");
    const {
      getPolicyQuarantineRow, isPolicyProcessingAllowed, runPolicyQuarantineGate, recordPolicyScanResult,
    } = await import("@/lib/policies/quarantine/store");
    const { listPolicyDocumentAudit } = await import("@/lib/policies/quarantine/audit");
    const {
      isPolicyQuarantineHeld, policyQuarantineLabel, userFacingScanResultDetail,
      PROTOTYPE_NOT_SCANNED_DETAIL, PROTOTYPE_RECEIVED_MESSAGE, persistableScanResultDetail,
    } = await import("@/lib/policies/quarantine/ui");
    const { evidenceStatusDisplay } = await import("@/lib/claims/evidence/document-catalogue");

    __registerFileScanAdapterForTests({ name: "proto-test-clean", async scanFile() { return { status: "clean" as const }; } });
    let scannerCalls = 0;
    __registerFileScanAdapterForTests({ name: "proto-test-counting", async scanFile() { scannerCalls += 1; return { status: "clean" as const }; } });

    const account = "61000000-0000-4000-8000-000000000001";
    const member = "71000000-0000-4000-8000-000000000001";
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Prototype Test')`, [account]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Self','self')`, [member, account]);
    let seq = 0;
    async function insertPolicy(): Promise<string> {
      seq += 1;
      const id = `81000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status)
         VALUES($1,$2,$3,$4,$5,$6,'queued')`,
        [id, account, member, `doc-${seq}.pdf`, `k-${seq}`, `hash-${seq}`],
      );
      return id;
    }
    const noBytes = async () => new Uint8Array([37, 80, 68, 70]);

    // ------------------------------------------------------------------
    // 1. Exactly one mode may be active.
    // ------------------------------------------------------------------
    await testAsync("both modes configured is refused, in production and out of it", async () => {
      for (const nodeEnv of ["production", "test"]) {
        const result = checkFileScannerConfigured({ NODE_ENV: nodeEnv, MALWARE_SCANNER_PROVIDER: "virustotal", [MALWARE_SCANNING_DISABLED_FLAG]: "true" } as unknown as NodeJS.ProcessEnv);
        assert.equal(result.ok, false, nodeEnv);
        assert.match(result.message, /Ambiguous|Exactly one mode/);
      }
    });
    await testAsync("neither mode configured is refused in production; each alone is accepted", async () => {
      assert.equal(checkFileScannerConfigured({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).ok, false);
      assert.equal(checkFileScannerConfigured({ NODE_ENV: "production", MALWARE_SCANNER_PROVIDER: "virustotal" } as unknown as NodeJS.ProcessEnv).ok, true);
      const prototype = checkFileScannerConfigured({ NODE_ENV: "production", [MALWARE_SCANNING_DISABLED_FLAG]: "true" } as unknown as NodeJS.ProcessEnv);
      assert.equal(prototype.ok, true);
      assert.match(prototype.message, /not_scanned_prototype/);
      assert.match(prototype.message, /launch readiness remains blocked/i);
      assert.doesNotMatch(prototype.message, /remain quarantined/i);
    });
    await testAsync("a selected real scanner always wins at runtime", async () => {
      assert.equal(malwareScanningIntentionallyDisabled({ [MALWARE_SCANNING_DISABLED_FLAG]: "true", MALWARE_SCANNER_PROVIDER: "virustotal" } as unknown as NodeJS.ProcessEnv), false);
      assert.equal(malwareScanningIntentionallyDisabled({ [MALWARE_SCANNING_DISABLED_FLAG]: "true" } as unknown as NodeJS.ProcessEnv), true);
      assert.equal(malwareScanningIntentionallyDisabled({} as unknown as NodeJS.ProcessEnv), false);
    });

    // ------------------------------------------------------------------
    // 2. Prototype mode: new upload proceeds, recorded honestly.
    // ------------------------------------------------------------------
    delete process.env.MALWARE_SCANNER_PROVIDER;
    process.env[MALWARE_SCANNING_DISABLED_FLAG] = "true";

    await testAsync("prototype mode: a new upload is released as not_scanned_prototype, never clean, never scanned", async () => {
      const id = await insertPolicy();
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, true);
      const row = await getPolicyQuarantineRow(account, id);
      assert.equal(row?.quarantine_status, "not_scanned_prototype");
      assert.equal(row?.scanned_at, null, "a document that was not scanned never gets a scanned_at timestamp");
      assert.equal(row?.scan_result_detail, PROTOTYPE_NOT_SCANNED_DETAIL);
      assert.equal(isPolicyProcessingAllowed(row!), true);
      const audit = await listPolicyDocumentAudit(account, id);
      assert.ok(audit.some((a) => a.action === "scan_skipped_prototype"), "the skip is audited distinctly");
      assert.ok(!audit.some((a) => a.action === "scan_result_recorded"), "no scan result is ever recorded");
      assert.ok(!JSON.stringify(audit).includes("scan_clean"), "nothing about the document says scan_clean");
    });

    // ------------------------------------------------------------------
    // 3. Existing held/rejected documents are not silently relabelled.
    // ------------------------------------------------------------------
    await testAsync("prototype mode leaves an already-held (scan attempted, unavailable) document held", async () => {
      delete process.env[MALWARE_SCANNING_DISABLED_FLAG];
      process.env.MALWARE_SCANNER_PROVIDER = "proto-test-unavailable";
      __registerFileScanAdapterForTests({ name: "proto-test-unavailable", async scanFile() { return { status: "scan_unavailable" as const, detail: "provider unreachable" }; } });
      const id = await insertPolicy();
      await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      const before = await getPolicyQuarantineRow(account, id);
      assert.equal(before?.quarantine_status, "scan_pending");
      // Now the operator switches prototype mode on. Re-running the gate
      // (a reprocess, a queue pass) must NOT release or relabel this
      // document -- it rested at scan_pending after a real scan attempt.
      delete process.env.MALWARE_SCANNER_PROVIDER;
      process.env[MALWARE_SCANNING_DISABLED_FLAG] = "true";
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, false);
      const after = await getPolicyQuarantineRow(account, id);
      assert.equal(after?.quarantine_status, "scan_pending");
      assert.equal(isPolicyProcessingAllowed(after!), false);
    });
    await testAsync("prototype mode leaves a scan_rejected document rejected", async () => {
      delete process.env[MALWARE_SCANNING_DISABLED_FLAG];
      process.env.MALWARE_SCANNER_PROVIDER = "proto-test-infected2";
      __registerFileScanAdapterForTests({ name: "proto-test-infected2", async scanFile() { return { status: "infected" as const }; } });
      const id = await insertPolicy();
      await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      delete process.env.MALWARE_SCANNER_PROVIDER;
      process.env[MALWARE_SCANNING_DISABLED_FLAG] = "true";
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: id, readBytes: noBytes });
      assert.equal(gate.cleared, false);
      assert.equal((await getPolicyQuarantineRow(account, id))?.quarantine_status, "scan_rejected");
    });

    // ------------------------------------------------------------------
    // 4. Re-enabling a real scanner: new uploads scanned, old rows untouched.
    // ------------------------------------------------------------------
    await testAsync("re-enabling a real scanner scans new uploads and rewrites nothing ingested while off", async () => {
      process.env[MALWARE_SCANNING_DISABLED_FLAG] = "true";
      delete process.env.MALWARE_SCANNER_PROVIDER;
      const prototypeId = await insertPolicy();
      await runPolicyQuarantineGate({ accountId: account, policyId: prototypeId, readBytes: noBytes });
      const prototypeRow = await getPolicyQuarantineRow(account, prototypeId);
      assert.equal(prototypeRow?.quarantine_status, "not_scanned_prototype");

      // The operator re-enables scanning (and removes the flag).
      delete process.env[MALWARE_SCANNING_DISABLED_FLAG];
      process.env.MALWARE_SCANNER_PROVIDER = "proto-test-counting";
      const scannedId = await insertPolicy();
      const before = scannerCalls;
      const gate = await runPolicyQuarantineGate({ accountId: account, policyId: scannedId, readBytes: noBytes });
      assert.equal(scannerCalls, before + 1, "the new upload is genuinely scanned");
      assert.equal(gate.row?.quarantine_status, "scan_clean");
      // The prototype-era document is untouched: same status, still allowed
      // to be read (its extraction is not lost), still honestly not-scanned.
      const rerun = await runPolicyQuarantineGate({ accountId: account, policyId: prototypeId, readBytes: noBytes });
      assert.equal(rerun.cleared, true);
      const unchanged = await getPolicyQuarantineRow(account, prototypeId);
      assert.equal(unchanged?.quarantine_status, "not_scanned_prototype");
      assert.equal(unchanged?.scanned_at, null);
    });

    // ------------------------------------------------------------------
    // 5. UI mapping never claims a scan happened.
    // ------------------------------------------------------------------
    await testAsync("UI mapping: prototype wording, and never any claim of a passed scan", async () => {
      const held = { quarantine_status: "scan_pending", scan_result_detail: null };
      assert.equal(policyQuarantineLabel(held, "not_scanned_prototype"), PROTOTYPE_RECEIVED_MESSAGE);
      assert.equal(policyQuarantineLabel({ quarantine_status: "uploaded", scan_result_detail: null }, "not_scanned_prototype"), PROTOTYPE_RECEIVED_MESSAGE);
      // A rejected document keeps its truthful history in either mode.
      assert.equal(policyQuarantineLabel({ quarantine_status: "scan_rejected", scan_result_detail: null }, "not_scanned_prototype"), "Rejected by malware scan");
      assert.equal(isPolicyQuarantineHeld({ quarantine_status: "not_scanned_prototype", scan_result_detail: null }), false);
      assert.equal(userFacingScanResultDetail({ quarantine_status: "not_scanned_prototype", scan_result_detail: PROTOTYPE_NOT_SCANNED_DETAIL }), PROTOTYPE_NOT_SCANNED_DETAIL);
      assert.equal(persistableScanResultDetail("not_scanned_prototype", "raw provider text"), PROTOTYPE_NOT_SCANNED_DETAIL);
      const forbidden = /scan passed|security scan passed|malware.?free|virus.?free|\bsafe file\b|virustotal approved|scanned and clean/i;
      for (const status of ["uploaded", "quarantined", "scan_pending", "not_scanned_prototype", "scan_clean"]) {
        for (const mode of ["malware_scan", "not_scanned_prototype"] as const) {
          const label = policyQuarantineLabel({ quarantine_status: status, scan_result_detail: null }, mode);
          assert.doesNotMatch(label, forbidden, `${status}/${mode}`);
        }
      }
      assert.doesNotMatch(PROTOTYPE_NOT_SCANNED_DETAIL, forbidden);
      assert.doesNotMatch(PROTOTYPE_SCANNING_DISABLED_WARNING, forbidden);
      for (const status of ["uploaded", "quarantined"]) {
        const display = evidenceStatusDisplay({ status, scan_status: "not_scanned_prototype" });
        assert.equal(display.detail, "Document received — reading and extracting information.");
        assert.doesNotMatch(`${display.label} ${display.detail}`, forbidden);
        assert.doesNotMatch(`${display.label} ${display.detail}`, /scan/i);
      }
    });

    // ------------------------------------------------------------------
    // 6. Database constraints accept the distinct value (both tables), and
    //    the gate function alone cannot invent scan_clean in prototype mode.
    // ------------------------------------------------------------------
    await testAsync("claim_evidence_documents.scan_status accepts not_scanned_prototype and refuses invented values", async () => {
      const claim = "91000000-0000-4000-8000-000000000001";
      await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,facts) VALUES($1,$2,$3,'{}'::jsonb)`, [claim, account, member]);
      await pool.query(
        `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,scan_status)
         VALUES($1,$2,$3,'death_certificate','x.pdf','k-ev-1','application/pdf',10,'h-ev-1','not_scanned_prototype')`,
        [account, member, claim],
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,scan_status)
           VALUES($1,$2,$3,'death_certificate','y.pdf','k-ev-2','application/pdf',10,'h-ev-2','definitely_scanned')`,
          [account, member, claim],
        ),
      );
    });
    await testAsync("recordPolicyScanResult(not_scanned_prototype) only ever moves a scan_pending row", async () => {
      process.env[MALWARE_SCANNING_DISABLED_FLAG] = "true";
      delete process.env.MALWARE_SCANNER_PROVIDER;
      const id = await insertPolicy();
      // Still 'uploaded': the CAS refuses -- nothing skips the gate's own cascade.
      const outcome = await recordPolicyScanResult({ accountId: account, policyId: id, status: "not_scanned_prototype", scanProvider: "none" });
      assert.notEqual(outcome, "applied");
      assert.equal((await getPolicyQuarantineRow(account, id))?.quarantine_status, "uploaded");
    });

    await testAsync("read-side trust: chat/estimate reads admit scan_clean and not_scanned_prototype, nothing else", async () => {
      const { trustedPolicyStatePredicate } = await import("@/lib/policies/trusted");
      const rows: { id: string; state: string; trusted: boolean }[] = [];
      for (const [state, trusted] of [
        ["uploaded", false], ["quarantined", false], ["scan_pending", false],
        ["scan_clean", true], ["not_scanned_prototype", true], ["scan_rejected", false],
      ] as const) {
        const id = await insertPolicy();
        await pool.query(`UPDATE policies SET quarantine_status=$1 WHERE id=$2`, [state, id]);
        rows.push({ id, state, trusted });
      }
      // A superseded release is out regardless of its scan state.
      const superseded = await insertPolicy();
      await pool.query(`UPDATE policies SET quarantine_status='not_scanned_prototype', superseded_at=now() WHERE id=$1`, [superseded]);
      const listed = await pool.query<{ id: string }>(`SELECT p.id FROM policies p WHERE ${trustedPolicyStatePredicate("p")}`);
      const trustedIds = new Set(listed.rows.map((r) => r.id));
      for (const row of rows) assert.equal(trustedIds.has(row.id), row.trusted, `${row.state} trusted=${row.trusted}`);
      assert.equal(trustedIds.has(superseded), false, "a superseded prototype release is never read");
    });

    console.log(`Prototype document-safety mode regressions passed (${cases} cases).`);
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    if (saved.provider === undefined) delete process.env.MALWARE_SCANNER_PROVIDER; else process.env.MALWARE_SCANNER_PROVIDER = saved.provider;
    if (saved.flag === undefined) delete process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED; else process.env.MALWARE_SCANNING_INTENTIONALLY_DISABLED = saved.flag;
    if (saved.nodeEnv === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = saved.nodeEnv;
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
